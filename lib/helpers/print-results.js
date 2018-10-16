const CleanTable = require('./clean-table');
const { s }      = require('./utils');
const logger     = require('./logger');

const defaultPull = { files: [], summary: {} };
module.exports = function printResults(context, startTs, res) {
  const head  = ['', 'Current', 'Tracking', 'Pushed', 'Merged', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions', 'E'];
  const table = new CleanTable({ head });

  const errors = [];
  for (const [i, repo] of context.repos.entries()) {
    const elt = {};
    if (res[i].err) {
      errors.push({ repo, error : res[i].err });
      continue;
    }

    if (repo !== res[i].repo) {
      throw new Error(`Unordered results: expected ${repo} at position ${i}, but got ${res[i].repo}: ${JSON.stringify(res)}`);
    }

    const { pull = defaultPull, status, stash, pushed, merged } = res[i].res;
    const statuses = ['not_added', 'modified', 'deleted', 'created', 'conflicted'].map(oneOrCountFactory(status));
    if (pull.error) {
      errors.push({ repo, error : pull.error });
      continue;
    }

    const nativeSuffix  = pull.files.find(isNative)  ? ' (n)' : '';
    const packageSuffix = pull.files.find(isPackage) ? ' (p)' : '';
    const pulls  = [oneOrCountFactory(pull)('files') + nativeSuffix + packageSuffix, t(pull.summary.changes), t(pull.summary.insertions), t(pull.summary.deletions)];

    const branch   = context.getDefaultBranch(repo);
    const current  = differentOrEmpty(status.current, branch);
    const tracking = differentOrEmpty(status.tracking, 'origin/' + status.current);
    const currTxt  = current + formatDiff(status) + formatDiff(status.diff_with_origin_master, true);
    const line     = [currTxt, tracking, t(pushed), t(merged), t(stash.total), ...statuses, ...pulls];
    if (line.find(e => e !== '')) {
      line.push(res[i].elapsed);
      elt[repo] = line;
      table.push(elt);
    }
  }

  table.removeEmptyColumns();
  if (table.length) {
    logger.logInfo(table.toString());
  }

  const elapsed = new Date() - startTs;
  const { repos } = context;
  logger.logInfo(`Checked ${repos.length} repositorie${s(repos)} in : ${elapsed / 1000}s @ ${new Date().toString()}`);

  if (errors.length) {
    logger.logError(`${errors.length} error${s(errors)} occured while pulling repos :`);
  }

  for (const e of errors) {
    logger.logError(`[${e.repo}]: ${e.error}`);
  }
};

function t(str) {
  return str || '';
}

function formatDiff(stats, addParenthesis = false) {
  if (!stats) { return ''; }

  const { ahead, behind } = stats;
  const pos = [];
  if (behind) { pos.push('-' + behind); }
  if (ahead)  { pos.push('+' + ahead); }

  if (pos.length === 0) { return ''; }

  const stat = pos.join('/');
  return addParenthesis ? ` (${stat})` : ' ' + stat;
}

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
