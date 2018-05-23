/* eslint-disable no-console */
const CleanTable = require('./clean-table');

module.exports = function printResults(config, startTs, res) {
  const { repos, defaultBranches } = config;
  const head  = ['', 'Current', 'Tracking', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions', 'E'];
  const table = new CleanTable({ head });

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
  console.log(`Checked ${repos.length} repositories in : ${elapsed / 1000}s @ ${new Date().toString()}`);

  if (errors.length) {
    console.error(`${errors.length} error(s) occured while pulling repos :`);
  }

  for (const e of errors) {
    console.error(`[${e.repo}]: ${e.error}`);
  }
};

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