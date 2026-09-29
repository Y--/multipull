const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const pullRepo = require('../../lib/runners/pull-repo');

const REPO_NAME = 'repo-1';
const SUBMODULE_NAME = 'sub';
const WIP_COMMIT_MESSAGE = '[multipull] WIP';
const UP_TO_DATE_PULL = { files: [], summary: {} };
const FETCHED_ONLY_PULL = { files: ['*** FETCHED ONLY, MERGE WOULD PRODUCE CONFLICTS ***'], summary: {} };
const PULL_ARGS = { '--all': null, '--stat': null };
const PULL_REBASE_ARGS = { '--all': null, '--rebase': null, '--stat': null };
const WIP_RESET_CALLS = [[['--soft', 'HEAD~1']], [['HEAD']]];
const LAST_COMMIT_CALL = [['log', '--pretty=format:%s', '-1']];
// Calls made in the parent to find its outdated submodules
const submoduleChecks = (...paths) => [
  [['ls-files', '--stage', '--', ...paths]],
  [['submodule', 'status', '--', ...paths]],
];

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Pull repo', () => {
    setupHooks();

    let consoleErrorSpy;
    beforeEach(() => {
      for (const fn of Object.values(mocks.sg)) {
        if (jest.isMockFunction(fn)) {
          fn.mockReset();
        }
      }
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    // Up to date: the status computed to decide whether to pull is reused for the result
    const UP_TO_DATE_STATUS_CALLS = [[]];

    [
      {
        status: { ahead: 0, behind: 0 },
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: { status: UP_TO_DATE_STATUS_CALLS },
      },
      {
        status: { ahead: 0, behind: 0, tracking: null },
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: { status: UP_TO_DATE_STATUS_CALLS },
      },
      {
        status: { ahead: 0, behind: 0, tracking: null, diff_with_origin_main: { behind: 0 } },
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: { status: UP_TO_DATE_STATUS_CALLS },
      },
      {
        title: 'looks for outdated submodules when up to date',
        status: { ahead: 0, behind: 0, modified: [], deleted: [], created: [], conflicted: [] },
        submodules: [SUBMODULE_NAME],
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: {
          raw: [...submoduleChecks(SUBMODULE_NAME), LAST_COMMIT_CALL],
          status: UP_TO_DATE_STATUS_CALLS,
        },
      },
      {
        title: "doesn't look for outdated submodules with --no-submodule",
        status: { ahead: 0, behind: 0, modified: [], deleted: [], created: [], conflicted: [] },
        config: { submodule: false },
        submodules: [SUBMODULE_NAME],
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: {
          status: UP_TO_DATE_STATUS_CALLS,
        },
      },
      {
        status: {
          tracking: null,
          modified: [],
          deleted: [],
          created: [],
          conflicted: [],
          diff_with_origin_main: { behind: 1 },
        },
        expectedPull: UP_TO_DATE_PULL,
        expectedCalls: {
          rebase: [[['origin/main', '--stat']]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_ARGS]],
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [1], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [2], created: [], conflicted: [] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [3], conflicted: [] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        status: { ahead: 0, behind: 1, modified: [], deleted: [], created: [], conflicted: [4] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        title: 'does not reset when the last commit is not the WIP commit',
        status: { ahead: 0, behind: 1, modified: [1], deleted: [], created: [], conflicted: [] },
        lastCommitMessage: 'Someone else commit',
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          log: [[['-1']]],
        },
      },
      {
        title: 'considers the repo clean when only a submodule is modified',
        status: { ahead: 0, behind: 1, modified: [SUBMODULE_NAME], deleted: [], created: [], conflicted: [] },
        submodules: [SUBMODULE_NAME],
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_ARGS]],
          raw: [...submoduleChecks(SUBMODULE_NAME), LAST_COMMIT_CALL],
        },
      },
      {
        title: 'excludes modified submodules from the WIP commit',
        status: {
          ahead: 0,
          behind: 1,
          modified: ['file.js', SUBMODULE_NAME],
          deleted: [],
          created: [],
          conflicted: [],
        },
        submodules: [SUBMODULE_NAME],
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          raw: [...submoduleChecks(SUBMODULE_NAME), LAST_COMMIT_CALL],
          add: [[['.', ':!' + SUBMODULE_NAME]]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null }]],
          pull: [[null, null, PULL_REBASE_ARGS]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        title: 'excludes submodules listed as created or conflicted from the WIP commit',
        status: {
          ahead: 0,
          behind: 1,
          modified: ['file.js', SUBMODULE_NAME],
          deleted: [],
          created: ['other-sub'],
          conflicted: [SUBMODULE_NAME],
        },
        submodules: [SUBMODULE_NAME, 'other-sub'],
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          raw: [...submoduleChecks(SUBMODULE_NAME, 'other-sub'), LAST_COMMIT_CALL],
          add: [[['.', ':!' + SUBMODULE_NAME, ':!other-sub']]],
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null }]],
          pull: [[null, null, PULL_REBASE_ARGS]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
        },
      },
      {
        status: { ahead: 1, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [[null, null, PULL_REBASE_ARGS]],
        },
      },
      {
        title: 'falls back to a regular pull when pull --rebase fails, without aborting a rebase',
        status: { ahead: 1, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        failingPulls: 1,
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          pull: [
            [null, null, PULL_REBASE_ARGS],
            [null, null, PULL_ARGS],
          ],
        },
      },
      {
        title: 'reports fetched only when both pull --rebase and pull fail',
        status: { ahead: 1, behind: 1, modified: [], deleted: [], created: [], conflicted: [] },
        failingPulls: 2,
        expectedPull: FETCHED_ONLY_PULL,
        expectedCalls: {
          pull: [
            [null, null, PULL_REBASE_ARGS],
            [null, null, PULL_ARGS],
          ],
        },
        expectConsoleError: true,
      },
      {
        title: 'aborts the rebase it initiated and falls back to a regular pull',
        status: {
          ahead: 1,
          tracking: null,
          modified: [],
          deleted: [],
          created: [],
          conflicted: [],
          diff_with_origin_main: { behind: 1 },
        },
        rebaseWillFail: true,
        expectedPull: { files: ['a-file'], summary: {} },
        expectedCalls: {
          rebase: [[['origin/main', '--stat']], [{ '--abort': null }]],
          pull: [[null, null, PULL_ARGS]],
        },
      },
      {
        title: 'aborts the rebase it initiated, resets the WIP commit and reports fetched only if pull fails',
        status: {
          ahead: 1,
          tracking: null,
          modified: ['file.js'],
          deleted: [],
          created: [],
          conflicted: [],
          diff_with_origin_main: { behind: 1 },
        },
        rebaseWillFail: true,
        failingPulls: 1,
        expectedPull: FETCHED_ONLY_PULL,
        expectedCalls: {
          commit: [[WIP_COMMIT_MESSAGE, null, { '--no-verify': null, '-a': null }]],
          rebase: [[['origin/main', '--stat']], [{ '--abort': null }]],
          log: [[['-1']]],
          reset: WIP_RESET_CALLS,
          pull: [[null, null, PULL_ARGS]],
        },
        expectConsoleError: true,
      },
    ].forEach((scenario) => {
      const {
        title,
        status,
        config = {},
        submodules = [],
        lastCommitMessage = WIP_COMMIT_MESSAGE,
        failingPulls = 0,
        rebaseWillFail = false,
        expectConsoleError = false,
        expectedPull,
        expectedCalls,
      } = scenario;
      status.current = 'main';

      const suffix = `status is ${JSON.stringify(status)}`;
      const testTitle = title
        ? `Should return ${JSON.stringify(expectedPull)} and ${title}`
        : `Should return ${JSON.stringify(expectedPull)} when ${suffix}`;
      it(testTitle, async () => {
        const stash = { all: [], latest: null, total: 0 };
        mocks.sg.status.mockImplementation(() => status);
        mocks.sg.stashList.mockImplementationOnce(() => stash);
        mocks.sg.raw.mockReturnValue('');
        mocks.sg.log.mockResolvedValue({ latest: { message: lastCommitMessage } });
        mocks.sg.pull.mockImplementation(async () => expectedPull);
        for (let i = 0; i < failingPulls; ++i) {
          mocks.sg.pull.mockImplementationOnce(async () => {
            throw new Error('pull failed');
          });
        }

        if (rebaseWillFail) {
          mocks.sg.rebase.mockImplementationOnce(async () => {
            throw new Error('rebase failed');
          });
        }

        const fixtureContext = createFixtureContext(REPO_NAME);
        Object.assign(fixtureContext.config, config);
        for (const submodule of submodules) {
          fixtureContext.submoduleToParentMap.set(`${REPO_NAME}/${submodule}`, REPO_NAME);
        }

        const res = await pullRepo(fixtureContext, REPO_NAME);

        expect(res).toEqual({ hasWipCommit: false, status, stash, pull: expectedPull });
        expect(status.isDefaultBranch).toBe(true);

        const allExpectedCalls = Object.assign(
          {
            fetch: [[['--all', '--jobs=8']]],
            status: [[], []],
            stashList: [[]],
            raw: [[['log', '--pretty=format:%s', '-1']]],
          },
          expectedCalls,
        );

        expectSgCalls(allExpectedCalls);
        expect(consoleErrorSpy.mock.calls).toHaveLength(expectConsoleError ? 1 : 0);
        expectDebugCalls();
      });
    });

    it('Should only return the status of a submodule without fetching or pulling', async () => {
      const submoduleRepo = `${REPO_NAME}/${SUBMODULE_NAME}`;
      const fixtureContext = createFixtureContext(REPO_NAME);
      fixtureContext.submoduleToParentMap.set(submoduleRepo, REPO_NAME);

      const parentSg = {
        raw: jest
          .fn()
          .mockResolvedValue(
            `diff --git a/${SUBMODULE_NAME} b/${SUBMODULE_NAME}\nindex abc123..def456 160000\n--- a/${SUBMODULE_NAME}\n`,
          ),
      };
      fixtureContext.gitAPIPerRepo.set(REPO_NAME, parentSg);

      const stash = { all: [], latest: null, total: 0 };
      mocks.sg.stashList.mockImplementationOnce(() => stash);
      mocks.sg.raw.mockReturnValue('');
      fixtureContext.markRepoDone(REPO_NAME); // The parent was pulled

      const res = await pullRepo(fixtureContext, submoduleRepo);

      expect(res.hasWipCommit).toBe(false);
      expect(res.stash).toBe(stash);
      expect(res).not.toHaveProperty('pull');
      expect(res.status.isSubmodule).toBe(true);
      expect(res.status.current).toBe('abc123..def456');

      expect(parentSg.raw.mock.calls).toEqual([[['diff', '--submodule=short', '--', SUBMODULE_NAME]]]);
      expectSgCalls({
        stashList: [[]],
        raw: [[['log', '--pretty=format:%s', '-1']]],
      });

      if (testParams.debug) {
        expect(mocks.debug.mock.calls[0]).toEqual([`Processing repository ${submoduleRepo}...`]);
      } else {
        expect(mocks.debug.mock.calls).toHaveLength(0);
      }
    });
  });

  function expectSgCalls(expectedCalls) {
    for (const [handlerId, fn] of Object.entries(mocks.sg)) {
      if (!jest.isMockFunction(fn)) {
        continue;
      }

      try {
        expect(fn.mock.calls).toEqual(expectedCalls[handlerId] || []);
      } catch (err) {
        err.message = `Error while checking '${handlerId}': ${err.message}`;
        throw err;
      }
    }
  }

  function expectDebugCalls() {
    if (testParams.debug) {
      expect(mocks.debug.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(mocks.debug.mock.calls[0]).toEqual(['Processing repository repo-1...']);
    } else {
      expect(mocks.debug.mock.calls).toHaveLength(0);
    }
  }
}

describe('Pull repo - submodules', () => {
  const submodules = require('../../lib/helpers/submodules');
  const SUBMODULE = `${REPO_NAME}/${SUBMODULE_NAME}`;
  const OLD = 'a'.repeat(40);
  const NEW = 'b'.repeat(40);
  let fixtureContext;

  beforeEach(() => {
    for (const fn of Object.values(mocks.sg)) {
      if (jest.isMockFunction(fn)) {
        fn.mockReset();
      }
    }
    fixtureContext = createFixtureContext(REPO_NAME);
    fixtureContext.submoduleToParentMap.set(SUBMODULE, REPO_NAME);
    fixtureContext.repos.push(SUBMODULE);
    mocks.sg.status.mockImplementation(() => ({
      ahead: 0,
      behind: 0,
      current: 'main',
      modified: [],
      deleted: [],
      created: [],
      conflicted: [],
    }));
    mocks.sg.stashList.mockImplementation(() => ({ all: [], latest: null, total: 0 }));
    mocks.sg.raw.mockResolvedValue('');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should compute the status of a submodule once its parent is done', async () => {
    let done = false;
    const pending = pullRepo(fixtureContext, SUBMODULE).then(() => (done = true));

    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);
    expect(mocks.sg.raw).not.toHaveBeenCalled();

    fixtureContext.markRepoDone(REPO_NAME);
    await pending;
    expect(done).toBe(true);
  });

  it("should mark the parent as done even when it fails, so that its submodules don't wait forever", async () => {
    mocks.sg.fetch.mockRejectedValue(new Error('network down'));

    await expect(pullRepo(fixtureContext, REPO_NAME)).rejects.toThrow('network down');
    await expect(pullRepo(fixtureContext, SUBMODULE)).resolves.toMatchObject({ status: { isSubmodule: true } });
  });

  it('should show the updated submodules, and compute the status of the parent again', async () => {
    jest.spyOn(submodules, 'updateOutdatedSubmodules').mockResolvedValue({
      updated: [{ path: SUBMODULE_NAME, from: OLD, to: NEW }],
      skipped: [],
    });

    const [parent, sub] = await Promise.all([
      pullRepo(fixtureContext, SUBMODULE),
      pullRepo(fixtureContext, REPO_NAME),
    ]).then(([s, p]) => [p, s]);

    expect(parent.pull).toEqual(UP_TO_DATE_PULL);
    expect(mocks.sg.status).toHaveBeenCalledTimes(2); // Before pulling, and after the submodule update
    expect(sub.status.current).toBe('aaaaaaa..bbbbbbb (updated)');
  });

  it('should show why an outdated submodule was not updated', async () => {
    jest.spyOn(submodules, 'updateOutdatedSubmodules').mockResolvedValue({
      updated: [],
      skipped: [{ path: SUBMODULE_NAME, reason: 'local changes' }],
    });
    // The parent's diff shows the submodule out of sync
    mocks.sg.raw.mockImplementation(async ([command]) =>
      command === 'diff' ? `diff --git a/${SUBMODULE_NAME} b/${SUBMODULE_NAME}\nindex 1111111..2222222 160000\n` : '',
    );

    const [, sub] = await Promise.all([pullRepo(fixtureContext, REPO_NAME), pullRepo(fixtureContext, SUBMODULE)]);

    expect(mocks.sg.status).toHaveBeenCalledTimes(1); // Up to date and nothing updated: the status is reused
    expect(sub.status.current).toBe('1111111..2222222 (not updated: local changes)');
  });

  it('should not update the submodules with --no-submodule', async () => {
    const spy = jest.spyOn(submodules, 'updateOutdatedSubmodules');
    fixtureContext.config.submodule = false;

    await pullRepo(fixtureContext, REPO_NAME);

    expect(spy).not.toHaveBeenCalled();
  });
});
