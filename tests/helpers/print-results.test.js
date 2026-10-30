const { mocks } = require('../mocks');
const { createFixtureContext } = require('../utils');
const printResults = require('../../lib/helpers/print-results');

const ORANGE = '\x1B[38;5;208m';

function createContext() {
  const context = createFixtureContext('repo-1');
  context.repos.push('repo-1/wt:feature');
  context.worktreeToParentMap.set('repo-1/wt:feature', 'repo-1');
  return context;
}

const EMPTY_FILES = { not_added: [], modified: [], deleted: [], created: [], conflicted: [] };

function result(repo, status, extra = {}) {
  const fullStatus = { ...EMPTY_FILES, ...status };
  return { repo, elapsed: 10, res: { status: fullStatus, stash: { total: 0 }, hasWipCommit: false, ...extra } };
}

function printTable() {
  const context = createContext();
  printResults(context, new Date(), [
    result('repo-1', { current: 'main', tracking: 'origin/main' }, { worktrees: 1 }),
    result('repo-1/wt:feature', { current: 'feature', tracking: 'origin/feature', modified: ['a.js'] }),
  ]);
  return mocks.logger.logInfo.mock.calls[0][0];
}

describe('printResults', () => {
  const { isTTY, getColorDepth } = process.stdout;
  afterEach(() => {
    process.stdout.isTTY = isTTY;
    process.stdout.getColorDepth = getColorDepth;
  });

  describe('Worktrees', () => {
    it('should show the worktrees below their repository, without colors when not in a terminal', () => {
      process.stdout.isTTY = false;

      const table = printTable();

      expect(table).not.toMatch(/\x1B\[/); // eslint-disable-line no-control-regex
      const rows = table.split('\n').filter((line) => line.startsWith('│'));
      expect(rows[1]).toMatch(/^│ repo-1 /);
      expect(rows[2]).toMatch(/^│ {3}wt:feature +│ feature /);
    });

    it('should show the worktrees in orange in a 256 colors terminal', () => {
      process.stdout.isTTY = true;
      process.stdout.getColorDepth = () => 8;

      const table = printTable();

      expect(table).toContain(`${ORANGE}  wt:feature\x1B[39m`);
      expect(table).toContain('\x1B[31mrepo-1\x1B[39m'); // Repositories keep the header's color
      expect(table).not.toContain(`\x1B[31m${ORANGE}`);
    });

    it('should show ☠️ in the Tracking column for the worktrees whose remote branch is gone', () => {
      process.stdout.isTTY = false;
      const context = createContext();
      printResults(context, new Date(), [
        result('repo-1', { current: 'main', tracking: 'origin/main' }),
        result('repo-1/wt:feature', { current: 'feature', tracking: 'origin/feature' }, { upstreamGone: true }),
      ]);
      const rows = mocks.logger.logInfo.mock.calls[0][0].split('\n').filter((line) => line.startsWith('│'));

      expect(rows[0]).not.toMatch(/Gone/);
      expect(rows.find((row) => row.includes('wt:feature'))).toMatch(/wt:feature +│ feature +│ ☠️ +│/);
    });

    it('should show ☠️ next to a tracking branch that has another name', () => {
      process.stdout.isTTY = false;
      printResults(createContext(), new Date(), [
        result('repo-1', { current: 'main', tracking: 'origin/main' }),
        result('repo-1/wt:feature', { current: 'feature', tracking: 'origin/other' }, { upstreamGone: true }),
      ]);
      const table = mocks.logger.logInfo.mock.calls[0][0];

      expect(table).toMatch(/wt:feature +│ feature +│ ☠️ origin\/other +│/);
    });

    it('should show the worktrees in yellow in a terminal with fewer colors', () => {
      process.stdout.isTTY = true;
      process.stdout.getColorDepth = () => 4;

      expect(printTable()).toContain('\x1B[33m  wt:feature\x1B[39m');
    });
  });
});
