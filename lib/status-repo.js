const debug         = require('debug')('pullrepo:lib:pull-repo');
const initSimpleGit = require('./simple-git');

module.exports = async function getRepoStatus(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = initSimpleGit(context, repo);
  const status = await sg.status();
  const stash = await sg.stashList();
  if (stash.total === undefined) {
    stash.total = 0;
  }
  return { repo, status, stash };
};


