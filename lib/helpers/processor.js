const debug         = require('debug')('pullrepo:lib:pull-repo');
const { indent, s } = require('./utils') ;
const Progress      = require('progress');
const { logInfo }   = require('./logger');

class Processor {
  constructor(context, tasksSpec) {
    this.context     = context;
    this.progress    = null;
    this.tasksSpec   = Processor._normalizeTaskSpec(tasksSpec);
    this.lastResults = null;
  }

  get repos() {
    return this.context.repos;
  }

  async run() {
    for (const task of this.tasksSpec) {
      if (task.title) {
        logInfo(task.title);
      }

      if (task.single) {
        this.lastResults = await this._callSingleRunner(task.runner);
      } else {
        this.lastResults = await this._callRunnerOnAllRepos(task.runner);
      }
      this._ensureNoError();
    }

    return this.lastResults;
  }

  async _callRunnerOnAllRepos(runner) {
    this.progress = Processor._createProgress(this.repos.length + 1);
    this.progress.tick();
    this.taskRunner = runner;
    return Promise.all(this.repos.map(this.processRepo, this));
  }

  async _callSingleRunner(runner) {
    const startTs = new Date();
    const result = {};
    try {
      result.res = await runner(this.context);
    } catch (err) {
      result.err = err;
    }

    result.elapsed = new Date() - startTs;
    return [result];
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

  _ensureNoError() {
    const errors = this.lastResults.filter(Processor._hasError);
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
