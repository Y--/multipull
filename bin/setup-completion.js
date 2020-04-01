#! /usr/bin/env node

const fs = require('fs');
const tabtab = require('tabtab');

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'install') {
    return installCompletion();
  } else if (cmd === 'uninstall') {
    return uninstallCompletion();
  }
})();

async function installCompletion() {
  const location = process.argv[3] || '~/.zshrc';
  for (const name of listFiles()) {
    await tabtab.install({ name, completer: 'multipull-completer', location });
  }
}

async function uninstallCompletion() {
  return Promise.allSettled(listFiles().map((name) => tabtab.uninstall({ name })));
}

function listFiles() {
  const files = [];
  for (const file of fs.readdirSync(__dirname)) {
    if (file !== 'setup-completion.js' && file !== 'multipull-completer') {
      files.push(file);
    }
  }

  return files;
}
