/* eslint-disable no-console */
const debug         = require('debug')('pullrepo:lib:pull-request');
const gitHelper     = require('../helpers/simple-git');
const util          = require('util');
const path          = require('path');
const doCheckout    = require('./checkout-branch-repo');
const doPushRepo    = require('./push-repo');
const child_process = require('child_process');

const exec = util.promisify(child_process.exec);

module.exports = async function doMergePullRequest(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  const status = await gitHelper.commonStatus(sg, repo);
  const branch = context.getWorkingBranch();
  if (!branch || branch === 'master') {
    return status;
  }

  // Find PR on the related branch
  const cwd = path.join(context.rootDir, repo);
  const { stdout: prUrl } = await exec(`hub pr list --head=${branch} --base=master -f %U`, { cwd });
  if (!prUrl) {
    return status;
  }

  // Ensure that we are on master
  context.setWorkingBranch('master');
  await doCheckout(context, repo);

  const result = Object.assign({ merged: prUrl }, status);
  if (context.isDryRunMode()) {
    result.merged = `Dry: ${result.merged}`;
    return result;
  }

  // Create the merge commits.
  const { stdout, stderr } = await exec(`hub merge ${prUrl}`, { cwd });
  debug.enabled && debug(`Merge results: ${JSON.stringify({ repo, stdout, stderr })}`);

  const pushResults = await doPushRepo(context, repo);
  return Object.assign(result, pushResults);
};
