const debug  = require('debug')('pullrepo:lib:pull-request');
const logger = require('../helpers/logger');
const utils  = require('../helpers/utils');
const editor = require('../helpers/message-editor');
const colors = require('colors/safe');

const { s } = utils;

module.exports = [{
  single: true,
  async runner(context) {
    const branch = await utils.findWorkingBranch(context);
    if (!branch) {
      throw new Error(`Usage ${process.argv.join(' ')} <branch>`);
    }

    if (branch === 'master') {
      throw new Error('Refusing to create a PR on \'master\'');
    }

    context.setWorkingBranch(branch);
    logger.logInfo(`Will create pull requests on ${colors.bold(branch)}.`);
  }
}, {
  title: (context) => `Finding repo with branch '${context.getWorkingBranch()}'`,
  async runner(context, repo) {
    const branch = context.getWorkingBranch();
    const sg = context.getGitAPI(repo);
    try {
      await sg.revparse(['--verify', branch]);
      return true;
    } catch (err) {
      return false;
    }
  }
}, {
  single: true,
  async runner(context, checkoutResults) {
    const candidates = [];
    for (const { res, repo } of checkoutResults) {
      if (res) {
        candidates.push(repo);
      }
    }

    if (!candidates.length) {
      const branch = context.getWorkingBranch();
      logger.logInfo(`Cannot find any repository with branch '${branch}'.`);
      return context.interrupt();
    }

    context.isDraft = context.config.draft === true;
    const countRepos = candidates.length === 1 ? '' : `${candidates.length} repo${s(candidates)}: `;
    const reposStr = countRepos + formatArr(candidates);
    const validator = context.isDraft ? validateDraftPR : validateFinalPR;
    const valid = await validator(context, reposStr);

    if (!valid) {
      logger.logInfo('Aborted.');
      return context.interrupt();
    }

    context.pullRequestsPerRepo = new Map(candidates.map(repo => [repo, null]));
    context.pullRequestsParams = findPullRequestParams(context);
  }
}, {
  title: (context) => `Creating PR in '${formatArr(context.pullRequestsPerRepo.keys())}'`,
  async runner(context, repo) {
    if (!context.pullRequestsPerRepo.has(repo)) {
      return;
    }

    debug.enabled && debug(`Processing repository ${repo}...`);
    const ghRepo = await context.getGitHubAPI(repo);
    const { data: { html_url, number } } = await ghRepo.createPullRequest(context.pullRequestsParams);

    const prResult = { html_url, number };
    context.pullRequestsPerRepo.set(repo, prResult);

    const { reviewers } = context;
    if (!reviewers) {
      return;
    }

    try {
      await ghRepo.createReviewRequest(number, { reviewers });
    } catch (err) {
      prResult.errors = prResult.errors || [];
      prResult.errors.push(err);
    }
  }
}, {
  single: true,
  async runner(context) {
    if (!context.pullRequestsPerRepo.size) {
      return;
    }

    const repoSuffix = context.pullRequestsPerRepo.size > 1 ? 'ies' : 'y';
    const parts = [`Pull request in ${context.pullRequestsPerRepo.size} repositor${repoSuffix}:`];
    for (const [repo, { html_url }] of context.pullRequestsPerRepo) {
      parts.push(`* \`${repo}\` : [${html_url}](${html_url})`);
    }

    const issueLink = findIssueLink(context);
    if (issueLink) {
      parts.push(`\n\nRelated issue: ${issueLink}`);
    }

    const body = parts.join('\n');
    if (!context.config.m) {
      context.pullRequestsFinalDescription = { body };
      return;
    }

    const initialSpec = { title: context.pullRequestsParams.title, body };
    const edited = await editor.editPRDescription(initialSpec);

    context.pullRequestsFinalDescription = {};

    if (edited.title) {
      context.pullRequestsFinalDescription.title = edited.title;
    }
    if (edited.body) {
      context.pullRequestsFinalDescription.body = edited.body;
    }
  },
}, {
  title: 'Update PR description',
  async runner(context, repo) {
    const status = await context.getRepoCommonStatus(repo);
    if (!context.pullRequestsPerRepo.has(repo)) {
      return status;
    }

    const { title, body } = context.pullRequestsFinalDescription;
    if (!title && !body) {
      return;
    }

    const { number, html_url, errors } = context.pullRequestsPerRepo.get(repo);
    status.pr = html_url;
    const ghRepo = await context.getGitHubAPI(repo);
    await ghRepo.updatePullRequest(number, context.pullRequestsFinalDescription);

    if (errors) {
      status.errors = errors;
    }

    return status;
  }
}];

async function validateDraftPR(context, reposStr) {
  return utils.getYNAnswer(`Do you want to create a ${colors.bold('draft')} PR in ${reposStr}?`);
}

async function validateFinalPR(context, reposStr) {
  const reviewers = context.reviewers = findReviewers(context);
  const reviewersStr = reviewers ? formatArr(reviewers) + ' as reviewer' + s(reviewers) : colors.bold('no reviewer');
  return utils.getYNAnswer(`Do you want to create a PR in '${reposStr}' with ${reviewersStr}?`);
}

function findPullRequestParams(context) {
  const repos = Array.from(context.pullRequestsPerRepo.keys()).map(addBackTicks).join(', ');
  const title = `PR from \`${context.getWorkingBranch()}\` in ${repos}`;
  const head = context.getWorkingBranch();

  const params = { title, body: '', head, base: 'master' };

  if (context.isDraft) {
    params.draft = true;
    params.AcceptHeader = 'shadow-cat-preview';
  }

  return params;
}

function addBackTicks(s) {
  return '`' + s + '`';
}

function formatArr(repos) {
  return Array.from(repos).map(r => colors.bold(r)).join(', ');
}

function findReviewers(context) {
  const reviewers = findForcedReviewers(context) || findRandomReviewers(context);
  if (!reviewers) {
    return null;
  }

  const filteredReviewers = reviewers.filter((reviewer) => !!reviewer);
  return filteredReviewers.length > 0 ? filteredReviewers : null;
}

function findForcedReviewers(context) {
  const { reviewers, collaborators } = context.config;
  if (reviewers !== undefined) {
    return reviewers.split(',');
  }

  const collaboratorsArr = collaborators && collaborators.split(',');
  if (collaboratorsArr && (collaboratorsArr.length === 1 || collaboratorsArr.length === 2)) {
    return collaboratorsArr;
  }
}

function findRandomReviewers(context) {
  const { collaborators } = context.config;
  const collaboratorsArr = collaborators && collaborators.split(',');

  if (collaboratorsArr && collaboratorsArr.length >= 2) {
    return utils.pickRandom(collaboratorsArr, 2);
  }
}

function findIssueLink(context) {
  const branch = context.getWorkingBranch();
  if (!branch) {
    return;
  }

  const m = branch.match(/[0-9]{9}/);
  return m && 'https://www.pivotaltracker.com/story/show/' + m[0];
}
