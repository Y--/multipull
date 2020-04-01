const debug = require('debug')('pullrepo:lib:exec-repo');
const { exec } = require('../helpers/utils');

module.exports = async function execCommandInRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);

  if (shouldSkipRepo(context, repo)) {
    return;
  }

  const cmd = context.config.exec;
  if (!cmd) {
    throw new Error('No command to execute.');
  }

  try {
    const res = await exec(cmd, { cwd: context.getRepoPath(repo) });
    return res;
  } catch (err) {
    return err;
  }
};

function shouldSkipRepo(context, repo) {
  return context.config.match && !repo.match(new RegExp(context.config.match));
}
