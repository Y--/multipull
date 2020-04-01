const debug = require('debug')('pullrepo:lib:push-repo');
const gitHelper = require('../helpers/simple-git');
const { s } = require('../helpers/utils');

module.exports = async function doPushRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  const pushed = await pushRepo(sg, context, repo);

  const pushResult = await gitHelper.commonStatus(sg, repo);
  return Object.assign(pushResult, { pushed });
};

async function pushRepo(sg, context, repo) {
  const { force } = context.args;
  const { ahead, behind, current, tracking } = await sg.status();
  if (behind !== 0 && (!force || current === context.getDefaultBranch(repo))) {
    return `No ('${current}' is behind ${behind} commit${s(behind)} from '${tracking}')`;
  }

  if (current === 'HEAD') {
    return 'No (detached HEAD)';
  }

  if (tracking && ahead === 0 && behind === 0) {
    return '';
  }

  const pushParams = [];
  if (!tracking) {
    pushParams.push(...['--set-upstream', 'origin', current]);
  }

  const useForce = behind !== 0;
  if (useForce) {
    pushParams.push('--force');
  }

  if (context.isDryRunMode()) {
    return `Dry: git push ${pushParams.join(' ')}`;
  }

  await sg.push(pushParams);
  return 'Yes' + (useForce ? ' (forced)' : '');
}
