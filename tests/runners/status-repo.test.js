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

    beforeEach(() => {
      mocks.sg.raw.mockReset();
      mocks.sg.raw.mockReturnValue('');
    });

    it('call git status on main', async () => {
      mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
      mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

      const res = await statusRepo(fixtureContext, REPO_NAME);

      expect(res).toEqual({
        hasWipCommit: false,
        status: { current: 'main', isDefaultBranch: true },
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
      expect(res).toEqual({
        hasWipCommit: false,
        status: { current: 'main', isDefaultBranch: true },
        stash: { total: 0 },
      });

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
          status: { current: 'main', isDefaultBranch: true },
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
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'APPROVED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: true, mergeable_state: 'blocked' },
          },

          expectedResult: {
            buildState: 'success',
            state: '🚫',
            pr: 'pr-url',
            reviews: '1 approved',
          },
        },
        {
          fixture: {
            pullRequests: [{ number: 42, head: { sha: 33 } }],
            reviews: [{ state: 'COMMENTED' }, { state: 'COMMENTED' }],
            combinedStatus: { state: 'success', statuses: [] },
            pullRequest: { html_url: 'pr-url', mergeable: null, mergeable_state: 'unknown' },
          },

          expectedResult: {
            buildState: 'success',
            state: '??',
            pr: 'pr-url',
            reviews: '2 comments',
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
            status: { current: 'foo-branch', isDefaultBranch: false, diff_with_origin_main: { ahead: 0, behind: 0 } },
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

          expectedError: "Invalid mergeable value 'wrong'",
        },
      ].forEach(({ fixture, expectedError }) => {
        it(`Should throw an error if the parameters are ${JSON.stringify(fixture)}: ${JSON.stringify(
          expectedError,
        )} `, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

          mocks.ghRepo.listPullRequests.mockImplementationOnce(() =>
            wrapGHResponse([{ number: 42, head: { sha: 33 } }]),
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
          status: { current: 'main', isDefaultBranch: true },
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
            buildStatus: 'description - 1 failure\ntarget://url',
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
            status: { current: 'foo-branch', isDefaultBranch: false, diff_with_origin_main: { ahead: 0, behind: 0 } },
            ...expectedResult,
          });

          const shaCalls = fixture.pullRequests ? fixture.pullRequests.map((pr) => [pr.head.sha]) : [];
          expect(mocks.ghRepo.getCombinedStatus.mock.calls).toEqual(shaCalls);
        });
      });
    });

    describe('When using the --ci flag with a successful build', () => {
      beforeEach(() => {
        fixtureContext.config.ci = true;
      });

      afterEach(() => {
        delete fixtureContext.config.ci;
      });

      it('Should summarize the successful checks', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.sg.revparse.mockImplementationOnce(() => 'some-hash\n');

        const combinedStatus = { state: 'success', statuses: [{ state: 'success' }, { state: 'success' }] };
        mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => wrapGHResponse(combinedStatus));

        const res = await statusRepo(fixtureContext, REPO_NAME);

        expect(res.buildState).toEqual('success');
        expect(res.buildStatus).toMatch(/^Checks: .*2 success/);
        expect(mocks.sg.revparse.mock.calls).toEqual([['HEAD']]);
        expect(mocks.ghRepo.getCombinedStatus.mock.calls).toEqual([['some-hash']]);
      });
    });

    describe('When a CI service is configured', () => {
      beforeEach(() => {
        fixtureContext.config.pr = true;
        fixtureContext.config.ciService = { moduleUrl: 'https://ci.example/pr/${pr.number}', display: '#${pr.number}' };
      });

      afterEach(() => {
        delete fixtureContext.config.pr;
        delete fixtureContext.config.ciService;
      });

      it('Should resolve the build URL from the pull request', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

        const pullRequests = [{ number: 42, head: { sha: 33 } }];
        mocks.ghRepo.listPullRequests.mockImplementation(() => wrapGHResponse(pullRequests));
        mocks.ghRepo.getReviews.mockImplementationOnce(() => wrapGHResponse([]));
        mocks.ghRepo.getCombinedStatus.mockImplementationOnce(() => wrapGHResponse({ state: 'success', statuses: [] }));
        mocks.ghRepo.getPullRequest.mockImplementationOnce(() =>
          wrapGHResponse({ html_url: 'pr-url', mergeable: true }),
        );

        try {
          const res = await statusRepo(fixtureContext, REPO_NAME);
          expect(res.buildURL).toEqual({ url: 'https://ci.example/pr/42', id: '#42' });
        } finally {
          mocks.ghRepo.listPullRequests.mockReset();
        }
      });
    });

    describe('Git status edge cases', () => {
      it('Should retry git status when both current and tracking are null', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: null, tracking: null }));
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'main', tracking: 'origin/main' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(fixtureContext, REPO_NAME);

        expect(res.status).toEqual({ current: 'main', tracking: 'origin/main', isDefaultBranch: true });
        expect(mocks.sg.status.mock.calls).toEqual([[], []]);
      });

      it('Should display the commit hash when the HEAD is detached', async () => {
        const sha = '0123456789abcdef0123456789abcdef01234567';
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'HEAD', tracking: null }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.raw.mockImplementation(([command]) => (command === 'rev-parse' ? sha + '\n' : ''));

        const res = await statusRepo(fixtureContext, REPO_NAME);

        const shortSha = sha.slice(0, 24);
        expect(res.status).toEqual({
          current: shortSha,
          tracking: null,
          isDefaultBranch: false,
          diff_with_origin_main: { ahead: 0, behind: 0 },
        });
        expect(mocks.sg.raw.mock.calls).toEqual(
          expect.arrayContaining([
            [['rev-parse', 'HEAD']],
            [['rev-list', '--left-right', `origin/main...${shortSha}`]],
          ]),
        );
      });

      it('Should mark the diff as unknown when the branch is not on origin', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.raw.mockImplementation(([command]) => {
          if (command === 'rev-list') {
            throw new Error('fatal: bad revision: unknown revision or path not in the working tree');
          }
          return '';
        });

        const res = await statusRepo(fixtureContext, REPO_NAME);

        expect(res.status.diff_with_origin_main).toEqual({ ahead: 'x', behind: 'x' });
      });
    });

    describe('Submodules', () => {
      const SUBMODULE = `${REPO_NAME}/sub`;
      let submoduleContext;

      beforeEach(() => {
        submoduleContext = createFixtureContext(REPO_NAME);
        submoduleContext.submoduleToParentMap.set(SUBMODULE, REPO_NAME);
        // All repos share the same mocked git object: resolve the parent first so that
        // resolving it later doesn't overwrite the submodule's `repo`.
        submoduleContext.getGitAPI(REPO_NAME);
      });

      afterEach(() => {
        // Restore the shared mocked git object for the other tests.
        mocks.sg.context = fixtureContext;
        mocks.sg.repo = REPO_NAME;
      });

      it('Should report the submodule revision change from the parent repository', async () => {
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.raw.mockImplementation(([command]) =>
          command === 'diff' ? 'diff --git a/sub b/sub\nindex 1111111..2222222 160000\n--- a/sub\n+++ b/sub\n' : '',
        );

        const res = await statusRepo(submoduleContext, SUBMODULE);

        expect(res.status.isSubmodule).toEqual(true);
        expect(res.status.isDefaultBranch).toEqual(false);
        expect(res.status.current).toEqual('1111111..2222222');
        expect(res.status.diff_with_origin_main).toBeUndefined();
        expect(mocks.sg.status.mock.calls).toEqual([]);
        expect(mocks.sg.raw.mock.calls).toEqual(expect.arrayContaining([[['diff', '--submodule=short', '--', 'sub']]]));
      });

      it('Should report an empty revision when the submodule is unchanged', async () => {
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await statusRepo(submoduleContext, SUBMODULE);

        expect(res.status.isSubmodule).toEqual(true);
        expect(res.status.current).toEqual('');
      });

      it('Should add context to the error when the parent diff fails', async () => {
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.raw.mockImplementation(([command]) => {
          if (command === 'diff') {
            throw new Error('boom');
          }
          return '';
        });

        await expect(statusRepo(submoduleContext, SUBMODULE)).rejects.toThrow(
          `Cannot get submodule status for ${SUBMODULE} in ${REPO_NAME}: boom`,
        );
      });
    });

    describe('WIP commit detection', () => {
      [
        { title: 'WIP', expected: true },
        { title: 'WIP on the new feature', expected: true },
        { title: 'Add feature', expected: false },
        { title: 'wip: something', expected: true },
        { title: 'Fix wiping logic', expected: false },
      ].forEach(({ title, expected }) => {
        it(`Should return hasWipCommit=${expected} when the last commit is "${title}"`, async () => {
          mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
          mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
          mocks.sg.raw.mockImplementation(([command]) => (command === 'log' ? title : ''));

          const res = await statusRepo(fixtureContext, REPO_NAME);
          expect(res.hasWipCommit).toEqual(expected);
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
        status: { current: 'foo-branch', isDefaultBranch: false, diff_with_origin_main: expectedDiffWithMaster },
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
