const debug     = require('debug')('pullrepo:lib:helper:simple-git');
const simpleGit = require('simple-git/promise');
const GitHub    = require('github-api');

module.exports.initSimpleGit = function(context, repo) {
  const repoPath = context.getRepoPath(repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
};

const OWNER_RE = /github.com[:/](.*)\//;
module.exports.getGHRepo = async function(sg, repo) {
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

module.exports.commonStatus = async function(sg, repo, additionalResults) {
  const status = await sg.status();
  const stash = await sg.stashList();
  if (stash.total === undefined) {
    stash.total = 0;
  }

  await getDiffFromMaster(sg, status);

  return Object.assign({ status, stash }, additionalResults);
};

async function getDiffFromMaster(sg, status) {
  if (status.current === 'master') {
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

module.exports.fetchAll = async function(sg, repo, context) {
  try {
    await sg.fetch(['--all']);
  } catch (err) {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg, context);
    await sg.fetch(['--all']);
  }
};

async function runOneGC(sg, context) {
  if (context.currentGcExecution) {
    await context.currentGcExecution;
    return runOneGC(sg);
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
}
