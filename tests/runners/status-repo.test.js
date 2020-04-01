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
        stash: { all: [], latest: null, total: 0 },
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
      expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([]);

      expectDebugCalls();
    });

    testGS('call git status on a branch that is in sync with master', '', { ahead: 0, behind: 0 });
    testGS('call git status on a branch ahead of master', '>hash-1\n>hash-2', { ahead: 2, behind: 0 });
    testGS('call git status on a branch behind master', '<hash-1\n<hash-2', { ahead: 0, behind: 2 });
    testGS('call git status on a branch that diverged from master', '>hash-1\n<hash-2', { ahead: 1, behind: 1 });

    it('the stash count is 0 by default', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({}));

      const res = await statusRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual({ status: { current: 'master' }, stash: { total: 0 } });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);

      expectDebugCalls();
    });

    describe('When using the --pr flag', () => {
      beforeEach(() => {
        fixtureContext.config.pr = true;
      });

      afterEach(() => {
        delete fixtureContext.config.pr;
      });

      it('Should not do anything if the current branch is master', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(fixtureContext, REPO_NAME);
        expect(res).toEqual({
          status: { current: 'master' },
          stash: { all: [], latest: null, total: 0 },
        });

        expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([]);
      });

      [
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }],
            combinedStatus: { state: 'pending', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true },
          },

          expectedResult: {
            build: 'N/A. ',
            state: 'Yes',
            pr: 'pr-url',
            reviews: '1 approved, 1 requested changes',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'APPROVED' }, { state: 'CHANGES_REQUESTED' }],
            combinedStatus: { state: 'pending', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true, mergeable_state: 'draft' },
          },

          expectedResult: {
            build: 'N/A. ',
            state: 'draft',
            pr: 'pr-url',
            reviews: '1 approved, 1 requested changes',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'CHANGES_REQUESTED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true },
          },

          expectedResult: {
            build: 'Checks: ',
            state: 'Yes',
            pr: 'pr-url',
            reviews: '1 requested changes',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'CHANGES_REQUESTED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: false },
          },

          expectedResult: {
            build: 'Checks: ',
            state: 'Conflicts',
            pr: 'pr-url',
            reviews: '1 requested changes',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'CHANGES_REQUESTED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: false, mergeable_state: 'draft' },
          },

          expectedResult: {
            build: 'Checks: ',
            state: 'Conflicts (draft)',
            pr: 'pr-url',
            reviews: '1 requested changes',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'COMMENTED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: null },
          },

          expectedResult: {
            build: 'Checks: ',
            state: 'Unknown',
            pr: 'pr-url',
            reviews: '1 comment',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [],
            combinedStatus: { state: 'failure', statuses: [{ state: 'failure', description: 'Because it failed' }] },
            pullRequest: { html_url: 'pr-url', mergeable: true },
          },

          expectedResult: {
            build: 'Because it failed\n1 failure',
            state: 'Yes',
            pr: 'pr-url',
            reviews: 'Not reviewed',
          },
        },
        {
          fixture: {
            pullRequests: [],
            reviews: [],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true },
          },

          expectedResult: {
            pr: '',
          },
        },
        {
          fixture: {
            pullRequests: null,
            reviews: [],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true },
          },

          expectedResult: {},
        },
      ].forEach(({ fixture, expectedResult }) => {
        it(`Should return ${JSON.stringify(expectedResult)} when ${JSON.stringify(fixture)}`, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

          mocks.ghRepo.listPullRequests.mockImplementationOnce(() => createGHResponse(fixture.pullRequests));

          if (fixture.pullRequests && fixture.pullRequests.length) {
            mocks.ghRepo.getReviews.mockImplementationOnce(() => createGHResponse(fixture.reviews));
            mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => createGHResponse(fixture.combinedStatus));
            mocks.ghRepo.getPullRequest.mockImplementationOnce(() => createGHResponse(fixture.pullRequest));
          }

          const res = await statusRepo(fixtureContext, REPO_NAME);
          expect(res).toEqual(
            Object.assign(
              {
                stash: { all: [], latest: null, total: 0 },
                status: { current: 'foo-branch', diff_with_origin_master: { ahead: 0, behind: 0 } },
              },
              expectedResult
            )
          );

          const expectedLsPRArgs = { base: 'master', head: 'foo-owner:foo-branch', state: 'open' };
          expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([[expectedLsPRArgs]]);

          const prNumberCalls = fixture.pullRequests ? fixture.pullRequests.map((pr) => [pr.number]) : [];
          const shaCalls = fixture.pullRequests ? fixture.pullRequests.map((pr) => [pr.head.sha]) : [];
          expect(mocks.ghRepo.getReviews.mock.calls).toEqual(prNumberCalls);
          expect(mocks.ghRepo.getCombinedStatus.mock.calls).toEqual(shaCalls);
          expect(mocks.ghRepo.getPullRequest.mock.calls).toEqual(prNumberCalls);
        });
      });

      [
        {
          fixture: {
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: 'wrong' },
          },

          expectedError: "Invalid mergeable value 'wrong'",
        },
        {
          fixture: {
            combinedStatus: { state: 'not-a-state', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: null },
          },

          expectedError: "Invalid state value 'not-a-state'",
        },
      ].forEach(({ fixture, expectedError }) => {
        it(`Should throw an error if the parameters are ${JSON.stringify(fixture)}: ${JSON.stringify(
          expectedError
        )} `, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

          mocks.ghRepo.listPullRequests.mockImplementationOnce(() =>
            createGHResponse([{ number: 42, head: { sha: 33 } }])
          );
          mocks.ghRepo.getReviews.mockImplementationOnce(() => createGHResponse([]));
          mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => createGHResponse(fixture.combinedStatus));
          mocks.ghRepo.getPullRequest.mockImplementationOnce(() => createGHResponse(fixture.pullRequest));

          await expect(statusRepo(fixtureContext, REPO_NAME)).rejects.toThrowError(expectedError);
        });
      });
    });

    describe('When using the --ci flag', () => {
      beforeEach(() => {
        fixtureContext.config.ci = true;
        fixtureContext.config.full = true;
      });

      afterEach(() => {
        delete fixtureContext.config.ci;
        delete fixtureContext.config.full;
      });

      it('Should not do anything if the current branch is master', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(fixtureContext, REPO_NAME);
        expect(res).toEqual({
          status: { current: 'master' },
          stash: { all: [], latest: null, total: 0 },
        });

        expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([]);
      });

      [
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 'some-hash' } }],
            combinedStatus: {
              state: 'failure',
              statuses: [{ state: 'failure', description: 'description', target_url: 'target://url' }],
            },
          },

          expectedResult: {
            build: 'description\n1 failure\ntarget://url',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 'some-hash' } }],
            combinedStatus: {
              state: 'pending',
              statuses: [{ state: 'pending', description: 'description', target_url: 'target://url' }],
            },
          },

          expectedResult: {
            build: 'description. 1 pending - target://url',
          },
        },
      ].forEach(({ fixture, expectedResult }) => {
        it(`Should return ${JSON.stringify(expectedResult)} when ${JSON.stringify(fixture)}`, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
          mocks.sg.revparse.mockImplementationOnce(() => 'some-hash');

          if (fixture.pullRequests && fixture.pullRequests.length) {
            mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => createGHResponse(fixture.combinedStatus));
          }

          const res = await statusRepo(fixtureContext, REPO_NAME);
          expect(res).toEqual(
            Object.assign(
              {
                stash: { all: [], latest: null, total: 0 },
                status: { current: 'foo-branch', diff_with_origin_master: { ahead: 0, behind: 0 } },
              },
              expectedResult
            )
          );

          const shaCalls = fixture.pullRequests ? fixture.pullRequests.map((pr) => [pr.head.sha]) : [];
          expect(mocks.ghRepo.getCombinedStatus.mock.calls).toEqual(shaCalls);
        });
      });
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
        stash: { all: [], latest: null, total: 0 },
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
      expect(mocks.sg.raw.mock.calls).toEqual([[['rev-list', '--left-right', 'origin/master...foo-branch']]]);

      expectDebugCalls();
    });
  }

  function createGHResponse(data) {
    return { data };
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
