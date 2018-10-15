const debug      = require('debug')('pullrepo:lib:pull-request');
const utils      = require('../helpers/utils');
const doCheckout = require('./checkout-branch-repo');
const path       = require('path');
const logger     = require('../helpers/logger');
const gitHelper  = require('../helpers/simple-git');

const { s } = utils;

module.exports = [{
  single: true,
  runner(context) {
    const branch = context.getWorkingBranch();
    if (!branch) {
      throw new Error(`Usage ${process.argv.join(' ')} <branch>`);
    }

    if (branch === 'master') {
      throw new Error('Refusing to create a PR on \'master\'');
    }

    logger.logInfo(`Will create pull requests on ${branch}.`);
  }
}, {
  title: (context) => `Checking out branch '${context.getWorkingBranch()}'`,
  runner: doCheckout
}, {
  single: true,
  async runner(context, checkoutResults) {
    const branch = context.getWorkingBranch();
    const candidates = [];
    for (const { res, repo } of checkoutResults) {
      if (res.status.current === branch) {
        candidates.push(repo);
      }
    }

    if (!candidates.length) {
      logger.logInfo(`Cannot find any repository with branch '${branch}'.`);
      return context.interrupt();
    }

    const countRepos = `${candidates.length} repo${s(candidates)}`;
    const valid = await utils.getYNAnswer(`Will create PR in ${countRepos}: ${candidates.join(', ')}, proceed?`);
    if (!valid) {
      logger.logInfo('Aborted.');
      return context.interrupt();
    }

    context.pullRequestRepos = new Set(candidates);
  }
}, {
  async runner(context, repo) {
    const sg = gitHelper.initSimpleGit(context, repo);
    const status = await gitHelper.commonStatus(sg, repo);
    if (!context.pullRequestRepos.has(repo)) {
      return status;
    }

    debug.enabled && debug(`Processing repository ${repo}...`);
    const cwd = path.join(context.rootDir, repo);
    const { stdout, stderr } = await utils.exec('hub pull-request --no-edit', { cwd });
    if (stderr) {
      throw new Error(stderr);
    }

    return Object.assign(status, { pushed: stdout });
  }
}];
