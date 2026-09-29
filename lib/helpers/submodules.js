const debug = require('debug')('pullrepo:lib:helper:submodules');

const SUBMODULE_UPDATE_JOBS = 8;

// Updates the submodules of `parentRepo` that are outdated: initialized, without local changes and checked out at a
// commit that the one recorded in the parent contains (so no commit is left behind). The others are left untouched.
//
// Returns { updated: [{ path, from, to }], skipped: [{ path, reason }] }, paths being relative to the parent.
exports.updateOutdatedSubmodules = async function (context, parentRepo) {
  const result = { updated: [], skipped: [] };
  const paths = listSubmodulePaths(context, parentRepo);
  if (paths.length === 0) {
    return result;
  }

  const parentSg = context.getGitAPI(parentRepo);
  const [recorded, checkedOut] = await Promise.all([
    getRecordedCommits(parentSg, paths),
    getCheckedOutCommits(parentSg, paths),
  ]);

  const candidates = [];
  for (const path of paths) {
    const head = checkedOut.get(path);
    const target = recorded.get(path);
    if (!head || !target || head.state === 'not initialized' || head.sha === target) {
      continue; // Up to date, or not something the user asked for
    }

    if (head.state === 'conflict') {
      result.skipped.push({ path, reason: 'merge conflict' });
      continue;
    }

    candidates.push({ path, from: head.sha, to: target });
  }

  const checks = await Promise.all(candidates.map((c) => checkCanUpdate(context, parentRepo, c)));
  const toUpdate = [];
  candidates.forEach((candidate, i) => {
    if (checks[i]) {
      result.skipped.push({ path: candidate.path, reason: checks[i] });
    } else {
      toUpdate.push(candidate);
    }
  });

  if (toUpdate.length === 0) {
    return result;
  }

  const updatePaths = toUpdate.map((c) => c.path);
  debug.enabled && debug(`Updating the submodules of ${parentRepo}: ${updatePaths.join(', ')}`);
  try {
    await parentSg.raw(['submodule', 'update', '--recursive', `--jobs=${SUBMODULE_UPDATE_JOBS}`, '--', ...updatePaths]);
    result.updated.push(...toUpdate);
  } catch (err) {
    const reason = `update failed: ${firstLine(err.message)}`;
    result.skipped.push(...updatePaths.map((path) => ({ path, reason })));
  }

  return result;
};

// Why `candidate` can't be updated, or null if it can
async function checkCanUpdate(context, parentRepo, { path, from, to }) {
  const sg = context.getGitAPI(`${parentRepo}/${path}`);
  try {
    const localChanges = await sg.raw(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty']);
    if (localChanges.trim()) {
      return 'local changes';
    }

    if (!(await hasCommit(sg, to))) {
      await sg.fetch();
      if (!(await hasCommit(sg, to))) {
        return `commit ${short(to)} not found`;
      }
    }

    // Behind: `from` is an ancestor of `to` (their merge base is `from`)
    const mergeBase = (await sg.raw(['merge-base', from, to])).trim();
    if (mergeBase === from) {
      return null;
    }

    // Ahead or diverged: don't move the user away from a branch they are working on
    const branch = await getCurrentBranch(sg);
    if (branch) {
      return `on branch ${branch}, with commits that ${parentRepo} doesn't have`;
    }

    // Detached HEAD (e.g. left there by a `git submodule update` on another branch of the parent): fine as long as its
    // commits are on a remote branch or a tag, i.e. nothing is lost
    return (await isOnRemoteBranchOrTag(sg, from)) ? null : 'has commits that are on no branch';
  } catch (err) {
    return `cannot check it: ${firstLine(err.message)}`;
  }
}

async function getCurrentBranch(sg) {
  try {
    return (await sg.raw(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return ''; // Detached HEAD
  }
}

async function isOnRemoteBranchOrTag(sg, sha) {
  const refs = await sg.raw([
    'for-each-ref',
    '--count=1',
    `--contains=${sha}`,
    '--format=%(refname)',
    'refs/remotes',
    'refs/tags',
  ]);
  return !!refs.trim();
}

async function hasCommit(sg, sha) {
  try {
    const type = await sg.raw(['cat-file', '-t', sha]);
    return type.trim() === 'commit';
  } catch {
    return false;
  }
}

function listSubmodulePaths(context, parentRepo) {
  const prefix = parentRepo + '/';
  const paths = [];
  for (const [submodule, parent] of context.submoduleToParentMap) {
    if (parent === parentRepo) {
      paths.push(submodule.slice(prefix.length));
    }
  }

  return paths;
}

// Commits recorded in the parent's index, e.g. `160000 <sha> 0\t<path>`
async function getRecordedCommits(parentSg, paths) {
  const out = await parentSg.raw(['ls-files', '--stage', '--', ...paths]);
  const recorded = new Map();
  for (const line of out.split('\n')) {
    const match = line.match(/^160000 ([0-9a-f]+) 0\t(.+)$/);
    if (match) {
      recorded.set(match[2], match[1]);
    }
  }

  return recorded;
}

// Commits checked out in the submodules, e.g. `+<sha> <path> (<describe>)`: ' ' in sync, '+' different, '-' not
// initialized, 'U' conflict
async function getCheckedOutCommits(parentSg, paths) {
  const out = await parentSg.raw(['submodule', 'status', '--', ...paths]);
  const states = { ' ': 'in sync', '+': 'different', '-': 'not initialized', U: 'conflict' };
  const checkedOut = new Map();
  for (const line of out.split('\n')) {
    const match = line.match(/^([ +\-U])([0-9a-f]+) (.+?)(?: \(.*\))?$/);
    if (match) {
      checkedOut.set(match[3], { state: states[match[1]], sha: match[2] });
    }
  }

  return checkedOut;
}

function short(sha) {
  return sha.slice(0, 7);
}

function firstLine(message) {
  return String(message).trim().split('\n')[0];
}

exports.short = short;
