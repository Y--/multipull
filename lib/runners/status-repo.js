const debug = require('debug')('pullrepo:lib:status-repo');

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const result = await context.getRepoCommonStatus(repo);
  if (context.config.pr) {
    result.pr = await findRelatedPR(context, repo, result.status.current);
  }

  return result;
};

async function findRelatedPR(context, repo, currentBranch) {
  if (!currentBranch || currentBranch === 'master') {
    return;
  }

  const ghRepo = await context.getGitHubAPI(repo);
  const head = ghRepo.__owner + ':' + currentBranch;
  const { data: prs } = await ghRepo.listPullRequests({ state: 'open', head, base: 'master' });
  return prs.map((pr) => pr.html_url).join(', ');
}
