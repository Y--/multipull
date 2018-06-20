const debug     = require('debug')('pullrepo:lib:push-repo');
const gitHelper = require('../helpers/simple-git');

module.exports = async function doPushRepo(context, repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = gitHelper.initSimpleGit(context, repo);

  const { pushed } = await pushRepo(sg);

  const status = await gitHelper.commonStatus(sg, repo);
  status.pushed = pushed;
  return status;
};

async function pushRepo(sg) {
  const { ahead, behind, current, tracking } = await sg.status();
  if (ahead === 0) {
    return { pushed: '' };
  }

  if (behind !== 0) {
    const s = behind > 1 ? 's' : '';
    const pushed = `${current} is behind ${behind} commit${s} from ${tracking}`;
    return { pushed };
  }

  await sg.push();
  return { pushed: 'Yes' };
}