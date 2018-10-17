const debug      = require('debug')('pullrepo:lib:pull-request');
const gitHelper  = require('../helpers/simple-git');
const logger     = require('../helpers/logger');
const utils      = require('../helpers/utils');
const path       = require('path');
const doCheckout = require('./checkout-branch-repo');
const doPushRepo = require('./push-repo');
const colors     = require('colors/safe');

module.exports = [{
  single: true,
  async runner(context) {
    const branch = await utils.findWorkingBranch(context);
    if (!branch || branch === 'master') {
      logger.logError('You must place yourself on the branch you want to merge or specify it with "--branch"');
      return context.interrupt();
    }

    context.setWorkingBranch(branch);
    context.concernedRepos = [];
  }
}, {
  title: (context) => `Finding pull requests related to ${colors.bold(context.workingBranch)}`,
  async runner(context, repo) {
    debug.enabled && debug(`Processing repository ${repo}...`);
    const sg = gitHelper.initSimpleGit(context, repo);

    const status = await gitHelper.commonStatus(sg, repo);
    const repoContext = { result: status, completed: true };
    context.setRepoContext(repo, repoContext);

    // Find PR on the related branch
    const cwd = path.join(context.rootDir, repo);
    const branch = context.getWorkingBranch();
    const { stdout: prUrl } = await utils.exec(`hub pr list --head=${branch} --base=master -f %U`, { cwd });
    if (!prUrl) {
      return;
    }

    const merged = prUrl;
    context.concernedRepos.push(repo);
    if (context.isDryRunMode()) {
      repoContext.result.merged = `Dry: ${merged}`;
      return;
    }

    repoContext.result.merged = merged;
    Object.assign(repoContext, { completed: false, prUrl, cwd });
  }
}, {
  title: createTitleFactory('Checking out master'),
  async runner(context, repo) {
    if (context.getRepoContext(repo).completed) {
      return;
    }
    // Ensure that we are on master
    context.setWorkingBranch('master');
    return doCheckout(context, repo);
  }
}, {
  title: createTitleFactory('Creating commits in master'),
  async runner(context, repo) {
    const { prUrl, cwd, completed } = context.getRepoContext(repo);
    if (completed) {
      return;
    }
    const { stdout, stderr } = await utils.exec(`hub merge ${prUrl}`, { cwd });
    debug.enabled && debug(`${repo}'s merge results: ${JSON.stringify({ stdout, stderr })}`);
  }
}, {
  title: createTitleFactory('Puhsing master\'s commits'),
  async runner(context, repo) {
    const { result, completed } = context.getRepoContext(repo);
    if (completed) {
      return result;
    }
    const pushResults = await doPushRepo(context, repo);
    return Object.assign(result, pushResults);
  }
}];

function createTitleFactory(description) {
  return (context) => {
    const dryMode = context.isDryRunMode() ? colors.cyan('[DRY MODE] ') : '';
    return `${dryMode}${description} in ${context.concernedRepos.map(bold).join(', ')}`;
  };
}

function bold(s) {
  return colors.bold(s);
}
