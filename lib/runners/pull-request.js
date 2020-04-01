const debug = require('debug')('pullrepo:lib:pull-request');
const colors = require('colors/safe');
const logger = require('../helpers/logger');
const utils = require('../helpers/utils');
const editor = require('../helpers/message-editor');
const simpleGit = require('../helpers/simple-git');

const { s } = utils;

module.exports = [
  {
    single: true,
    async runner(context) {
      const branch = await utils.findWorkingBranch(context);
      if (!branch) {
        throw new Error(`Usage ${process.argv.join(' ')} <branch>`);
      }

      if (branch === 'master') {
        throw new Error("Refusing to create a PR on 'master'");
      }

      context.setWorkingBranch(branch);
      logger.logInfo(`Will create pull requests on ${colors.bold(branch)}.`);
    },
  },
  {
    title: (context) => `Finding repo(s) with branch '${context.getWorkingBranch()}'...`,
    async runner(context, repo) {
      const branch = context.getWorkingBranch();
      const sg = context.getGitAPI(repo);
      try {
        await sg.revparse(['--verify', branch]);
      } catch (err) {
        return { branch: false };
      }

      const ghRepo = await context.getGitHubAPI(repo);
      const prs = await simpleGit.listPullRequests(ghRepo, branch);
      const pr = prs && prs.length === 1 ? prs[0] : null;
      if (pr && context.config.approve) {
        await ghRepo.approveReviewRequest(pr.number);
        const result = await context.getRepoCommonStatus(repo);
        result.approved = true;
        context.interrupt();
        return result;
      }

      if (pr && pr.requested_reviewers.length === 0) {
        // Only fetching reviews if there's no `requested_reviewers` since that's what we want to know.
        pr.reviews = await ghRepo.getReviews(pr.number);
      }

      return { branch: true, pr };
    },
  },
  {
    single: true,
    async runner(context, scanResults) {
      const candidates = scanResults.filter((it) => it.res.branch);

      if (!candidates.length) {
        const branch = context.getWorkingBranch();
        logger.logInfo(`Cannot find any repository with branch '${branch}'.`);
        return context.interrupt();
      }

      const actions = inferActionsFromCandidates(context, candidates);
      if (hasNothingToDo(actions)) {
        logger.logInfo('Nothing to do, bye!');
        return context.interrupt();
      }

      const question = convertActionsToText(actions);
      const accept = await utils.getYNAnswer(question);

      if (!accept) {
        logger.logInfo('Aborted.');
        return context.interrupt();
      }

      context.actions = actions;
      context.pullRequestsPerRepo = new Map();
      const created = actions.creations ? actions.creations.repos : [];
      for (const repo of created) {
        context.pullRequestsPerRepo.set(repo, {});
      }

      for (const [repo, update] of actions.updatesPerRepo || []) {
        context.pullRequestsPerRepo.set(repo, update.pr);
      }

      context.defaultTitle = computeDefaultPRTitle(context.getWorkingBranch(), context.pullRequestsPerRepo.keys());
    },
  },
  {
    title: (context) => `Processing PR in '${formatArr(context.pullRequestsPerRepo.keys())}'`,
    async runner(context, repo) {
      const pr = context.pullRequestsPerRepo.get(repo);
      if (pr) {
        return pr.html_url ? updatePR(context, repo, pr) : createPR(context, repo, pr);
      }
    },
  },
  {
    single: true,
    async runner(context) {
      if (!context.pullRequestsPerRepo.size) {
        return;
      }

      const body = computeDefaultPRBody(context, context.pullRequestsPerRepo);
      const defaultSpec = { title: context.defaultTitle, body };
      if (!context.config.m) {
        context.pullRequestsFinalDescription = defaultSpec;
        return;
      }

      const edited = await editor.editPRDescription(defaultSpec);

      context.pullRequestsFinalDescription = {};

      if (edited.title) {
        context.pullRequestsFinalDescription.title = edited.title;
      }
      if (edited.body) {
        context.pullRequestsFinalDescription.body = edited.body;
      }
    },
  },
  {
    title: 'Update PR description',
    async runner(context, repo) {
      const status = await context.getRepoCommonStatus(repo);
      const repoPR = context.pullRequestsPerRepo.get(repo);
      if (!repoPR) {
        return status;
      }

      status.pr = repoPR.html_url;

      if (!repoPR.updateDescription) {
        return status;
      }

      const { title, body } = context.pullRequestsFinalDescription;
      if (!title && !body) {
        return status;
      }

      const { number, errors } = repoPR;
      const ghRepo = await context.getGitHubAPI(repo);
      await ghRepo.updatePullRequest(number, context.pullRequestsFinalDescription);

      if (errors) {
        status.errors = errors;
      }

      return status;
    },
  },
];

async function createPR(context, repo, pr) {
  debug.enabled && debug(`Creating PR in ${repo}...`);
  const ghRepo = await context.getGitHubAPI(repo);
  const params = getPullRequestCreationParams(context);
  const { data } = await ghRepo.createPullRequest(params);
  Object.assign(pr, data);

  const reviewers = context.actions.creations.reviewers || (!context.actions.creations.draft && findReviewers(context));
  await createReviewRequest(ghRepo, pr, reviewers, repo);

  pr.updateDescription = true;
}

async function updatePR(context, repo, pr) {
  debug.enabled && debug(`Updating PR in ${repo}...`);

  const ghRepo = await context.getGitHubAPI(repo);

  const update = context.actions.updatesPerRepo.get(repo);

  if (update.transitionFromDraftToReady) {
    const query = `mutation { markPullRequestReadyForReview(input: { pullRequestId: "${pr.node_id}" }) { clientMutationId } }`;
    await ghRepo.graphql({ AcceptHeader: 'shadow-cat-preview', query });
  }

  await createReviewRequest(ghRepo, pr, update.reviewers, repo);

  pr.updateDescription = update.updateDescription;
}

function getPullRequestCreationParams(context) {
  const params = { title: context.defaultTitle, body: '', head: context.getWorkingBranch(), base: 'master' };
  if (context.actions.creations.draft) {
    params.draft = true;
    params.AcceptHeader = 'shadow-cat-preview';
  }

  return params;
}

// --------------------------------------------------------------------------
// Reviewers
// --------------------------------------------------------------------------

function findReviewers(context) {
  if (context.config.reviewers === '') {
    return; // Forced to no reviewers
  }

  const reviewers = findForcedReviewers(context) || findRandomReviewers(context);
  if (!reviewers) {
    return;
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

async function createReviewRequest(ghRepo, prResult, reviewers, repo) {
  if (!reviewers) {
    return;
  }

  debug.enabled && debug(`Adding ${reviewers} to PR in ${repo}...`);
  try {
    await ghRepo.createReviewRequest(prResult.number, { reviewers });
  } catch (err) {
    prResult.errors = prResult.errors || [];
    prResult.errors.push(err);
  }
}

// --------------------------------------------------------------------------
// Description
// --------------------------------------------------------------------------

function computeDefaultDescription(context, prUrlsPerRepo) {
  return {
    title: computeDefaultPRTitle(context.getWorkingBranch(), prUrlsPerRepo.keys()),
    body: computeDefaultPRBody(context, prUrlsPerRepo),
  };
}

function computeDefaultPRTitle(head, repos) {
  const quotedRepos = [];
  for (const repo of repos) {
    quotedRepos.push('`' + repo + '`');
  }

  return `PR from \`${head}\` in ${quotedRepos.join(', ')}`;
}

function computeDefaultPRBody(context, prUrlsPerRepo) {
  const repoSuffix = prUrlsPerRepo.size > 1 ? 'ies' : 'y';
  const parts = [`Pull request in ${prUrlsPerRepo.size} repositor${repoSuffix}:`];
  for (const [repo, { html_url }] of prUrlsPerRepo) {
    parts.push(`* \`${repo}\` : [${html_url}](${html_url})`);
  }

  const issueLink = findIssueLink(context);
  if (issueLink) {
    parts.push(`\n\nRelated issue: ${issueLink}`);
  }

  return parts.join('\n');
}

function findIssueLink(context) {
  const branch = context.getWorkingBranch();
  if (!branch) {
    return;
  }

  const { issueTracker } = context.config;
  if (!issueTracker) {
    return;
  }

  const m = branch.match(new RegExp(issueTracker.issueIdPattern));
  return m && issueTracker.urlPrefix + m[0];
}

// --------------------------------------------------------------------------
// Actions creation
// --------------------------------------------------------------------------

function inferActionsFromCandidates(context, candidates) {
  const creations = findRequestedCreations(context, candidates);
  const nbPRsToCreate = creations ? creations.repos.length : 0;
  if (nbPRsToCreate === candidates.length) {
    return { creations };
  }

  const updatesPerRepo =
    nbPRsToCreate > 0
      ? findApplicableUpdatesAlongCreations(context, candidates)
      : findApplicableUpdates(context, candidates);
  return { creations, updatesPerRepo };
}

function findRequestedCreations(context, candidates) {
  const repos = [];
  for (const { repo, res } of candidates) {
    if (!res.pr) {
      repos.push(repo);
    }
  }

  if (repos.length === 0) {
    return null;
  }

  const draft = !context.config.ready;
  const reviewers = draft ? findForcedReviewers(context) : findReviewers(context);
  return { draft, repos, reviewers };
}

function findApplicableUpdatesAlongCreations(context, candidates) {
  const updatesPerRepo = new Map();

  // Compute the description that would have been set by default
  const prUrlsPerRepo = new Map();
  for (const candidate of candidates) {
    if (candidate.res.pr) {
      prUrlsPerRepo.set(candidate.repo, candidate.res.pr);
    }
  }

  const forcedReviewers = findForcedReviewers(context);
  const defaultDescription = computeDefaultDescription(context, prUrlsPerRepo);
  const readyForReview = !!context.config.ready;
  for (const { repo, res } of candidates) {
    const { pr } = res;
    if (!pr) {
      continue;
    }

    const updateDescription = defaultDescription.title !== pr.title || defaultDescription.body !== pr.body;
    const update = { repo, pr, updateDescription };
    insertUpdate(context, update, forcedReviewers, readyForReview, updatesPerRepo);
  }

  return updatesPerRepo;
}

function findApplicableUpdates(context, candidates) {
  const updatesPerRepo = new Map();
  const readyForReview = !context.config.draft;
  const forcedReviewers = findForcedReviewers(context);
  for (const { repo, res } of candidates) {
    const update = { repo, pr: res.pr, updateDescription: !!context.config.update };
    insertUpdate(context, update, forcedReviewers, readyForReview, updatesPerRepo);
  }

  return updatesPerRepo;
}

function insertUpdate(context, update, forcedReviewers, readyForReview, updatesPerRepo) {
  const transitionFromDraftToReady = update.pr.draft && readyForReview;
  if (transitionFromDraftToReady) {
    update.transitionFromDraftToReady = true;
  }

  const readyForReviewers = transitionFromDraftToReady || !update.pr.draft;
  const reviewers = findReviewersToUpdate(context, update.pr, forcedReviewers, readyForReviewers);
  if (reviewers) {
    update.reviewers = reviewers;
  }

  if (update.updateDescription || reviewers || transitionFromDraftToReady) {
    updatesPerRepo.set(update.repo, update);
  }
}

function findReviewersToUpdate(context, pr, forcedReviewers, readyForReviewers) {
  if (pr.requested_reviewers.length > 0 || pr.reviews.length > 0) {
    return; // Do not changing anything
  }

  return readyForReviewers ? findReviewers(context) : forcedReviewers;
}

// --------------------------------------------------------------------------
// Actions to text
// --------------------------------------------------------------------------

function hasNothingToDo(actions) {
  return !actions.creations && (!actions.updatesPerRepo || actions.updatesPerRepo.size === 0);
}

function convertActionsToText(actions) {
  if (!actions.updatesPerRepo || actions.updatesPerRepo.size === 0) {
    return askAction(convertCreationsToText(actions.creations));
  }
  if (!actions.creations) {
    return askAction(convertUpdatesToText(actions.updatesPerRepo));
  }

  const creationsStr = convertCreationsToText(actions.creations);
  const updatesStr = convertUpdatesToText(actions.updatesPerRepo);
  return askAction(`perform the following actions:\n- ${creationsStr}\n- ${updatesStr}`);
}

function askAction(actionsStr) {
  return `Do you want to ${actionsStr}`;
}

function convertCreationsToText(creations) {
  const { draft, repos, reviewers } = creations;
  const whatStr = draft ? `a ${colors.bold('draft')} PR` : `a PR ${colors.bold('ready for review')}`;
  const reviewersStr = reviewers ? reviewersToStr(reviewers) : colors.bold('no reviewer');

  return `create ${whatStr} with ${reviewersStr} in ${reposToStr(repos)}`;
}

function convertUpdatesToText(updatesPerRepo) {
  if (areSameUpdates(updatesPerRepo)) {
    const repos = Array.from(updatesPerRepo.keys());
    return convertUpdateToText(repos, firstMapValue(updatesPerRepo));
  }

  const tempRepos = [null];
  const text = [];
  for (const [repo, update] of updatesPerRepo) {
    tempRepos[0] = repo;
    text.push(convertUpdateToText(tempRepos, update));
  }

  return `update the repos:\n  -${text.join('\n  -')}`;
}

function convertUpdateToText(repos, update) {
  const { transitionFromDraftToReady, reviewers, updateDescription } = update;

  const reposStr = reposToStr(repos);
  if (transitionFromDraftToReady) {
    const whatStr = `mark PRs ${colors.bold('ready for review')}`;
    const reviewersStr = reviewers ? ` and add ${reviewersToStr(reviewers)}` : '';
    const their = repos.length > 1 ? 'their' : 'its';
    const updateDescriptionStr = updateDescription ? ` and update ${their} description` : '';
    return `${whatStr} in ${reposStr}${reviewersStr}${updateDescriptionStr}`;
  }

  if (updateDescription) {
    const reviewersStr = reviewers ? ` and add ${reviewersToStr(reviewers)}` : '';
    return `update PR${s(repos)} description in ${reposStr}'s${reviewersStr}`;
  }

  return `set ${reviewersToStr(reviewers)} in ${reposStr}`;
}

function areSameUpdates(updatesPerRepo) {
  const first = firstMapValue(updatesPerRepo);
  const updatesKeys = ['updateDescription', 'reviewers', 'transitionFromDraftToReady'];
  for (const current of updatesPerRepo.values()) {
    for (const key of updatesKeys) {
      if (current[key] !== first[key]) {
        return false;
      }
    }
  }

  return true;
}

function firstMapValue(map) {
  return map.values().next().value;
}

function reposToStr(repos) {
  const countRepos = repos.length === 1 ? '' : `${repos.length} repositories `;
  return countRepos + formatArr(repos);
}

function reviewersToStr(reviewers) {
  return formatArr(reviewers) + ' as reviewer' + s(reviewers);
}

function formatArr(repos) {
  return Array.from(repos)
    .map((r) => colors.bold(r))
    .join(', ');
}
