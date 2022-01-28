const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRepo = require('../../lib/runners/pull-repo');

const REPO_NAME = 'repo-1';

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Pull repo', () => {
    setupHooks();

    [
      {
        status: { ahead: 0, behind: 0 },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {},
      },
      {
        status: { ahead: 0, behind: 0, tracking: null },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {},
      },
      {
        status: { ahead: 0, behind: 0, tracking: null, diff_with_origin_main: { behind: 0 } },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {},
      },
      {
        status: {
          tracking: null,
          modified: [],
          deleted: [],
          created: [],
          conflicted: [],
          diff_with_origin_main: { behind: 1 },
        },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          rebase: [[['origin/main', '--stat']]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--stat': null }]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [1], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [2], created: [], conflicted: [] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [3], conflicted: [] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [], conflicted: [4] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
          rebase: null,
          commit: [['[multipull] WIP', null, { '--no-verify': null, '-a': null }]],
          reset: [[['--soft', 'HEAD~1']], [['HEAD']]],
        },
      },
      {
        status: { ahead: 1, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: [], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
        },
      },
      {
        status: { ahead: 1, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        pullWillFail: true,
        expectedPull: { files: ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'], summary: {} },
        expectedCalls: {
          pull: [[null, null, { '--all': null, '--rebase': null, '--stat': null }]],
          rebase: [[{ '--abort': null }]],
        },
      },
    ].forEach(({ status, pullWillFail, expectedPull, expectedCalls }) => {
      status.current = 'main';

      const suffix = `status is ${JSON.stringify(status)}`;
      it(`Should return ${JSON.stringify(expectedPull)} when ${suffix}`, async () => {
        const stash = { all: [], latest: null, total: 0 };
        mocks.sg.status.mockImplementation(() => status);
        mocks.sg.stashList.mockImplementationOnce(() => stash);
        mocks.sg.raw.mockReturnValue('');

        if (expectedCalls.pull && pullWillFail) {
          mocks.sg.pull.mockImplementationOnce(async () => {
            throw new Error();
          });
        } else if (expectedCalls.pull && !pullWillFail) {
          mocks.sg.pull.mockImplementationOnce(() => expectedPull);
        }

        const fixtureContext = createFixtureContext(REPO_NAME);
        const res = await pullRepo(fixtureContext, REPO_NAME);

        expect(res).toEqual({ hasWipCommit: false, status, stash, pull: expectedPull });

        expect(mocks.sg.pull.mock.calls).toHaveLength(expectedCalls.pull ? 1 : 0);
        expect(mocks.sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']]]);

        expectedCalls.fetch = expectedCalls.fetch || [[['--all']]];
        expectedCalls.status = expectedCalls.status || [[], []];
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
