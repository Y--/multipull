const debug     = require('debug')('pullrepo:lib:status-repo');
const { s }     = require('../helpers/utils');
const simpleGit = require('../helpers/simple-git');

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const result = await context.getRepoCommonStatus(repo);
  if (context.config.pr) {
    const prDetails = await simpleGit.findPullRequestsOnBranch(context, repo, result.status.current);
    setStatuses(prDetails, result);
  }

  return result;
};

function setStatuses(prDetails, result) {
  if (!prDetails) {
    return;
  }

  result.pr = prDetails.map(pr => pr.html_url).join(', ');
  if (!prDetails.length || prDetails.length > 1) {
    return;
  }

  const [pr] = prDetails;
  result.mergeable = mergeabilityStatus(pr);
  result.build = ciStatus(pr);
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

function ciStatus(pr) {
  const status = pr.ci_status;
  if (status.state === 'failure') {
    const firstFailed = status.statuses.find(s => s.state === 'failure');
    return firstFailed.description;
  } else if (status.state === 'pending') {
    return 'Pending';
  } else if (status.state === 'success') {
    return 'Green';
  }

  throw new Error(`Invalid state value '${status.state}'`);
}