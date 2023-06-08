const fs = require('fs');
const rc = require('rc');
const path = require('path');
const gitHelper = require('./simple-git');

class Context {
  constructor(appName, defaultConfig) {
    Context.normalizeDefaultConfig(defaultConfig);
    this.config = rc(appName, defaultConfig);
    this.repos = listRepositories(this.config);
    this.defaultBranches = getMapFromConfig(this.config.branches);
    resolveReferences(this.config.refs, this.defaultBranches);
    this.defaultBranch = this.config.defaultBranch || 'main';
    this.rootDir = this.config.root;
    this.workingBranch = null;
    this.interrupted = false;
    this.reposWithDetachedHead = new Set(this.config.reposWithDetachedHead);

    this.args = {};
    for (const arg of process.argv.slice(2)) {
      if (arg.startsWith('--')) {
        const [k, v = true] = arg.slice(2).split('=');
        this.args[k] = v;
      }
    }

    if (this.onlyCurrentRepo()) {
      this.repos = this.repos.filter(this.isInCurrentRepo, this);
    }

    this.contextPerRepo = new Map();
    this.gitAPIPerRepo = new Map();
    this.gitHubAPIPerRepo = new Map();
  }

  getDefaultBranch(repoName) {
    return this.defaultBranches.get(repoName) || this.defaultBranch;
  }

  hasDetachedHead(repoName) {
    return this.reposWithDetachedHead.has(repoName);
  }

  getGitAPI(repo) {
    const cached = this.gitAPIPerRepo.get(repo);
    if (cached) {
      return cached;
    }

    const sg = gitHelper.initSimpleGit(this, repo);
    this.gitAPIPerRepo.set(repo, sg);
    return sg;
  }

  async getGitHubAPI(repoRelativePath) {
    const cached = this.gitHubAPIPerRepo.get(repoRelativePath);
    if (cached) {
      return cached;
    }

    const sg = this.getGitAPI(repoRelativePath);
    const ghRepo = await gitHelper.getGHRepo(sg);
    this.gitHubAPIPerRepo.set(repoRelativePath, ghRepo);
    return ghRepo;
  }

  getRepoContext(repo) {
    return this.contextPerRepo.get(repo);
  }

  getRepoPath(repoName) {
    return path.join(this.rootDir, repoName);
  }

  getWorkingBranch() {
    if (this.workingBranch) {
      return this.workingBranch;
    }

    const [branchInArg] = this.config._;
    const branch = branchInArg ? branchInArg : this.args.branch || '';
    this.setWorkingBranch(branch);
    return this.workingBranch;
  }

  async getRepoCommonStatus(repo) {
    const sg = this.getGitAPI(repo);
    const defaultBranch = this.getDefaultBranch(repo);
    return gitHelper.commonStatus(sg, repo, defaultBranch);
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

  setRepoContext(repo, context) {
    this.contextPerRepo.set(repo, context);
  }

  setWorkingBranch(branch) {
    this.workingBranch = branch ? decodeURIComponent(branch) : null;
  }

  onlyCurrentRepo() {
    return this.args.this;
  }


  toPrintableUrl(url = '', _id = null) {
    if (this.config.raw) {
      return url;
    }

    const id = _id || lastPathItem(url);
    return url ? `\x1B]8;;${url}\x07${id}\x1B]8;;\x07` : url;
  }

  static normalizeDefaultConfig(defaultConfig = {}) {
    defaultConfig.branches = defaultConfig.branches || '';
    defaultConfig.repos = defaultConfig.repos || '';
    defaultConfig.root = defaultConfig.root || '';
  }
}

module.exports = Context;

function lastPathItem(url = '') {
  const parts = url.split('/');
  while (parts.length > 0) {
    const item = parts.pop();
    if (item) {
      return item;
    }
  }

  return url;
}

function getMapFromConfig(config) {
  if (!config) {
    return new Map();
  }

  if (typeof config !== 'string') {
    return new Map(Object.entries(config));
  }

  const m = new Map();
  for (const keyValue of distinctList(config)) {
    const [key, value] = keyValue.split(':');
    m.set(key, value);
  }

  return m;
}

function resolveReferences(references, map) {
  for (const [k, v] of map) {
    if (typeof v === 'string' && v.startsWith('${')) {
      map.set(k, resolveReference(references, v));
    }
  }
}

function resolveReference(references, value) {
  const key = value.slice(2, -1);
  return references[key] ?? value;
}

function distinctList(s) {
  if (!s) {
    return [];
  }

  const l = typeof s === 'string' ? s.split(',') : s;
  return Array.from(new Set(l));
}

function listRepositories(config) {
  if (config.repos) {
    return distinctList(config.repos);
  }

  const repos = [];
  for (const file of fs.readdirSync(config.root, { withFileTypes: true })) {
    const isGitRepository = fs.existsSync(path.join(config.root, file.name, '.git'));
    if (isGitRepository) {
      repos.push(file.name);
    }
  }

  return repos;
}
