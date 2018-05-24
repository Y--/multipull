const rc = require('rc');

module.exports = function readConfig(appName) {
  const config    = rc(appName);
  const repos     = distinctList(config.repos);
  const branches  = distinctList(config.branches);
  const defaultBranches = new Map();
  for (const repoBranch of branches) {
    const [repo, branch] = repoBranch.split(':');
    defaultBranches.set(repo, branch);
  }

  return { repos, branches, defaultBranches, rootDir: config.root };
};

function distinctList(s) {
  if (!s) { return []; }
  return Array.from(new Set(s.split(',')));
}
