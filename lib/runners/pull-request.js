const debug      = require('debug')('pullrepo:lib:pull-request');
const utils      = require('../helpers/utils');
const doCheckout = require('./checkout-branch-repo');
const path       = require('path');
const logger     = require('../helpers/logger');
const gitHelper  = require('../helpers/simple-git');

const { s, formatParmeters } = utils;

module.exports = [{
  single: true,
  async runner(context) {
    const branch = await findWorkingBranch(context);
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
    const params = findPullRequestParams(context);
    const { stdout, stderr } = await utils.exec(`hub pull-request ${formatParmeters(params)}`, { cwd });
    if (stderr) {
      throw new Error(stderr);
    }

    return Object.assign(status, { pushed: stdout });
  }
}];

async function findWorkingBranch(context) {
  const workingBranch = context.getWorkingBranch();
  if (workingBranch) {
    return workingBranch;
  }

  try {
    const { stdout } = await utils.exec('git ls-remote --get-url');
    if (!stdout) {
      return;
    }

    const [, fullRepo] = stdout.split('/');
    if (!fullRepo) {
      return;
    }

    const repo = fullRepo.split('.')[0];
    if (!context.repos.includes(repo)) {
      return;
    }

    const { stdout: currentBranch } = await utils.exec('git rev-parse --abbrev-ref HEAD');
    return currentBranch;
  } catch (err) {
    debug.enabled && debug(err);
  }
}

function findPullRequestParams(context) {
  const { browse = false, assign = '' } = context.config;
  const reviewer = findReviewers(context);
  return { assign, browse, 'no-edit': true, reviewer };
}

function findReviewers(context) {
  const { reviewer, reviewers } = context.config;
  if (reviewer) {
    return reviewer; // Forward hub's 'reviewer' paraneter if set
  }

  const reviewersArr = reviewers && reviewers.split(',');
  if (reviewersArr && reviewersArr.length >= 2) {
    return utils.pickRandom(reviewersArr, 2);
  }
  return '';
}
