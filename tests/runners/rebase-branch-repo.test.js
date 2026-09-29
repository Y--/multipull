const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const rebaseBranch = require('../../lib/runners/rebase-branch-repo');

const REPO_NAME = 'repo-1';

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Rebase Branch in repository', () => {
    setupHooks();

    [
      {
        status: { ahead: 0, behind: 0, current: 'main' },
        expectedCalls: {},
      },
      {
        status: { current: 'foo' },
        expectedCalls: {
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']]
          ],
        },
      },
      {
        status: { current: 'foo', modified: [], deleted: [], created: [], conflicted: [] },
        revList: '<\n<',
        expectedCalls: {
          stashList: [[], []],
          status: [[], []],
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
          ],
          rebase: [[['origin/main', '--stat']]],
          diffSummary: [[['foo...origin/main']]],
        },
      },
      {
        status: { current: 'foo', tracking: 'bar', modified: [], deleted: [], created: [], conflicted: [] },
        revList: '<\n<',
        expectedCalls: {
          stashList: [[], []],
          status: [[], []],
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
          ],
          rebase: [[['origin/main', '--stat']]],
          diffSummary: [[['foo...origin/foo']]],
        },
      },
      {
        status: { current: 'foo', modified: [2], deleted: [], created: [], conflicted: [] },
        revList: '<\n<',
        expectedCalls: {
          stashList: [[], []],
          status: [[], []],
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
          ],
          rebase: [[['origin/main', '--stat']]],
          diffSummary: [[['foo...origin/main']]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { current: 'foo', modified: [2], deleted: [], created: [], conflicted: [] },
        revList: '<\n<',
        diffSummaryWillFail: true,
        expectedCalls: {
          stashList: [[], []],
          status: [[], []],
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
          ],
          rebase: [[['origin/main', '--stat']]],
          diffSummary: [[['foo...origin/main']]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { current: 'foo', modified: [2], deleted: [], created: [], conflicted: [] },
        rebaseWillFail: true,
        revList: '<\n<',
        expectedCalls: {
          stashList: [[], []],
          status: [[], []],
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/main...foo']],
          ],
          rebase: [[['origin/main', '--stat']], [{ '--abort': null }]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
    ].forEach(({ status, revList, rebaseWillFail, diffSummaryWillFail, expectedCalls }, i) => {
      const suffix = `status is ${JSON.stringify(status)} - ${i}`;
      it(`Should return when ${suffix}`, async () => {
        const stash = { all: [], latest: null, total: 0 };
        mocks.sg.status.mockImplementation(() => status);
        mocks.sg.stashList.mockImplementation(() => stash);

        mocks.sg.raw.mockImplementation(([command]) => {
          if (command === 'log') {
            return '';
          } else if (revList) {
            return revList;
          }
        });

        if (rebaseWillFail) {
          mocks.sg.rebase.mockImplementationOnce(async () => {
            throw new Error();
          });
        }

        const diffSummary = { files: [{ file: 'foo.js' }], changed: 1, insertions: 2, deletions: 3 };
        mocks.sg.diffSummary.mockReset();
        if (diffSummaryWillFail) {
          mocks.sg.diffSummary.mockImplementationOnce(async () => {
            throw new Error();
          });
        } else {
          mocks.sg.diffSummary.mockResolvedValueOnce(diffSummary);
        }

        const fixtureContext = createFixtureContext(REPO_NAME);
        const res = await rebaseBranch(fixtureContext, REPO_NAME);

        const expectedRes = { status, stash, hasWipCommit: false };
        if (rebaseWillFail) {
          expectedRes.pull = { files: ['*** FETCHED ONLY, REBASE WOULD PRODUCE CONFLICTS ***'], summary: {} };
        }
        if (diffSummaryWillFail) {
          expectedRes.pull = { files: [''], summary: {} };
        } else if (expectedCalls.diffSummary) {
          expectedRes.pull = diffSummary;
        }

        expect(res).toEqual(expectedRes);

        expect(mocks.sg.pull.mock.calls).toHaveLength(expectedCalls.pull ? 1 : 0);

        expectedCalls.fetch = expectedCalls.fetch || [[['--all']]];
        expectedCalls.status = expectedCalls.status || [[]];
        expectedCalls.stashList = expectedCalls.stashList || [[]];
        expectedCalls.raw = expectedCalls.raw || [[['log', '--pretty=format:%s', '-1']]];

        for (const [handlerId, { mock }] of Object.entries(mocks.sg)) {
          if (!mock) {
            continue;
          }

          try {
            expect(mock.calls).toEqual(expectedCalls[handlerId] || []);
          } catch (err) {
            err.message = `Error while checking '${handlerId}': ${err.message}`;
            throw err;
          }
        }
        expectDebugCalls();
      });
    });
  });

  function expectDebugCalls() {
    if (testParams.debug) {
      expect(mocks.debug.mock.calls).toHaveLength(1);
      expect(mocks.debug.mock.calls[0]).toHaveLength(1);
      expect(mocks.debug.mock.calls[0][0]).toEqual('Processing repository repo-1...');
    } else {
      expect(mocks.debug.mock.calls).toHaveLength(0);
    }
  }
}
