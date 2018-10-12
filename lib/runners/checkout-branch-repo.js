const debug     = require('debug')('pullrepo:lib:checkout-branch-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doCheckoutBranch(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const branch = context.getWorkingBranch() || 'master';
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);
  await checkoutBranch(context, repo, sg, branch);

  return gitHelper.commonStatus(sg, repo);
};

async function checkoutBranch(context, repo, sg, branch) {
  try {
    await sg.checkout(branch);
  } catch (err) {
    const re = new RegExp(`pathspec '${branch}' did not match any file`);
    if (err.message.match(re)) {
      return checkoutDefaultBranch(context, repo, sg, branch);
    }
    throw err;
  }
}

async function checkoutDefaultBranch(context, repo, sg, requestedBranch) {
  const defaultBranch = context.getDefaultBranch(repo);
  if (requestedBranch === defaultBranch) {
    return;
  }

  const { current } = await sg.status();
  if (current === defaultBranch) {
    return;
  }

  await sg.checkout(defaultBranch);
}
