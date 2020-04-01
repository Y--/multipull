const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const mergePullRequestRunnerSpec = require('../../lib/runners/merge-pull-request');
const colors = require('colors/safe');

const fixtureContext = createFixtureContext('repo-01,repo-42,repo-84,repo-10');

const [setWorkingBranch, findPullRequest, abortIfNoPR, mergePullRequest] = mergePullRequestRunnerSpec;

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Merge Pull Request', () => {
    setupHooks();

    beforeEach(() => {
      fixtureContext.workingBranch = null;
      delete fixtureContext.concernedRepos;
    });

    describe('Set working branch', () => {
      const { runner } = setWorkingBranch;

      it('Should log an error if the branch is not defined', async () => {
        await runner(fixtureContext);

        const errMsg = 'You must place yourself on the branch you want to merge or specify it with "--branch"';
        expect(mocks.logger.logError.mock.calls).toEqual([[errMsg]]);
      });

      it('Should set the concernedRepos Array if a working branch is found', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        expect(fixtureContext.concernedRepos).toBeUndefined();

        await runner(fixtureContext);

        expect(mocks.logger.logError.mock.calls).toEqual([]);
        expect(fixtureContext.concernedRepos).toEqual([]);
      });
    });

    describe('Find pull request', () => {
      const { runner } = findPullRequest;

      beforeEach(() => {
        fixtureContext.workingBranch = null;
        fixtureContext.concernedRepos = [];
        fixtureContext.args = {};
      });

      it('Should display the title', () => {
        fixtureContext.workingBranch = 'foo-branch';
        expect(findPullRequest.title(fixtureContext)).toMatch(fixtureContext.workingBranch);
      });

      it('Should not add the repo if it doesnt have the PR', async () => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => ({ data: [] }));

        await runner(fixtureContext, 'repo-84');

        expect(mocks.logger.logError.mock.calls).toEqual([]);
        expect(fixtureContext.concernedRepos).toEqual([]);

        expect(fixtureContext.getRepoContext('repo-84')).toEqual({
          completed: true,
          result: { stash: { all: [], latest: null, total: 0 }, status: { current: 'master' } },
        });

        expectDebugCalls();
      });

      it('Should add the repo if it does have the PR', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => ({ data: [{ html_url: 'pr-url' }] }));

        await runner(fixtureContext, 'repo-84');

        expect(mocks.logger.logError.mock.calls).toEqual([]);
        expect(fixtureContext.concernedRepos).toEqual(['repo-84']);

        expect(fixtureContext.getRepoContext('repo-84')).toEqual({
          completed: false,
          pr: { html_url: 'pr-url' },
          result: { stash: { all: [], latest: null, total: 0 }, status: { current: 'master' }, pr: 'pr-url' },
        });

        expectDebugCalls();
      });

      it('Should be an error to have more than one PR', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => ({ data: [{}, {}] }));

        await expect(runner(fixtureContext, 'repo-84')).rejects.toThrowError(
          /Found 2 pull requests open on 'foo-branch'/
        );

        expect(mocks.logger.logError.mock.calls).toEqual([]);
        expect(fixtureContext.concernedRepos).toEqual([]);

        expect(fixtureContext.getRepoContext('repo-84')).toEqual({
          completed: true,
          result: { stash: { all: [], latest: null, total: 0 }, status: { current: 'master' } },
        });

        expectDebugCalls();
      });

      it('Should complete the process if the dry flag is activated', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.args.dry = true;
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => ({ data: [{ html_url: 'pr-url' }] }));

        await runner(fixtureContext, 'repo-84');

        expect(mocks.logger.logError.mock.calls).toEqual([]);
        expect(fixtureContext.concernedRepos).toEqual(['repo-84']);

        expect(fixtureContext.getRepoContext('repo-84')).toEqual({
          completed: true,
          result: {
            merged: 'Dry',
            pr: 'pr-url',
            stash: { all: [], latest: null, total: 0 },
            status: { current: 'master' },
          },
        });

        expectDebugCalls();
      });
    });

    describe('Interrupt the flow if there is not PR', () => {
      const { runner } = abortIfNoPR;

      beforeEach(() => {
        fixtureContext.concernedRepos = [];
        fixtureContext.interrupted = false;
        fixtureContext.workingBranch = null;
      });

      it('Should stop if there is no PR', () => {
        fixtureContext.workingBranch = 'foo-branch';
        runner(fixtureContext);

        expect(mocks.logger.logInfo.mock.calls).toEqual([['No repository found with PR on branch foo-branch']]);
        expect(mocks.logger.logError.mock.calls).toEqual([]);

        expect(fixtureContext.interrupted).toEqual(true);
      });

      it('Should not stop if there is some PR', () => {
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.concernedRepos = ['repo-84'];
        runner(fixtureContext);

        expect(mocks.logger.logInfo.mock.calls).toEqual([]);
        expect(mocks.logger.logError.mock.calls).toEqual([]);

        expect(fixtureContext.interrupted).toEqual(false);
      });
    });

    describe('Merge the PR', () => {
      const { runner } = mergePullRequest;

      beforeEach(() => {
        fixtureContext.args = {};
        fixtureContext.concernedRepos = [];
        fixtureContext.interrupted = false;
        fixtureContext.workingBranch = null;
        fixtureContext.contextPerRepo = new Map();
      });

      it('Should display the right title in normal mode', () => {
        const repos = ['r1', 'r2'];
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.concernedRepos = repos;
        const title = mergePullRequest.title(fixtureContext);

        const repoTitle = repos.map((r) => colors.bold(r)).join(', ');
        expect(title).toEqual(`Merging PR on ${colors.bold('foo-branch')} in ${repoTitle}`);
      });

      it('Should display the right title in dry mode', () => {
        const repos = ['r1', 'r2'];
        fixtureContext.args.dry = true;
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.concernedRepos = repos;
        const title = mergePullRequest.title(fixtureContext);

        const repoTitle = repos.map((r) => colors.bold(r)).join(', ');
        expect(title).toMatch(`Merging PR on ${colors.bold('foo-branch')} in ${repoTitle}`);
        expect(title).toMatch('DRY MODE');
      });

      it('Should return the status if the process is completed', async () => {
        fixtureContext.setRepoContext('repo-84', { completed: true, result: 'the result' });
        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual('the result');
        expectNoLog();
      });

      it('Should merge the pull request with no error', async () => {
        const head = { sha: 33, label: 'head-label', ref: 'head-ref' };
        fixtureContext.setRepoContext('repo-84', { result: { hello: 'world' }, pr: { number: 42, head } });
        mocks.ghRepo.mergePullRequest.mockImplementationOnce(() => ({ data: { merged: true, message: 'merge done' } }));

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual({ hello: 'world', merged: 'merge done' });

        const expectedMergeArgs = {
          commit_message: '',
          commit_title: 'Merge pull request #42 from head-label/head-ref',
          merge_method: 'merge',
          sha: 33,
        };

        expect(mocks.ghRepo.mergePullRequest.mock.calls).toEqual([[42, expectedMergeArgs]]);
        expectNoLog();
      });

      it('Should merge the pull request with an error', async () => {
        const head = { sha: 33, label: 'head-label', ref: 'head-ref' };
        fixtureContext.setRepoContext('repo-84', { result: { hello: 'world' }, pr: { number: 42, head } });
        mocks.ghRepo.mergePullRequest.mockImplementationOnce(() => ({
          data: { merged: false, message: 'merge failed' },
        }));

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual({ hello: 'world', merged: 'Error: merge failed' });
        const expectedMergeArgs = {
          commit_message: '',
          commit_title: 'Merge pull request #42 from head-label/head-ref',
          merge_method: 'merge',
          sha: 33,
        };

        expect(mocks.ghRepo.mergePullRequest.mock.calls).toEqual([[42, expectedMergeArgs]]);
        expectNoLog();
      });

      // it('Should not stop if there is some PR', () => {
      //   fixtureContext.workingBranch = 'foo-branch';
      //   fixtureContext.concernedRepos = ['repo-84'];
      //   runner(fixtureContext);

      //   expect(mocks.logger.logInfo.mock.calls).toEqual([]);
      //   expect(mocks.logger.logError.mock.calls).toEqual([]);

      //   expect(fixtureContext.interrupted).toEqual(false);
      // });
    });
  });

  function expectNoLog() {
    expect(mocks.logger.logInfo.mock.calls).toEqual([]);
    expect(mocks.logger.logError.mock.calls).toEqual([]);
  }

  function expectDebugCalls() {
    const { calls } = mocks.debug.mock;
    if (testParams.debug) {
      expect(calls).toHaveLength(1);
      expect(calls[0]).toHaveLength(1);
      expect(calls[0][0]).toEqual('Processing repository repo-84...');
    } else {
      expect(calls).toHaveLength(0);
    }
  }
}
