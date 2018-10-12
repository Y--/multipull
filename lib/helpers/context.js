const rc   = require('rc');
const path = require('path');

class Context {
  constructor(appName) {
    this.config        = rc(appName);
    this.repos         = distinctList(this.config.repos);
    this.branches      = distinctList(this.config.branches);
    this.rootDir       = this.config.root;
    this.workingBranch = null;

    this.defaultBranches = new Map();
    for (const repoBranch of this.branches) {
      const [repo, branch] = repoBranch.split(':');
      this.defaultBranches.set(repo, branch);
    }

    this.args = {};
    for (const arg of process.argv.slice(2)) {
      if (!arg.startsWith('--')) { continue; }
      const [k, v = true] = arg.slice(2).split('=');
      this.args[k] = v;
    }

    if (this.onlyCurrentRepo()) {
      this.repos = this.repos.filter(this.isInCurrentRepo, this);
    }
  }

  getDefaultBranch(repoName) {
    return this.defaultBranches.get(repoName) || 'master';
  }

  getRepoPath(repoName) {
    return path.join(this.rootDir, repoName);
  }

  isInCurrentRepo(repoName) {
    return this.getRepoPath(repoName) === process.cwd();
  }

  isDryRunMode() {
    return !!this.args.dry;
  }

  getWorkingBranch() {
    if (this.workingBranch) {
      return this.workingBranch;
    }

    const [branchInArg] = this.config._;
    return branchInArg ? branchInArg : this.args.branch || '';
  }

  setWorkingBranch(branch) {
    this.workingBranch = branch;
  }

  onlyCurrentRepo() {
    return this.args.this;
  }
}

module.exports = function createContext(appName) {
  return new Context(appName);
};

function distinctList(s) {
  if (!s) { return []; }
  return Array.from(new Set(s.split(',')));
}
