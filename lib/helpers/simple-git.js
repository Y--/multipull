Error.stackTraceLimit = Infinity;
const debug = require('debug')('pullrepo:lib:helper:simple-git');
const { simpleGit } = require('simple-git');
const fsSync = require('fs');
const { promises: fs }  = require('fs');
const childProcess = require('child_process');
const path = require('path');
const ini = require('ini');
const { GitHubRepository } = require('./github');

const EMPTY_STATUS = {
  not_added: [],
  conflicted: [],
  created: [],
  deleted: [],
  ignored: undefined,
  modified: [],
  renamed: [],
  files: [],
  staged: [],
  ahead: 0,
  behind: 0,
  current: '',
  tracking: null,
  detached: true,
  isClean: true
};

// `git` on the PATH can be a wrapper (e.g. /usr/bin/git on macOS runs `xcrun` to find the real one on every call):
// call the git binary of `git --exec-path` directly, which makes each command faster.
let gitBinary = null;
exports.getGitBinary = function () {
  if (gitBinary === null) {
    gitBinary = findGitBinary();
  }

  return gitBinary;
};

function findGitBinary() {
  try {
    const execPath = childProcess.execFileSync('git', ['--exec-path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const candidate = path.join(execPath.trim(), process.platform === 'win32' ? 'git.exe' : 'git');
    fsSync.accessSync(candidate, fsSync.constants.X_OK);
    debug.enabled && debug(`Using git binary ${candidate}`);
    return candidate;
  } catch (err) {
    debug.enabled && debug('Cannot find the git binary, using `git`', err);
    return 'git';
  }
}

exports.initSimpleGit = function (context, repo) {
  const repoPath = context.getRepoPath(repo);
  try {
    const sg = simpleGit({ baseDir: repoPath, binary: exports.getGitBinary() });
    sg.context = context;
    sg.repo = repo;
    return sg;
  } catch (err) {
    if (err.message.includes('Cannot use simple-git on a directory that does not exist')) {
      err.message = `Cannot start: repository '${repoPath}' does not exist`;
      err.stack = '';
      delete err.task;
      delete err.config;
    } else {
      err.message = `Cannot setup git in '${repoPath}' : ${err.message}`;
    }
    throw err;
  }
};

const OWNER_RE = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/;
exports.getGHRepo = async function (sg) {
  const remoteUrl = (await sg.listRemote(['--get-url'])).trim();
  if (!remoteUrl) {
    throw new Error('Cannot find remote url');
  }

  // `git@github.com:owner/repo.git`, `https://github.com/owner/repo`, ...
  const match = remoteUrl.match(OWNER_RE);
  if (!match) {
    throw new Error(`Remote URL '${remoteUrl}' doesn't match the expected format`);
  }

  const [, owner, repoName] = match;
  return exports.createGitHubRepository(owner, repoName);
};

exports.createGitHubRepository = function (owner, repoName) {
  return new GitHubRepository(owner, repoName);
};

exports.getStatus = async function (sg) {
  const parentRepo = sg.context.submoduleToParentMap.get(sg.repo);
  if (parentRepo) {
    const status = Object.create(EMPTY_STATUS);
    status.isSubmodule = true;
    const submodulePath = sg.repo.slice(parentRepo.length + 1);
    try {
      const revisions = await getSubmodulesRevisions(sg.context, parentRepo);
      const revision = revisions.get(submodulePath);
      if (revision) {
        status.current = revision;
      }

      return status;
    } catch (err) {
      // The error of the parent's diff is shared by its submodules: don't modify it
      throw new Error(`Cannot get submodule status for ${sg.repo} in ${parentRepo}: ${err.message}`, { cause: err });
    }
  }

  const status = await sg.status();
  if (status.current === null && status.tracking === null) {
    return await sg.status(); // Retry
  } else if (status.current === 'HEAD') {
    const sha = await sg.raw(['rev-parse', 'HEAD']);
    status.current = sha.slice(0, 24);
  }

  return status;
};

// `old..new` revisions of the modified submodules of `parentRepo`, keyed by path. A single `git diff` is run for
// all the submodules of a parent: concurrent requests share it, later ones (e.g. after a pull) run a new one.
function getSubmodulesRevisions(context, parentRepo) {
  context.pendingSubmodulesDiffs = context.pendingSubmodulesDiffs || new Map();
  let pending = context.pendingSubmodulesDiffs.get(parentRepo);
  if (!pending) {
    pending = diffSubmodules(context, parentRepo).finally(() => context.pendingSubmodulesDiffs.delete(parentRepo));
    context.pendingSubmodulesDiffs.set(parentRepo, pending);
  }

  return pending;
}

async function diffSubmodules(context, parentRepo) {
  const prefix = parentRepo + '/';
  const paths = [];
  for (const [submodule, parent] of context.submoduleToParentMap) {
    if (parent === parentRepo) {
      paths.push(submodule.slice(prefix.length));
    }
  }

  const diff = await context.getGitAPI(parentRepo).raw(['diff', '--submodule=short', '--', ...paths]);
  return parseSubmodulesDiff(diff);
}

function parseSubmodulesDiff(diff) {
  const revisions = new Map();
  let path = null;
  for (const line of (diff || '').split('\n')) {
    if (line.startsWith('diff --git a/')) {
      path = line.slice('diff --git a/'.length, line.lastIndexOf(' b/'));
    } else if (path !== null && line.startsWith('index ') && !revisions.has(path)) {
      revisions.set(path, line.split(' ')[1]);
    }
  }

  return revisions;
}

exports.getSubmodules = async function (rootDir, repo) {
  const submodules = [];
  let gitmodulesStr;
  try {
    const c = await fs.readFile(`${rootDir}/${repo}/.gitmodules`);
    gitmodulesStr = c.toString();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const gitmodulesConf = await ini.parse(gitmodulesStr);
  for (const { path } of Object.values(gitmodulesConf)) {
    submodules.push(`${repo}/${path}`);
  }

  return submodules;
};

exports.updateSubmodules = async function (sg) {
  await sg.raw(['submodule', 'update', '--recursive']);
};

// `options.status`: the result of `getStatus` if it was just computed, to avoid running it again
exports.commonStatus = async function (sg, repo, defaultBranch, additionalResults, options = {}) {
  if (sg.context.submoduleToParentMap.has(sg.repo)) {
    return submoduleCommonStatus(sg, defaultBranch, additionalResults);
  }

  const [stash, status, hasWipCommit] = await Promise.all([
    getStashStatus(sg),
    getFullStatus(sg, defaultBranch, options.status),
    getHasWipCommit(sg),
  ]);

  return Object.assign({ status, stash, hasWipCommit }, additionalResults);
};

// Unchanged submodules are not displayed: only look at their stash and last commit when they changed
async function submoduleCommonStatus(sg, defaultBranch, additionalResults) {
  const status = await getFullStatus(sg, defaultBranch);
  if (!status.current) {
    return Object.assign({ status, stash: { all: [], latest: null, total: 0 }, hasWipCommit: false }, additionalResults);
  }

  const [stash, hasWipCommit] = await Promise.all([getStashStatus(sg), getHasWipCommit(sg)]);
  return Object.assign({ status, stash, hasWipCommit }, additionalResults);
}

async function getStashStatus(sg) {
  try {
    const stash = await sg.stashList();
    if (stash.total === undefined) {
      stash.total = 0;
    }

    return stash;
  } catch (err) {
    err.message = `Cannot get stash status for ${sg.repo}: ${err.message}`;
    throw err;
  }
}

async function getFullStatus(sg, defaultBranch, knownStatus = null) {
  const status = knownStatus || (await exports.getStatus(sg));
  status.isDefaultBranch = status.current === defaultBranch;

  if (!status.isSubmodule && !status.isDefaultBranch && status.current) {
    await getDiffFromMain(sg, defaultBranch, status);
  }

  return status;
}

const WIP_WORD_RE = /\bwip\b/i;
async function getHasWipCommit(sg) {
  const lastCommitTitle = await sg.raw(['log', '--pretty=format:%s', '-1']);
  return WIP_WORD_RE.test(lastCommitTitle);
}

async function getDiffFromMain(sg, mainBranch, status) {
  let revList;
  try {
    revList = await sg.raw(['rev-list', '--left-right', `origin/${mainBranch}...${status.current}`]);
  } catch (err) {
    if (err.message.includes('unknown revision or path not in the working tree')) {
      status.diff_with_origin_main = { ahead: 'x', behind: 'x' };
      return;
    } else {
      throw err;
    }
  }

  let { ahead, behind } = { ahead: 0, behind: 0 };
  const hashes = revList ? revList.split('\n') : [];
  for (const hash of hashes) {
    if (hash) {
      hash.startsWith('<') ? ++behind : ++ahead;
    }
  }

  status.diff_with_origin_main = { ahead, behind };
}

// Remotes (and submodules) are fetched in parallel (network bound): a repository with 3 remotes is fetched about
// 3 times faster
const FETCH_ARGS = ['--all', '--jobs=8'];

exports.fetchAll = async function (sg, repo, context) {
  try {
    await sg.fetch(FETCH_ARGS);
  } catch {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg, context);
    await sg.fetch(FETCH_ARGS);
  }
};

exports.findPullRequestsOnBranch = async function (context, repo, currentBranch) {
  if (!currentBranch || currentBranch === context.getDefaultBranch(repo)) {
    return;
  }

  const prsDetails = await listPullRequestsWithDetails(context, repo, currentBranch);
  if (!prsDetails) {
    return;
  }

  const res = [];
  for (const [reviews, status, pr] of prsDetails) {
    res.push({
      number: pr.number,
      html_url: pr.html_url,
      mergeable_state: pr.mergeable_state,
      reviews: reviews.map((r) => r.state),
      ci_status: {
        state: status.state,
        statuses: status.statuses.map((s) => pick(s, ['state', 'description', 'created_at', 'context', 'target_url'])),
      },
      mergeable: pr.mergeable,
    });
  }

  return res;
};

exports.listPullRequests = async function (ghRepo, branch) {
  const head = ghRepo.owner + ':' + branch;
  const res = await ghRepo.listPullRequests({ state: 'open', head });
  return res.data;
};

exports.listOpenPullRequests = async function (ghRepo) {
  const res = await ghRepo.listAllPullRequests({ state: 'open' });
  return res.data;
};

async function listPullRequestsWithDetails(context, repo, branch) {
  const ghRepo = await context.getGitHubAPI(repo);
  const prs = await exports.listPullRequests(ghRepo, branch);
  return prs && Promise.all(prs.map((pr) => generateDetails(ghRepo, pr)));
}

async function runOneGC(sg, context) {
  if (context.currentGcExecution) {
    await context.currentGcExecution;
    return runOneGC(sg, context);
  }

  context.currentGcExecution = sg.raw(['gc', '--prune=now']);
  await context.currentGcExecution;
  context.currentGcExecution = null;
}

async function generateDetails(ghRepo, pr) {
  const details = await Promise.all([
    ghRepo.getReviews(pr.number),
    ghRepo.getCombinedStatus(pr.head.sha),
    ghRepo.getPullRequest(pr.number),
  ]);
  return details.map(({ data }) => data);
}

function pick(o, keys) {
  const res = {};
  for (const k of keys) {
    res[k] = o[k];
  }
  return res;
}
