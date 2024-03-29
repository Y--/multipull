const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pushRepo = require('../../lib/runners/push-repo');

const REPO_NAME = 'repo-1';

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Push', () => {
    setupHooks();

    [
      {
        status: { ahead: 0, behind: 0, current: 'main', tracking: 'origin/main' },
        cmdLineArgs: {},
        expectedPushed: '',
        expectedPushCall: null,
      },
      {
        status: { ahead: 42, behind: 0, current: 'main', tracking: 'origin/main' },
        cmdLineArgs: {},
        expectedPushed: 'Yes',
        expectedPushCall: [],
      },
      {
        status: { ahead: 1, behind: 3, current: 'main', tracking: 'origin/main' },
        cmdLineArgs: {},
        expectedPushed: 'No (\'main\' is behind 3 commits from \'origin/main\')',
        expectedPushCall: null,
      },
      {
        status: { ahead: 3, behind: 0, current: 'foo-branch', tracking: undefined },
        cmdLineArgs: {},
        expectedPushed: 'Yes',
        expectedPushCall: ['--set-upstream', 'origin', 'foo-branch'],
      },
      {
        status: { ahead: 3, behind: 0, current: 'foo-branch', tracking: 'origin/foo-branch' },
        cmdLineArgs: { force: true },
        expectedPushed: 'Yes',
        expectedPushCall: [],
      },
      {
        status: { ahead: 3, behind: 1, current: 'foo-branch', tracking: 'origin/foo-branch' },
        cmdLineArgs: { force: true },
        expectedPushed: 'Yes (forced)',
        expectedPushCall: ['--force'],
      },
      {
        status: { ahead: 0, behind: 0, current: 'HEAD', tracking: null },
        cmdLineArgs: { force: true },
        expectedPushed: 'No (detached HEAD)',
        expectedPushCall: null,
      },
      {
        status: { ahead: 0, behind: 0, current: 'HEAD', tracking: null },
        cmdLineArgs: {},
        expectedPushed: 'No (detached HEAD)',
        expectedPushCall: null,
      },
      {
        status: { ahead: 3, behind: 0, current: 'foo-branch', tracking: 'origin/foo-branch' },
        cmdLineArgs: { dry: true },
        expectedPushed: 'Dry: git push ',
        expectedPushCall: null,
      },
    ].forEach(({ cmdLineArgs, status, expectedPushed, expectedPushCall }) => {
      const suffix = `and parmeters ${JSON.stringify(cmdLineArgs)}`;
      it(`Should return ${expectedPushed} when status is ${JSON.stringify(status)} ${suffix}`, async () => {
        const stash = { all: [], latest: null, total: 0 };
        mocks.sg.status.mockImplementation(() => status);
        mocks.sg.stashList.mockImplementationOnce(() => stash);
        mocks.sg.raw.mockReturnValue('');

        const fixtureContext = createFixtureContext(REPO_NAME);
        Object.assign(fixtureContext.args, cmdLineArgs);
        const res = await pushRepo(fixtureContext, REPO_NAME);

        expect(res).toEqual({ hasWipCommit: false, status, stash, pushed: expectedPushed });

        expect(mocks.sg.status.mock.calls).toEqual([[], []]);
        expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
        expect(mocks.sg.push.mock.calls).toEqual(expectedPushCall ? [[expectedPushCall]] : []);
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
