const util          = require('util');
const child_process = require('child_process');
const readline      = require('readline');
const logger        = require('./logger');

exports.indent = function(msg, options = { size: 2, prefix: '|' }) {
  const indentTxt = new Array(options.size + 1).join(' ');
  const parts = msg.split('\n');
  const last = parts.pop();
  const indented = parts.map(line => options.prefix + indentTxt + line);
  indented.push(last);
  return indented.join('\n');
};

exports.s = s;

function s(arg) {
  const count = Array.isArray(arg) ? arg.length : arg;
  return count > 1 ? 's' : '';
}

exports.exec = util.promisify(child_process.exec);

exports.getYNAnswer = async function(question) {
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
};

async function getAnswer(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

exports.formatParmeters = function(o) {
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    if (!v) {
      continue;
    }

    parts.push(`--${k}` + (v === true ? '' : `=${v}`));
  }
  return parts.join(' ');
};

exports.pickRandom = function(collection, count) {
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