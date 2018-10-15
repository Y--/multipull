const debug         = require('debug')('pullrepo:lib:pull-repo');
const { indent, s } = require('./utils') ;
const Progress      = require('progress');
const { logInfo }   = require('./logger');

class Processor {
  constructor(context, tasksSpec) {
    this.context    = context;
    this.progress   = null;
    this.tasksSpec  = Processor._normalizeTaskSpec(tasksSpec);
  }

  get repos() {
    return this.context.repos;
  }

  async run() {
    let lastResults = null;
    for (const task of this.tasksSpec) {
      if (task.title) {
        logInfo(task.title);
      }

      this.progress = Processor._createProgress(this.repos.length + 1);
      this.progress.tick();
      this.taskRunner = task.runner;
      lastResults = await Promise.all(this.repos.map(this.processRepo, this));

      Processor._ensureNoError(lastResults);
    }
    return lastResults;
  }

  async processRepo(repo) {
    const startTs = new Date();
    const result = { repo };
    try {
      result.res = await this.taskRunner(this.context, repo);
    } catch (err) {
      result.err = err;
    }

    debug.enabled && debug(`Completed task ${repo}`);

    result.elapsed = new Date() - startTs;
    this.progress.tick();

    return result;
  }

  static _ensureNoError(results) {
    const errors = results.filter(Processor._hasError);
    if (!errors.length) {
      return;
    }

    const repos = errors.map(res => res.repo);
    const parts = [`Aborting execution because of ${errors.length} error${s(errors)} in ${repos.join(', ')}:`];
    for (const { repo, err } of errors) {
      parts.push(`------------  in ${repo}:`);
      parts.push(indent(err.stack));
    }

    throw new Error(parts.join('\n'));
  }

  static _hasError(result) {
    return !!result.err;
  }

  static _normalizeTaskSpec(tasksSpec) {
    if (typeof tasksSpec === 'function') {
      return [{ runner: tasksSpec }];
    }

    if (!Array.isArray(tasksSpec)) {
      throw new Error(`Invalid specification: ${JSON.stringify(tasksSpec)}`);
    }
    return tasksSpec;
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
