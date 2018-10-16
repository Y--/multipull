const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const statusRepo = require('../../lib/runners/status-repo');

const REPO_NAME = 'repo-1';
const fixtureContext = createFixtureContext(REPO_NAME);
setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Status', () => {
    setupHooks();

    it('call git status on master', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

      const res = await statusRepo(fixtureContext, REPO_NAME);

      expect(res).toEqual({
        status: { current: 'master' },
        stash: { all: [], latest: null, total: 0 }
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);

      expectDebugCalls();
    });

    testGS('call git status on a branch that is in sync with master', '',                 { ahead: 0, behind: 0 });
    testGS('call git status on a branch ahead of master',             '>hash-1\n>hash-2', { ahead: 2, behind: 0 });
    testGS('call git status on a branch behind master',               '<hash-1\n<hash-2', { ahead: 0, behind: 2 });
    testGS('call git status on a branch that diverged from master',   '>hash-1\n<hash-2', { ahead: 1, behind: 1 });

    it('the stash count is 0 by default', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({}));

      const res = await statusRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual({ status: { current: 'master' }, stash: { total: 0 } });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);

      expectDebugCalls();
    });
  });

  function testGS(title, revListResult, expectedDiffWithMaster) {
    it(title, async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));

      mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

      mocks.sg.raw.mockImplementationOnce(([command]) => {
        if (command !== 'rev-list') {
          throw new Error(`Unexpected call to 'sg.raw': ${command}`);
        }
        return revListResult;
      });

      const res = await statusRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual({
        status: { current: 'foo-branch', diff_with_origin_master: expectedDiffWithMaster },
        stash: { all: [], latest: null, total: 0 }
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
      expect(mocks.sg.raw.mock.calls).toEqual([[['rev-list', '--left-right', 'origin/master...foo-branch']]]);

      expectDebugCalls();
    });
  }

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
