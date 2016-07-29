'use strict';

/* eslint-disable no-console */
const appName   = 'multipull';

const CliTable  = require('cli-table');
const debug     = require('debug')(appName);
const path      = require('path');
const rc        = require('rc');
const simpleGit = require('simple-git');

const config    = rc(appName);
const rootDir   = config.root;
const repos     = config.repos.split(',');


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

processTasksParallel(repos.map(r => done => processRepo(r, done)), (err, res) => {
  if (err) { return handleErr(err); }

  const head  = ['', 'Current', 'Tracking', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions'];
  const table = new CliTable({ head });

  const errors = [];
  for (const [i, repo] of repos.entries()) {
    const elt = {};
    if (res[i].err) {
      const repoErr = processError(repo, res[i].err);
      elt[repo]     = new Array(head.length);
      elt[repo][0]  = repoErr.message;
      table.push(elt);
      continue;
    }

    if (repo !== res[i].res.repo) { console.log(repo, res[i].res.repo); return handleErr(new Error('Unordered results')); }

    const { pull, status, stash } = res[i].res;
    const pos = [];
    if (status.ahead)  { pos.push('+' + status.ahead); }
    if (status.behind) { pos.push('-' + status.behind); }

    const statuses = ['not_added', 'modified', 'deleted', 'created', 'conflicted'].map(oneOrCountFactory(status));
    let pulls;
    if (!pull.error) {
      const suffix = pull.files.find(isNative) ? ' (n)' : '';
      pulls = [oneOrCountFactory(pull)('files') + suffix, pull.summary.changes || '', pull.summary.insertions || '', pull.summary.deletions || ''];
    } else {
      pulls = [ 'error', '-', '-', '-' ];
      errors.push(pull.error);
    }

    const current  = status.current  === 'master'        ? '' : (status.current  || '*** none ***');
    const tracking = status.tracking === 'origin/master' ? '' : (status.tracking || '*** none ***');
    elt[repo] = [ current + pos.join('/'), tracking, stash.total || '', ...statuses, ...pulls];
    if (elt[repo].find(e => e !== '')) {
      table.push(elt);
    }
  }

  table.removeEmptyColumns();
  console.log(table.toString());

  if (errors.length) {
    console.error("%d error(s) occured while pulling repos :", errors.length);
  }
  for (const err of errors) {
    console.error(err);
  }
});

function processTasksParallel(tasks, done) {
  let expectedAnswers = tasks.length;
  const responses  = new Array(expectedAnswers);
  for (const [i, task] of tasks.entries()) {
    task(_onTaskCompleteGenerator(i));
  }

  return;

  function _onTaskCompleteGenerator(taskId) {
    return (err, res) => {
      responses[taskId] = { taskId, err, res };
      if (--expectedAnswers) { return; }

      return done(null, responses);
    };
  }
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

function processError(repo, err) {
  if (typeof err !== 'string') {
    err.message = `Error occured while processing ${repo} : ${err.message}`;
    return err;
  }

  const error    = err.split('\n');
  const message  = error.shift().replace(/.*Error: /, '');
  const finalErr = new Error(`Error occured while processing ${repo} : ${message}`);
  finalErr.stack = error.join('\n');
  return finalErr;
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

