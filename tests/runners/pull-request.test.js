const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRequestRunnerSpec = require('../../lib/runners/pull-request');
const colors = require('colors/safe');

const [
  validateParameters,
  checkoutStep,
  selectRepositories,
  prCreation,
  prBodyGeneration,
  prBodyUpdate,
] = pullRequestRunnerSpec;

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Pull Request', () => {
    setupHooks();

    let fixtureContext = null;
    beforeEach(() => {
      fixtureContext = createFixtureContext('repo-01,repo-42,repo-84,repo-10');
    });

    describe('Parameters validation', () => {
      const { runner } = validateParameters;

      it('Should throw an error if the branch is not defined', async () => {
        await expect(runner(fixtureContext)).rejects.toThrowError(/Usage/);
      });

      [
        {
          title: 'Should look for the current branch and not find anything if it is not a git repository',
          lsRemoteResult: { stderr: 'fatal: No remote configured to list refs from.' },
        },
        {
          title: 'Should look not find the branch if git ls-remote does not return the right url (1)',
          lsRemoteResult: { stdout: 'not an url' },
        },
        {
          title: 'Should look not find the branch if git ls-remote does not return the right url (2)',
          lsRemoteResult: { stdout: 'not an url/' },
        },
        {
          title: 'Should look not find the branch if it is not among the defined repositories',
          lsRemoteResult: { stdout: 'git@github.com:username/reponame' },
        },
        {
          title: 'Should look not find the branch if it is not among the defined repositories',
          lsRemoteResult: { stdout: 'git@github.com:username/otherrepo.git' },
        },
      ].forEach((scenario) => {
        it(scenario.title, async () => {
          mocks.utils.exec.mockImplementationOnce(() => scenario.lsRemoteResult);

          await expect(runner(fixtureContext)).rejects.toThrowError(/Usage/);
          expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url']]);
        });
      });

      it('Should look for the current branch and refuse if it is main', async () => {
        mocks.utils.exec
          .mockImplementationOnce(() => ({ stdout: 'git@github.com:username/repo-84.git' }))
          .mockImplementationOnce(() => ({ stdout: 'main' }));

        await expect(runner(fixtureContext)).rejects.toThrowError(/Refusing to create a PR on 'main'/);
        expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url'], ['git rev-parse --abbrev-ref HEAD']]);
      });

      const boldBranch = '\u001b[1mfoo-branch\u001b[22m';
      [
        'git@github.com:username/repo-84.git',
        'git@github.com:username/repo-84.git\n',
        'git@github.com:username/repo-84',
        'git@github.com:username/repo-84\n',
        'https://github.com/username/repo-84.git',
        'https://github.com/username/repo-84.git\n',
        'https://github.com/username/repo-84',
        'https://github.com/username/repo-84\n',
      ].forEach((lsRemoteResult) => {
        it(`Should proceed if git ls-remote returns "${lsRemoteResult}"`, async () => {
          expect(fixtureContext.getWorkingBranch()).toEqual(null);
          mocks.utils.exec
            .mockImplementationOnce(() => ({ stdout: lsRemoteResult }))
            .mockImplementationOnce(() => ({ stdout: 'foo-branch\n' }));

          await runner(fixtureContext);

          expect(mocks.logger.logInfo.mock.calls).toEqual([[`Will work with pull requests on ${boldBranch}.`]]);
          expect(mocks.utils.exec.mock.calls).toEqual([
            ['git ls-remote --get-url'],
            ['git rev-parse --abbrev-ref HEAD'],
          ]);
          expect(fixtureContext.getWorkingBranch()).toEqual('foo-branch');
        });
      });

      it('Should throw an error if the branch is main', async () => {
        fixtureContext.workingBranch = 'main';
        await expect(runner(fixtureContext)).rejects.toThrowError(/Refusing to create a PR on 'main'/);
      });

      it('Should say that it will processed if the parameters are correct', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        await runner(fixtureContext);
        expect(mocks.logger.logInfo.mock.calls).toEqual([[`Will work with pull requests on ${boldBranch}.`]]);
      });
    });

    describe('Find candidates repositories', () => {
      const { runner } = checkoutStep;
      it('The title should indicate the current branch', () => {
        fixtureContext.workingBranch = 'foo-branch';
        const actualTitle = checkoutStep.title(fixtureContext);
        expect(actualTitle).toMatch(/foo-branch/);
      });

      it('Should return `branch: false` if "git rev-parse --verify" fails', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.sg.revparse.mockImplementationOnce(() => {
          throw new Error();
        });

        const res = await runner(fixtureContext, 'repo-84');
        expect(res).toEqual({ branch: false });

        expect(mocks.sg.revparse.mock.calls).toEqual([[['--verify', 'foo-branch']]]);
      });

      it('Should return `branch: true` and `pr: null` if no PR is found', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.sg.revparse.mockImplementationOnce(() => 'some-hash');
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => wrapGHResponse([]));

        const res = await runner(fixtureContext, 'repo-84');
        expect(res).toEqual({ branch: true, pr: null });

        expect(mocks.sg.revparse.mock.calls).toEqual([[['--verify', 'foo-branch']]]);
        expect(mocks.sg.listRemote.mock.calls).toEqual([[['--get-url']]]);
        expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([
          [
            {
              AcceptHeader: 'shadow-cat-preview',
              head: 'foo-owner:foo-branch',
              state: 'open',
            },
          ],
        ]);
      });

      it('Should return `branch: true` and the pr with reviews if it is found', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        mocks.sg.revparse.mockImplementationOnce(() => 'some-hash');
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => wrapGHResponse([{ number: 42 }]));
        mocks.ghRepo.getReviews.mockImplementationOnce(() => wrapGHResponse([{ review: 'fake' }]));

        const res = await runner(fixtureContext, 'repo-84');
        expect(res).toEqual({ branch: true, pr: { number: 42, reviews: [{ review: 'fake' }] } });

        expect(mocks.sg.revparse.mock.calls).toEqual([[['--verify', 'foo-branch']]]);
        expect(mocks.sg.listRemote.mock.calls).toEqual([[['--get-url']]]);
        expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([
          [
            {
              AcceptHeader: 'shadow-cat-preview',
              head: 'foo-owner:foo-branch',
              state: 'open',
            },
          ],
        ]);
        expect(mocks.ghRepo.getReviews.mock.calls).toEqual([[42]]);
      });

      it('Should approve PR if `--approve` is set and PR is found', async () => {
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.config.approve = true;
        mocks.sg.revparse.mockImplementationOnce(() => 'some-hash');
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.sg.raw.mockReturnValue('');
        mocks.ghRepo.listPullRequests.mockImplementationOnce(() => wrapGHResponse([{ number: 42 }]));
        mocks.ghRepo.approveReviewRequest.mockImplementationOnce(() => wrapGHResponse([{ review: 'fake' }]));
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'foo-branch' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));

        const res = await runner(fixtureContext, 'repo-84');
        expect(res.approved).toEqual(true);
        expect(fixtureContext.interrupted).toEqual(true);

        expect(mocks.sg.revparse.mock.calls).toEqual([[['--verify', 'foo-branch']]]);
        expect(mocks.sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']], [['rev-list', '--left-right', 'origin/main...foo-branch']]]);
        expect(mocks.sg.listRemote.mock.calls).toEqual([[['--get-url']]]);
        expect(mocks.ghRepo.listPullRequests.mock.calls).toEqual([
          [
            {
              AcceptHeader: 'shadow-cat-preview',
              head: 'foo-owner:foo-branch',
              state: 'open',
            },
          ],
        ]);
        expect(mocks.ghRepo.approveReviewRequest.mock.calls).toEqual([[42]]);
      });
    });

    describe.skip('Repository & reviewers selection', () => {
      const { runner } = selectRepositories;

      it('Should select the repo that have the existing branch', async () => {
        fixtureContext.workingBranch = 'foo-branch';

        mocks.utils.getYNAnswer.mockImplementationOnce(() => true);

        await runner(fixtureContext, [
          genCheckoutResult('repo-01', 'main'),
          genCheckoutResult('repo-42', 'bar-branch'),
          genCheckoutResult('repo-84', 'foo-branch'),
          genCheckoutResult('repo-10', 'foo-branch'),
        ]);

        expect(fixtureContext.pullRequestsPerRepo).toEqual(genRepoMap(['repo-10', 'repo-84']));
        expect(fixtureContext.isInterrupted()).toEqual(false);
        expectLogs([]);
      });

      it('Should interrupt the process if there is no matching branch', async () => {
        fixtureContext.workingBranch = 'old-branch';

        await runner(fixtureContext, [genCheckoutResult('repo-84', 'main')]);

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

      it('Should create a draft PR if --draft flag is used', async () => {
        const context = createFixtureContext('repo-84');
        context.config.draft = true;
        context.workingBranch = 'foo-branch';

        mocks.utils.getYNAnswer.mockImplementationOnce(() => true);

        await runner(context, [genCheckoutResult('repo-84', 'foo-branch')]);

        expect(context.pullRequestsPerRepo).toEqual(genRepoMap(['repo-84']));
        expect(context.isInterrupted()).toEqual(false);
        expect(context.pullRequestsParams).toEqual({
          AcceptHeader: 'shadow-cat-preview',
          base: 'main',
          body: '',
          draft: true,
          head: 'foo-branch',
          title: 'PR from `foo-branch` in `repo-84`',
        });
        expectLogs([]);
      });

      [
        { contextParams: {}, expectedReviewers: null },
        { contextParams: { reviewers: '' }, expectedReviewers: null },
        { contextParams: { reviewers: 'boss' }, expectedReviewers: ['boss'] },
        { contextParams: { reviewers: 'reviewer1,reviewer2' }, expectedReviewers: ['reviewer1', 'reviewer2'] },
        { contextParams: { collaborators: 'rev1' }, expectedReviewers: ['rev1'] },
        { contextParams: { collaborators: 'rev1,rev2' }, expectedReviewers: ['rev1', 'rev2'] },
        {
          contextParams: { collaborators: 'rev1,rev2,rev3' },
          expectedReviewers: ['rev1', 'rev2'],
          expectPickRandom: true,
        },
        { contextParams: { reviewers: 'boss', collaborators: 'rev1,rev2' }, expectedReviewers: ['boss'] },
      ].forEach(({ contextParams, expectedReviewers, expectPickRandom }) => {
        const expectedMessage = 'PR from `foo-branch` in `repo-84`';
        const prDesc = `title:${expectedMessage}, reviewers:${expectedReviewers}`;
        it(`Should create a PR with ${prDesc} when provided with ${JSON.stringify(contextParams)}`, async () => {
          const context = createFixtureContext('repo-84');
          Object.assign(context.config, contextParams);
          context.workingBranch = 'foo-branch';

          mocks.utils.getYNAnswer.mockImplementationOnce(() => true);
          if (expectPickRandom) {
            const res = contextParams.collaborators.split(',').slice(0, 2);
            mocks.utils.pickRandom.mockImplementationOnce(() => res);
          }

          await runner(context, [genCheckoutResult('repo-84', 'foo-branch')]);

          expect(context.pullRequestsPerRepo).toEqual(genRepoMap(['repo-84']));
          expect(context.reviewers).toEqual(expectedReviewers);
          expect(context.pullRequestsParams.title).toEqual(expectedMessage);

          if (expectPickRandom) {
            const col = contextParams.collaborators.split(',');
            expect(mocks.utils.pickRandom.mock.calls).toEqual([[col, 2]]);
          } else {
            expect(mocks.utils.pickRandom.mock.calls).toEqual([]);
          }
        });
      });
    });

    describe.skip('PR creation', () => {
      const { runner } = prCreation;
      beforeEach(() => {
        mocks.sg.status.mockImplementationOnce(() => ({ current: 'main' }));
        mocks.sg.stashList.mockImplementationOnce(() => ({ all: [], latest: null, total: 0 }));
      });

      it('Should include the repos in the title', () => {
        fixtureContext.pullRequestsPerRepo = genRepoMap(['repo-84']);
        const title = prCreation.title(fixtureContext);
        expect(title).toEqual(`Creating PR in '${colors.bold('repo-84')}'`);
      });

      it('Should not create a PR if the repo is not in pullRequestsPerRepo', async () => {
        fixtureContext.pullRequestsPerRepo = genRepoMap(['foo-repo']);

        await runner(fixtureContext, 'repo-84');

        expect(fixtureContext.pullRequestsPerRepo).toEqual(genRepoMap(['foo-repo']));
        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);
      });

      it('Should create a PR with no reviewer', async () => {
        const context = createFixtureContext('repo-84');
        context.reviewers = null;
        context.pullRequestsPerRepo = genRepoMap(['repo-84']);
        context.pullRequestsParams = { base: 'main', body: '', head: 'foo-branch' };
        context.workingBranch = 'foo-branch';

        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.createPullRequest.mockImplementationOnce(() => ({ data: { html_url: 'pr-url', number: 42 } }));

        await runner(context, 'repo-84');

        expect(context.pullRequestsPerRepo).toEqual(new Map([['repo-84', { html_url: 'pr-url', number: 42 }]]));

        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([[context.pullRequestsParams]]);

        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);

        expectDebugCalls();
      });

      it('Should send a clond', async () => {
        const context = createFixtureContext('repo-84');
        const prParams = { base: 'main', body: '', head: 'foo-branch', AcceptHeader: 'foo' };
        context.pullRequestsPerRepo = genRepoMap(['repo-84']);
        context.pullRequestsParams = clone(prParams);
        context.workingBranch = 'foo-branch';

        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');

        let createPullRequestParams = null;
        mocks.ghRepo.createPullRequest.mockImplementationOnce((params) => {
          createPullRequestParams = clone(params);
          delete params.AcceptHeader;
          return { data: { html_url: 'pr-url', number: 42 } };
        });

        await runner(context, 'repo-84');

        expect(context.pullRequestsPerRepo).toEqual(new Map([['repo-84', { html_url: 'pr-url', number: 42 }]]));

        expect(createPullRequestParams).toEqual(prParams);

        expect(context.pullRequestsParams.AcceptHeader).toEqual('foo');
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);

        expectDebugCalls();
      });

      it('Should not fail the PR creation if we cannot add the reviewers', async () => {
        const context = createFixtureContext('repo-84');
        const expectedReviewers = ['rev1', 'rev2'];
        context.reviewers = expectedReviewers;
        context.pullRequestsPerRepo = genRepoMap(['repo-84']);
        context.pullRequestsParams = {
          base: 'main',
          body: '',
          head: 'foo-branch',
          title: 'PR on `foo-branch` for `repo-84`',
        };
        context.workingBranch = 'foo-branch';

        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        mocks.ghRepo.createPullRequest.mockImplementationOnce(() => ({ data: { html_url: 'pr-url', number: 42 } }));
        mocks.ghRepo.createReviewRequest.mockImplementationOnce(() => {
          throw new Error('Fail');
        });

        await runner(context, 'repo-84');

        expect(context.pullRequestsPerRepo).toEqual(
          new Map([['repo-84', { html_url: 'pr-url', number: 42, errors: [new Error('Fail')] }]])
        );

        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([[context.pullRequestsParams]]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([[42, { reviewers: expectedReviewers }]]);

        expectDebugCalls();
      });
    });

    describe.skip('PR body generation', () => {
      [
        {
          pullRequestsPerRepo: new Map(),
          expectedPullRequestBody: undefined,
        },
        {
          pullRequestsPerRepo: genRepoMapWithValues(['foo-repo']),
          expectedPullRequestBody: 'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)',
        },
        {
          pullRequestsPerRepo: genRepoMapWithValues(['repo1', 'repo2']),
          expectedPullRequestBody:
            'Pull request in 2 repositories:\n* `repo1` : [repo1-pr-url](repo1-pr-url)\n* `repo2` : [repo2-pr-url](repo2-pr-url)',
        },
        {
          pullRequestsPerRepo: genRepoMapWithValues(['foo-repo']),
          workingBranch: 'foo-bar-123456789',
          expectedPullRequestBody:
            'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)\n\n\nRelated issue: https://www.pivotaltracker.com/story/show/123456789',
        },
      ].forEach((scenario) => {
        const pullRequestsPerRepoStr = JSON.stringify(Array.from(scenario.pullRequestsPerRepo));
        const expected = scenario.expectedPullRequestBody
          ? scenario.expectedPullRequestBody.replace(/\n/g, '\\n')
          : scenario.expectedPullRequestBody;
        it(`Should generate '${expected}' if repo list is ${pullRequestsPerRepoStr}`, async () => {
          if (scenario.workingBranch) {
            fixtureContext.workingBranch = scenario.workingBranch;
          }
          Object.assign(fixtureContext.config, scenario.config);

          fixtureContext.pullRequestsPerRepo = scenario.pullRequestsPerRepo;
          await prBodyGeneration.runner(fixtureContext);

          const body = fixtureContext.pullRequestsFinalDescription && fixtureContext.pullRequestsFinalDescription.body;
          expect(body).toEqual(scenario.expectedPullRequestBody);
        });
      });

      [
        {
          title: 'with both a title and a body',
          editedResult: { title: 'Edited title', body: 'Edited Body' },
        },
        {
          title: 'with only a title',
          editedResult: { title: 'Edited title' },
        },
        {
          title: 'with only a body',
          editedResult: { body: 'Edited body' },
        },
        {
          title: 'with nothing',
          editedResult: {},
        },
      ].forEach((scenario) => {
        it('Should allow to edit the content of the PR title and desciption - ' + scenario.title, async () => {
          const context = createFixtureContext('repo-84');
          context.config.m = true;
          context.pullRequestsPerRepo = genRepoMapWithValues(['foo-repo']);
          context.pullRequestsParams = { title: 'Original title' };

          const expectedDescription = clone(scenario.editedResult);
          mocks.editor.editPRDescription.mockImplementationOnce(() => scenario.editedResult);
          await prBodyGeneration.runner(context);

          expect(mocks.editor.editPRDescription.mock.calls).toEqual([
            [
              {
                body: 'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)',
                title: 'Original title',
              },
            ],
          ]);
          expect(context.pullRequestsFinalDescription).toEqual(expectedDescription);
        });
      });
    });

    describe.skip('PR body update', () => {
      it('Should not update the PR body if the repo is not in the list', async () => {
        fixtureContext.pullRequestsPerRepo = new Map();

        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');
        expect(result).toEqual(genStatusResult());

        expect(mocks.sg.listRemote.mock.calls).toEqual([]);
      });

      it('Should update the PR body if the repo is in the list', async () => {
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', { html_url: 'repo-pr-url/123', number: 123 }]]);
        fixtureContext.pullRequestsFinalDescription = { body: 'updated body' };
        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult('repo-pr-url/123'));
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([[123, fixtureContext.pullRequestsFinalDescription]]);
      });

      it('Should add the error if it finds one', async () => {
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        fixtureContext.pullRequestsPerRepo = new Map([
          ['repo-84', { html_url: 'repo-pr-url/123', number: 123, errors: ['foo'] }],
        ]);
        fixtureContext.pullRequestsFinalDescription = { body: 'updated body' };
        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');

        const expectedResult = genStatusResult('repo-pr-url/123');
        expectedResult.errors = ['foo'];
        expect(result).toEqual(expectedResult);
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([[123, fixtureContext.pullRequestsFinalDescription]]);
      });

      it('Should not update the PR body if the title and body is empty', async () => {
        mocks.sg.listRemote.mockImplementationOnce(() => 'git@github.com:foo-owner/repo-84.git');
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', { html_url: 'repo-pr-url/123', number: 123 }]]);
        fixtureContext.pullRequestsFinalDescription = {};

        const result = await prBodyUpdate.runner(fixtureContext, 'repo-84');
        expect(result).toEqual(genStatusResult('repo-pr-url/123'));

        expect(mocks.sg.listRemote.mock.calls).toEqual([]);
      });
    });
  });

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
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

  function genRepoMap(repos) {
    return new Map(repos.map((r) => [r, null]));
  }

  function genRepoMapWithValues(repos) {
    return new Map(repos.map((r) => [r, { html_url: r + '-pr-url', number: 42 }]));
  }

  function genCheckoutResult(repo, current) {
    return { res: current === 'foo-branch', repo };
  }

  function genStatusResult(pr) {
    const r = { stash: { all: [], latest: null, total: 0 }, status: { current: 'main' } };
    if (pr) {
      r.pr = pr;
    }
    return r;
  }

  function expectLogs(logInfoCalls) {
    expect(mocks.logger.logInfo.mock.calls).toEqual(logInfoCalls);
    expect(mocks.logger.logError.mock.calls).toEqual([]);
  }

  function wrapGHResponse(data) {
    return { data };
  }
}
