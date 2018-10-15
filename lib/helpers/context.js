const rc   = require('rc');
const path = require('path');

class Context {
  constructor(appName, defaultConfig) {
    Context.normalizeDefaultConfig(defaultConfig);

    this.config        = rc(appName, defaultConfig);
    this.repos         = Context.distinctList(this.config.repos);
    this.branches      = Context.distinctList(this.config.branches);
    this.rootDir       = this.config.root;
    this.workingBranch = null;
    this.interrupted   = false;

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

  getWorkingBranch() {
    if (this.workingBranch) {
      return this.workingBranch;
    }

    const [branchInArg] = this.config._;
    return branchInArg ? branchInArg : this.args.branch || '';
  }

  isDryRunMode() {
    return !!this.args.dry;
  }

  isInCurrentRepo(repoName) {
    return this.getRepoPath(repoName) === process.cwd();
  }

  isInterrupted() {
    return this.interrupted;
  }

  interrupt() {
    this.interrupted = true;
  }

  setWorkingBranch(branch) {
    this.workingBranch = branch;
  }

  onlyCurrentRepo() {
    return this.args.this;
  }

  static distinctList(s) {
    if (!s) { return []; }
    return Array.from(new Set(s.split(',')));
  }

  static normalizeDefaultConfig(defaultConfig = {}) {
    defaultConfig.branches = defaultConfig.branches || '';
    defaultConfig.repos = defaultConfig.repos || '';
    defaultConfig.root = defaultConfig.root || '';
  }
}

module.exports = Context;
