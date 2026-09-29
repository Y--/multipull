const { updateOutdatedSubmodules } = require('../../lib/helpers/submodules');

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

// Fake git of a submodule: `changes` in `git status`, `commits` it knows, `mergeBase` of HEAD and the recorded commit,
// `branch` checked out ('' when detached), `containedIn`: the remote branch or tag containing HEAD ('' when none)
function createSubmoduleSg({
  changes = '',
  commits = [OLD, NEW],
  mergeBase = OLD,
  fetchedCommits = [],
  branch = '',
  containedIn = '',
} = {}) {
  const known = new Set(commits);
  return {
    raw: jest.fn(async ([command, ...args]) => {
      if (command === 'status') {
        return changes;
      }
      if (command === 'cat-file') {
        if (!known.has(args[1])) {
          throw new Error(`fatal: Not a valid object name ${args[1]}`);
        }
        return 'commit\n';
      }
      if (command === 'merge-base') {
        return mergeBase + '\n';
      }
      if (command === 'symbolic-ref') {
        return branch ? branch + '\n' : ''; // Like git on a detached HEAD: exit code 1, no output
      }
      if (command === 'for-each-ref') {
        return containedIn ? containedIn + '\n' : '';
      }
      throw new Error(`Unexpected command ${command}`);
    }),
    fetch: jest.fn(async () => fetchedCommits.forEach((c) => known.add(c))),
  };
}

// `submodules`: { path: { recorded, head, flag, sg } } where `flag` is the `git submodule status` prefix
function createContext(submodules, { updateError = null } = {}) {
  const submoduleToParentMap = new Map([['other/x', 'other']]);
  const sgs = new Map();
  let lsFiles = '';
  let submoduleStatus = '';
  for (const [path, { recorded = NEW, head = OLD, flag = '+', sg = createSubmoduleSg() }] of Object.entries(
    submodules,
  )) {
    submoduleToParentMap.set(`parent/${path}`, 'parent');
    sgs.set(`parent/${path}`, sg);
    lsFiles += `160000 ${recorded} 0\t${path}\n`;
    submoduleStatus += `${flag}${head} ${path} (heads/main)\n`;
  }

  const parentSg = {
    raw: jest.fn(async ([command, sub]) => {
      if (command === 'ls-files') {
        return lsFiles;
      }
      if (command === 'submodule' && sub === 'status') {
        return submoduleStatus;
      }
      if (command === 'submodule' && sub === 'update') {
        if (updateError) {
          throw new Error(updateError);
        }
        return '';
      }
      throw new Error(`Unexpected command ${command}`);
    }),
  };
  sgs.set('parent', parentSg);

  return { submoduleToParentMap, getGitAPI: (repo) => sgs.get(repo), parentSg, sgs };
}

const updateCalls = (context) =>
  context.parentSg.raw.mock.calls.filter(([[c, s]]) => c === 'submodule' && s === 'update');

describe('updateOutdatedSubmodules', () => {
  it("should not run anything when the repository doesn't have submodules", async () => {
    const context = createContext({});
    context.submoduleToParentMap.delete('other/x');

    await expect(updateOutdatedSubmodules(context, 'parent')).resolves.toEqual({ updated: [], skipped: [] });
    expect(context.parentSg.raw).not.toHaveBeenCalled();
  });

  it('should update a clean submodule that is behind the recorded commit', async () => {
    const context = createContext({ sub: {} });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result).toEqual({ updated: [{ path: 'sub', from: OLD, to: NEW }], skipped: [] });
    expect(updateCalls(context)).toEqual([[['submodule', 'update', '--recursive', '--jobs=8', '--', 'sub']]]);
    expect(context.sgs.get('parent/sub').raw.mock.calls).toEqual([
      [['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=dirty']],
      [['cat-file', '-t', NEW]],
      [['merge-base', OLD, NEW]],
    ]);
  });

  it('should update every outdated submodule with a single command', async () => {
    const context = createContext({ a: {}, 'with space': {}, 'nested/b': {} });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result.updated.map((u) => u.path)).toEqual(['a', 'with space', 'nested/b']);
    expect(updateCalls(context)).toEqual([
      [['submodule', 'update', '--recursive', '--jobs=8', '--', 'a', 'with space', 'nested/b']],
    ]);
  });

  it('should leave in sync and not initialized submodules alone, silently', async () => {
    const context = createContext({ synced: { head: NEW, flag: ' ' }, uninit: { flag: '-' } });

    await expect(updateOutdatedSubmodules(context, 'parent')).resolves.toEqual({ updated: [], skipped: [] });
    expect(updateCalls(context)).toEqual([]);
  });

  [
    { title: 'it has local changes', sg: createSubmoduleSg({ changes: ' M file.c\n' }), reason: 'local changes' },
    {
      title: 'it is on a branch with commits the parent does not have',
      sg: createSubmoduleSg({ mergeBase: OTHER, branch: 'my-work', containedIn: 'refs/remotes/origin/my-work' }),
      reason: "on branch my-work, with commits that parent doesn't have",
    },
    {
      title: 'its detached HEAD has commits that are on no remote branch or tag',
      sg: createSubmoduleSg({ mergeBase: OTHER }),
      reason: 'has commits that are on no branch',
    },
    {
      title: 'the recorded commit cannot be fetched',
      sg: createSubmoduleSg({ commits: [OLD] }),
      reason: `commit ${NEW.slice(0, 7)} not found`,
    },
    { title: 'it is in a merge conflict', flag: 'U', reason: 'merge conflict' },
  ].forEach(({ title, sg, flag = '+', reason }) => {
    it(`should not update a submodule when ${title}`, async () => {
      const context = createContext({ sub: { sg, flag }, ok: {} });

      const result = await updateOutdatedSubmodules(context, 'parent');

      expect(result.skipped).toEqual([{ path: 'sub', reason }]);
      expect(result.updated.map((u) => u.path)).toEqual(['ok']);
      expect(updateCalls(context)).toEqual([[['submodule', 'update', '--recursive', '--jobs=8', '--', 'ok']]]);
    });
  });

  it('should update a detached submodule that diverged, when its commits are on a remote branch', async () => {
    const sg = createSubmoduleSg({ mergeBase: OTHER, containedIn: 'refs/remotes/origin/some-backport' });
    const context = createContext({ sub: { sg } });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result).toEqual({ updated: [{ path: 'sub', from: OLD, to: NEW }], skipped: [] });
    expect(sg.raw.mock.calls.slice(-2)).toEqual([
      [['symbolic-ref', '--quiet', '--short', 'HEAD']],
      [['for-each-ref', '--count=1', `--contains=${OLD}`, '--format=%(refname)', 'refs/remotes', 'refs/tags']],
    ]);
  });

  it('should update a submodule that is behind, even on a branch (its commits stay on the branch)', async () => {
    const sg = createSubmoduleSg({ branch: 'main' });
    const context = createContext({ sub: { sg } });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result.updated.map((u) => u.path)).toEqual(['sub']);
    expect(sg.raw.mock.calls.map(([[c]]) => c)).not.toContain('symbolic-ref'); // No need to look further
  });

  it('should fetch the submodule when it does not have the recorded commit yet', async () => {
    const sg = createSubmoduleSg({ commits: [OLD], fetchedCommits: [NEW] });
    const context = createContext({ sub: { sg } });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(sg.fetch).toHaveBeenCalledTimes(1);
    expect(result.updated.map((u) => u.path)).toEqual(['sub']);
  });

  it('should report the submodules that could not be updated when the update fails', async () => {
    const context = createContext({ a: {}, b: {} }, { updateError: 'fatal: unable to checkout\nmore details' });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([
      { path: 'a', reason: 'update failed: fatal: unable to checkout' },
      { path: 'b', reason: 'update failed: fatal: unable to checkout' },
    ]);
  });

  it('should skip a submodule whose checks fail', async () => {
    const sg = { raw: jest.fn().mockRejectedValue(new Error('fatal: not a git repository')), fetch: jest.fn() };
    const context = createContext({ sub: { sg } });

    const result = await updateOutdatedSubmodules(context, 'parent');

    expect(result.skipped).toEqual([{ path: 'sub', reason: 'cannot check it: fatal: not a git repository' }]);
    expect(updateCalls(context)).toEqual([]);
  });
});
