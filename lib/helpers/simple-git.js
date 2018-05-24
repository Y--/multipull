const path      = require('path');
const debug     = require('debug')('pullrepo:lib:helper:simple-git');
const simpleGit = require('simple-git/promise');

module.exports.initSimpleGit = function({ rootDir }, repo) {
  const repoPath = path.join(rootDir, repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
};

module.exports.commonStatus = async function(sg, repo, additionalResults) {
  const status = await sg.status();
  const stash = await sg.stashList();
  if (stash.total === undefined) {
    stash.total = 0;
  }
  return Object.assign({ repo, status, stash }, additionalResults);
};

module.exports.fetchAll = async function(sg, repo, context) {
  try {
    await sg.fetch(['--all']);
  } catch (err) {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg, context);
    await sg.fetch(['--all']);
  }
};

async function runOneGC(sg, context) {
  if (context.currentGcExecution) {
    await context.currentGcExecution;
    return runOneGC(sg);
  }

  context.currentGcExecution = sg.raw(['gc', '--prune=now']);
  await context.currentGcExecution;
  context.currentGcExecution = null;
}