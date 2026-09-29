const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRequestRunnerSpec = require('../../lib/runners/pull-request');
const colors = require('colors/safe');

const [validateParameters, checkoutStep, selectRepositories, prCreation, prBodyGeneration, prBodyUpdate] =
  pullRequestRunnerSpec;

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks) {
  describe('Pull Request', () => {
    setupHooks();

    let fixtureContext = null;
    beforeEach(() => {
      fixtureContext = createFixtureContext('repo-01,repo-42,repo-84,repo-10');
      mocks.utils.exec.mockResolvedValue({ stdout: '' });
    });

    describe('Parameters validation', () => {
      const { runner } = validateParameters;

      it('Should throw an error if the branch is not defined', async () => {
        await expect(runner(fixtureContext)).rejects.toThrow(/Usage/);
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

          await expect(runner(fixtureContext)).rejects.toThrow(/Usage/);
          expect(mocks.utils.exec.mock.calls).toEqual([['git ls-remote --get-url']]);
        });
      });

      it('Should look for the current branch and refuse if it is main', async () => {
        mocks.utils.exec
          .mockImplementationOnce(() => ({ stdout: 'git@github.com:username/repo-84.git' }))
          .mockImplementationOnce(() => ({ stdout: 'main' }));

        await expect(runner(fixtureContext)).rejects.toThrow(/Refusing to create a PR on 'main'/);
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
        await expect(runner(fixtureContext)).rejects.toThrow(/Refusing to create a PR on 'main'/);
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
        expect(mocks.sg.raw.mock.calls).toEqual([
          [['log', '--pretty=format:%s', '-1']],
          [['rev-list', '--left-right', 'origin/main...foo-branch']],
        ]);
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

    describe('Repository & reviewers selection', () => {
      const { runner } = selectRepositories;
      const b = (str) => colors.bold(str);

      beforeEach(() => {
        fixtureContext.workingBranch = 'foo-branch';
      });

      it('Should interrupt the process if there is no matching branch', async () => {
        await runner(fixtureContext, [
          genScanResult('repo-01', { branch: false }),
          genScanResult('repo-84', { branch: false }),
        ]);

        expect(fixtureContext.pullRequestsPerRepo).toBeUndefined();
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([]);
        expectLogs([["Cannot find any repository with branch 'foo-branch'."]]);
      });

      it('Should interrupt the process if the user refuses the actions', async () => {
        mocks.utils.getYNAnswer.mockResolvedValueOnce(false);

        await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr: null })]);

        expect(fixtureContext.pullRequestsPerRepo).toBeUndefined();
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expectLogs([['Aborted.']]);
      });

      it('Should create draft PRs by default in the repos that have the branch but no PR', async () => {
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);

        await runner(fixtureContext, [
          genScanResult('repo-01', { branch: false }),
          genScanResult('repo-84', { branch: true, pr: null }),
          genScanResult('repo-10', { branch: true, pr: null }),
        ]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [
            `Do you want to create a ${b('draft')} PR with ${b('no reviewer')} in 2 repositories ${b('repo-84')}, ${b(
              'repo-10',
            )}`,
          ],
        ]);
        expect(fixtureContext.actions).toEqual({
          creations: { draft: true, repos: ['repo-84', 'repo-10'], reviewers: undefined },
        });
        expect(fixtureContext.pullRequestsPerRepo).toEqual(
          new Map([
            ['repo-84', {}],
            ['repo-10', {}],
          ]),
        );
        expect(fixtureContext.defaultTitle).toEqual('PR from `foo-branch` in `repo-84`, `repo-10`');
        expect(fixtureContext.isInterrupted()).toEqual(false);
        expectLogs([]);
      });

      [
        { config: {}, draft: { reviewers: undefined }, ready: { reviewers: undefined } },
        { config: { reviewers: 'boss' }, draft: { reviewers: ['boss'] }, ready: { reviewers: ['boss'] } },
        {
          config: { reviewers: 'rev1,rev2' },
          draft: { reviewers: ['rev1', 'rev2'] },
          ready: { reviewers: ['rev1', 'rev2'] },
        },
        { config: { reviewers: 'rev1,,rev2' }, ready: { reviewers: ['rev1', 'rev2'] } },
        { config: { reviewers: '' }, ready: { reviewers: undefined } },
        { config: { collaborators: 'rev1' }, draft: { reviewers: ['rev1'] }, ready: { reviewers: ['rev1'] } },
        {
          config: { collaborators: 'rev1,rev2' },
          draft: { reviewers: ['rev1', 'rev2'] },
          ready: { reviewers: ['rev1', 'rev2'] },
        },
        {
          config: { collaborators: 'rev1,rev2,rev3' },
          draft: { reviewers: undefined },
          ready: { reviewers: ['rev3', 'rev1'], pickRandom: true },
        },
        {
          config: { reviewers: 'boss', collaborators: 'rev1,rev2,rev3' },
          draft: { reviewers: ['boss'] },
          ready: { reviewers: ['boss'] },
        },
      ].forEach(({ config, draft, ready }) => {
        for (const [mode, expected] of [
          ['draft', draft],
          ['ready', ready],
        ]) {
          if (!expected) {
            continue;
          }

          it(`Should create a ${mode} PR with reviewers ${expected.reviewers} when config is ${JSON.stringify(config)}`, async () => {
            Object.assign(fixtureContext.config, config, { ready: mode === 'ready' });
            mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
            if (expected.pickRandom) {
              mocks.utils.pickRandom.mockReturnValueOnce(expected.reviewers);
            }

            await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr: null })]);

            expect(fixtureContext.actions.creations).toEqual({
              draft: mode === 'draft',
              repos: ['repo-84'],
              reviewers: expected.reviewers,
            });

            const whatStr = mode === 'draft' ? `a ${b('draft')} PR` : `a PR ${b('ready for review')}`;
            const reviewersStr = expected.reviewers
              ? expected.reviewers.map(b).join(', ') + ' as reviewer' + (expected.reviewers.length > 1 ? 's' : '')
              : b('no reviewer');
            expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
              [`Do you want to create ${whatStr} with ${reviewersStr} in ${b('repo-84')}`],
            ]);

            const expectedPickRandomCalls = expected.pickRandom ? [[config.collaborators.split(','), 2]] : [];
            expect(mocks.utils.pickRandom.mock.calls).toEqual(expectedPickRandomCalls);
          });
        }
      });

      it('Should not set any reviewer on a draft PR when --reviewers is empty', async () => {
        fixtureContext.config.reviewers = '';
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);

        await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr: null })]);

        expect(fixtureContext.actions.creations.reviewers).toBeFalsy();
      });

      it('Should do nothing if the existing PRs already have reviews and no update is requested', async () => {
        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr: genPR({ reviews: [{ state: 'APPROVED' }] }) }),
          genScanResult('repo-10', { branch: true, pr: genPR({ requested_reviewers: [{ login: 'rev1' }] }) }),
        ]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([]);
        expect(fixtureContext.isInterrupted()).toEqual(true);
        expectLogs([['Nothing to do, bye!']]);
      });

      it('Should add reviewers to existing PRs that have none', async () => {
        fixtureContext.config.collaborators = 'rev1,rev2';
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
        const pr84 = genPR({ html_url: 'url-84' });
        const pr10 = genPR({ html_url: 'url-10' });

        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr: pr84 }),
          genScanResult('repo-10', { branch: true, pr: pr10 }),
        ]);

        expect(fixtureContext.actions.creations).toBeNull();
        expect(fixtureContext.actions.updatesPerRepo).toEqual(
          new Map([
            ['repo-84', { repo: 'repo-84', pr: pr84, updateDescription: false, reviewers: ['rev1', 'rev2'] }],
            ['repo-10', { repo: 'repo-10', pr: pr10, updateDescription: false, reviewers: ['rev1', 'rev2'] }],
          ]),
        );
        expect(fixtureContext.pullRequestsPerRepo).toEqual(
          new Map([
            ['repo-84', pr84],
            ['repo-10', pr10],
          ]),
        );
        expect(fixtureContext.isInterrupted()).toEqual(false);
      });

      it('Should group identical updates in the question', async () => {
        fixtureContext.config.collaborators = 'rev1,rev2';
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);

        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr: genPR() }),
          genScanResult('repo-10', { branch: true, pr: genPR() }),
        ]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [
            `Do you want to set ${b('rev1')}, ${b('rev2')} as reviewers in 2 repositories ${b('repo-84')}, ${b('repo-10')}`,
          ],
        ]);
      });

      it('Should mark draft PRs ready for review and add reviewers', async () => {
        fixtureContext.config.reviewers = 'boss';
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
        const pr = genPR({ draft: true });

        await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr })]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [`Do you want to mark PRs ${b('ready for review')} in ${b('repo-84')} and add ${b('boss')} as reviewer`],
        ]);
        expect(fixtureContext.actions.updatesPerRepo.get('repo-84')).toEqual({
          repo: 'repo-84',
          pr,
          updateDescription: false,
          transitionFromDraftToReady: true,
          reviewers: ['boss'],
        });
      });

      it('Should keep draft PRs as draft with --draft and only set the forced reviewers', async () => {
        Object.assign(fixtureContext.config, { draft: true, reviewers: 'boss' });
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
        const pr = genPR({ draft: true });

        await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr })]);

        expect(fixtureContext.actions.updatesPerRepo.get('repo-84')).toEqual({
          repo: 'repo-84',
          pr,
          updateDescription: false,
          reviewers: ['boss'],
        });
      });

      it('Should update the PR description with --update', async () => {
        fixtureContext.config.update = true;
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
        const pr = genPR({ reviews: [{ state: 'APPROVED' }] });

        await runner(fixtureContext, [genScanResult('repo-84', { branch: true, pr })]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [`Do you want to update PR description in ${b('repo-84')}'s`],
        ]);
        expect(fixtureContext.actions.updatesPerRepo.get('repo-84')).toEqual({
          repo: 'repo-84',
          pr,
          updateDescription: true,
        });
      });

      it('Should list the updates per repo when they differ', async () => {
        fixtureContext.config.update = true;
        fixtureContext.config.reviewers = 'boss';
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);

        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr: genPR({ reviews: [{ state: 'APPROVED' }] }) }),
          genScanResult('repo-10', { branch: true, pr: genPR() }),
        ]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [
            'Do you want to update the repos:\n' +
              `  -update PR description in ${b('repo-84')}'s\n` +
              `  -update PR description in ${b('repo-10')}'s and add ${b('boss')} as reviewer`,
          ],
        ]);
      });

      it('Should create missing PRs and update the description of the existing ones', async () => {
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);
        const pr = genPR({ html_url: 'url-84', title: 'Old title', reviews: [{ state: 'APPROVED' }] });

        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr }),
          genScanResult('repo-10', { branch: true, pr: null }),
        ]);

        expect(mocks.utils.getYNAnswer.mock.calls).toEqual([
          [
            'Do you want to perform the following actions:\n' +
              `- create a ${b('draft')} PR with ${b('no reviewer')} in ${b('repo-10')}\n` +
              `- update PR description in ${b('repo-84')}'s`,
          ],
        ]);
        expect(fixtureContext.actions.updatesPerRepo).toEqual(
          new Map([['repo-84', { repo: 'repo-84', pr, updateDescription: true }]]),
        );
        expect(fixtureContext.pullRequestsPerRepo).toEqual(
          new Map([
            ['repo-10', {}],
            ['repo-84', pr],
          ]),
        );
        expect(fixtureContext.defaultTitle).toEqual('PR from `foo-branch` in `repo-10`, `repo-84`');
      });

      it('Should not update the description of existing PRs if it is already the default one', async () => {
        const title = 'PR from `foo-branch` in `repo-84`, `repo-10`';
        const body = 'Pull request in 2 repositories:\n* `repo-84` : [url-84](url-84)\n* `repo-10` url pending';
        const pr = genPR({ html_url: 'url-84', title, body, reviews: [{ state: 'APPROVED' }] });
        mocks.utils.getYNAnswer.mockResolvedValueOnce(true);

        await runner(fixtureContext, [
          genScanResult('repo-84', { branch: true, pr }),
          genScanResult('repo-10', { branch: true, pr: null }),
        ]);

        expect(fixtureContext.actions.updatesPerRepo).toEqual(new Map());
      });
    });

    describe('PR creation & update', () => {
      const { runner } = prCreation;

      beforeEach(() => {
        fixtureContext.workingBranch = 'foo-branch';
        fixtureContext.defaultTitle = 'PR from `foo-branch` in `repo-84`';
        mocks.sg.listRemote.mockResolvedValue('git@github.com:foo-owner/repo-84.git');
      });

      afterEach(() => {
        mocks.sg.listRemote.mockReset();
      });

      it('Should include the repos in the title', () => {
        fixtureContext.pullRequestsPerRepo = new Map([
          ['repo-84', {}],
          ['repo-10', {}],
        ]);
        const title = prCreation.title(fixtureContext);
        expect(title).toEqual(`Processing PR in '${colors.bold('repo-84')}, ${colors.bold('repo-10')}'`);
      });

      it('Should not do anything if the repo is not in pullRequestsPerRepo', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([['foo-repo', {}]]);

        await runner(fixtureContext, 'repo-84');

        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);
        expect(mocks.ghRepo.graphql.mock.calls).toEqual([]);
      });

      it('Should create a draft PR with no reviewer', async () => {
        const pr = {};
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', pr]]);
        fixtureContext.actions = { creations: { draft: true, repos: ['repo-84'], reviewers: undefined } };
        mocks.ghRepo.createPullRequest.mockResolvedValueOnce(wrapGHResponse({ html_url: 'pr-url', number: 42 }));

        await runner(fixtureContext, 'repo-84');

        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([
          [
            {
              title: 'PR from `foo-branch` in `repo-84`',
              body: '',
              head: 'foo-branch',
              base: 'main',
              draft: true,
              AcceptHeader: 'shadow-cat-preview',
            },
          ],
        ]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);
        expect(pr).toEqual({ html_url: 'pr-url', number: 42, updateDescription: true });
        expect(mocks.utils.pickRandom.mock.calls).toEqual([]);
      });

      it('Should create a PR against the default branch of the repo', async () => {
        const context = createFixtureContext('repo-84', 'repo-84:develop');
        context.workingBranch = 'foo-branch';
        context.defaultTitle = 'title';
        context.pullRequestsPerRepo = new Map([['repo-84', {}]]);
        context.actions = { creations: { draft: false, repos: ['repo-84'], reviewers: null } };
        mocks.ghRepo.createPullRequest.mockResolvedValueOnce(wrapGHResponse({ html_url: 'pr-url', number: 42 }));

        await runner(context, 'repo-84');

        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([
          [{ title: 'title', body: '', head: 'foo-branch', base: 'develop' }],
        ]);
      });

      it('Should request reviews from individuals and teams', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', {}]]);
        fixtureContext.actions = {
          creations: { draft: false, repos: ['repo-84'], reviewers: ['rev1', 'team/core', 'rev2'] },
        };
        mocks.ghRepo.createPullRequest.mockResolvedValueOnce(wrapGHResponse({ html_url: 'pr-url', number: 42 }));

        await runner(fixtureContext, 'repo-84');

        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([
          [42, { reviewers: ['rev1', 'rev2'], team_reviewers: ['core'] }],
        ]);
      });

      it('Should not fail the PR creation if we cannot add the reviewers', async () => {
        const pr = {};
        const error = new Error('Fail');
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', pr]]);
        fixtureContext.actions = { creations: { draft: false, repos: ['repo-84'], reviewers: ['rev1'] } };
        mocks.ghRepo.createPullRequest.mockResolvedValueOnce(wrapGHResponse({ html_url: 'pr-url', number: 42 }));
        mocks.ghRepo.createReviewRequest.mockRejectedValueOnce(error);

        await runner(fixtureContext, 'repo-84');

        expect(pr).toEqual({ html_url: 'pr-url', number: 42, errors: [error], updateDescription: true });
      });

      it('Should mark a draft PR ready for review and add reviewers', async () => {
        const pr = { html_url: 'pr-url', number: 42, node_id: 'node-42', draft: true };
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', pr]]);
        fixtureContext.actions = {
          updatesPerRepo: new Map([
            ['repo-84', { pr, updateDescription: false, transitionFromDraftToReady: true, reviewers: ['boss'] }],
          ]),
        };

        await runner(fixtureContext, 'repo-84');

        expect(mocks.ghRepo.graphql.mock.calls).toEqual([
          [
            {
              AcceptHeader: 'shadow-cat-preview',
              query:
                'mutation { markPullRequestReadyForReview(input: { pullRequestId: "node-42" }) { clientMutationId } }',
            },
          ],
        ]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([
          [42, { reviewers: ['boss'], team_reviewers: [] }],
        ]);
        expect(mocks.ghRepo.createPullRequest.mock.calls).toEqual([]);
        expect(pr.updateDescription).toEqual(false);
      });

      it('Should only flag the description for update on an existing PR', async () => {
        const pr = { html_url: 'pr-url', number: 42 };
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', pr]]);
        fixtureContext.actions = { updatesPerRepo: new Map([['repo-84', { pr, updateDescription: true }]]) };

        await runner(fixtureContext, 'repo-84');

        expect(mocks.ghRepo.graphql.mock.calls).toEqual([]);
        expect(mocks.ghRepo.createReviewRequest.mock.calls).toEqual([]);
        expect(pr.updateDescription).toEqual(true);
      });
    });

    describe('PR body generation', () => {
      const { runner } = prBodyGeneration;

      beforeEach(() => {
        fixtureContext.defaultTitle = 'Default title';
      });

      it('Should not do anything if there is no PR', async () => {
        fixtureContext.pullRequestsPerRepo = new Map();
        await runner(fixtureContext);
        expect(fixtureContext.pullRequestsFinalDescription).toBeUndefined();
      });

      [
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
          config: {
            issueTracker: { issueIdPattern: '[0-9]{9}', urlPrefix: 'https://www.pivotaltracker.com/story/show/' },
          },
          expectedPullRequestBody:
            'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)\n\n\nRelated issue: https://www.pivotaltracker.com/story/show/123456789',
        },
        {
          pullRequestsPerRepo: genRepoMapWithValues(['foo-repo']),
          workingBranch: 'foo-bar-no-issue',
          config: {
            issueTracker: { issueIdPattern: '[0-9]{9}', urlPrefix: 'https://www.pivotaltracker.com/story/show/' },
          },
          expectedPullRequestBody: 'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)',
        },
      ].forEach((scenario) => {
        const pullRequestsPerRepoStr = JSON.stringify(Array.from(scenario.pullRequestsPerRepo.keys()));
        const expected = scenario.expectedPullRequestBody.replace(/\n/g, '\\n');
        it(`Should generate '${expected}' for ${pullRequestsPerRepoStr} on '${scenario.workingBranch}'`, async () => {
          fixtureContext.workingBranch = scenario.workingBranch || 'foo-branch';
          Object.assign(fixtureContext.config, scenario.config);
          fixtureContext.pullRequestsPerRepo = scenario.pullRequestsPerRepo;

          await runner(fixtureContext);

          expect(fixtureContext.pullRequestsFinalDescription).toEqual({
            title: 'Default title',
            body: scenario.expectedPullRequestBody,
          });
          expect(mocks.editor.editPRDescription.mock.calls).toEqual([]);
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
        it('Should allow to edit the content of the PR title and description - ' + scenario.title, async () => {
          fixtureContext.workingBranch = 'foo-branch';
          fixtureContext.config.m = true;
          fixtureContext.pullRequestsPerRepo = genRepoMapWithValues(['foo-repo']);

          mocks.editor.editPRDescription.mockResolvedValueOnce(scenario.editedResult);
          await runner(fixtureContext);

          expect(mocks.editor.editPRDescription.mock.calls).toEqual([
            [
              {
                body: 'Pull request in 1 repository:\n* `foo-repo` : [foo-repo-pr-url](foo-repo-pr-url)',
                title: 'Default title',
              },
            ],
          ]);
          expect(fixtureContext.pullRequestsFinalDescription).toEqual(scenario.editedResult);
        });
      });
    });

    describe('PR body update', () => {
      const { runner } = prBodyUpdate;

      beforeEach(() => {
        mocks.sg.status.mockResolvedValueOnce({ current: 'main' });
        mocks.sg.stashList.mockResolvedValueOnce({ all: [], latest: null, total: 0 });
        mocks.sg.raw.mockResolvedValue('');
        mocks.sg.listRemote.mockResolvedValue('git@github.com:foo-owner/repo-84.git');
        fixtureContext.pullRequestsFinalDescription = { body: 'updated body' };
      });

      afterEach(() => {
        mocks.sg.listRemote.mockReset();
      });

      it('Should only return the status if the repo is not in the list', async () => {
        fixtureContext.pullRequestsPerRepo = new Map();

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult());
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([]);
      });

      it('Should not update the PR body if the PR is not flagged for description update', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([['repo-84', { html_url: 'repo-pr-url/123', number: 123 }]]);

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult('repo-pr-url/123'));
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([]);
      });

      it('Should update the PR body if the PR is flagged for description update', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([
          ['repo-84', { html_url: 'repo-pr-url/123', number: 123, updateDescription: true }],
        ]);

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult('repo-pr-url/123'));
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([[123, { body: 'updated body' }]]);
      });

      it('Should add the errors if it finds some', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([
          ['repo-84', { html_url: 'repo-pr-url/123', number: 123, updateDescription: true, errors: ['foo'] }],
        ]);

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual({ ...genStatusResult('repo-pr-url/123'), errors: ['foo'] });
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([[123, { body: 'updated body' }]]);
      });

      it('Should not update the PR body if the title and body are empty', async () => {
        fixtureContext.pullRequestsPerRepo = new Map([
          ['repo-84', { html_url: 'repo-pr-url/123', number: 123, updateDescription: true }],
        ]);
        fixtureContext.pullRequestsFinalDescription = {};

        const result = await runner(fixtureContext, 'repo-84');

        expect(result).toEqual(genStatusResult('repo-pr-url/123'));
        expect(mocks.ghRepo.updatePullRequest.mock.calls).toEqual([]);
      });
    });
  });

  function genRepoMapWithValues(repos) {
    return new Map(repos.map((r) => [r, { html_url: r + '-pr-url', number: 42 }]));
  }

  function genScanResult(repo, res) {
    return { repo, res };
  }

  function genPR(overrides = {}) {
    return { number: 42, html_url: 'pr-url', draft: false, requested_reviewers: [], reviews: [], ...overrides };
  }

  function genStatusResult(pr) {
    const r = {
      hasWipCommit: false,
      stash: { all: [], latest: null, total: 0 },
      status: { current: 'main', isDefaultBranch: true },
    };
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
