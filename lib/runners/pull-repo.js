const debug = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

const DIRTY_STATUS_KEYS = ['modified', 'deleted', 'created', 'conflicted'];

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);

  const pull = await pullRepoIfNotAhead(sg, repo);
  return gitHelper.commonStatus(sg, repo, { pull });
};

async function pullRepoIfNotAhead(sg, repo) {
  const status = await gitHelper.getStatus(sg, repo);
  if (isLocalBranchUpToDate(status)) {
    return { files: [], summary: {} };
  }

  const isLocalClean = isClean(status);
  if (!status.ahead && isLocalClean) {
    return rebaseRepo(sg, status);
  }

  if (!isLocalClean) {
    await commitWIP(sg);
  }

  const rebase = { success: false };
  try {
    rebase.result = await rebaseRepo(sg, status, true);
    rebase.success = true;
  } catch (err) {
    await sg.rebase({ '--abort': null });
  }

  if (!isLocalClean) {
    await resetWIP(sg);
  }

  return rebase.success
    ? rebase.result
    : {
      files: ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
      summary: {},
    };
}

async function rebaseRepo(sg, status, rebaseWhenPulling = false) {
  if (status.tracking === null) {
    await sg.rebase(['origin/master', '--stat']);
    return { files: [], summary: {} };
  }

  const pullArgs = { '--stat': null, '--all': null };
  if (rebaseWhenPulling) {
    pullArgs['--rebase'] = null;
  }

  return sg.pull(null, null, pullArgs);
}

function commitWIP(sg) {
  return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a': null });
}

async function resetWIP(sg) {
  await sg.reset(['--soft', 'HEAD~1']);
  return sg.reset(['HEAD']);
}

function isLocalBranchUpToDate(status) {
  if (status.tracking === null) {
    return !status.diff_with_origin_master || status.diff_with_origin_master.behind === 0;
  } else {
    return status.behind === 0;
  }
}

function isClean(status) {
  for (const k of DIRTY_STATUS_KEYS) {
    if (status[k].length) {
      return false;
    }
  }
  return true;
}
