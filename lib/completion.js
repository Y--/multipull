'use strict';

// Shell completion for the multi* commands, built on @bomb.sh/tab.
//
// tab's model is one program with a `complete` subcommand: the generated shell script
// runs `<executable> complete -- <words after the program name>` and prints one
// `value<TAB>description` line per candidate, then a `:<directive>` line.
// multipull ships separate binaries, so a single `multipull-completion` entry point:
//   * `multipull-completion <shell>` prints the scripts for every command, each one
//     registered for its command name with `multipull-completion <command>` as executable;
//   * `multipull-completion <command> complete -- <words...>` answers the requests.

const childProcess = require('child_process');
const rc = require('rc');

const APP_NAME = 'multipull';
const COMPLETION_BIN = 'multipull-completion';
const SHELLS = ['zsh', 'bash', 'fish'];

// Values of tab's ShellCompDirective (see @bomb.sh/tab `ShellCompDirective`)
const DIRECTIVE_ERROR = 1;
const DIRECTIVE_NO_SPACE = 2;
const DIRECTIVE_NO_FILE_COMP = 4;

const branchValues = ({ cwd }) => listLocalBranches(cwd);

const COMMON_OPTIONS = [
  { name: 'this', description: 'Only process the repository of the current directory' },
  { name: 'all', description: 'Show every repository in the summary, even unchanged ones' },
  { name: 'raw', description: 'Print raw URLs instead of terminal hyperlinks' },
];

const BRANCH_OPTION = { name: 'branch', description: 'Branch to work on', values: branchValues };

const COMMANDS = {
  multicheckout: {
    description: 'Checkout a branch in every repository',
    branchArgument: true,
    options: [BRANCH_OPTION],
  },
  multiexec: {
    description: 'Run a command in every repository',
    options: [
      { name: 'exec', description: 'Command to run', values: () => [] },
      { name: 'match', description: 'Only run in repositories matching this regular expression', values: () => [] },
    ],
  },
  multilist: {
    description: 'List the repositories having a branch',
    branchArgument: true,
    options: [BRANCH_OPTION, { name: 'openprs', description: 'List the open pull requests instead' }],
  },
  multimerge: {
    description: 'Merge the default branch into the current branch',
    options: [],
  },
  multimergepr: {
    description: 'Merge the pull requests of a branch',
    branchArgument: true,
    options: [BRANCH_OPTION, { name: 'dry', description: 'Dry run: do not merge anything' }],
  },
  multipr: {
    description: 'Create or update pull requests',
    branchArgument: true,
    options: [
      BRANCH_OPTION,
      { name: 'reviewers', description: 'Comma separated reviewers (empty for none)', values: reviewerValues },
      { name: 'collaborators', description: 'Comma separated candidates for random reviewers', values: reviewerValues },
      { name: 'm', description: 'Edit the pull request description' },
      { name: 'approve', description: 'Approve the pull request' },
      { name: 'ready', description: 'Create the pull request as ready for review' },
      { name: 'draft', description: 'Keep the pull request as draft' },
      { name: 'update', description: 'Update the pull request description' },
    ],
  },
  multipull: {
    description: 'Pull every repository',
    options: [{ name: 'no-submodule', description: "Don't update the outdated submodules" }],
  },
  multipush: {
    description: 'Push every repository',
    options: [
      { name: 'force', description: 'Force push (never on the default branch)' },
      { name: 'dry', description: 'Dry run: do not push anything' },
    ],
  },
  multirebase: {
    description: 'Rebase every repository on its default branch',
    options: [],
  },
  multistatus: {
    description: 'Summarize the status of every repository',
    options: [
      { name: 'pr', description: 'Show the pull requests' },
      { name: 'list', description: 'Only list the pull requests URLs', requires: 'pr' },
      { name: 'open', description: 'Open the pull requests in the browser', requires: 'pr' },
      { name: 'files', description: 'Open the "Files changed" tab', requires: 'open' },
      { name: 'ci', description: 'Show the CI status' },
      { name: 'full', description: 'Show the status of every check', requires: 'ci' },
      { name: 'ci-url', description: 'Show the CI build URL', requires: 'ci' },
      { name: 'open-ci', description: 'Open the CI builds in the browser' },
      { name: 'worktree', description: 'Also show the status of the linked worktrees', excludes: ['wt'] },
      { name: 'wt', description: 'Also show the status of the linked worktrees', excludes: ['worktree'] },
    ],
  },
};

function isValueOption(option) {
  return typeof option.values === 'function';
}

function flagName(word) {
  return word.replace(/^-+/, '').split('=')[0];
}

function findOption(commandName, word) {
  if (!word || !word.startsWith('--')) {
    return undefined;
  }

  const name = flagName(word);
  return getAllOptions(commandName).find((option) => option.name === name);
}

function getAllOptions(commandName) {
  return [...COMMANDS[commandName].options, ...COMMON_OPTIONS];
}

// Options still worth suggesting given the words already typed (`previousWords` excludes the current word)
function getAvailableOptions(commandName, previousWords) {
  const used = new Set(previousWords.filter((word) => word.startsWith('--')).map(flagName));
  return getAllOptions(commandName).filter(
    (option) =>
      !used.has(option.name) &&
      (!option.requires || used.has(option.requires)) &&
      !(option.excludes || []).some((name) => used.has(name)), // e.g. aliases
  );
}

// Positional words already typed, skipping the values of `--option value`
function getPositionalWords(commandName, previousWords) {
  const positionals = [];
  for (let i = 0; i < previousWords.length; i++) {
    const word = previousWords[i];
    if (!word.startsWith('-')) {
      positionals.push(word);
      continue;
    }

    const option = findOption(commandName, word);
    if (option && isValueOption(option) && !word.includes('=')) {
      i++;
    }
  }

  return positionals;
}

// tab only suggests flags once the current word starts with `-`. When there is nothing else
// to suggest (no positional argument expected), suggest the flags on an empty word too.
function shouldSuggestFlagsOnEmptyWord(commandName, previousWords) {
  const prev = previousWords[previousWords.length - 1];
  const prevOption = findOption(commandName, prev);
  if (prevOption && isValueOption(prevOption) && !prev.includes('=')) {
    return false; // Completing the value of `--option value`
  }

  const expectsBranch = !!COMMANDS[commandName].branchArgument;
  return !expectsBranch || getPositionalWords(commandName, previousWords).length > 0;
}

function toList(value) {
  if (!value || value === true) {
    return [];
  }

  const list = Array.isArray(value) ? value : String(value).split(',');
  return list.map((item) => String(item).trim()).filter((item) => !!item);
}

// `current` is what's already typed as the option value, e.g. `alice,b` for `--reviewers=alice,b`
function getSuggestedReviewers(current, collaborators) {
  const parts = (current || '').split(',');
  parts.pop(); // The reviewer being typed
  const prefix = parts.length > 0 ? parts.join(',') + ',' : '';
  const alreadyListed = new Set(parts);
  return toList(collaborators)
    .filter((candidate) => !alreadyListed.has(candidate))
    .map((candidate) => prefix + candidate);
}

function reviewerValues({ current, words }) {
  const onCommandLine = words.find((word) => word.startsWith('--collaborators='));
  const collaborators = onCommandLine ? onCommandLine.slice('--collaborators='.length) : loadConfig().collaborators;
  return getSuggestedReviewers(current, collaborators);
}

function loadConfig() {
  try {
    return rc(APP_NAME, {}, { _: [] }) || {}; // Explicit argv: don't parse the completer's own arguments
  } catch {
    return {};
  }
}

function listLocalBranches(cwd = process.cwd()) {
  try {
    const out = childProcess.execFileSync('git', ['branch', '--list', '--format=%(refname:short)'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !!line && !line.startsWith('('));
  } catch {
    return []; // Not in a git repository, git not installed, ...
  }
}

// Value typed so far for the option being completed (`--opt=<value>` or `--opt <value>`)
function getOptionValue(current) {
  const idx = current.indexOf('=');
  return idx >= 0 && current.startsWith('--') ? current.slice(idx + 1) : current;
}

function loadTab() {
  return require('@bomb.sh/tab'); // ESM-only package: relies on require(esm) (Node >= 22.12)
}

function createRootCommand(tab, commandName, words, env) {
  const previousWords = words.slice(0, -1);
  const current = words[words.length - 1] || '';
  const available = new Set(getAvailableOptions(commandName, previousWords));
  const ctx = { cwd: env.cwd, words: previousWords, current: getOptionValue(current) };
  const valuesFromHandlers = new Set();
  const handler = (getValues) => (complete) => {
    for (const value of getValues(ctx)) {
      valuesFromHandlers.add(value);
      complete(value, '');
    }
  };

  // Flags listed by tab: drop the ones not worth suggesting, and suggest `--option=` for the ones taking a value
  const toCandidate = (value) => {
    if (valuesFromHandlers.has(value)) {
      return value;
    }

    const option = findOption(commandName, value);
    if (!option) {
      return value;
    }

    if (!available.has(option)) {
      return null;
    }

    return isValueOption(option) ? `--${option.name}=` : value;
  };

  class MultipullRootCommand extends tab.RootCommand {
    // Same output format as tab's own `complete`, plus the tweaks above and no space after `--option=`
    complete(currentWord) {
      const typed = getOptionValue(currentWord);
      const matches = new Map();
      for (const { value, description } of this.completions) {
        const candidate = toCandidate(value);
        if (candidate !== null && candidate.startsWith(typed) && !matches.has(candidate)) {
          matches.set(candidate, description || '');
        }
      }

      let directive = DIRECTIVE_NO_FILE_COMP;
      if (matches.size > 0 && [...matches.keys()].every((candidate) => candidate.endsWith('='))) {
        directive |= DIRECTIVE_NO_SPACE;
      }

      for (const [candidate, description] of matches) {
        console.log(description ? `${candidate}\t${description}` : candidate); // zsh shows a stray `--` otherwise
      }
      console.log(`:${directive}`);
    }
  }

  const root = new MultipullRootCommand();
  const cmd = root.command(commandName, COMMANDS[commandName].description);
  // Every option is declared, so that tab knows which ones take a value (the ones with a handler)
  for (const option of getAllOptions(commandName)) {
    if (isValueOption(option)) {
      cmd.option(option.name, option.description, handler(option.values));
    } else {
      cmd.option(option.name, option.description);
    }
  }

  if (COMMANDS[commandName].branchArgument) {
    cmd.argument('branch', handler(branchValues));
  }

  return root;
}

function complete(commandName, words, { tab = loadTab(), cwd = process.cwd() } = {}) {
  const args = words.slice();
  if (args.length === 0) {
    args.push('');
  }

  const previousWords = args.slice(0, -1);
  if (args[args.length - 1] === '' && shouldSuggestFlagsOnEmptyWord(commandName, previousWords)) {
    args[args.length - 1] = '--';
  }

  const root = createRootCommand(tab, commandName, args, { cwd });
  root.parse([commandName, ...args]);
}

function captureConsoleLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...items) => lines.push(items.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }

  return lines.join('\n');
}

function generateScript(shell, { tab = loadTab(), commands = Object.keys(COMMANDS) } = {}) {
  const scripts = commands.map((name) =>
    captureConsoleLog(() => tab.script(shell, name, `${COMPLETION_BIN} ${name}`)),
  );

  return (shell === 'bash' ? scripts.map(fixBashScript) : scripts).join('\n');
}

const BASH_COMPREPLY_LINE = 'COMPREPLY=( $(compgen -W "${completions[*]}" -- "$cur") )';

function fixBashScript(script, index) {
  // Every script declares the same `readonly ShellCompDirective*=<n>` variables: declare them once, and not as
  // readonly, so that sourcing the scripts several times (or re-sourcing ~/.bashrc) doesn't fail
  const directives = /^readonly (ShellCompDirective\w+=\d+)$/gm;
  let fixed = index === 0 ? script.replace(directives, '$1') : script.replace(directives, '');

  // `cur` is the whole `--option=value` word, but bash only replaces what follows the `=` (a COMP_WORDBREAKS
  // character) and tab outputs the values alone: filter them on the value
  return fixed.replace(BASH_COMPREPLY_LINE, () => `[[ "$cur" == --*=* ]] && cur="\${cur#*=}"\n    ${BASH_COMPREPLY_LINE}`);
}

function usage() {
  return [
    `Usage: ${COMPLETION_BIN} <${SHELLS.join('|')}>`,
    '',
    'Prints the completion script of every multipull command, e.g. in ~/.zshrc:',
    `  source <(${COMPLETION_BIN} zsh)`,
  ].join('\n');
}

function main(argv) {
  const [first, second, third] = argv;
  if (SHELLS.includes(first)) {
    console.log(generateScript(first));
    return 0;
  }

  if (Object.hasOwn(COMMANDS, first) && second === 'complete' && third === '--') {
    try {
      complete(first, argv.slice(3));
    } catch {
      console.log(`:${DIRECTIVE_ERROR}`);
    }
    return 0;
  }

  console.error(usage());
  return 1;
}

module.exports = {
  COMMANDS,
  SHELLS,
  complete,
  generateScript,
  getAvailableOptions,
  getSuggestedReviewers,
  listLocalBranches,
  main,
  shouldSuggestFlagsOnEmptyWord,
};
