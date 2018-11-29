const CleanTable = require('./clean-table');
const { s }      = require('./utils');
const logger     = require('./logger');

const defaultPull = { files: [], summary: {} };
module.exports = function printResults(context, startTs, res) {
  if (context.config.exec) {
    return printExecResults(context, startTs, res);
  }

  const head  = ['', 'Current', 'Tracking', 'Pushed', 'Merged', 'Pull Request', 'Mergeable', 'Build', 'Reviews', 'S', '??', 'M', 'D', 'A', 'C', 'Files', 'Changes', 'Insertions', 'Deletions', 'E'];
  const table = new CleanTable({ head });

  const errors = [];
  for (const [i, repo] of context.repos.entries()) {
    const elt = {};
    const { err: error, res: result } = res[i];
    if (error) {
      errors.push({ repo, error });
      continue;
    }

    if (repo !== res[i].repo) {
      throw new Error(`Unordered results: expected ${repo} at position ${i}, but got ${res[i].repo}: ${JSON.stringify(res)}`);
    }

    const { pull = defaultPull, status, stash, pushed, merged, pr, mergeable, build, reviews } = result;
    const statuses = ['not_added', 'modified', 'deleted', 'created', 'conflicted'].map(oneOrCountFactory(status));
    const nativeSuffix  = pull.files.find(isNative)  ? ' (n)' : '';
    const packageSuffix = pull.files.find(isPackage) ? ' (p)' : '';
    const pulls  = [oneOrCountFactory(pull)('files') + nativeSuffix + packageSuffix, t(pull.summary.changes), t(pull.summary.insertions), t(pull.summary.deletions)];

    const branch   = context.getDefaultBranch(repo);
    const current  = differentOrEmpty(status.current, branch);
    const tracking = differentOrEmpty(status.tracking, 'origin/' + status.current);
    const currTxt  = current + formatDiff(status) + formatDiff(status.diff_with_origin_master, true);
    const line     = [currTxt, tracking, t(pushed), t(merged), t(pr), t(mergeable), t(build), t(reviews), t(stash.total), ...statuses, ...pulls];
    if (line.find(e => e !== '')) {
      line.push(res[i].elapsed);
      elt[repo] = line;
      table.push(elt);
    }

    if (result.errors) {
      errors.push(...result.errors.map((error) => ({ repo, error })));
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
    logger.logError(`${errors.length} error${s(errors)} occured while processing repos:`);
  }

  for (const e of errors) {
    logger.logError(`[${e.repo}]: ${e.error}`);
  }
};

function printExecResults(context, startTs, results) {
  const stats = { unmatched: 0, empty: 0 }
  for (const { repo, res, elapsed } of results) {
    if (!res) {
      stats.unmatched++;
      continue;
    }

    const { stdout, stderr } = res;
    if (!stdout && !stderr) {
      stats.empty++;
      continue;
    }

    logger.logInfo(`\t- ${repo} (${elapsed} ms):`);
    if (stdout) {
      logger.logInfo(stdout);
      split();
    }

    if (stderr) {
      logger.logError(stderr);
      split();
    }
  }

  const { repos } = context;
  const timeStr = `in : ${(new Date() - startTs) / 1000}s @ ${new Date().toString()}`;
  logger.logInfo(`Executed '${context.config.exec}' ${repos.length} repositorie${s(repos)} ${timeStr}`);

  if (stats.unmatched || stats.empty) {
    const { unmatched, empty } = stats;
    logger.logInfo(`${unmatched} unmatched repo${s(unmatched)} and ${empty} empty response${s(empty)}`);
  }
}

function split() {
  logger.logInfo(new Array(process.stdout.columns).join('-'));
}

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
