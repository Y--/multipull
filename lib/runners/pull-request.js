const debug     = require('debug')('pullrepo:lib:pull-request');
const path      = require('path');
const logger    = require('../helpers/logger');
const gitHelper = require('../helpers/simple-git');
const utils     = require('../helpers/utils');
const colors    = require('colors/safe');

const { s, formatParmeters } = utils;

// TODO: use simple git instead of `exec git <>`
module.exports = [{
  single: true,
  async runner(context) {
    const branch = await utils.findWorkingBranch(context);
    if (!branch) {
      throw new Error(`Usage ${process.argv.join(' ')} <branch>`);
    }

    if (branch === 'master') {
      throw new Error('Refusing to create a PR on \'master\'');
    }

    context.setWorkingBranch(branch);
    logger.logInfo(`Will create pull requests on ${colors.bold(branch)}.`);
  }
}, {
  title: (context) => `Finding repo with branch '${context.getWorkingBranch()}'`,
  async runner(context, repo) {
    const branch = context.getWorkingBranch();
    const cwd = path.join(context.rootDir, repo);

    try {
      await utils.exec('git rev-parse --verify ' + branch, { cwd });
      return true;
    } catch (err) {
      return false;
    }
  }
}, {
  single: true,
  async runner(context, checkoutResults) {
    const candidates = [];
    for (const { res, repo } of checkoutResults) {
      if (res) {
        candidates.push(repo);
      }
    }

    if (!candidates.length) {
      const branch = context.getWorkingBranch();
      logger.logInfo(`Cannot find any repository with branch '${branch}'.`);
      return context.interrupt();
    }

    const countRepos = candidates.length === 1 ? '' : `${candidates.length} repo${s(candidates)}, `;
    const valid = await utils.getYNAnswer(`Do you want to create a PR in ${countRepos}${candidates.join(', ')}?`);
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

function findPullRequestParams(context) {
  const { browse = false, assign = '' } = context.config;
  const reviewer = findReviewers(context);
  const repos = Array.from(context.pullRequestRepos).map(addBackTicks).join(', ');
  const message = `PR on \`${context.getWorkingBranch()}\` for ${repos}`;
  return { assign, browse, message, reviewer };
}

function addBackTicks(s) {
  return '`' + s + '`';
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
