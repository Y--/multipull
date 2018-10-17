const debug     = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

const DIRTY_STATUS_KEYS = ['modified', 'deleted', 'created', 'conflicted'];

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);

  const pull = await pullRepoIfNotAhead(sg);
  return gitHelper.commonStatus(sg, repo, { pull });
};

async function pullRepoIfNotAhead(sg) {
  const status = await sg.status();
  if (!status.behind) {
    return { files : [], summary : {} };
  }

  const isLocalClean = isClean(status);
  if (!status.ahead && isLocalClean) {
    return sg.pull(null, null, { '--stat': null, '--all': null });
  }

  if (!isLocalClean) {
    await commitWIP(sg);
  }

  const rebase = { success: false };
  try {
    rebase.result = await sg.pull(null, null, { '--rebase' : null, '--stat': null, '--all': null });
    rebase.success = true;
  } catch (err) {
    await sg.rebase({ '--abort' : null });
  }

  if (!isLocalClean) {
    await resetWIP(sg);
  }

  return rebase.success ? rebase.result : {
    files   : ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
    summary : {}
  };
}

function commitWIP(sg) {
  return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a' : null });
}

async function resetWIP(sg) {
  await sg.reset(['--soft', 'HEAD~1']);

  return sg.reset(['HEAD']);
}

function isClean(status) {
  for (const k of DIRTY_STATUS_KEYS) {
    if (status[k].length) {
      return false;
    }
  }
  return true;
}


