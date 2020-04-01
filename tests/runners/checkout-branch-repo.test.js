const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const checkoutBranch = require('../../lib/runners/checkout-branch-repo');

const REPO_NAME = 'repo-1';

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Checkout Branch', () => {
    setupHooks();

    [
      {
        currentBranch: 'master',
        expectedCalls: {
          checkout: [['master']],
        },
      },
      {
        currentBranch: 'master',
        workingBranch: 'foo-branch',
      },
      {
        currentBranch: 'master',
        workingBranch: 'foo-branch',
        checkoutErr: 'some exception',
        expectedErr: /some exception/,
      },
      {
        currentBranch: 'master',
        workingBranch: 'foo-branch',
        checkoutErr: "pathspec 'foo-branch' did not match any file",
        expectedCalls: {
          status: [[], []],
        },
      },
      {
        currentBranch: 'master',
        workingBranch: 'foo-branch',
        defaultBranch: 'foo-branch',
        checkoutErr: "pathspec 'foo-branch' did not match any file",
        expectedCalls: {
          status: [[]],
        },
      },
      {
        currentBranch: 'bar-branch',
        workingBranch: 'foo-branch',
        checkoutErr: "pathspec 'foo-branch' did not match any file",
        expectedCalls: {
          status: [[], []],
          checkout: [['foo-branch'], ['master']],
          raw: [[['rev-list', '--left-right', 'origin/master...bar-branch']]],
        },
      },
    ].forEach(({ currentBranch, workingBranch, defaultBranch, expectedCalls = {}, checkoutErr, expectedErr }) => {
      const suffix = checkoutErr ? ` and 'checkout' throws '${checkoutErr}'` : '';
      const statusStr = JSON.stringify({ currentBranch, workingBranch, defaultBranch });
      it(`Should checkout the branch when ${statusStr}${suffix}`, async () => {
        const stash = { all: [], latest: null, total: 0 };
        const status = { current: currentBranch };
        mocks.sg.status.mockImplementation(() => status);
        mocks.sg.stashList.mockImplementationOnce(() => stash);

        if (checkoutErr) {
          mocks.sg.checkout.mockImplementationOnce(() => {
            throw new Error(checkoutErr);
          });
        }

        const branches = defaultBranch ? REPO_NAME + ':' + defaultBranch : '';
        const fixtureContext = createFixtureContext(REPO_NAME, branches);
        fixtureContext.setWorkingBranch(workingBranch);

        expectedCalls.fetch = [[['--all']]];
        expectedCalls.checkout = expectedCalls.checkout || [['foo-branch']];
        if (!expectedErr) {
          const res = await checkoutBranch(fixtureContext, REPO_NAME);
          expect(res).toEqual({ status, stash });

          expectedCalls.status = expectedCalls.status || [[]];
          expectedCalls.stashList = [[]];
        } else {
          await expect(checkoutBranch(fixtureContext, REPO_NAME)).rejects.toThrowError(new RegExp(expectedErr));

          expectedCalls.status = [];
          expectedCalls.stashList = [];
        }

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
