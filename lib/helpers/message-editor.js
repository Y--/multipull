const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function readPRDescription(messageFileName) {
  let messageFileContent = null;
  try {
    messageFileContent = fs.readFileSync(messageFileName);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null; // File not saved
    }

    throw err;
  }

  fs.unlinkSync(messageFileName);

  const lines = messageFileContent.toString().split('\n');
  const result = { title: null, body: [] };
  let pendingEmptyLines = 0;
  for (const line of lines) {
    if (line.startsWith('#')) {
      continue;
    }

    if (!result.title && line.trimRight().length === 0) {
      continue;
    }

    if (!result.title) {
      result.title = line;
    } else if (line.trimRight().length === 0) {
      pendingEmptyLines++;
    } else {
      if (pendingEmptyLines > 0 && result.body.length > 0) {
        result.body.push(new Array(pendingEmptyLines + 1).join('\n'));
        pendingEmptyLines = 0;
      }

      result.body.push(line);
    }
  }

  result.body = result.body.length > 0 ? result.body.join('\n') : '';
  return result;
}

function writePRDescription(messageFileName, initialSpec) {
  const initialMessage = `${initialSpec.title}

${initialSpec.body}

# Please enter the pull request description. Lines starting with '#' will
# be ignored, and an empty message will leave the default one.
#
# On branch ${initialSpec.branch}
#`;
  // TODO: add something like # Your branch is ahead of 'origin/master' by x commits.
  fs.writeFileSync(messageFileName, initialMessage);
}

exports.editPRDescription = async function (initialSpec) {
  const editorProgram = process.env.VISUAL || process.env.EDITOR || 'vim';
  const messageFileName = path.join(os.tmpdir(), 'MULTIPULL_PR_EDITMSG');
  writePRDescription(messageFileName, initialSpec);

  const ps = spawn(editorProgram, [messageFileName], { stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    ps.on('exit', async (code, sig) => {
      if (code !== 0 || sig !== null) {
        return reject(new Error(`Message edition terminated with code: ${code}, signal: ${sig}.`));
      }

      return resolve(readPRDescription(messageFileName));
    });
  });
};
