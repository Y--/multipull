'use strict';

/* eslint-disable no-console */
const appName   = 'multipull';
const startTs   = new Date();

const CliTable  = require('cli-table');
const debug     = require('debug')(appName);
const path      = require('path');
const Progress  = require('progress');
const rc        = require('rc');
const simpleGit = require('simple-git');

const config    = rc(appName);
const rootDir   = config.root;
const repos     = config.repos.split(',');

const progress  = new Progress(':bar :percent :elapsed', {
  clear      : true,
  complete   : '\u001b[42m \u001b[0m',
  incomplete : '\u001b[41m \u001b[0m',
  width      : 100,
  total      : repos.length
});

debug.enabled && debug(`Will process ${repos.join(', ')} repos in ${config.root}.`);

// TODO : implement it properly and make a PR.
CliTable.prototype.removeEmptyColumns = function() {
  if (!this.length) { return; }

  const nbColumns  = this[0][Object.keys(this[0])[0]].length;
  const isColEmpty = new Array(nbColumns).fill(true);
  for (const row of this) {
    const header = Object.keys(row)[0];
    for (const [i, cell] of row[header].entries()) {
      isColEmpty[i] = isColEmpty[i] && cell === '';
    }
  }

  const idxToRemove = new Set(isColEmpty.map((x, i) => x ? i : null).filter(x => x !== null));
  const filterFunc  = (x, i) => !idxToRemove.has(i);

  for (const row of this) {
    const header = Object.keys(row)[0];
    row[header]  = row[header].filter(filterFunc);
  }

  const shifted     = this.options.head.shift();
  this.options.head = this.options.head.filter(filterFunc);
  this.options.head.unshift(shifted);
};

processTasksParallel(repos.map(r => done => processRepo(r, done)), () => progress.tick(), (err, res) => {
  if (err) { return handleErr(err); }

  const head  = ['', 'Current', 'Tracking', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions', 'E'];
  const table = new CliTable({ head });

  const errors = [];
  for (const [i, repo] of repos.entries()) {
    const elt = {};
    if (res[i].err) {
      errors.push({ repo, error : res[i].err });
      continue;
    }

    if (repo !== res[i].res.repo) { console.log(repo, res[i].res.repo); return handleErr(new Error('Unordered results')); }

    const { pull, status, stash } = res[i].res;
    const pos = [];
    if (status.ahead)  { pos.push('+' + status.ahead); }
    if (status.behind) { pos.push('-' + status.behind); }

    const statuses = ['not_added', 'modified', 'deleted', 'created', 'conflicted'].map(oneOrCountFactory(status));
    if (pull.error) {
      errors.push({ repo, error : pull.error });
      continue;
    }

    const suffix = pull.files.find(isNative) ? ' (n)' : '';
    const pulls = [oneOrCountFactory(pull)('files') + suffix, pull.summary.changes || '', pull.summary.insertions || '', pull.summary.deletions || ''];

    const current  = differentOrEmpty(status.current, 'master');
    const tracking = differentOrEmpty(status.tracking, 'origin/' + status.current);
    const line     = [ current + pos.join('/'), tracking, stash.total || '', ...statuses, ...pulls];
    if (line.find(e => e !== '')) {
      line.push(res[i].elapsed);
      elt[repo] = line;
      table.push(elt);
    }
  }

  table.removeEmptyColumns();
  console.log(table.toString());

  const elapsed = new Date() - startTs;
  console.log("Checked %d repositories in : %ds", repos.length, elapsed / 1000);

  if (errors.length) {
    console.error("%d error(s) occured while pulling repos :", errors.length);
  }
  for (const e of errors) {
    console.error('[%s] - %s', e.repo, e.error);
  }
});

function processTasksParallel(tasks, onTaskComplete, done) {
  let expectedAnswers = tasks.length;
  const responses  = new Array(expectedAnswers);
  for (const [i, task] of tasks.entries()) {
    task(_onTaskCompleteGenerator(i, new Date()));
  }

  return;

  function _onTaskCompleteGenerator(taskId, startTs) {
    return (err, res) => {
      const elapsed = new Date() - startTs;
      responses[taskId] = { taskId, err, res, elapsed };
      onTaskComplete();

      if (--expectedAnswers) { return; }

      return done(null, responses);
    };
  }
}

function differentOrEmpty(actual, common) {
  return actual === common ? '' : (actual || '*** none ***');
}

function isNative(f) {
  return f.endsWith('cc') || f.endsWith('hh');
}

function oneOrCountFactory(obj) {
  return (s) => {
    const arr = obj[s];
    if (!arr.length) { return ''; }
    if (arr.length === 1) { return arr[0]; }
    return arr.length;
  };
}

function handleErr(err) {
  if (!err.message || !err.stack) {
    console.error(err);
  } else {
    console.error(err.message);
    console.error(err.stack);
  }
  process.exit(-1);
}

function processRepo(repo, done) {
  const sg = simpleGit(path.join(rootDir, repo)).silent(true);
  return sg.fetch(err => {
    if (err) { return done(err); }

    sg.status((err, res) => {
      if (err) { return done(err); }

      pullRepoIfNotAhead(sg, res, (error, pull) => {
        if (error) {
          pull = { error };
        }

        sg.status((err, status) => {
          if (err) { return done(err); }

          sg.stashList((err, stash) => {
            if (err) { return done(err); }

            if (stash.total === undefined) {
              stash = { total : 0 };
            }

            return done(null, { repo, pull, status, stash });
          });
        });
      });
    });
  });
}

function pullRepoIfNotAhead(sg, status, done) {
  if (!status.behind) {
    return done(null, { files : [], summary : {} });
  }

  if (!status.ahead && isLocalClean(status)) {
    return sg.pull(done);
  }

  commitWIPIfUnclean(sg, status, err => {
    if (err) { return done(err); }

    sg.pull(null, null, { '--rebase' : null, '--stat': null }, (err, res) => {

      abortRebaseIfFailed(sg, err, res, (err, rebase = {}) => {
        if (err) { return done(err); }

        resetWIPIfUnclean(sg, status, err => {
          if (err) { return done(err); }

          const result = rebase.success ? rebase.result : {
            files   : ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
            summary : {}
          };
          return done(null, result);
        });
      });
    });
  });
}

function abortRebaseIfFailed(sg, errRebasing, result, done) {
  if (errRebasing) {
    return sg._run(['rebase', '--abort'], done);
  }

  if (typeof result === 'string') {
    result = { files : ['*** Rebased : TODO : find the status ***'], summary : {} };
  }
  return done(null, { success : true, result });
}

function commitWIPIfUnclean(sg, status, done) {
  if (isLocalClean(status)) { return done(); }

  sg.commit('[multipull] WIP', null, { '-a' : null }, done);
}

function resetWIPIfUnclean(sg, status, done) {
  if (isLocalClean(status)) { return done(); }

  sg.reset(['--soft', 'HEAD~1'], done);
}

function isLocalClean(status) {
  return !['modified', 'deleted', 'created', 'conflicted'].map(k => status[k]).filter(v => !!v.length).length;
}

