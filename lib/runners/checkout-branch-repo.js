const debug     = require('debug')('pullrepo:lib:checkout-branch-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const [, , branch = 'master'] = process.argv;
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);
  await checkoutBranch(sg, branch);

  return gitHelper.commonStatus(sg, repo);
};

async function checkoutBranch(sg, branch) {
  try {
    await sg.checkout(branch);
  } catch (err) {
    const re = new RegExp(`pathspec '${branch}' did not match any file`);
    if (err.message.match(re)) {
      return;
    }
    throw err;
  }
}
