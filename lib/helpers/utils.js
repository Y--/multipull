const debug = require('debug')('pullrepo:lib:helper:utils');
const util = require('util');
const child_process = require('child_process');
const readline = require('readline');
const logger = require('./logger');

const GIT_EXTENSION = '.git';

exports.s = s;

function s(arg) {
  const count = Array.isArray(arg) ? arg.length : arg;
  return count > 1 ? 's' : '';
}

exports.exec = util.promisify(child_process.exec);

exports.getYNAnswer = async function (question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let answer = null;
  while (answer === null) {
    const [a] = await getAnswer(rl, question + ' (Y/N) ');
    const lcA = a && a.toLowerCase();
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
};

async function getAnswer(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

exports.formatParmeters = function (o) {
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    if (!v) {
      continue;
    }

    parts.push(formatArgument(k, v));
  }
  return parts.join(' ');
};

function formatArgument(k, v) {
  const base = `--${k}`;
  if (v === true) {
    return base;
  }

  const strVal = '' + v;
  return base + '=' + (v.includes(' ') ? `"${strVal}"` : strVal);
}

exports.pickRandom = function (collection, count) {
  if (collection.length < count) {
    const suffix = `collection has only ${collection.length} element${s(collection)}`;
    throw new Error(`Cannot select ${count} element${s(count)}: ${suffix}`);
  }

  if (isNaN(+count)) {
    throw new Error(`Invalid count: ${count}`);
  }

  const candidates = collection.slice();
  const results = [];
  while (count > 0) {
    const index = Math.floor(Math.random() * Math.floor(candidates.length));
    results.push(candidates[index]);
    candidates.splice(index, 1);
    count--;
  }
  return results;
};

exports.findWorkingBranch = async function (context) {
  const workingBranch = context.getWorkingBranch();
  if (workingBranch) {
    return workingBranch;
  }

  try {
    // Make sure we're in a known repository.
    const { stdout: remoteUrl } = await exports.exec('git ls-remote --get-url');
    if (!remoteUrl) {
      return;
    }

    const fullRepo = remoteUrl.trim().split('/').pop();
    if (!fullRepo) {
      return;
    }

    const repo = fullRepo.endsWith(GIT_EXTENSION) ? fullRepo.slice(0, -GIT_EXTENSION.length) : fullRepo;
    if (!context.repos.includes(repo)) {
      return;
    }

    const { stdout: currentBranch } = await exports.exec('git rev-parse --abbrev-ref HEAD');
    return currentBranch.trim();
  } catch (err) {
    debug.enabled && debug(err);
  }
};
