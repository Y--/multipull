const debug = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

const DIRTY_STATUS_KEYS = ['modified', 'deleted', 'created', 'conflicted'];

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const isSubmodule = context.submoduleToParentMap.has(repo);
  const sg = gitHelper.initSimpleGit(context, repo);
  if (isSubmodule)  {
    return gitHelper.commonStatus(sg, repo);
  }

  await gitHelper.fetchAll(sg, repo, context);

  if (context.config.sub) {
    await gitHelper.updateSubmodules(sg);
  }

  const pull = await pullRepoIfNotAhead(context, sg, repo);
  const defaultBranch = context.getDefaultBranch(repo);
  return gitHelper.commonStatus(sg, repo, defaultBranch, { pull });
};

async function pullRepoIfNotAhead(context, sg, repo) {
  const status = await gitHelper.getStatus(sg, repo);
  if (isLocalBranchUpToDate(status)) {
    return { files: [], summary: {} };
  }

  const isLocalClean = isClean(status);
  if (!status.ahead && isLocalClean) {
    return rebaseRepo(context, repo, sg, status);
  }

  if (!isLocalClean) {
    await commitWIP(sg, context, repo, status);
  }

  const rebase = { success: false };
  try {
    rebase.result = await rebaseRepo(context, repo, sg, status, true);
    rebase.success = true;
  } catch (err) {
    if (status.tracking === null) {
      await sg.rebase({ '--abort': null });
    }
  }

  if (!isLocalClean) {
    await resetWIP(sg);
  }

  if (rebase.success) {
    return rebase.result;
  }

  try {
    return await sg.pull(null, null, { '--stat': null, '--all': null });
  } catch (err) {
    console.error('Failed to pull with rebase and without rebase', err);
  }

  return {
    files: ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
    summary: {},
  };
}

function listModifiedSubmodules(context, repo, status) {
  const modifiedSubmodules = [];
  for (const mod of status.modified) {
    if (context.submoduleToParentMap.has(repo + '/' + mod)) {
      modifiedSubmodules.push(':!' + mod);
    }
  }
  return modifiedSubmodules;
}

async function rebaseRepo(context, repo, sg, status, rebaseWhenPulling = false) {
  if (status.tracking === null) {
    const mainBranch = context.getDefaultBranch(repo);
    await sg.rebase(['origin/' + mainBranch, '--stat']);
    return { files: [], summary: {} };
  }

  const pullArgs = { '--stat': null, '--all': null };
  if (rebaseWhenPulling) {
    pullArgs['--rebase'] = null;
  }

  return sg.pull(null, null, pullArgs);
}

async function commitWIP(sg, context, repo, status) {
  const modifiedSubmodules = listModifiedSubmodules(context, repo, status);
  if (modifiedSubmodules.length === 0) {
    return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a': null });
  }

  await sg.add(['.'].concat(modifiedSubmodules));
  return sg.commit('[multipull] WIP', null, { '--no-verify': null });
}

async function resetWIP(sg) {
  await sg.reset(['--soft', 'HEAD~1']);
  return sg.reset(['HEAD']);
}

function isLocalBranchUpToDate(status) {
  if (status.tracking === null) {
    return !status.diff_with_origin_main || status.diff_with_origin_main.behind === 0;
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
