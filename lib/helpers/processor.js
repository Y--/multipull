const debug    = require('debug')('pullrepo:lib:pull-repo');
const Progress = require('progress');

class Processor {
  constructor(context, repoProcessor) {
    const { repos } = context;
    this.context       = context;
    this.progress      = Processor._createProgress(repos.length + 1);
    this.repoProcessor = repoProcessor;
  }

  get repos() {
    return this.context.repos;
  }

  async run() {
    this.progress.tick();
    return await Promise.all(this.repos.map(this.processRepo, this));
  }

  async processRepo(repo) {
    const startTs = new Date();
    const result = { repo };
    try {
      result.res = await this.repoProcessor(this.context, repo);
    } catch (err) {
      result.err = err;
    }

    debug.enabled && debug(`Completed task ${repo}`);

    result.elapsed = new Date() - startTs;
    this.progress.tick();

    return result;
  }

  static _createProgress(total) {
    return new Progress(':bar :percent :elapsed', {
      total,
      clear      : true,
      complete   : '\u001b[42m \u001b[0m',
      incomplete : '\u001b[41m \u001b[0m',
      width      : process.stdout.columns - 10,
    });
  }
}

module.exports = Processor;