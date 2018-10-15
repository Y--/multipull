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

exports.s = function(arg) {
  const count = Array.isArray(arg) ? arg.length : +arg;
  return count > 1 ? 's' : '';
};

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