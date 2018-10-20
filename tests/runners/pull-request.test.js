const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRequestRunnerSpec = require('../../lib/runners/pull-request');
const colors = require('colors/safe');

const fixtureContext = createFixtureContext('repo-01,repo-42,repo-84,repo-10');

const [validateParameters, checkoutStep, selectRepositories, prCreation, prBodyGeneration, prBodyUpdate] = pullRequestRunnerSpec;

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Pull Request', () => {
    setupHooks();

    beforeEach(() => {
      fixtureContext.workingBranch = null;
      fixtureContext.interrupted = false;
      delete fixtureContext.pullRequestsPerRepo;
      delete fixtureContext.pullRequestBody;
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

      const boldBranch = '\u001b[1mfoo-branch\u001b[22m';
      [
        'git@github.com:username/repo-84.git',
        'git@github.com:username/repo-84.git\n',
        'git@github.com:username/repo-84',
        'git@github.com:username/repo-84\n',
      ].forEach((lsRemoteResult) => {
        it(`Should proceed if git ls-remote returns "${lsRemoteResult}"`, async () => {
          expect(fixtureContext.getWorkingBranch()).toEqual('');
          mocks.utils.exec
            .mockImplementationOnce(() => ({ stdout: lsRemoteResult }))
            .mockImplementationOnce(() => ({ stdout: 'foo-branch\n' }));

          await runner(fixtureContext);

          expect(mocks.logger.logInfo.mock.calls).toEqual([[`Will create pull requests on ${boldBranch}.`]]);
          expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url'], ['git rev-parse --abbrev-ref HEAD']]);
          expect(fixtureContext.getWorkingBranch()).toEqual('foo-branch');
        });
      });

      it('Should throw an error if the branch is master', async () => {
        fixtureContext.workingBranch = 'master';
        await expect(runner(fixtureContext)).rejects.toThrowError(/Refusing to create a PR on 'master'/);
      });

      it('Should say that it will processed if the parameters are correct', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        await runner(fixtureContext);
        expect(mocks.logger.logInfo.mock.calls).toEqual([[`Will create pull requests on ${boldBranch}.`]]);
      });
    });

    describe('Find candidates repositories', () => {
      const { runner } = checkoutStep;
      it('The title should indicate the current branch', () => {
        fixtureContext.workingBranch = 'foo-branch';
        const actualTitle = checkoutStep.title(fixtureContext);
        expect(actualTitle).toMatch(/foo-branch/);
      });

      it('Should return true if "git rev-parse --verify" succeed', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'some-hash', stderr: '' }));

        const res = await runner(fixtureContext, 'repo-84');
        expect(res).toEqual(true);

        const expectedCwd = fixtureContext.rootDir + '/repo-84';
        expect(mocks.utils.exec.mock.calls).toEqual([['git rev-parse --verify foo-branch', { cwd: expectedCwd }]]);
      });

      it('Should return false if "git rev-parse --verify" fails', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.utils.exec.mockImplementationOnce(() => { throw new Error(); });

        const res = await runner(fixtureContext, 'repo-84');
        expect(res).toEqual(false);

        const expectedCwd = fixtureContext.rootDir + '/repo-84';
        expect(mocks.utils.exec.mock.calls).toEqual([['git rev-parse --verify foo-branch', { cwd: expectedCwd }]]);
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

        expect(fixtureContext.pullRequestsPerRepo).toEqual(genRepoMap(['repo-10', 'repo-84']));
        expect(fixtureContext.isInterrupted()).toEqual(false);
        expectLogs([]);
      });

      it('Should interrupt the process if there is no matching branch', async () => {
        fixtureContext.workingBranch = 'old-branch';

        await runner(fixtureContext, [genCheckoutResult('repo-84', 'master')]);

        expect(fixtureContext.pullRequestsPerRepo).toBeUndefined();
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expectLogs([['Cannot find any repository with branch \'old-branch\'.']]);
      });

      it('Should interrupt the process if the user refuse the selection', async () => {
        fixtureContext.workingBranch = 'foo-branch';

        mocks.utils.getYNAnswer.mockImplementationOnce(() => false);

        await runner(fixtureContext, [genCheckoutResult('repo-84', 'foo-branch')]);

        expect(fixtureContext.pullRequestsPerRepo).toBeUndefined();
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

      it('Should include the repos in the title', () => {
        fixtureContext.pullRequestsPerRepo = genRepoMap(['repo-84']);
        const title = prCreation.title(fixtureContext);
        expect(title).toEqual(`Creating PR in '${colors.bold('repo-84')}'`);
      });

      it('Should not call `hub pull-request` if the repo is not in pullRequestsPerRepo', async () => {
        fixtureContext.pullRequestsPerRepo = genRepoMap(['foo-repo']);

        await runner(fixtureContext, 'repo-84');

        expect(fixtureContext.pullRequestsPerRepo).toEqual(genRepoMap(['foo-repo']));
        expect(mocks.utils.exec.mock.calls).toEqual([]);
      });

      [
        {
          contextParams: {},
          expectHubArgs: '--message="PR on `foo-branch` for `repo-84`"' },
        {
          contextParams: { reviewer:  'boss' },
          expectHubArgs: '--message="PR on `foo-branch` for `repo-84`" --reviewer=boss'
        },
        {
          contextParams: { reviewers: 'rev1,rev2' },
          expectHubArgs: '--message="PR on `foo-branch` for `repo-84`" --reviewer=rev1,rev2',
          expectPickRandom: true
        },
        {
          contextParams: { reviewer:  'boss', reviewers: 'rev1,rev2' },
          expectHubArgs: '--message="PR on `foo-branch` for `repo-84`" --reviewer=boss',
        }
      ].forEach(({ expectHubArgs, contextParams, expectPickRandom = false }) => {
        it(`Should call 'hub pull-request '${expectHubArgs}' when provided with ${JSON.stringify(contextParams)}`, async () => {
          const context = createFixtureContext('repo-84');
          Object.assign(context.config, contextParams);
          context.pullRequestsPerRepo = genRepoMap(['repo-84']);
          context.workingBranch = 'foo-branch';

          mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'Done.', stderr: '' }));

          if (contextParams.reviewers) {
            const res = contextParams.reviewers.split(',').slice(0, 2);
            mocks.utils.pickRandom.mockImplementationOnce(() => res);
          }

          await runner(context, 'repo-84');

          expect(context.pullRequestsPerRepo).toEqual(new Map([['repo-84', 'Done.']]));

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
        fixtureContext.pullRequestsPerRepo = new Set(['repo-84']);
        fixtureContext.workingBranch = 'foo-branch';

        mocks.utils.exec.mockImplementationOnce(() => ({ stdout: 'stdout', stderr: 'stderr' }));

        await expect(runner(fixtureContext, 'repo-84')).rejects.toThrowError(/stderr/);

        const expectedCwd = fixtureContext.rootDir + '/repo-84';
        const expectedCmd = 'hub pull-request --message="PR on `foo-branch` for `repo-84`"';
        expect(mocks.utils.exec.mock.calls).toEqual([[expectedCmd, { cwd: expectedCwd }]]);

        expectDebugCalls();
      });
    });

    describe('PR body generation', () => {
      [{
        pullRequestsPerRepo: new Map(),
        expectedPullRequestBody: undefined
      }, {
        pullRequestsPerRepo: new Map([['foo-repo', 'foo-pr-url']]),
        expectedPullRequestBody: 'Pull Request on 1 repository:\n* `foo-repo` : [foo-pr-url](foo-pr-url)'
      }, {
        pullRequestsPerRepo: new Map([['repo1', 'pr-url-1'], ['repo2', 'pr-url-2']]),
        expectedPullRequestBody: 'Pull Request on 2 repositories:\n* `repo1` : [pr-url-1](pr-url-1)\n* `repo2` : [pr-url-2](pr-url-2)'
      }].forEach((scenario) => {

        const pullRequestsPerRepoStr = JSON.stringify(Array.from(scenario.pullRequestsPerRepo));
        const expected = scenario.expectedPullRequestBody
          ? scenario.expectedPullRequestBody.replace(/\n/g, '\\n')
          : scenario.expectedPullRequestBody;
        it(`Should generate '${expected}' if repo list is ${pullRequestsPerRepoStr}`, () => {
          fixtureContext.pullRequestsPerRepo = scenario.pullRequestsPerRepo;
          prBodyGeneration.runner(fixtureContext);
          expect(fixtureContext.pullRequestBody).toEqual(scenario.expectedPullRequestBody);
        });
      });
    });

    describe('PR body update', () => {
      it('Should not update the PR body if the repo is not in the list', async () => {
        fixtureContext.pullRequestsPerRepo = new Map();

        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');
        expect(result).toEqual(genStatusResult());

        expect(mocks.sg.listRemote.mock.calls).toEqual([]);
      });

      it('Should update the PR body if the repo is in the list', async () => {
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', 'repo-pr-url/123']]);
        fixtureContext.pullRequestBody = 'updated body';
        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult('repo-pr-url/123'));
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([['123', {body: fixtureContext.pullRequestBody}]]);
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

  function genRepoMap(repos) {
    return new Map(repos.map(r => [r, null]));
  }

  function genCheckoutResult(repo, current) {
    return { res: current === 'foo-branch', repo };
  }

  function genStatusResult(pushed) {
    const r = { stash: { all: [], latest: null, total: 0 }, status: { current: 'master' } };
    if (pushed) {
      r.pushed = pushed;
    }
    return r;
  }

  function expectLogs(logInfoCalls) {
    expect(mocks.logger.logInfo.mock.calls).toEqual(logInfoCalls);
    expect(mocks.logger.logError.mock.calls).toEqual([]);
  }
}
