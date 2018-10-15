const readline      = require('readline');
const debug         = require('debug')('pullrepo:lib:pull-request');
const Processor     = require('../helpers/processor');
const { indent, s } = require('../helpers/utils');
const doCheckout    = require('./checkout-branch-repo');
const configReader  = require('../helpers/config');
const util          = require('util');
const path          = require('path');
const child_process = require('child_process');
const logger        = require('../helpers/logger');

const exec = util.promisify(child_process.exec);

createPullRequest();

async function createPullRequest() {
  const context = configReader('multipull');
  debug.enabled && debug(`Will process ${context.repos.join(', ')} repos in ${context.rootDir}.`);

  const branch = context.getWorkingBranch();
  if (!branch) {
    return logger.logError(`Usage ${process.argv.join(' ')} <branch>`);
  }

  if (branch === 'master') {
    return logger.logError('Refusing to create a PR on \'master\'');
  }

  logger.logInfo(`Will create pull requests on ${branch}.`);

  const checkoutResults = await runProcessor(context, doCheckout);
  const { hasError, candidates } = processCheckoutResults(branch, checkoutResults);
  if (hasError) {
    return logger.logError('Checkout failed: aborting.');
  }

  const countRepos = `${candidates.length} repo${s(candidates)}`;
  const valid = await validateYN(`Will create PR in ${countRepos}: ${candidates.join(', ')}, proceed?`);
  if (!valid) {
    return logger.logInfo('Aborted.');
  }

  context.pullRequestRepos = new Set(candidates);
  const createPRResults = await runProcessor(context, doCreatePullRequest);
  for (const res of createPRResults) {
    if (!context.pullRequestRepos.has(res.repo)) { continue; }
    logger.logInfo(`${res.repo} : `);
    if (res.err && res.err.stderr) {
      logger.logInfo(indent(res.err.stderr));
    } else {
      logger.logInfo(res);
    }
  }
}

async function doCreatePullRequest(context, repo) {
  if (!context.pullRequestRepos.has(repo)) {
    return;
  }

  debug.enabled && debug(`Processing repository ${repo}...`);
  const cwd = path.join(context.rootDir, repo);
  const { stdout, stderr } = await exec('hub pull-request --no-edit', { cwd });
  return { stdout, stderr };
}

async function runProcessor(context, func) {
  const processor = new Processor(context, func);
  return processor.run();
}

function processCheckoutResults(branch, results) {
  let hasError = false;
  const candidates = [];
  for (const r of results) {
    if (r.err) {
      hasError = true;
      logger.logError(`Could not checkout ${r.repo}:`);
      logger.logError(indent(r.err.message));
    } else if (r.res.status.current === branch) {
      candidates.push(r.repo);
    }
  }
  return { hasError, candidates };
}

async function validateYN(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let answer = null;
  while (answer === null) {
    const [a] = await getAnswer(rl, question + ' (Y/N) ');
    const lcA = a.toLowerCase();
    if (lcA === 'y') {
      answer = true;
    } else if (lcA === 'n') {
      answer = false;
    } else {
      logger.logError('Please answer Y/N');
    }
  }

  rl.close();
  return answer;
}

async function getAnswer(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}