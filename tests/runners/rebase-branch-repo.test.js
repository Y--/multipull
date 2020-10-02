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
        status: { ahead: 0, behind: 0, current: 'master' },
        expectedCalls: {},
      },
      {
        status: { current: 'foo' },
        expectedCalls: {
          raw: [
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']]
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
            [['rev-list', '--left-right', 'origin/master...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']],
          ],
          rebase: [[['origin/master', '--stat']]],
          diffSummary: [[['foo...origin/master']]],
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
            [['rev-list', '--left-right', 'origin/master...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']],
          ],
          rebase: [[['origin/master', '--stat']]],
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
            [['rev-list', '--left-right', 'origin/master...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']],
          ],
          rebase: [[['origin/master', '--stat']]],
          diffSummary: [[['foo...origin/master']]],
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
            [['rev-list', '--left-right', 'origin/master...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']],
          ],
          rebase: [[['origin/master', '--stat']]],
          diffSummary: [[['foo...origin/master']]],
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
            [['rev-list', '--left-right', 'origin/master...foo']],
            [['log', '--pretty=format:%s', '-1']],
            [['rev-list', '--left-right', 'origin/master...foo']],
          ],
          rebase: [[['origin/master', '--stat']], [{ '--abort': null }]],
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

        if (diffSummaryWillFail) {
          mocks.sg.diffSummary.mockImplementationOnce(async () => {
            throw new Error();
          });
        }

        const fixtureContext = createFixtureContext(REPO_NAME);
        const res = await rebaseBranch(fixtureContext, REPO_NAME);

        const expectedRes = { status, stash, hasWipCommit: false };
        if (rebaseWillFail) {
          expectedRes.pull = { files: ['*** FETCHED ONLY, REBASE WOULD PRODUCE CONFLICTS ***'], summary: {} };
        }
        if (diffSummaryWillFail) {
          expectedRes.pull = { files: [''], summary: {} };
        }

        expect(res).toEqual(expectedRes);

        expect(mocks.sg.pull.mock.calls).toHaveLength(expectedCalls.pull ? 1 : 0);

        expectedCalls.fetch = expectedCalls.fetch || [[['--all']]];
        expectedCalls.status = expectedCalls.status || [[]];
        expectedCalls.stashList = expectedCalls.stashList || [[]];
        expectedCalls.raw = expectedCalls.raw || [[['log', '--pretty=format:%s', '-1']]];

        for (const [handlerId, { mock }] of Object.entries(mocks.sg)) {
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
