const debug     = require('debug')('pullrepo:lib:status-repo');
const { s }     = require('../helpers/utils');
const simpleGit = require('../helpers/simple-git');

const FAILED_STATES = new Set(['failure', 'error']);
const PENDING_STATES = new Set(['pending']);

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const result = await context.getRepoCommonStatus(repo);
  if (context.config.pr) {
    const prDetails = await simpleGit.findPullRequestsOnBranch(context, repo, result.status.current);
    setStatuses(context, prDetails, result);
  } else if (result.status.current !== 'master' && context.config.ci) {
    const sg = context.getGitAPI(repo);
    const ghRepo = await context.getGitHubAPI(repo);
    const head = await sg.revparse('HEAD');
    const { data: combinedStatus } = await ghRepo.getCombinedStatus(head.trim());
    result.build = ciStatus(combinedStatus, context.config.full);
  }

  return result;
};

function setStatuses(context, prDetails, result) {
  if (!prDetails) {
    return;
  }

  result.pr = prDetails.map(pr => pr.html_url).join(', ');
  if (prDetails.length !== 1) {
    return;
  }

  const [pr] = prDetails;
  result.mergeable = mergeabilityStatus(pr);
  result.build = ciStatus(pr.ci_status, context.config.full);
  result.reviews = reviewStatus(pr);
}

function reviewStatus(pr) {
  const counts = {};
  for (const review of pr.reviews) {
    counts[review] = counts[review] || 0;
    counts[review]++;
  }

  if (!counts.APPROVED && !counts.CHANGES_REQUESTED && !counts.COMMENTED) {
    return 'Not reviewed';
  }

  const { APPROVED, CHANGES_REQUESTED, COMMENTED } = counts;
  const approved = APPROVED ? `${APPROVED} approved` : '';
  const changesRequest = CHANGES_REQUESTED ? `${CHANGES_REQUESTED} requested changes` : '';
  const commented = COMMENTED ? `${COMMENTED} comment${s(COMMENTED)}` : '';
  return [approved, changesRequest, commented].filter(x => !!x).join(', ');
}

function mergeabilityStatus(pr) {
  if (pr.mergeable === true) {
    return 'Yes';
  } else if (pr.mergeable === false) {
    return 'Conflicts';
  } else if (pr.mergeable === null) {
    return 'Unknown';
  }

  throw new Error(`Invalid mergeable value '${pr.mergeable}'`);
}

function ciStatus(status, includeUrl = false) {
  if (status.state === 'failure') {
    const { firstInState, details } = findRelevantStatus(includeUrl, status, FAILED_STATES);
    const buildURL = includeUrl ? '\n' + firstInState.target_url : '';
    return `${firstInState.description}\n${details}` + buildURL;
  } else if (status.state === 'pending') {
    const { firstInState, details } = findRelevantStatus(includeUrl, status, PENDING_STATES);
    const buildURL = includeUrl ? ' - ' + firstInState.target_url : '';
    return (firstInState.description || 'Pending') + ' ' + details + buildURL;
  } else if (status.state === 'success') {
    const details = formattedCountByKey(status.statuses, 'state');
    return 'Checks: ' + details;
  }

  throw new Error(`Invalid state value '${status.state}'`);
}

function findRelevantStatus(includeUrl, status, states) {
  const details = formattedCountByKey(status.statuses, 'state');
  const firstInState = status.statuses.find(s => states.has(s.state));
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
    parts.push(v + ' ' + k);
  }
  return parts.join(', ');
}