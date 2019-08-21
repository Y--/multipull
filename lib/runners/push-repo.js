const debug     = require('debug')('pullrepo:lib:push-repo');
const gitHelper = require('../helpers/simple-git');
const { s }     = require('../helpers/utils');

module.exports = async function doPushRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  const pushed = await pushRepo(sg, context);

  const pushResult = await gitHelper.commonStatus(sg, repo);
  return Object.assign(pushResult, { pushed });
};

async function pushRepo(sg, context) {
  const { force } = context.args;
  const { ahead, behind, current, tracking } = await sg.status();
  if (behind !== 0 && !force) {
    return `No ('${current}' is behind ${behind} commit${s(behind)} from '${tracking}')`;
  }

  if (tracking && ahead === 0) {
    return '';
  }

  const pushParams = [];
  if (!tracking) {
    pushParams.push(...['--set-upstream', 'origin', current]);
  }

  if (force) {
    pushParams.push('--force');
  }

  if (context.isDryRunMode()) {
    return `Dry: git push ${pushParams.join(' ')}`;
  } else {
    await sg.push(pushParams);
  }

  return 'Yes';
}