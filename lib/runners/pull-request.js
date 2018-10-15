/* eslint-disable no-console */
const readline      = require('readline');
const debug         = require('debug')('pullrepo:lib:pull-request');
const Processor     = require('../helpers/processor');
const doCheckout    = require('./checkout-branch-repo');
const configReader  = require('../helpers/config');
const util          = require('util');
const path          = require('path');
const child_process = require('child_process');

const exec = util.promisify(child_process.exec);

createPullRequest();

async function createPullRequest() {
  const context = configReader('multipull');
  debug.enabled && debug(`Will process ${context.repos.join(', ')} repos in ${context.rootDir}.`);

  const branch = context.getWorkingBranch();
  if (!branch) {
    return console.error(`Usage ${process.argv.join(' ')} <branch>`);
  }

  if (branch === 'master') {
    return console.error('Refusing to create a PR on \'master\'');
  }

  console.log(`Will create pull requests on ${branch}.`);

  const checkoutResults = await runProcessor(context, doCheckout);
  const { hasError, candidates } = processCheckoutResults(branch, checkoutResults);
  if (hasError) {
    return console.error('Checkout failed: aborting.');
  }

  const countRepos = `${candidates.length} repo${candidates.length > 1 ? 's' : ''}`;
  const valid = await validateYN(`Will create PR in ${countRepos}: ${candidates.join(', ')}, proceed?`);
  if (!valid) {
    return console.log('Aborted.');
  }

  context.pullRequestRepos = new Set(candidates);
  const createPRResults = await runProcessor(context, doCreatePullRequest);
  for (const res of createPRResults) {
    if (!context.pullRequestRepos.has(res.repo)) { continue; }
    console.log(`${res.repo} : `);
    if (res.err && res.err.stderr) {
      console.log(indent(res.err.stderr));
    } else {
      console.log(res);
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
      console.error(`Could not checkout ${r.repo}:`);
      console.error(indent(r.err.message));
    } else if (r.res.status.current === branch) {
      candidates.push(r.repo);
    }
  }
  return { hasError, candidates };
}

function indent(msg, options = { size: 2, prefix: '|' }) {
  const indentTxt = new Array(options.size + 1).join(' ');
  const parts = msg.split('\n');
  const last = parts.pop();
  const indented = parts.map(line => options.prefix + indentTxt + line);
  indented.push(last);
  return indented.join('\n');
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
      console.error('Please answer Y/N');
    }
  }

  rl.close();
  return answer;
}

async function getAnswer(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}