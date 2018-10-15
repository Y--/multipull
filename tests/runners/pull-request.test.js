const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRequestRunnerSpec = require('../../lib/runners/pull-request');

const fixtureContext = createFixtureContext('repo-01,repo-42,repo84,repo-10');

const [validateParameters, checkoutStep, selectRepositories, prCreation] = pullRequestRunnerSpec;

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Pull Request', () => {
    setupHooks();

    beforeEach(() => {
      fixtureContext.workingBranch = null;
      fixtureContext.interrupted = false;
      delete fixtureContext.pullRequestRepos;
    });

    describe('Parameters validation', () => {
      const { runner } = validateParameters;
      it('Should throw an error if the branch is not defined', () => {
        expect(() => runner(fixtureContext)).toThrowError(/Usage/);
      });

      it('Should throw an error if the branch is master', () => {
        fixtureContext.workingBranch = 'master';
        expect(() => runner(fixtureContext)).toThrowError(/Refusing to create a PR on 'master'/);
      });

      it('Should say that it will processed if the parameters are correct', () => {
        fixtureContext.workingBranch = 'foo-branch';
        runner(fixtureContext);
        expect(mocks.logger.logInfo.mock.calls).toEqual([['Will create pull requests on foo-branch.']]);
      });
    });

    describe('Checkout', () => {
      it('The title should indicate the current branch', () => {
        fixtureContext.workingBranch = 'foo-branch';
        const actualTitle = checkoutStep.title(fixtureContext);
        expect(actualTitle).toMatch(/foo-branch/);
      });
    });

    describe('Repository selection', () => {
      const { runner } = selectRepositories;

      it('Should select the repo that have the existing branch', async () => {
        fixtureContext.workingBranch = 'foo-branch';

        mocks.utils.getYNAnswer.mockImplementationOnce(() => true);

        await runner(fixtureContext, [
          genCheckoutResult('repo-01', 'master'),
          genCheckoutResult('repo-42', 'bar-branch'),
          genCheckoutResult('repo-84', 'foo-branch'),
          genCheckoutResult('repo-10', 'foo-branch')
        ]);

        expect(fixtureContext.pullRequestRepos).toEqual(new Set(['repo-10', 'repo-84']));
        expect(fixtureContext.isInterrupted()).toEqual(false);
        expectLogs([]);
      });

      it('Should interrupt the process if there is no matching branch', async () => {
        fixtureContext.workingBranch = 'old-branch';

        await runner(fixtureContext, [genCheckoutResult('repo-84', 'master')]);

        expect(fixtureContext.pullRequestRepos).toBeUndefined();
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expectLogs([['Cannot find any repository with branch \'old-branch\'.']]);
      });

      it('Should interrupt the process if the user refuse the selection', async () => {
        fixtureContext.workingBranch = 'foo-branch';

        mocks.utils.getYNAnswer.mockImplementationOnce(() => false);

        await runner(fixtureContext, [genCheckoutResult('repo-84', 'foo-branch')]);

        expect(fixtureContext.pullRequestRepos).toBeUndefined();
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expectLogs([['Aborted.']]);
      });
    });

    describe('PR creation', () => {
      const { runner } = prCreation;
      beforeEach(() => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'master' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
      });

      it('Should not call `hub pull-request` if the repo is not in pullRequestRepos', async () => {
        fixtureContext.pullRequestRepos = new Set(['foo-repo']);

        const result = await runner(fixtureContext, 'repo-84');
        expect(result).toEqual(genStatusResult());

        expect(mocks.utils.exec.mock.calls).toEqual([]);
      });

      it('Should call `hub pull-request` with the right directory', async () => {
        fixtureContext.pullRequestRepos = new Set(['repo-84']);

        mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'Done.', stderr: '' }));

        const result = await runner(fixtureContext, 'repo-84');

        const expectedResult = genStatusResult();
        expectedResult.pushed = 'Done.';
        expect(result).toEqual(expectedResult);

        const expectedCwd = fixtureContext.rootDir + '/repo-84';
        expect(mocks.utils.exec.mock.calls).toEqual([['hub pull-request --no-edit', { cwd: expectedCwd }]]);

        expectDebugCalls();
      });

      it('Should throw an error if an issue occurs', async () => {
        fixtureContext.pullRequestRepos = new Set(['repo-84']);

        mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'stdout', stderr: 'stderr' }));

        await expect(runner(fixtureContext, 'repo-84')).rejects.toThrowError(/stderr/);

        const expectedCwd = fixtureContext.rootDir + '/repo-84';
        expect(mocks.utils.exec.mock.calls).toEqual([['hub pull-request --no-edit', { cwd: expectedCwd }]]);

        expectDebugCalls();
      });
    });
  });

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

  function genCheckoutResult(repo, current) {
    return { res: { status: { current } }, repo };
  }

  function genStatusResult() {
    return { stash: { all: [], latest: null, total: 0 }, status: { current: 'master' } };
  }

  function expectLogs(logInfoCalls) {
    expect(mocks.logger.logInfo.mock.calls).toEqual(logInfoCalls);
    expect(mocks.logger.logError.mock.calls).toEqual([]);
  }
}
