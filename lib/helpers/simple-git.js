const debug     = require('debug')('pullrepo:lib:helper:simple-git');
const simpleGit = require('simple-git/promise');
const GitHub    = require('github-api');

exports.initSimpleGit = function(context, repo) {
  const repoPath = context.getRepoPath(repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
};

const OWNER_RE = /github.com[:/](.*)\//;
exports.getGHRepo = async function(sg, repo) {
  const gh = new GitHub({ token: process.env.GITHUB_TOKEN });
  const remoteUrl = await sg.listRemote(['--get-url']);
  if (!remoteUrl) {
    throw new Error('Cannot find remote url');
  }

  // Assumes remoteUrl is `git@github.com:owner/repo.git`
  const ownerMatch = remoteUrl.match(OWNER_RE);
  if (!ownerMatch) {
    throw new Error(`Remote URL '${remoteUrl}' doesn't match the expected format`);
  }

  const owner = ownerMatch[1];
  const ghRepo = gh.getRepo(owner, repo);
  ghRepo.__owner = owner;
  __patchRepositoryPrototype(ghRepo);
  return ghRepo;
};

exports.getStatus = async function(sg) {
  const status = await sg.status();
  if (status.current === null && status.tracking === null) {
    return await sg.status();
  }
  return status;
};

exports.commonStatus = async function(sg, repo, additionalResults) {
  const stash = await sg.stashList();
  if (stash.total === undefined) {
    stash.total = 0;
  }

  const status = await exports.getStatus(sg);
  await getDiffFromMaster(sg, status);

  return Object.assign({ status, stash }, additionalResults);
};

async function getDiffFromMaster(sg, status) {
  if (status.current === 'master' || !status.current) {
    return;
  }

  const revList = await sg.raw(['rev-list', '--left-right', 'origin/master...' + status.current]);

  let { ahead, behind } = { ahead: 0, behind: 0 };
  const hashes = revList ? revList.split('\n') : [];
  for (const hash of hashes) {
    if (!hash) { continue; }
    hash.startsWith('<') ? ++behind : ++ahead;
  }

  status.diff_with_origin_master = { ahead, behind };
}

exports.fetchAll = async function(sg, repo, context) {
  try {
    await sg.fetch(['--all']);
  } catch (err) {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg, context);
    await sg.fetch(['--all']);
  }
};

exports.findPullRequestsOnBranch = async function(context, repo, currentBranch) {
  if (!currentBranch || currentBranch === 'master') {
    return;
  }

  const prsDetails = await listPullRequests(context, repo, currentBranch);
  if (!prsDetails) {
    return;
  }

  const res = [];
  for (const [reviews, status, pr] of prsDetails) {
    res.push({
      html_url: pr.html_url,
      mergeable_state: pr.mergeable_state,
      reviews: reviews.map(r => r.state),
      ci_status: {
        state: status.state,
        statuses: status.statuses.map(s => pick(s, ['state', 'description', 'created_at', 'context', 'target_url'])),
      },
      mergeable: pr.mergeable
    });
  }

  return res;
};

async function listPullRequests(context, repo, branch) {
  const ghRepo = await context.getGitHubAPI(repo);
  const head = ghRepo.__owner + ':' + branch;
  const { data: prs } = await ghRepo.listPullRequests({ state: 'open', head, base: 'master' });
  return prs && Promise.all(prs.map(pr => generateDetails(ghRepo, pr)));
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

  ghRepo.constructor.prototype.createReviewRequest = function(number, options, cb) {
    return this._request('POST', `/repos/${this.__fullname}/pulls/${number}/requested_reviewers`, options, cb);
  };

  ghRepo.constructor.prototype.getReviews = function(number, cb) {
    return this._request('GET', `/repos/${this.__fullname}/pulls/${number}/reviews`, null, cb);
  };

  ghRepo.constructor.prototype.getCombinedStatus = function(ref, options, cb) {
    return this._request('GET', `/repos/${this.__fullname}/commits/${ref}/status`, options, cb);
  };

  wrapGHFunctions(ghRepo.constructor.prototype);
}

function wrapGHFunctions(prototype) {
  const nonWrappables = new Set(Object.getOwnPropertyNames(Object).concat(Object.getOwnPropertyNames({}.constructor.prototype)));
  for (const methodName of Object.getOwnPropertyNames(prototype)) {
    if (methodName[0] === '_' || nonWrappables.has(methodName)) {
      continue;
    }

    prototype[methodName] = wrapGHFunction(prototype, methodName);
  }
}

function wrapGHFunction(prototype, methodName) {
  const method = prototype[methodName];
  return async function(...args) {
    try {
      const res = await method.call(this, ...args);
      return res;
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
    parts.push(...data.errors.map(err => err.message));
  }
  return parts.join('; ');
}

async function generateDetails(ghRepo, pr) {
  const details = await Promise.all([
    ghRepo.getReviews(pr.number),
    ghRepo.getCombinedStatus(pr.head.sha),
    ghRepo.getPullRequest(pr.number)
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
