const debug     = require('debug')('pullrepo:lib:pull-repo');
const path      = require('path');
const simpleGit = require('simple-git/promise');

let currentGcExecution = null;
module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = initSimpleGit(context, repo);

  try {
    await sg.fetch(['--all']);
  } catch (err) {
    debug.enabled && debug(`Fetch failed in ${repo}, will call GC and try again...`);

    await runOneGC(sg);
    await sg.fetch(['--all']);
  }

  const initialStatus = await sg.status();

  const pull = await pullRepoIfNotAhead(sg, initialStatus);

  const status = await sg.status();

  const stash = await sg.stashList();

  if (stash.total === undefined) {
    stash.total = 0;
  }

  return { repo, pull, status, stash };
};

async function runOneGC(sg) {
  if (currentGcExecution) {
    await currentGcExecution;
    return runOneGC(sg);
  }

  currentGcExecution = sg.raw(['gc', '--prune=now']);
  await currentGcExecution;
  currentGcExecution = null;
}

function initSimpleGit({ rootDir }, repo) {
  const repoPath = path.join(rootDir, repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
}

async function pullRepoIfNotAhead(sg, status) {
  try {
    return await _pullRepoIfNotAhead(sg, status);
  } catch (error) {
    return { error };
  }
}

async function _pullRepoIfNotAhead(sg, status) {
  if (!status.behind) {
    return { files : [], summary : {} };
  }

  if (!status.ahead && isLocalClean(status)) {
    return sg.pull(null, null, { '--stat': null, '--all': null });
  }

  await commitWIPIfUnclean(sg, status);

  const rebase = { success: false };
  try {
    rebase.result = await sg.pull(null, null, { '--rebase' : null, '--stat': null, '--all': null });
    rebase.success = true;
  } catch (err) {
    await sg.rebase({ '--abort' : null });
  }

  await resetWIPIfUnclean(sg, status);

  return rebase.success ? rebase.result : {
    files   : ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
    summary : {}
  };
}

function commitWIPIfUnclean(sg, status) {
  if (isLocalClean(status)) { return; }

  return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a' : null });
}

async function resetWIPIfUnclean(sg, status) {
  if (isLocalClean(status)) { return; }

  await sg.reset(['--soft', 'HEAD~1']);

  return sg.reset(['HEAD']);
}

function isLocalClean(status) {
  return !['modified', 'deleted', 'created', 'conflicted'].map(k => status[k]).filter(v => !!v.length).length;
}
