const debug  = require('debug')('pullrepo:lib:pull-request');
const logger = require('../helpers/logger');
const utils  = require('../helpers/utils');
const colors = require('colors/safe');

module.exports = [{
  single: true,
  async runner(context) {
    const branch = await utils.findWorkingBranch(context);
    if (!branch || branch === 'master') {
      logger.logError('You must place yourself on the branch you want to merge or specify it with "--branch"');
      return context.interrupt();
    }

    context.setWorkingBranch(branch);
    context.concernedRepos = [];
  }
}, {
  title: (context) => `Finding pull requests related to ${colors.bold(context.workingBranch)}`,
  async runner(context, repo) {
    debug.enabled && debug(`Processing repository ${repo}...`);
    const status = await context.getRepoCommonStatus(repo);
    const repoContext = { result: status, completed: true };
    context.setRepoContext(repo, repoContext);

    // Find PR on the related branch
    const branch = context.getWorkingBranch();
    const ghRepo = await context.getGitHubAPI(repo);
    const head = ghRepo.__owner + ':' + branch;
    const { data: prs } = await ghRepo.listPullRequests({ state: 'open', head, base: 'master' });
    if (!prs.length) {
      return;
    }

    if (prs.length > 1) {
      throw new Error(`Found ${prs.length} pull requests open on '${branch}'`);
    }

    const [pr] = prs;
    context.concernedRepos.push(repo);
    repoContext.result.pr = pr.html_url;
    if (context.isDryRunMode()) {
      repoContext.result.merged = 'Dry';
      return;
    }

    Object.assign(repoContext, { completed: false, pr });
  }
}, {
  single: true,
  runner(context) {
    if (context.concernedRepos.length) {
      return;
    }

    const branch = context.getWorkingBranch();
    logger.logInfo(`No repository found with PR on branch ${branch}`);
    return context.interrupt();
  }
}, {
  title(context) {
    const dryMode = context.isDryRunMode() ? colors.cyan('[DRY MODE] ') : '';
    const branch = context.getWorkingBranch();
    return `${dryMode}Merging PR on ${colors.bold(branch)} in ${context.concernedRepos.map(bold).join(', ')}`;
  },
  async runner(context, repo) {
    const { result, pr, completed } = context.getRepoContext(repo);
    if (completed) {
      return result;
    }

    const ghRepo = await context.getGitHubAPI(repo);

    const { data } = await ghRepo.mergePullRequest(pr.number, {
      commit_title: `Merge pull request #${pr.number} from ${pr.head.label}/${pr.head.ref}`,
      commit_message: '',
      sha: pr.head.sha,
      merge_method: 'merge' // merge, squash or rebase
    });

    result.merged = data.merged ? '' : 'Error: ';
    result.merged += data.message;

    return result;
  }
}];

function bold(s) {
  return colors.bold(s);
}
