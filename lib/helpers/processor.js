const debug    = require('debug')('pullrepo:lib:pull-repo');
const Progress = require('progress');

class Processor {
  constructor(config, repoProcessor) {
    const { repos } = config;
    this.repos = repos;
    this.config = config;
    this.progress = Processor._createProgress(repos.length + 1);
    this.repoProcessor = repoProcessor;
  }

  async run() {
    this.progress.tick();
    return await Promise.all(this.repos.map(this.processRepo, this));
  }

  async processRepo(repo) {
    const startTs = new Date();
    const result = {};
    try {
      result.res = await this.repoProcessor(this.config, repo);
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
      width      : 100,
    });
  }
}

module.exports = Processor;