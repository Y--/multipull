const debug     = require('debug')('pullrepo:lib:status-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);
  return gitHelper.commonStatus(sg, repo);
};
