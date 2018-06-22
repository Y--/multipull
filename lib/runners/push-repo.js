const debug     = require('debug')('pullrepo:lib:push-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doPushRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  const pushed = await pushRepo(sg);

  const pushResult = await gitHelper.commonStatus(sg, repo);
  return Object.assign(pushResult, { pushed });
};

async function pushRepo(sg) {
  const { ahead, behind, current, tracking } = await sg.status();
  if (behind !== 0) {
    const s = behind > 1 ? 's' : '';
    return `${current} is behind ${behind} commit${s} from ${tracking}`;
  }

  if (tracking && ahead === 0) {
    return '';
  }

  const pushParams = tracking ? null : ['--set-upstream', 'origin', current];
  await sg.push(pushParams);

  return 'Yes';
}