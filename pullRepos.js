'use strict';

/* eslint-disable no-console */
const appName = 'multipull';
const startTs = new Date();

const CliTable  = require('cli-table');
const debug     = require('debug')(appName);
const path      = require('path');
const Progress  = require('progress');
const rc        = require('rc');
const simpleGit = require('simple-git/promise');

const config    = rc(appName);
const rootDir   = config.root;
const repos     = (config.repos || '').split(',');
const branches  = (config.branches || '').split(',');
const chunkSize = config.chunkSize || 8;

const defaultBranches = new Map();
for (const repoBranch of branches) {
  const [repo, branch] = repoBranch.split(':');
  defaultBranches.set(repo, branch);
}

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
      isColEmpty[i] = isColEmpty[i] && (cell === '' || cell === null || cell === undefined);
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

(async function main() {
  const res = await processRepos(repos, chunkSize);
  const head  = ['', 'Current', 'Tracking', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions', 'E'];
  const table = new CliTable({ head });

  const errors = [];
  for (const [i, repo] of repos.entries()) {
    const elt = {};
    if (res[i].err) {
      errors.push({ repo, error : res[i].err });
      continue;
    }

    if (repo !== res[i].res.repo) {
      return handleErr(new Error(`Unordered results: expected ${repo} at position ${i}, but got ${res[i].res.repo}`));
    }

    const { pull, status, stash } = res[i].res;

    const pos = [];
    if (status.ahead)  { pos.push('+' + status.ahead); }
    if (status.behind) { pos.push('-' + status.behind); }

    const statuses = ['not_added', 'modified', 'deleted', 'created', 'conflicted'].map(oneOrCountFactory(status));
    if (pull.error) {
      errors.push({ repo, error : pull.error });
      continue;
    }

    const nativeSuffix  = pull.files.find(isNative)  ? ' (n)' : '';
    const packageSuffix = pull.files.find(isPackage) ? ' (p)' : '';
    const pulls  = [oneOrCountFactory(pull)('files') + nativeSuffix + packageSuffix, pull.summary.changes || '', pull.summary.insertions || '', pull.summary.deletions || ''];

    const branch   = defaultBranches.get(repo) || 'master';
    const current  = differentOrEmpty(status.current, branch);
    const tracking = differentOrEmpty(status.tracking, 'origin/' + status.current);
    const line     = [ current + pos.join('/'), tracking, stash.total || '', ...statuses, ...pulls];
    if (line.find(e => e !== '')) {
      line.push(res[i].elapsed);
      elt[repo] = line;
      table.push(elt);
    }
  }

  table.removeEmptyColumns();
  if (table.length) {
    console.log(table.toString());
  }

  const elapsed = new Date() - startTs;
  console.log(`Checked ${repos.length} repositories in : ${elapsed / 1000}s`);

  if (errors.length) {
    console.error(`${errors.length} error(s) occured while pulling repos :`);
  }

  for (const e of errors) {
    console.error(`[${e.repo}]: ${e.error}`);
  }
})();

function differentOrEmpty(actual, common) {
  return actual === common ? '' : (actual || '*** none ***');
}

function isNative(f) {
  return f.endsWith('cc') || f.endsWith('hh');
}

function isPackage(f) {
  return f === 'package.json';
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

async function processRepos(repos, chunkSize) {
  const results = [];
  for (let i = 0; i < repos.length; i += chunkSize) {
    const chunk = repos.slice(i, i + chunkSize).map(processRepo);
    const chunkResults = await Promise.all(chunk);
    results.push(...chunkResults);
  }

  return results;
}

async function processRepo(repo, retry = 1) {
  const startTs = new Date();
  const result = {};
  try {
    result.res = await doProcessRepo(repo);
  } catch (err) {
    result.err = err;
  }

  debug.enabled && debug(`Completed task ${repo}`);

  result.elapsed = new Date() - startTs;
  progress.tick();

  return result;
}

async function doProcessRepo(repo) {
  debug.enabled && debug(`Processing repository ${repo}...`);
  const sg = initSimpleGit(repo);

  await sg.fetch();

  const initialStatus = await sg.status();

  const pull = await pullRepoIfNotAhead(sg, initialStatus);

  const status = await sg.status();

  const stash = await sg.stashList();

  if (stash.total === undefined) {
    stash.total = 0;
  }

  return { repo, pull, status, stash };
}

function initSimpleGit(repo) {
  const repoPath = path.join(rootDir, repo);
  try {
    return simpleGit(repoPath).silent(true);
  } catch (err) {
    err.message = `Cannot setup git in ${repoPath} : ${err.message}`;
    throw err;
  }
}

async function pullRepoIfNotAhead(sg, status) {
  try {
    return await _pullRepoIfNotAhead(sg, status);
  } catch (error) {
    return { error };
  }
}

async function _pullRepoIfNotAhead(sg, status) {
  if (!status.behind) {
    return { files : [], summary : {} };
  }

  if (!status.ahead && isLocalClean(status)) {
    return sg.pull();
  }

  await commitWIPIfUnclean(sg, status);

  const rebase = { success: false };
  try {
    rebase.result = await sg.pull(null, null, { '--rebase' : null, '--stat': null });
    rebase.success = true;
  } catch (err) {
    await sg.rebase({ '--abort' : null });
  }

  await resetWIPIfUnclean(sg, status);

  return rebase.success ? rebase.result : {
    files   : ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'],
    summary : {}
  };
}

function commitWIPIfUnclean(sg, status) {
  if (isLocalClean(status)) { return; }

  return sg.commit('[multipull] WIP', null, { '--no-verify': null, '-a' : null });
}

async function resetWIPIfUnclean(sg, status) {
  if (isLocalClean(status)) { return; }

  await sg.reset(['--soft', 'HEAD~1']);

  return sg.reset(['HEAD']);
}

function isLocalClean(status) {
  return !['modified', 'deleted', 'created', 'conflicted'].map(k => status[k]).filter(v => !!v.length).length;
}

