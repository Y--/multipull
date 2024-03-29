const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const statusRepo = require('../../lib/runners/status-repo');

const REPO_NAME = 'repo-1';
const AcceptHeader = 'shadow-cat-preview';
const fixtureContext = createFixtureContext(REPO_NAME);
setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Status', () => {
    setupHooks();

    it('call git status on main', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
      mocks.sg.raw.mockReturnValue('');

      const res = await statusRepo(fixtureContext, REPO_NAME);

      expect(res).toEqual({
        hasWipCommit: false,
        status: { current: 'main' },
        stash: { all: [], latest: null, total: 0 },
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
      expect(mocks.sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']]]);
      expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([]);

      expectDebugCalls();
    });

    testGS('call git status on a branch that is in sync with main', '', { ahead: 0, behind: 0 });
    testGS('call git status on a branch ahead of main', '>hash-1\n>hash-2', { ahead: 2, behind: 0 });
    testGS('call git status on a branch behind main', '<hash-1\n<hash-2', { ahead: 0, behind: 2 });
    testGS('call git status on a branch that diverged from main', '>hash-1\n<hash-2', { ahead: 1, behind: 1 });

    it('the stash count is 0 by default', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({}));

      const res = await statusRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual({ hasWipCommit: false, status: { current: 'main' }, stash: { total: 0 } });

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

      it('Should not do anything if the current branch is main', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(fixtureContext, REPO_NAME);
        expect(res).toEqual({
          hasWipCommit: false,
          status: { current: 'main' },
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
            buildState: 'pending',
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
            buildState: 'pending',
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
            buildState: 'success',
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
            buildState: 'success',
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
            buildState: 'success',
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
            buildState: 'success',
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
            buildState: 'failure',
            state: 'Yes',
            pr: 'pr-url',
            reviews: 'None',
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

          mocks.ghRepo.listPullRequests.mockImplementationOnce(() => wrapGHResponse(fixture.pullRequests));

          if (fixture.pullRequests && fixture.pullRequests.length) {
            mocks.ghRepo.getReviews.mockImplementationOnce(() => wrapGHResponse(fixture.reviews));
            mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => wrapGHResponse(fixture.combinedStatus));
            mocks.ghRepo.getPullRequest.mockImplementationOnce(() => wrapGHResponse(fixture.pullRequest));
          }

          const res = await statusRepo(fixtureContext, REPO_NAME);

          if (expectedResult.pr) {
            expect(res.pr).toMatch(new RegExp(expectedResult.pr));
            res.pr = expectedResult.pr;
          }

          if (expectedResult.state) {
            expect(res.state.includes(expectedResult.state)).toEqual(true);
            res.state = expectedResult.state;
          }

          expect(res).toEqual({
            hasWipCommit: false,
            stash: { all: [], latest: null, total: 0 },
            status: { current: 'foo-branch', diff_with_origin_main: { ahead: 0, behind: 0 } },
            ...expectedResult,
          });

          const expectedLsPRArgs = { head: 'foo-owner:foo-branch', state: 'open', AcceptHeader };
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

          expectedError: 'Invalid mergeable value \'wrong\'',
        },
      ].forEach(({ fixture, expectedError }) => {
        it(`Should throw an error if the parameters are ${JSON.stringify(fixture)}: ${JSON.stringify(
          expectedError
        )} `, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

          mocks.ghRepo.listPullRequests.mockImplementationOnce(() =>
            wrapGHResponse([{ number: 42, head: { sha: 33 } }])
          );
          mocks.ghRepo.getReviews.mockImplementationOnce(() => wrapGHResponse([]));
          mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => wrapGHResponse(fixture.combinedStatus));
          mocks.ghRepo.getPullRequest.mockImplementationOnce(() => wrapGHResponse(fixture.pullRequest));

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

      it('Should not do anything if the current branch is main', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(fixtureContext, REPO_NAME);
        expect(res).toEqual({
          hasWipCommit: false,
          status: { current: 'main' },
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
            buildState: 'failure',
            buildStatus: 'description\n1 failure\ntarget://url',
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
            buildState: 'pending',
            buildStatus: 'description. 1 pending - target://url',
          },
        },
      ].forEach(({ fixture, expectedResult }) => {
        it(`Should return ${JSON.stringify(expectedResult)} when ${JSON.stringify(fixture)}`, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
          mocks.sg.revparse.mockImplementationOnce(() => 'some-hash');

          if (fixture.pullRequests && fixture.pullRequests.length) {
            mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => wrapGHResponse(fixture.combinedStatus));
          }

          const res = await statusRepo(fixtureContext, REPO_NAME);

          expect(res).toEqual({
            hasWipCommit: false,
            stash: { all: [], latest: null, total: 0 },
            status: { current: 'foo-branch', diff_with_origin_main: { ahead: 0, behind: 0 } },
            ...expectedResult,
          });

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

      // mocks.sg.revparse.mock
      mocks.sg.raw.mockImplementationOnce(([command]) => {
        if (command !== 'log') {
          throw new Error(`Unexpected call to 'sg.raw': ${command}`);
        }
        return '';
      });

      mocks.sg.raw.mockImplementationOnce(([command]) => {
        if (command !== 'rev-list') {
          throw new Error(`Unexpected call to 'sg.raw': ${command}`);
        }
        return revListResult;
      });

      const res = await statusRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual({
        hasWipCommit: false,
        status: { current: 'foo-branch', diff_with_origin_main: expectedDiffWithMaster },
        stash: { all: [], latest: null, total: 0 },
      });

      expect(mocks.sg.status.mock.calls).toEqual([[]]);
      expect(mocks.sg.stashList.mock.calls).toEqual([[]]);
      expect(mocks.sg.raw.mock.calls).toEqual([
        [['log', '--pretty=format:%s', '-1']],
        [['rev-list', '--left-right', 'origin/main...foo-branch']],
      ]);

      expectDebugCalls();
    });
  }

  function wrapGHResponse(data) {
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
