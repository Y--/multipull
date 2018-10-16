const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRequestRunnerSpec = require('../../lib/runners/pull-request');

const fixtureContext = createFixtureContext('repo-01,repo-42,repo-84,repo-10');

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

      it('Should throw an error if the branch is not defined', async () => {
        await expect(runner(fixtureContext)).rejects.toThrowError(/Usage/);
      });

      [{
        title: 'Should look for the current branch and not find anything if it is not a git repository',
        lsRemoteResult: { stderr: 'fatal: No remote configured to list refs from.' }
      }, {
        title: 'Should look not find the branch if git ls-remote does not return the right url (1)',
        lsRemoteResult: { stdout: 'not an url' }
      }, {
        title: 'Should look not find the branch if git ls-remote does not return the right url (2)',
        lsRemoteResult: { stdout: 'not an url/' }
      }, {
        title: 'Should look not find the branch if it is not among the defined repositories',
        lsRemoteResult: { stdout: 'git@github.com:username/reponame' }
      }, {
        title: 'Should look not find the branch if it is not among the defined repositories',
        lsRemoteResult: { stdout: 'git@github.com:username/otherrepo.git' }
      }].forEach((scenario) => {

        it(scenario.title, async () => {
          mocks.utils.exec.mockImplementationOnce(() => scenario.lsRemoteResult);

          await expect(runner(fixtureContext)).rejects.toThrowError(/Usage/);
          expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url']]);
        });
      });

      it('Should look for the current branch and refuse if it is master', async () => {
        mocks.utils.exec
          .mockImplementationOnce(() => ({ stdout: 'git@github.com:username/repo-84.git' }))
          .mockImplementationOnce(() => ({ stdout: 'master' }));

        await expect(runner(fixtureContext)).rejects.toThrowError(/Refusing to create a PR on 'master'/);
        expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url'], ['git rev-parse --abbrev-ref HEAD']]);
      });

      [
        'git@github.com:username/repo-84.git',
        'git@github.com:username/repo-84.git\n',
        'git@github.com:username/repo-84',
        'git@github.com:username/repo-84\n',
      ].forEach((lsRemoteResult) => {
        it(`Should proceed if git ls-remote returns ${lsRemoteResult}`, async () => {
          mocks.utils.exec
            .mockImplementationOnce(() => ({ stdout: lsRemoteResult }))
            .mockImplementationOnce(() => ({ stdout: 'foo-branch' }));

          await runner(fixtureContext);

          expect(mocks.logger.logInfo.mock.calls).toEqual([['Will create pull requests on foo-branch.']]);
          expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url'], ['git rev-parse --abbrev-ref HEAD']]);
        });
      });

      it('Should throw an error if the branch is master', async () => {
        fixtureContext.workingBranch = 'master';
        await expect(runner(fixtureContext)).rejects.toThrowError(/Refusing to create a PR on 'master'/);
      });

      it('Should say that it will processed if the parameters are correct', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        await runner(fixtureContext);
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

      [
        {
          contextParams: {},
          expectHubArgs: '--no-edit' },
        {
          contextParams: { reviewer:  'boss' },
          expectHubArgs: '--no-edit --reviewer=boss'
        },
        {
          contextParams: { reviewers: 'rev1,rev2' },
          expectHubArgs: '--no-edit --reviewer=rev1,rev2',
          expectPickRandom: true
        },
        {
          contextParams: { reviewer:  'boss', reviewers: 'rev1,rev2' },
          expectHubArgs: '--no-edit --reviewer=boss',
        }
      ].forEach(({ expectHubArgs, contextParams, expectPickRandom = false }) => {
        it(`Should call 'hub pull-request '${expectHubArgs}' when provided with ${JSON.stringify(contextParams)}`, async () => {
          const context = createFixtureContext('repo-84');
          Object.assign(context.config, contextParams);
          context.pullRequestRepos = new Set(['repo-84']);

          mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'Done.', stderr: '' }));

          if (contextParams.reviewers) {
            const res = contextParams.reviewers.split(',').slice(0, 2);
            mocks.utils.pickRandom.mockImplementationOnce(() => res);
          }

          const result = await runner(context, 'repo-84');

          const expectedResult = genStatusResult();
          expectedResult.pushed = 'Done.';
          expect(result).toEqual(expectedResult);

          const expectedCwd = context.rootDir + '/repo-84';
          expect(mocks.utils.exec.mock.calls).toEqual([['hub pull-request ' + expectHubArgs, { cwd: expectedCwd }]]);

          if (expectPickRandom) {
            const col = contextParams.reviewers.split(',');
            expect(mocks.utils.pickRandom.mock.calls).toEqual([[col, 2]]);
          } else {
            expect(mocks.utils.pickRandom.mock.calls).toEqual([]);
          }

          expectDebugCalls();
        });
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
