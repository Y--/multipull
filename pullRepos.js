'use strict';

/* eslint-disable no-console */
const appName   = 'multipull';

const simpleGit = require('simple-git');
const async     = require('async');
const CliTable  = require('cli-table');
const path      = require('path');
const rc        = require('rc');
const debug     = require('debug')(appName);

const config  = rc(appName);
const rootDir = config.root;
const repos   = config.repos.split(',');
debug.enabled && debug(`Will process ${repos.join(', ')} repos in ${config.root}.`);

function processRepo(repo, done) {
  const sg = simpleGit(path.join(rootDir, repo)).silent(true);
  sg.pull((error, pull) => {
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
}

async.parallel(repos.map(r => done => processRepo(r, done)), (err, res) => {
  if (err) { return handleErr(err); }

  const table = new CliTable({
      head : ['',
        'Current', 'Tracking', 'S', '??', 'M', 'D', 'A', 'C',
        'Files', 'Changes', 'Insertions', 'Deletions']
  });

  for (const [i, repo] of repos.entries()) {
    if (repo !== res[i].repo) { return handleErr(new Error('Unordered results')); }

    const { pull, status, stash } = res[i];
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
    }

    const elt = {};
    elt[repo] = [status.current + pos.join('/'), status.tracking, stash.total, ...statuses, ...pulls];
    table.push(elt);
  }

  console.log(table.toString());
});

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
  console.error('ERROR :', err.message);
  console.error(err.stack);
  process.exit(-1);
}
