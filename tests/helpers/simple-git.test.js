require('../mocks');
const fs = require('fs');
const os = require('os');
const gitHelper = require('../../lib/helpers/simple-git');

function createSg({ repo = 'repo-1', submoduleToParentMap = new Map(), parentSg = null } = {}) {
  return {
    repo,
    context: {
      submoduleToParentMap,
      getGitAPI: jest.fn(() => parentSg),
    },
    raw: jest.fn(),
    revparse: jest.fn(),
    status: jest.fn(),
    stashList: jest.fn(),
  };
}

describe('simple-git helper', () => {
  describe('countWorktrees', () => {
    const path = require('path');
    let tmp;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multipull-worktrees-'));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    // A repository with linked worktrees `names`; `existing`: the ones whose directory still exists
    function createRepo(names, existing = names) {
      const repo = path.join(tmp, 'repo');
      for (const name of names) {
        const adminDir = path.join(repo, '.git', 'worktrees', name);
        const worktree = path.join(tmp, 'worktrees', name);
        fs.mkdirSync(adminDir, { recursive: true });
        fs.writeFileSync(path.join(adminDir, 'gitdir'), path.join(worktree, '.git') + '\n');
        fs.writeFileSync(path.join(adminDir, 'commondir'), '../..\n'); // Like git: points to the main `.git`
        if (existing.includes(name)) {
          fs.mkdirSync(worktree, { recursive: true });
          fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${adminDir}\n`);
        }
      }
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      return repo;
    }

    it('should return 0 without linked worktrees', async () => {
      await expect(gitHelper.countWorktrees(createRepo([]))).resolves.toBe(0);
    });

    it('should count the linked worktrees', async () => {
      await expect(gitHelper.countWorktrees(createRepo(['a', 'b', 'c']))).resolves.toBe(3);
    });

    it('should not count the worktrees whose directory was deleted (prunable)', async () => {
      await expect(gitHelper.countWorktrees(createRepo(['a', 'b', 'c'], ['b']))).resolves.toBe(1);
    });

    it('should count the worktrees of the main repository from a linked worktree', async () => {
      createRepo(['a', 'b']);
      await expect(gitHelper.countWorktrees(path.join(tmp, 'worktrees', 'a'))).resolves.toBe(2);
    });

    it('should return 0 for a directory that is not a repository', async () => {
      await expect(gitHelper.countWorktrees(path.join(tmp, 'nothing-here'))).resolves.toBe(0);
    });
  });

  describe('getGHRepo', () => {
    [
      'git@github.com:foo-owner/repo-84.git',
      'git@github.com:foo-owner/repo-84',
      'https://github.com/foo-owner/repo-84.git',
      'https://github.com/foo-owner/repo-84',
      'ssh://git@github.com/foo-owner/repo-84.git',
      'https://github.com/foo-owner/repo-84.git\n',
    ].forEach((remoteUrl) => {
      it(`should create the GitHub repository from '${remoteUrl.trim()}'`, async () => {
        const sg = { listRemote: jest.fn(async () => remoteUrl) };

        const ghRepo = await gitHelper.getGHRepo(sg);

        expect(sg.listRemote.mock.calls).toEqual([[['--get-url']]]);
        expect(ghRepo).toMatchObject({ owner: 'foo-owner', repo: 'repo-84' });
      });
    });

    it('should keep dots in the repository name', async () => {
      const sg = { listRemote: jest.fn(async () => 'git@github.com:foo-owner/my.repo.git') };
      await expect(gitHelper.getGHRepo(sg)).resolves.toMatchObject({ owner: 'foo-owner', repo: 'my.repo' });
    });

    it('should throw if there is no remote', async () => {
      const sg = { listRemote: jest.fn(async () => '\n') };
      await expect(gitHelper.getGHRepo(sg)).rejects.toThrow('Cannot find remote url');
    });

    it('should throw if the remote is not on GitHub', async () => {
      const sg = { listRemote: jest.fn(async () => 'git@gitlab.com:foo-owner/repo-84.git') };
      await expect(gitHelper.getGHRepo(sg)).rejects.toThrow(
        "Remote URL 'git@gitlab.com:foo-owner/repo-84.git' doesn't match the expected format",
      );
    });
  });

  describe('initSimpleGit', () => {
    afterEach(() => {
      jest.dontMock('simple-git');
    });

    function loadOriginalInitSimpleGit() {
      let initSimpleGit;
      jest.isolateModules(() => {
        ({ initSimpleGit } = require('../../lib/helpers/simple-git'));
      });
      return initSimpleGit;
    }

    it('should attach the context and the repo to the simple-git instance', () => {
      const initSimpleGit = loadOriginalInitSimpleGit();
      const context = { getRepoPath: () => os.tmpdir() };

      const sg = initSimpleGit(context, 'repo-1');
      expect(sg.context).toBe(context);
      expect(sg.repo).toBe('repo-1');
    });

    it('should rewrite the error when the repository does not exist', () => {
      const initSimpleGit = loadOriginalInitSimpleGit();
      const context = { getRepoPath: () => '/this/path/does/not/exist' };

      let error = null;
      try {
        initSimpleGit(context, 'repo-1');
      } catch (err) {
        error = err;
      }

      expect(error.message).toBe("Cannot start: repository '/this/path/does/not/exist' does not exist");
      expect(error.stack).toBe('');
      expect(error).not.toHaveProperty('task');
      expect(error).not.toHaveProperty('config');
    });

    it('should prefix any other error with the repository path', () => {
      jest.doMock('simple-git', () => ({
        simpleGit: () => {
          throw new Error('Something bad');
        },
      }));
      const initSimpleGit = loadOriginalInitSimpleGit();
      const context = { getRepoPath: () => '/my/repo' };

      expect(() => initSimpleGit(context, 'repo-1')).toThrow("Cannot setup git in '/my/repo' : Something bad");
    });
  });

  describe('getStatus', () => {
    it('should return the status of a regular repository', async () => {
      const sg = createSg();
      sg.status.mockResolvedValueOnce({ current: 'main', tracking: 'origin/main' });

      const status = await gitHelper.getStatus(sg);
      expect(status).toEqual({ current: 'main', tracking: 'origin/main' });
      expect(sg.status).toHaveBeenCalledTimes(1);
    });

    it('should retry once when both current and tracking are null', async () => {
      const sg = createSg();
      sg.status
        .mockResolvedValueOnce({ current: null, tracking: null })
        .mockResolvedValueOnce({ current: 'main', tracking: 'origin/main' });

      const status = await gitHelper.getStatus(sg);
      expect(status).toEqual({ current: 'main', tracking: 'origin/main' });
      expect(sg.status).toHaveBeenCalledTimes(2);
    });

    it('should resolve the sha when the HEAD is detached', async () => {
      const sg = createSg();
      const sha = '0123456789abcdef0123456789abcdef01234567';
      sg.status.mockResolvedValueOnce({ current: 'HEAD', tracking: null });
      sg.raw.mockResolvedValueOnce(sha + '\n');

      const status = await gitHelper.getStatus(sg);
      expect(status.current).toBe(sha.slice(0, 24));
      expect(sg.raw.mock.calls).toEqual([[['rev-parse', 'HEAD']]]);
    });

    describe('On a submodule', () => {
      function createSubmoduleSg() {
        const parentSg = { raw: jest.fn() };
        const sg = createSg({
          repo: 'parent/libs/sub',
          submoduleToParentMap: new Map([['parent/libs/sub', 'parent']]),
          parentSg,
        });
        return { sg, parentSg };
      }

      it('should return an empty clean status when the submodule is not modified', async () => {
        const { sg, parentSg } = createSubmoduleSg();
        parentSg.raw.mockResolvedValueOnce('');

        const status = await gitHelper.getStatus(sg);
        expect(status.isSubmodule).toBe(true);
        expect(status.current).toBe('');
        expect(status.isClean).toBe(true);
        expect(status.files).toEqual([]);
        expect(sg.status).not.toHaveBeenCalled();
        expect(sg.context.getGitAPI.mock.calls).toEqual([['parent']]);
        expect(parentSg.raw.mock.calls).toEqual([[['diff', '--submodule=short', '--', 'libs/sub']]]);
      });

      it('should extract the revision range from the parent diff', async () => {
        const { sg, parentSg } = createSubmoduleSg();
        parentSg.raw.mockResolvedValueOnce(
          [
            'diff --git a/libs/sub b/libs/sub',
            'index abc1234..def5678 160000',
            '--- a/libs/sub',
            '+++ b/libs/sub',
            '@@ -1 +1 @@',
            '-Subproject commit abc1234',
            '+Subproject commit def5678',
          ].join('\n')
        );

        const status = await gitHelper.getStatus(sg);
        expect(status.isSubmodule).toBe(true);
        expect(status.current).toBe('abc1234..def5678');
      });

      it('should wrap errors raised while diffing in the parent', async () => {
        const { sg, parentSg } = createSubmoduleSg();
        parentSg.raw.mockRejectedValueOnce(new Error('fatal: boom'));

        await expect(gitHelper.getStatus(sg)).rejects.toThrow(
          'Cannot get submodule status for parent/libs/sub in parent: fatal: boom'
        );
      });
    });
  });

  describe('getSubmodules', () => {
    let readFileSpy;
    beforeEach(() => {
      readFileSpy = jest.spyOn(fs.promises, 'readFile');
    });

    afterEach(() => {
      readFileSpy.mockRestore();
    });

    it('should list the submodules declared in .gitmodules', async () => {
      readFileSpy.mockResolvedValueOnce(
        Buffer.from(
          [
            '[submodule "libs/a"]',
            '\tpath = libs/a',
            '\turl = git@github.com:owner/a.git',
            '[submodule "b"]',
            '\tpath = vendor/b',
            '\turl = git@github.com:owner/b.git',
          ].join('\n')
        )
      );

      const submodules = await gitHelper.getSubmodules('/root', 'repo-1');
      expect(submodules).toEqual(['repo-1/libs/a', 'repo-1/vendor/b']);
      expect(readFileSpy.mock.calls).toEqual([['/root/repo-1/.gitmodules']]);
    });

    it('should return an empty list when there is no .gitmodules', async () => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      readFileSpy.mockRejectedValueOnce(err);

      await expect(gitHelper.getSubmodules('/root', 'repo-1')).resolves.toEqual([]);
    });

    it('should rethrow any other error', async () => {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      readFileSpy.mockRejectedValueOnce(err);

      await expect(gitHelper.getSubmodules('/root', 'repo-1')).rejects.toBe(err);
    });
  });

  describe('commonStatus', () => {
    function setupSg({ status = { current: 'main' }, lastCommitTitle = 'Some commit', revList = '' } = {}) {
      const sg = createSg();
      sg.status.mockResolvedValue(status);
      sg.stashList.mockResolvedValue({ all: [], latest: null, total: 0 });
      sg.raw.mockImplementation(async ([cmd]) => {
        if (cmd === 'log') {
          return lastCommitTitle;
        }
        if (cmd === 'rev-list') {
          if (revList instanceof Error) {
            throw revList;
          }
          return revList;
        }
        throw new Error(`Unexpected raw command ${cmd}`);
      });
      return sg;
    }

    it('should aggregate status, stash and WIP detection with additional results', async () => {
      const sg = setupSg();

      const res = await gitHelper.commonStatus(sg, 'repo-1', 'main', { extra: 42 });
      expect(res).toEqual({
        status: { current: 'main', isDefaultBranch: true },
        stash: { all: [], latest: null, total: 0 },
        hasWipCommit: false,
        extra: 42,
      });
      expect(sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']]]);
    });

    it('should default the stash total to 0', async () => {
      const sg = setupSg();
      sg.stashList.mockResolvedValue({});

      const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
      expect(res.stash).toEqual({ total: 0 });
    });

    it('should wrap stash errors', async () => {
      const sg = setupSg();
      sg.stashList.mockRejectedValue(new Error('stash failed'));

      await expect(gitHelper.commonStatus(sg, 'repo-1', 'main')).rejects.toThrow(
        'Cannot get stash status for repo-1: stash failed'
      );
    });

    it('should compute the diff with origin main on a non default branch', async () => {
      const sg = setupSg({ status: { current: 'feature' }, revList: '>a\n>b\n<c\n' });

      const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
      expect(res.status).toEqual({
        current: 'feature',
        isDefaultBranch: false,
        diff_with_origin_main: { ahead: 2, behind: 1 },
      });
      expect(sg.raw).toHaveBeenCalledWith(['rev-list', '--left-right', 'origin/main...feature']);
    });

    it("should mark the diff as unknown when the revision doesn't exist on origin", async () => {
      const revList = new Error('fatal: bad revision: unknown revision or path not in the working tree.');
      const sg = setupSg({ status: { current: 'feature' }, revList });

      const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
      expect(res.status.diff_with_origin_main).toEqual({ ahead: 'x', behind: 'x' });
    });

    it('should rethrow other rev-list errors', async () => {
      const sg = setupSg({ status: { current: 'feature' }, revList: new Error('fatal: other') });

      await expect(gitHelper.commonStatus(sg, 'repo-1', 'main')).rejects.toThrow('fatal: other');
    });

    it('should not run any git command in an unchanged submodule', async () => {
      const parentSg = { raw: jest.fn().mockResolvedValue('') };
      const sg = createSg({
        repo: 'parent/sub',
        submoduleToParentMap: new Map([['parent/sub', 'parent']]),
        parentSg,
      });

      const res = await gitHelper.commonStatus(sg, 'parent/sub', 'main');
      expect(res.status.isSubmodule).toBe(true);
      expect(res.status.isDefaultBranch).toBe(false);
      expect(res.status).not.toHaveProperty('diff_with_origin_main');
      expect(res.stash).toEqual({ all: [], latest: null, total: 0 });
      expect(res.hasWipCommit).toBe(false);
      expect(sg.raw.mock.calls).toEqual([]);
      expect(sg.stashList.mock.calls).toEqual([]);
    });

    it('should look at the stash and the last commit of a changed submodule', async () => {
      const parentSg = { raw: jest.fn().mockResolvedValue('diff --git a/sub b/sub\nindex 1111111..2222222 160000\n') };
      const sg = createSg({
        repo: 'parent/sub',
        submoduleToParentMap: new Map([['parent/sub', 'parent']]),
        parentSg,
      });
      sg.stashList.mockResolvedValue({ total: 2 });
      sg.raw.mockResolvedValue('WIP');

      const res = await gitHelper.commonStatus(sg, 'parent/sub', 'main');
      expect(res.status.current).toBe('1111111..2222222');
      expect(res.stash).toEqual({ total: 2 });
      expect(res.hasWipCommit).toBe(true);
      expect(sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']]]);
    });

    describe('Submodules of the same parent', () => {
      function createSiblings(paths, parentSg) {
        const submoduleToParentMap = new Map(paths.map((p) => [`parent/${p}`, 'parent']));
        submoduleToParentMap.set('other/x', 'other');
        const context = { submoduleToParentMap, getGitAPI: jest.fn(() => parentSg) };
        return paths.map((p) => ({ ...createSg({ repo: `parent/${p}` }), context }));
      }

      const DIFF = [
        'diff --git a/a b/a',
        'index 1111111..2222222 160000',
        '--- a/a',
        '+++ b/a',
        '@@ -1 +1 @@',
        '-Subproject commit 1111111',
        '+Subproject commit 2222222',
        'diff --git a/nested/c b/nested/c',
        'index 3333333..4444444 160000',
        '--- a/nested/c',
        '+++ b/nested/c',
      ].join('\n');

      it('should run a single diff in the parent for all its submodules', async () => {
        const parentSg = { raw: jest.fn().mockResolvedValue(DIFF) };
        const siblings = createSiblings(['a', 'b', 'nested/c'], parentSg);

        const statuses = await Promise.all(siblings.map((sg) => gitHelper.getStatus(sg)));

        expect(statuses.map((s) => s.current)).toEqual(['1111111..2222222', '', '3333333..4444444']);
        expect(parentSg.raw.mock.calls).toEqual([[['diff', '--submodule=short', '--', 'a', 'b', 'nested/c']]]);
      });

      it('should run a new diff for requests made after the previous one completed', async () => {
        const parentSg = { raw: jest.fn().mockResolvedValue('') };
        const [sg] = createSiblings(['a'], parentSg);

        await gitHelper.getStatus(sg);
        await gitHelper.getStatus(sg);

        expect(parentSg.raw).toHaveBeenCalledTimes(2);
      });

      it('should fail every pending request when the diff fails, and retry on the next one', async () => {
        const parentSg = { raw: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('') };
        const siblings = createSiblings(['a', 'b'], parentSg);

        const results = await Promise.allSettled(siblings.map((sg) => gitHelper.getStatus(sg)));
        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        expect(results[0].reason.message).toBe('Cannot get submodule status for parent/a in parent: boom');

        await expect(gitHelper.getStatus(siblings[0])).resolves.toMatchObject({ current: '' });
        expect(parentSg.raw).toHaveBeenCalledTimes(2);
      });
    });

    describe('WIP commit detection', () => {
      const cases = [
        ['WIP', true],
        ['wip', true],
        ['wip foo', true],
        ['fix wip stuff', true],
        ['fix wip', true],
        ['wiping', false],
        ['swipe left', false],
        ['Regular commit', false],
        ['Some WIP', true],
        ['Wip foo', true],
        ['wip: foo', true],
        ['[multipull] WIP', true],
        ['add wipe option', false],
      ];

      for (const [title, expected] of cases) {
        it(`should return ${expected} for '${title}'`, async () => {
          const sg = setupSg({ lastCommitTitle: title });
          const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
          expect(res.hasWipCommit).toBe(expected);
        });
      }
    });
  });
});
