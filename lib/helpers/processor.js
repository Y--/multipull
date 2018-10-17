const debug         = require('debug')('pullrepo:lib:pull-repo');
const { indent, s } = require('./utils') ;
const Progress      = require('progress');
const readline      = require('readline');
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

      this._ensureNoError();

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
    const parts = [];
    if (repos.length === 1 && repos[0] === undefined) {
      parts.push('Aborting execution:');
      parts.push(indent(errors[0].err.stack));
      throw new Error(parts.join('\n'));
    }


    const errorsSummary = `${errors.length} error${s(errors)}`;
    parts.push(`Aborting execution because of ${errorsSummary} in ${repos.join(', ')}:`);
    for (const { repo, err } of errors) {
      parts.push(`------------  in ${repo}:`);
      parts.push(indent(err.stack));
    }

    throw new Error(parts.join('\n'));
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
