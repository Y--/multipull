const { mocks } = require('../mocks');
const Context = require('../../lib/helpers/context');
const gitHelper = require('../../lib/helpers/simple-git');

function createContext(config = {}) {
  return new Context('test-multipull', Object.assign({ root: '/my/root/folder', repos: 'repo-a,repo-b' }, config));
}

describe('Context', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('init', () => {
    it('should register submodules as repositories', async () => {
      jest
        .spyOn(gitHelper, 'getSubmodules')
        .mockImplementation(async (root, repo) => (repo === 'repo-a' ? ['repo-a/libs/x', 'repo-a/libs/y'] : []));

      const context = createContext();
      await context.init();

      expect(context.repos).toEqual(['repo-a', 'repo-b', 'repo-a/libs/x', 'repo-a/libs/y']);
      expect(context.submoduleToParentMap).toEqual(
        new Map([
          ['repo-a/libs/x', 'repo-a'],
          ['repo-a/libs/y', 'repo-a'],
        ])
      );
      expect(gitHelper.getSubmodules.mock.calls).toEqual([
        ['/my/root/folder', 'repo-a'],
        ['/my/root/folder', 'repo-b'],
      ]);
    });

    describe('Worktrees', () => {
      beforeEach(() => {
        jest
          .spyOn(gitHelper, 'getSubmodules')
          .mockImplementation(async (root, repo) => (repo === 'repo-a' ? ['repo-a/sub'] : []));
        jest
          .spyOn(gitHelper, 'listWorktrees')
          .mockImplementation(async (repoPath) =>
            repoPath === '/my/root/folder/repo-a' ? [{ name: 'feature', path: '/tmp/somewhere/feature' }] : [],
          );
      });

      [{ worktree: true }, { wt: true }].forEach((flag) => {
        it(`should register the linked worktrees as repositories with ${JSON.stringify(flag)}`, async () => {
          const context = createContext({ ...flag, branches: 'repo-a:develop' });
          await context.init({ worktrees: true });

          expect(context.repos).toEqual(['repo-a', 'repo-b', 'repo-a/sub', 'repo-a/wt:feature']);
          expect(context.worktreeToParentMap).toEqual(new Map([['repo-a/wt:feature', 'repo-a']]));
          expect(context.getRepoPath('repo-a/wt:feature')).toBe('/tmp/somewhere/feature');
          expect(context.getRepoPath('repo-a')).toBe('/my/root/folder/repo-a');
          expect(context.getDefaultBranch('repo-a/wt:feature')).toBe('develop'); // The one of its repository
          // Submodules don't have worktrees of their own here
          expect(gitHelper.listWorktrees.mock.calls).toEqual([['/my/root/folder/repo-a'], ['/my/root/folder/repo-b']]);
        });
      });

      it('should not look for worktrees without --worktree/--wt', async () => {
        const context = createContext();
        await context.init({ worktrees: true });

        expect(context.repos).toEqual(['repo-a', 'repo-b', 'repo-a/sub']);
        expect(gitHelper.listWorktrees).not.toHaveBeenCalled();
      });

      it('should not look for worktrees when the command does not support them', async () => {
        const context = createContext({ wt: true });
        await context.init();

        expect(context.repos).toEqual(['repo-a', 'repo-b', 'repo-a/sub']);
        expect(gitHelper.listWorktrees).not.toHaveBeenCalled();
      });
    });

    it('should leave the repositories untouched without submodules', async () => {
      jest.spyOn(gitHelper, 'getSubmodules').mockResolvedValue([]);

      const context = createContext();
      await context.init();

      expect(context.repos).toEqual(['repo-a', 'repo-b']);
      expect(context.submoduleToParentMap.size).toBe(0);
    });
  });

  describe('getGitAPI', () => {
    it('should cache the git API per repository', () => {
      const context = createContext();
      const initSpy = jest.spyOn(gitHelper, 'initSimpleGit');

      const sg = context.getGitAPI('repo-a');
      expect(sg).toBe(mocks.sg);
      expect(context.getGitAPI('repo-a')).toBe(sg);
      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(context.errors).toEqual([]);
    });

    it('should return a fallback and record the error when git cannot be initialized', async () => {
      jest.spyOn(gitHelper, 'initSimpleGit').mockImplementation(() => {
        throw new Error("Cannot start: repository '/my/root/folder/repo-a' does not exist");
      });

      const context = createContext();
      const sg = context.getGitAPI('repo-a');

      expect(sg.repo).toBe('repo-a');
      expect(sg.context).toBe(context);
      expect(await sg.stashList()).toEqual([]);
      expect(await sg.raw(['log'])).toBe('');
      expect(context.errors).toEqual([
        {
          repo: 'repo-a',
          error:
            "Failed to initialize git for repo repo-a: Cannot start: repository '/my/root/folder/repo-a' does not exist",
        },
      ]);
    });
  });

  describe('getDefaultBranch', () => {
    it("should default to 'main'", () => {
      expect(createContext().getDefaultBranch('repo-a')).toBe('main');
    });

    it('should use the configured default branch', () => {
      expect(createContext({ defaultBranch: 'master' }).getDefaultBranch('repo-a')).toBe('master');
    });

    it('should use the per-repository branch from a string config', () => {
      const context = createContext({ branches: 'repo-a:develop,repo-b:trunk' });
      expect(context.getDefaultBranch('repo-a')).toBe('develop');
      expect(context.getDefaultBranch('repo-b')).toBe('trunk');
      expect(context.getDefaultBranch('repo-c')).toBe('main');
    });

    it('should use the per-repository branch from an object config', () => {
      const context = createContext({ branches: { 'repo-a': 'develop' } });
      expect(context.getDefaultBranch('repo-a')).toBe('develop');
      expect(context.getDefaultBranch('repo-b')).toBe('main');
    });
  });

  describe('Branch references', () => {
    it('should resolve references from `refs`', () => {
      const context = createContext({
        branches: { 'repo-a': '${release}', 'repo-b': 'develop' },
        refs: { release: 'release-2.0' },
      });

      expect(context.getDefaultBranch('repo-a')).toBe('release-2.0');
      expect(context.getDefaultBranch('repo-b')).toBe('develop');
    });

    it('should resolve references from a string config', () => {
      const context = createContext({ branches: 'repo-a:${release}', refs: { release: 'release-2.0' } });
      expect(context.getDefaultBranch('repo-a')).toBe('release-2.0');
    });

    it('should keep unknown references as is', () => {
      const context = createContext({ branches: { 'repo-a': '${unknown}' }, refs: { release: 'release-2.0' } });
      expect(context.getDefaultBranch('repo-a')).toBe('${unknown}');
    });

    it('should keep references as is when no `refs` are configured', () => {
      const context = createContext({ branches: { 'repo-a': '${release}' } });
      expect(context.getDefaultBranch('repo-a')).toBe('${release}');
    });
  });

  describe('toPrintableUrl', () => {
    it('should return the raw url in raw mode', () => {
      const context = createContext({ raw: true });
      expect(context.toPrintableUrl('https://github.com/o/r/pull/42')).toBe('https://github.com/o/r/pull/42');
    });

    it('should generate a terminal hyperlink using the last path item', () => {
      const context = createContext();
      expect(context.toPrintableUrl('https://github.com/o/r/pull/42')).toBe(
        '\x1B]8;;https://github.com/o/r/pull/42\x0742\x1B]8;;\x07'
      );
    });

    it('should ignore trailing slashes when computing the id', () => {
      const context = createContext();
      expect(context.toPrintableUrl('https://github.com/o/r/pull/42/')).toBe(
        '\x1B]8;;https://github.com/o/r/pull/42/\x0742\x1B]8;;\x07'
      );
    });

    it('should use the provided id', () => {
      const context = createContext();
      expect(context.toPrintableUrl('https://ci/build/1', 'build')).toBe('\x1B]8;;https://ci/build/1\x07build\x1B]8;;\x07');
    });

    it('should return an empty string without url', () => {
      const context = createContext();
      expect(context.toPrintableUrl()).toBe('');
      expect(context.toPrintableUrl('')).toBe('');
    });
  });
});
