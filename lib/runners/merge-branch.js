const debug = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);

  const initialStatus = await gitHelper.commonStatus(sg, repo);
  const { status } = initialStatus;
  if (status.current === 'master' || !isBehind(status)) {
    return initialStatus;
  }

  await sg.merge(['master', '--stat']);

  return gitHelper.commonStatus(sg, repo);
};

function isBehind(status) {
  return status.diff_with_origin_master && status.diff_with_origin_master.behind > 0;
}
