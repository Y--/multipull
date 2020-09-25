const debug = require('debug')('pullrepo:lib:pull-repo');
const Progress = require('progress');
const readline = require('readline');
const { logInfo } = require('./logger');
const gitHelper = require('./simple-git');

class Processor {
  constructor(context, tasksSpec) {
    this.context = context;
    this.progress = null;
    this.tasksSpec = Processor._normalizeTaskSpec(tasksSpec, context);
    this.lastResults = null;
  }

  get repos() {
    return this.context.repos;
  }

  async run() {
    for (const { title, single, runner } of this.tasksSpec) {
      const startTs = new Date();
      let hasPendingTitle = false;
      if (title) {
        const displayedTitle = typeof title === 'function' ? title(this.context) : title;
        logInfo(displayedTitle);
        hasPendingTitle = true;
      }

      if (single) {
        this.lastResults = await this._callSingleRunner(runner);
      } else {
        this.lastResults = await this._callRunnerOnAllRepos(runner);
      }

      if (this.hasExecutionError()) {
        return this.lastResults;
      }

      if (hasPendingTitle) {
        const lastElapsed = new Date() - startTs;
        Processor._displayElapsed(lastElapsed);
      }

      if (this.context.isInterrupted()) {
        return this.lastResults;
      }
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
      result.res = await runner(this.context, this.lastResults);
    } catch (err) {
      result.err = err;
    }

    result.elapsed = new Date() - startTs;
    return result;
  }

  async processRepo(repo) {
    const startTs = new Date();
    const result = { repo };
    try {
      result.res = await this.taskRunner(this.context, repo);
    } catch (err) {
      const sg = gitHelper.initSimpleGit(this.context, repo);
      result.res = await gitHelper.commonStatus(sg, repo);
      result.err = err;
    }

    debug.enabled && debug(`Completed task ${repo}`);

    result.elapsed = new Date() - startTs;
    this.progress.tick();

    return result;
  }

  hasExecutionError() {
    if (!Array.isArray(this.lastResults)) {
      return Processor._hasError(this.lastResults);
    }

    for (const res of this.lastResults) {
      if (Processor._hasError(res)) {
        return true;
      }
    }

    return false;
  }

  static _displayElapsed(elapsed) {
    const out = ` (${elapsed} ms)`;
    readline.cursorTo(process.stdout, 0);
    readline.moveCursor(process.stdout, process.stdout.columns - out.length, -1);
    process.stdout.write(out);
    readline.cursorTo(process.stdout, 0);
    readline.moveCursor(process.stdout, 0, 1);
  }

  static _hasError(result) {
    return !!result.err;
  }

  static _normalizeTaskSpec(originalTasksSpec, context) {
    const tasksSpec = originalTasksSpec.isFactory ? originalTasksSpec(context) : originalTasksSpec;
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
      clear: true,
      complete: '\u001b[42m \u001b[0m',
      incomplete: '\u001b[41m \u001b[0m',
      width: process.stdout.columns - 10,
    });
  }
}

module.exports = Processor;
