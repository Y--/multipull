const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const completion = require('../lib/completion');

const BIN_DIR = path.join(__dirname, '..', 'bin');
const COMPLETION_BIN = path.join(BIN_DIR, 'multipull-completion');

let tmpDir;
let gitRepoDir;
let notGitDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipull-completion-'));
  gitRepoDir = path.join(tmpDir, 'repo');
  notGitDir = path.join(tmpDir, 'not-a-repo');
  fs.mkdirSync(gitRepoDir);
  fs.mkdirSync(notGitDir);

  const git = (...args) => childProcess.execFileSync('git', args, { cwd: gitRepoDir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
  git('branch', 'feature/foo');
  git('branch', 'fix-bar');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Runs the completer the way the generated shell scripts do: `multipull-completion <cmd> complete -- <words...>`
function runCompleter(command, words, { cwd = gitRepoDir, collaborators = 'alice,bob,carol' } = {}) {
  const env = { ...process.env, HOME: tmpDir, multipull_collaborators: collaborators };
  if (collaborators === null) {
    delete env.multipull_collaborators;
  }

  const res = childProcess.spawnSync(process.execPath, [COMPLETION_BIN, command, 'complete', '--', ...words], {
    cwd,
    env,
    encoding: 'utf8',
  });
  expect(res.status).toBe(0);
  const lines = res.stdout.trim().split('\n');
  const directive = Number(lines.pop().slice(1));
  return { values: lines.map((line) => line.split('\t')[0]), directive, lines };
}

describe('Completion', () => {
  describe('commands', () => {
    it('should describe every command in bin/', () => {
      const commands = fs.readdirSync(BIN_DIR).filter((file) => file !== 'multipull-completion');
      expect(Object.keys(completion.COMMANDS).sort()).toEqual(commands.sort());
    });
  });

  describe('getSuggestedReviewers', () => {
    it('should suggest every collaborator', () => {
      expect(completion.getSuggestedReviewers('', 'alice,bob')).toEqual(['alice', 'bob']);
    });

    it('should accept an array of collaborators', () => {
      expect(completion.getSuggestedReviewers('', ['alice', 'bob'])).toEqual(['alice', 'bob']);
    });

    it('should not suggest the reviewers already listed, and keep them as prefix', () => {
      expect(completion.getSuggestedReviewers('bob,', 'alice,bob,carol')).toEqual(['bob,alice', 'bob,carol']);
      expect(completion.getSuggestedReviewers('bob,ca', 'alice,bob,carol')).toEqual(['bob,alice', 'bob,carol']);
    });

    it('should not suggest anything without collaborators', () => {
      expect(completion.getSuggestedReviewers('', undefined)).toEqual([]);
      expect(completion.getSuggestedReviewers('', true)).toEqual([]);
    });
  });

  describe('getAvailableOptions', () => {
    const names = (command, words) => completion.getAvailableOptions(command, words).map(({ name }) => name);

    it('should not suggest the options already used', () => {
      expect(names('multipush', ['--force'])).toEqual(['dry', 'this', 'all', 'raw']);
    });

    it('should only suggest the dependent options once their parent is used', () => {
      expect(names('multistatus', [])).toEqual(['pr', 'ci', 'open-ci', 'this', 'all', 'raw']);
      expect(names('multistatus', ['--pr'])).toEqual(['list', 'open', 'ci', 'open-ci', 'this', 'all', 'raw']);
      expect(names('multistatus', ['--pr', '--open'])).toContain('files');
      expect(names('multistatus', ['--ci'])).toEqual(expect.arrayContaining(['full', 'ci-url']));
    });
  });

  describe('shouldSuggestFlagsOnEmptyWord', () => {
    it('should suggest flags for commands without positional argument', () => {
      expect(completion.shouldSuggestFlagsOnEmptyWord('multistatus', [])).toBe(true);
    });

    it('should suggest the branches first for commands taking a branch', () => {
      expect(completion.shouldSuggestFlagsOnEmptyWord('multicheckout', [])).toBe(false);
      expect(completion.shouldSuggestFlagsOnEmptyWord('multicheckout', ['my-branch'])).toBe(true);
    });

    it('should not suggest flags when completing the value of `--option value`', () => {
      expect(completion.shouldSuggestFlagsOnEmptyWord('multipr', ['--reviewers'])).toBe(false);
      expect(completion.shouldSuggestFlagsOnEmptyWord('multiexec', ['--exec'])).toBe(false);
    });
  });

  describe('listLocalBranches', () => {
    it('should list the local branches', () => {
      expect(completion.listLocalBranches(gitRepoDir).sort()).toEqual(['feature/foo', 'fix-bar', 'main']);
    });

    it('should not list anything outside a git repository', () => {
      expect(completion.listLocalBranches(notGitDir)).toEqual([]);
    });

    it('should not throw when the directory does not exist', () => {
      expect(completion.listLocalBranches(path.join(tmpDir, 'does-not-exist'))).toEqual([]);
    });
  });

  describe('main', () => {
    it('should reject an invalid usage', () => {
      const res = childProcess.spawnSync(process.execPath, [COMPLETION_BIN, 'nope'], { encoding: 'utf8' });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Usage: multipull-completion <zsh|bash|fish>');
    });

    it('should reject an unknown command', () => {
      const res = childProcess.spawnSync(process.execPath, [COMPLETION_BIN, 'toString', 'complete', '--', ''], {
        encoding: 'utf8',
      });
      expect(res.status).toBe(1);
    });
  });

  describe('scripts', () => {
    const generate = (shell) => childProcess.execFileSync(process.execPath, [COMPLETION_BIN, shell], { encoding: 'utf8' });

    it('should generate a zsh script registering every command', () => {
      const script = generate('zsh');
      for (const command of Object.keys(completion.COMMANDS)) {
        expect(script).toContain(`compdef _${command} ${command}\n`);
        expect(script).toContain(`requestComp="multipull-completion ${command} complete -- `);
      }
    });

    it('should generate a bash script that can be sourced several times', () => {
      const script = generate('bash');
      for (const command of Object.keys(completion.COMMANDS)) {
        expect(script).toContain(`complete -F __${command}_complete ${command}\n`);
      }
      expect(script).not.toMatch(/^readonly /m);
      expect(script.match(/^ShellCompDirectiveError=1$/gm)).toHaveLength(1);
      expect(script).toContain('[[ "$cur" == --*=* ]] && cur="${cur#*=}"');
    });

    it('should generate a fish script registering every command', () => {
      const script = generate('fish');
      for (const command of Object.keys(completion.COMMANDS)) {
        expect(script).toContain(`complete -c ${command} `);
      }
    });
  });

  describe('completer', () => {
    describe('multistatus', () => {
      it('should suggest the flags on an empty word', () => {
        const { values, directive } = runCompleter('multistatus', ['']);
        expect(values).toEqual(['--pr', '--ci', '--open-ci', '--this', '--all', '--raw']);
        expect(directive).toBe(4); // No file completion
      });

      it('should include the descriptions', () => {
        const { lines } = runCompleter('multistatus', ['--p']);
        expect(lines).toEqual(['--pr\tShow the pull requests']);
      });

      it('should suggest --list and --open after --pr', () => {
        const { values } = runCompleter('multistatus', ['--pr', '--']);
        expect(values).toEqual(['--list', '--open', '--ci', '--open-ci', '--this', '--all', '--raw']);
      });

      it('should filter on the current word', () => {
        expect(runCompleter('multistatus', ['--pr', '--o']).values).toEqual(['--open', '--open-ci']);
      });
    });

    describe('multipush', () => {
      it('should suggest --force', () => {
        expect(runCompleter('multipush', ['--f']).values).toEqual(['--force']);
      });
    });

    describe('multipr', () => {
      it('should suggest --reviewers= without a trailing space', () => {
        const { values, directive } = runCompleter('multipr', ['--rev']);
        expect(values).toEqual(['--reviewers=']);
        expect(directive).toBe(4 | 2); // No file completion, no space
      });

      it('should suggest the collaborators as reviewers', () => {
        expect(runCompleter('multipr', ['--reviewers=']).values).toEqual(['alice', 'bob', 'carol']);
        expect(runCompleter('multipr', ['--reviewers=b']).values).toEqual(['bob']);
        expect(runCompleter('multipr', ['--reviewers', '']).values).toEqual(['alice', 'bob', 'carol']);
      });

      it('should not suggest the reviewers already listed', () => {
        expect(runCompleter('multipr', ['--reviewers=alice,']).values).toEqual(['alice,bob', 'alice,carol']);
      });

      it('should use the collaborators given on the command line', () => {
        expect(runCompleter('multipr', ['--collaborators=x,y', '--reviewers=']).values).toEqual(['x', 'y']);
      });

      it('should not suggest reviewers without collaborators', () => {
        expect(runCompleter('multipr', ['--reviewers='], { collaborators: null }).values).toEqual([]);
      });

      it('should suggest the flags', () => {
        const { values } = runCompleter('multipr', ['--']);
        expect(values).toEqual(expect.arrayContaining(['--reviewers=', '--collaborators=', '--m', '--approve']));
      });
    });

    describe('multicheckout', () => {
      it('should suggest the local branches', () => {
        expect(runCompleter('multicheckout', ['']).values.sort()).toEqual(['feature/foo', 'fix-bar', 'main']);
        expect(runCompleter('multicheckout', ['f']).values.sort()).toEqual(['feature/foo', 'fix-bar']);
        expect(runCompleter('multicheckout', ['--branch=fi']).values).toEqual(['fix-bar']);
      });

      it('should suggest the flags once the branch is given', () => {
        expect(runCompleter('multicheckout', ['main', '']).values).toEqual(['--branch=', '--this', '--all', '--raw']);
      });

      it('should not suggest anything outside a git repository', () => {
        const { values, directive } = runCompleter('multicheckout', [''], { cwd: notGitDir });
        expect(values).toEqual([]);
        expect(directive).toBe(4);
      });
    });
  });
});
