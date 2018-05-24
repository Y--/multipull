const path      = require('path');
const simpleGit = require('simple-git/promise');

module.exports = function initSimpleGit({ rootDir }, repo) {
  const repoPath = path.join(rootDir, repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
};