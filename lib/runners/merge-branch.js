const debug = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);

  const defaultBranch = context.getDefaultBranch(repo);

  const initialStatus = await gitHelper.commonStatus(sg, repo, defaultBranch);
  const { status } = initialStatus;

  if (status.current === defaultBranch || !isBehind(status)) {
    return initialStatus;
  }

  await sg.merge([defaultBranch, '--stat']);

  return gitHelper.commonStatus(sg, repo, defaultBranch);
};

function isBehind(status) {
  return status.diff_with_origin_main && status.diff_with_origin_main.behind > 0;
}
