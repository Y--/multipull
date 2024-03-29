const vm = require('vm');
const debug = require('debug')('pullrepo:lib:status-repo');
const colors = require('colors/safe');
const { s } = require('../helpers/utils');
const simpleGit = require('../helpers/simple-git');

const FAILED_STATES = new Set(['failure', 'error']);
const PENDING_STATES = new Set(['pending']);

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const result = await context.getRepoCommonStatus(repo);

  if (!result.status.isDefaultBranch) {
    await addExtraForNonDefaultBranch(context, repo, result);
  }

  if (context.config.pr) {
    const prDetails = await simpleGit.findPullRequestsOnBranch(context, repo, result.status.current);
    setStatuses(context, prDetails, result);
  }

  return result;
};

async function addExtraForNonDefaultBranch(context, repo, result) {
  let ghRepo;
  if (context.config.ci) {
    const sg = context.getGitAPI(repo);
    ghRepo = await context.getGitHubAPI(repo);
    const head = await sg.revparse('HEAD');
    const { data: combinedStatus } = await ghRepo.getCombinedStatus(head.trim());
    result.buildStatus = ciStatus(combinedStatus, context.config.full);
    result.buildState = combinedStatus.state;
  }

  if (context.config.ci || context.config.pr) {
    ghRepo = ghRepo || await context.getGitHubAPI(repo);
    await addBuildURL(context, ghRepo, repo, result);
  }
}

async function addBuildURL(context, ghRepo, repo, result) {
  const { moduleUrl, display } = context.config.ciService || {};
  if (!moduleUrl || (!context.config['ci-url'] && !context.config.pr && !!context.config.ci)) {
    return;
  }

  const branchName = result.status.current;
  const prs = await simpleGit.listPullRequests(ghRepo, branchName);

  if (!prs || prs.length !== 1) {
    return;
  }

  const pr = prs[0];
  result.buildURL = {
    url: resolveParams(pr, moduleUrl),
    id: resolveParams(pr, display),
  };
}

function resolveParams(pr, inputStr) {
  const context = { pr };
  vm.runInNewContext('outputStr = `' + inputStr + '`', context);
  return context.outputStr;
}

function setStatuses(context, prDetails, result) {
  if (!prDetails) {
    return;
  }

  result.pr = prDetails.map((pr) => pr.html_url).join(', ');
  if (prDetails.length !== 1) {
    return;
  }

  const [pr] = prDetails;
  if (context.config.ci) {
    result.buildStatus = ciStatus(pr.ci_status, context.config.full);
  }

  result.buildState = pr.ci_status.state;
  result.reviews = reviewStatus(pr);
  result.state = mergeabilityStatus(pr);
}

function reviewStatus(pr) {
  const counts = {};
  for (const review of pr.reviews) {
    counts[review] = counts[review] || 0;
    counts[review]++;
  }

  if (!counts.APPROVED && !counts.CHANGES_REQUESTED && !counts.COMMENTED) {
    return 'None';
  }

  const { APPROVED, CHANGES_REQUESTED, COMMENTED } = counts;
  const approved = APPROVED ? `${APPROVED} approved` : '';
  const changesRequest = CHANGES_REQUESTED ? `${CHANGES_REQUESTED} requested changes` : '';
  const commented = COMMENTED ? `${COMMENTED} comment${s(COMMENTED)}` : '';
  return [approved, changesRequest, commented].filter((x) => !!x).join(', ');
}

function mergeabilityStatus(pr) {
  if (pr.mergeable === true && pr.mergeable_state === 'blocked') {
    return '🚫';
  } if (pr.mergeable_state === 'unknown') {
    return '??';
  } else if (pr.mergeable === true && pr.mergeable_state === 'draft') {
    return colors.gray('draft');
  } else if (pr.mergeable === true) {
    return colors.green(pr.mergeable_state || 'Yes');
  } else if (pr.mergeable === false) {
    const ms = pr.mergeable_state ? ` (${pr.mergeable_state})` : '';
    return 'Conflicts' + ms;
  } else if (pr.mergeable === null) {
    return pr.mergeable_state || 'Unknown';
  }

  throw new Error(`Invalid mergeable value '${pr.mergeable}'`);
}

function ciStatus(status, includeUrl = false) {
  if (status.state === 'failure') {
    const { firstInState, details } = findRelevantStatus(includeUrl, status, FAILED_STATES);
    const buildURL = includeUrl ? '\n' + firstInState.target_url : '';
    return `${firstInState.description} - ${details}` + buildURL;
  } else if (status.state === 'pending') {
    const { firstInState, details } = findRelevantStatus(includeUrl, status, PENDING_STATES);
    const buildURL = includeUrl ? ' - ' + firstInState.target_url : '';
    return firstInState.description + '. ' + details + buildURL;
  } else if (status.state === 'success') {
    const details = formattedCountByKey(status.statuses, 'state');
    return 'Checks: ' + details;
  }

  throw new Error(`Invalid state value '${status.state}'`);
}

function findRelevantStatus(includeUrl, status, states) {
  const details = formattedCountByKey(status.statuses, 'state');
  const firstInState = status.statuses.find((s) => states.has(s.state)) || { target_url: 'N/A', description: 'N/A' };
  return { firstInState, details };
}

function formattedCountByKey(collection, key) {
  const res = {};
  for (const elt of collection) {
    const keyValue = elt[key];
    res[keyValue] = res[keyValue] || 0;
    ++res[keyValue];
  }
  return formatKeyValues(res);
}

function formatKeyValues(o) {
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    const str = v + ' ' + k;
    if (k === 'success') {
      parts.push(colors.green(str));
    } else {
      parts.push(str);
    }
  }
  return parts.join(', ');
}
