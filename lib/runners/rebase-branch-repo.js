const debug = require('debug')('pullrepo:lib:pull-repo');
const gitHelper = require('../helpers/simple-git');

const DIRTY_STATUS_KEYS = ['modified', 'deleted', 'created', 'conflicted'];

module.exports = async function doPullRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  await gitHelper.fetchAll(sg, repo, context);

  const initialStatus = await gitHelper.commonStatus(sg, repo);
  const { status } = initialStatus;
  const { current } = status;
  if (current === 'master' || !isBehind(status)) {
    return initialStatus;
  }

  const isLocalClean = isClean(status);
  if (!isLocalClean) {
    await commitWIP(sg);
  }

  const rebase = { success: false };
  try {
    await sg.rebase(['origin/master', '--stat']);
    rebase.success = true;
  } catch (err) {
    await sg.rebase({ '--abort': null });
  }

  if (!isLocalClean) {
    await resetWIP(sg);
  }

  const result = await gitHelper.commonStatus(sg, repo);
  if (!rebase.success) {
    result.pull = {
      files: ['*** FETCHED ONLY, REBASE WOULD PRODUCE CONFLICTS ***'],
      summary: {},
    };
    return result;
  }

  try {
    const base = status.tracking ? current : 'master';
    rebase.pull = await sg.diffSummary([current + '...origin/' + base]);
  } catch ({ message }) {
    result.pull = { files: [message], summary: {} };
  }

  return result;
};

function isBehind(status) {
  return status.diff_with_origin_master && status.diff_with_origin_master.behind > 0;
}

function commitWIP(sg) {
  return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a': null });
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
