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
      jest.doMock('simple-git', () => () => {
        throw new Error('Something bad');
      });
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
      const revList = new Error("fatal: bad revision: unknown revision or path not in the working tree.");
      const sg = setupSg({ status: { current: 'feature' }, revList });

      const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
      expect(res.status.diff_with_origin_main).toEqual({ ahead: 'x', behind: 'x' });
    });

    it('should rethrow other rev-list errors', async () => {
      const sg = setupSg({ status: { current: 'feature' }, revList: new Error('fatal: other') });

      await expect(gitHelper.commonStatus(sg, 'repo-1', 'main')).rejects.toThrow('fatal: other');
    });

    it('should not compute the diff on a submodule', async () => {
      const parentSg = { raw: jest.fn().mockResolvedValue('') };
      const sg = createSg({
        repo: 'parent/sub',
        submoduleToParentMap: new Map([['parent/sub', 'parent']]),
        parentSg,
      });
      sg.stashList.mockResolvedValue({ total: 0 });
      sg.raw.mockResolvedValue('Some commit');

      const res = await gitHelper.commonStatus(sg, 'parent/sub', 'main');
      expect(res.status.isSubmodule).toBe(true);
      expect(res.status.isDefaultBranch).toBe(false);
      expect(res.status).not.toHaveProperty('diff_with_origin_main');
      expect(sg.raw.mock.calls).toEqual([[['log', '--pretty=format:%s', '-1']]]);
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
      ];

      for (const [title, expected] of cases) {
        it(`should return ${expected} for '${title}'`, async () => {
          const sg = setupSg({ lastCommitTitle: title });
          const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
          expect(res.hasWipCommit).toBe(expected);
        });
      }

      // Known bugs in `getHasWipCommit`/`hasWipWord` (lib/helpers/simple-git.js):
      // - the character following the match is read at `str[subLen]` instead of `str[idx + subLen]`
      // - only `wip` and `WIP` are searched, so mixed-case variants return an index of -1
      // - punctuation right after `wip` is not treated as a word boundary
      const failingCases = [
        ['Some WIP', true],
        ['Wip foo', true],
        ['wip: foo', true],
        ['add wipe option', false],
      ];

      for (const [title, expected] of failingCases) {
        it.failing(`should return ${expected} for '${title}'`, async () => {
          const sg = setupSg({ lastCommitTitle: title });
          const res = await gitHelper.commonStatus(sg, 'repo-1', 'main');
          expect(res.hasWipCommit).toBe(expected);
        });
      }
    });
  });
});
