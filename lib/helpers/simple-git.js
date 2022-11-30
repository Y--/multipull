const debug = require('debug')('pullrepo:lib:helper:simple-git');

// Patch _schedule to ensure that we read everything
// otherwise, sometimes stash (at least) are not correctly reported.
patchSimpleGit();

const simpleGit = require('simple-git/src/git-factory');
const GitHub = require('github-api');

exports.initSimpleGit = function (context, repo) {
  const repoPath = context.getRepoPath(repo);
  try {
    return simpleGit.gitInstanceFactory(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in '${repoPath}' : ${err.message}`;
    throw err;
  }
};

const OWNER_RE = /github.com[:/](.*)\/(.*)\.git/;
exports.getGHRepo = async function (sg) {
  const gh = new GitHub({ token: process.env.GITHUB_TOKEN });
  const remoteUrl = await sg.listRemote(['--get-url']);
  if (!remoteUrl) {
    throw new Error('Cannot find remote url');
  }

  // Assumes remoteUrl is `git@github.com:owner/repo.git`
  const match = remoteUrl.match(OWNER_RE);
  if (!match) {
    throw new Error(`Remote URL '${remoteUrl}' doesn't match the expected format`);
  }

  const [, owner, repoName] = match;
  const ghRepo = gh.getRepo(owner, repoName);
  ghRepo.__owner = owner;
  ghRepo.__repoName = repoName;
  __patchRepositoryPrototype(ghRepo);
  return ghRepo;
};

exports.getStatus = async function (sg) {
  const status = await sg.status();
  if (status.current === null && status.tracking === null) {
    return await sg.status(); // Retry
  } else if (status.current === 'HEAD') {
    const sha = await sg.raw(['rev-parse', 'HEAD']);
    status.current = sha.slice(0, 24);
  }

  return status;
};

exports.commonStatus = async function (sg, repo, defaultBranch, additionalResults) {
  const [stash, status, hasWipCommit] = await Promise.all([
    getStashStatus(sg),
    getFullStatus(sg, defaultBranch),
    getHasWipCommit(sg)
  ]);

  return Object.assign({ status, stash, hasWipCommit }, additionalResults);
};

async function getStashStatus(sg) {
  const stash = await sg.stashList();
  if (stash.total === undefined) {
    stash.total = 0;
  }

  return stash;
}

async function getFullStatus(sg, defaultBranch) {
  const status = await exports.getStatus(sg);
  status.isDefaultBranch = status.current === defaultBranch;

  if (!status.isDefaultBranch && status.current) {
    await getDiffFromMain(sg, defaultBranch, status);
  }

  return status;
}

async function getHasWipCommit(sg) {
  const lastCommitTitle = await sg.raw(['log', '--pretty=format:%s', '-1']);
  if (!lastCommitTitle.toLowerCase().includes('wip')) {
    return false;
  }

  let idx = lastCommitTitle.indexOf('wip');
  if (idx === -1) {
    idx = lastCommitTitle.indexOf('WIP');
  }

  return idx > -1 && hasWipWord(lastCommitTitle, 3, idx);
}

function hasWipWord(str, subLen, idx) {
  return (idx === 0 || str[idx - 1] === ' ')
      && (subLen === str.length || str[subLen] === ' ');
}

async function getDiffFromMain(sg, mainBranch, status) {
  let revList = null;
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

exports.fetchAll = async function (sg, repo, context) {
  try {
    await sg.fetch(['--all']);
  } catch (err) {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg, context);
    await sg.fetch(['--all']);
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
  const head = ghRepo.__owner + ':' + branch;
  const AcceptHeader = 'shadow-cat-preview';
  const res = await ghRepo.listPullRequests({ state: 'open', head, AcceptHeader });
  return res.data;
};

exports.listOpenPullRequests = async function (ghRepo) {
  const AcceptHeader = 'shadow-cat-preview';
  const res = await ghRepo.listPullRequests({ state: 'open', AcceptHeader });
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

function __patchRepositoryPrototype(ghRepo) {
  if (ghRepo.constructor.prototype.createReviewRequest) {
    return;
  }

  ghRepo.constructor.prototype.createReviewRequest = function (number, options, cb) {
    return this._request('POST', `/repos/${this.__fullname}/pulls/${number}/requested_reviewers`, options, cb);
  };

  ghRepo.constructor.prototype.approveReviewRequest = function (number, cb) {
    return this._request('POST', `/repos/${this.__fullname}/pulls/${number}/reviews`, { event: 'APPROVE' }, cb);
  };

  ghRepo.constructor.prototype.getReviews = function (number, cb) {
    return this._request('GET', `/repos/${this.__fullname}/pulls/${number}/reviews`, null, cb);
  };

  ghRepo.constructor.prototype.getCombinedStatus = function (ref, options, cb) {
    return this._request('GET', `/repos/${this.__fullname}/commits/${ref}/status`, options, cb);
  };

  ghRepo.constructor.prototype.graphql = function (options, cb) {
    return this._request('POST', '/graphql', options, cb);
  };

  wrapGHFunctions(ghRepo.constructor.prototype);
}

function wrapGHFunctions(prototype) {
  const nonWrappables = new Set(
    Object.getOwnPropertyNames(Object).concat(Object.getOwnPropertyNames({}.constructor.prototype))
  );
  for (const methodName of Object.getOwnPropertyNames(prototype)) {
    if (methodName[0] === '_' || nonWrappables.has(methodName)) {
      continue;
    }

    prototype[methodName] = wrapGHFunction(prototype, methodName);
  }
}

function wrapGHFunction(prototype, methodName) {
  const method = prototype[methodName];
  return async function (...args) {
    try {
      return await method.call(this, ...args);
    } catch (err) {
      const data = err.response && err.response.data;
      if (data) {
        const errors = extractErrors(data);
        err.message = `Error while calling ${methodName}: ${errors}: ${err.message}`;
      }
      throw err;
    }
  };
}

function extractErrors(data) {
  const parts = [];
  if (data.message) {
    parts.push(data.message);
  }

  if (data.errors) {
    parts.push(...data.errors.map((err) => err.message + '\n------------\n' + err.stack));
  }
  return parts.join('; ');
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

function patchSimpleGit() {
  const { GitExecutorChain } = require('simple-git/src/lib/runners/git-executor-chain.js');
  const child_process = require('child_process');

  GitExecutorChain.prototype.gitResponse = function (command, args, outputHandler) {
    const spawnOptions = { cwd: this.cwd, env: this.env, windowsHide: true };
    return new Promise((resolve) => {
      const stdOut = [];
      const stdErr = [];
      let attempted = false;
      function attemptClose(exitCode) {
        // closing when there is content, terminate immediately
        if (attempted || stdErr.length || stdOut.length) {
          resolve({ stdOut, stdErr, exitCode });
          attempted = true;
        }
        // first attempt at closing but no content yet, wait briefly for the close/exit that may follow
        if (!attempted) {
          attempted = true;
        }
      }

      const spawned = child_process.spawn(command, args, spawnOptions);
      spawned.stdout.on('data', (buffer) => stdOut.push(buffer));
      spawned.stderr.on('data', (buffer) => stdErr.push(buffer));
      spawned.on('error', (err) => stdErr.push(Buffer.from(String(err.stack), 'ascii')));
      spawned.on('close', attemptClose);
      spawned.on('exit', attemptClose);

      if (outputHandler) {
        outputHandler(command[0], spawned.stdout, spawned.stderr);
      }
    });
  };
}
