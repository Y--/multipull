const debug  = require('debug')('pullrepo:lib:pull-request');
const logger = require('../helpers/logger');
const utils  = require('../helpers/utils');
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

    const countRepos = candidates.length === 1 ? '' : `${candidates.length} repo${s(candidates)}, `;
    const valid = await utils.getYNAnswer(`Do you want to create a PR in ${countRepos}${candidates.join(', ')}?`);
    if (!valid) {
      logger.logInfo('Aborted.');
      return context.interrupt();
    }

    context.pullRequestsPerRepo = new Map(candidates.map(repo => [repo, null]));
  }
}, {
  title: (context) => `Creating PR in '${formatRepos(context.pullRequestsPerRepo.keys())}'`,
  async runner(context, repo) {
    if (!context.pullRequestsPerRepo.has(repo)) {
      return;
    }

    debug.enabled && debug(`Processing repository ${repo}...`);
    const params = findPullRequestParams(context);
    const ghRepo = await context.getGitHubAPI(repo);
    const { data: { html_url, number } } = await ghRepo.createPullRequest(params);

    const reviewers = findReviewers(context);
    if (reviewers) {
      await ghRepo.createReviewRequest(number, { reviewers });
    }

    context.pullRequestsPerRepo.set(repo, { html_url, number });
  }
}, {
  single: true,
  runner(context) {
    if (!context.pullRequestsPerRepo.size) {
      return;
    }

    const repoSuffix = context.pullRequestsPerRepo.size > 1 ? 'ies' : 'y';
    const parts = [`Pull Request on ${context.pullRequestsPerRepo.size} repositor${repoSuffix}:`];
    for (const [repo, { html_url }] of context.pullRequestsPerRepo) {
      parts.push(`* \`${repo}\` : [${html_url}](${html_url})`);
    }

    context.pullRequestBody = parts.join('\n');
  },
}, {
  title: 'Update PR description',
  async runner(context, repo) {
    const status = await context.getRepoCommonStatus(repo);
    if (!context.pullRequestsPerRepo.has(repo)) {
      return status;
    }

    const { number, html_url } = context.pullRequestsPerRepo.get(repo);
    status.pr = html_url;
    const ghRepo = await context.getGitHubAPI(repo);
    await ghRepo.updatePullRequest(number, { body: context.pullRequestBody });

    return status;
  }
}];

function findPullRequestParams(context) {
  const repos = Array.from(context.pullRequestsPerRepo.keys()).map(addBackTicks).join(', ');
  const title = `PR on \`${context.getWorkingBranch()}\` for ${repos}`;
  const head = context.getWorkingBranch();

  return { title, body: '', head, base: 'master' };
}

function addBackTicks(s) {
  return '`' + s + '`';
}

function formatRepos(repos) {
  return Array.from(repos).map(r => colors.bold(r)).join(', ');
}

function findReviewers(context) {
  const { reviewers, collaborators } = context.config;
  if (reviewers) {
    return reviewers.split(',');
  }

  const collaboratorsArr = collaborators && collaborators.split(',');
  if (collaboratorsArr && collaboratorsArr.length >= 2) {
    return utils.pickRandom(collaboratorsArr, 2);
  }
}
