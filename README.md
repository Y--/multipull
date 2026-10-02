<p align="center">
  <a href="https://app.travis-ci.com/Y--/multipull"><img src="https://app.travis-ci.com/Y--/multipull.svg?branch=master" alt="Travis Build Status"></a>
  <a href="https://codecov.io/gh/Y--/multipull"><img src="https://codecov.io/gh/Y--/multipull/branch/master/graph/badge.svg" alt="Codecov badge"></a>
</p>

# multipull - Manage multiple git repositories

## Install

`npm i -g multipull`

## Configure

Add a `.multipullrc` file in your home directory containing a JSON with the following keys :

* `root` : the absolute path where your repositories are located
* `repos` : an array of repositories names (will use every folder that have a `.git` folder in `root` if not specified)
* `branches` : the default branch in the repository if not `main`

Example:

```json
{
  "root": "/your/workspace/root/path",
  "collaborators": "your,comma,separated,list,of,collaborators",
  "repos": ["an", "array", "of", "repositories", "in", "root"],
  "branches": {
    "my-repo1": "my-default-branch"
  },
  "issueTracker": {
    "issueIdPattern": "[0-9]{9}",
    "urlPrefix": "https://www.pivotaltracker.com/story/show/"
  }
}
```

## Shell completion

`multipull-completion` (installed along with the other commands) prints the completion script of every
`multi*` command. Load it from your shell's startup file:

```sh
# zsh (~/.zshrc, after `compinit`)
source <(multipull-completion zsh)

# bash >= 4 with bash-completion (~/.bashrc)
eval "$(multipull-completion bash)"

# fish (~/.config/fish/config.fish)
multipull-completion fish | source
```

Then press <kbd>Tab</kbd>: flags (`multistatus --pr --<Tab>`), local branches (`multicheckout <Tab>`) and
reviewers taken from the `collaborators` setting (`multipr --reviewers=<Tab>`) are completed.

If you had set up completion with a previous version, remove the `# tabtab source for packages` block from your
shell's startup file (and `~/.config/tabtab`).

## Usage

Every command will always display a table summarizing the status at the end.

Any cell that is equal to the default will contain an empty value,
and any line that only contains default values will be omitted.

Parameter    | Description
------------ | -------------
Repo         | Repository's name
Current      | Current branch (if different from default one)
Tracking     | Tracking branch (if different from default one)
Pushed       | When using `multipush`: displays a confirmation or an reason for not doing so
Merged       | When using `multimerge`: displays a confirmation or an reason for not doing so
Pull Request | When using `multistatus --pr`: displays the link of an existing pull request on the current branch
Mergeable    | Indicate GitHub's mergeable status (i.e no conflict)
Build        | When using `multistatus --ci`: displays the build status on this branch (based on GitHub checks)
Reviews      | Indicate the number of reviews and comment on GitHub's pull request
WT           | Number of linked worktrees (`git worktree list`, without the main one and the prunable ones)
S            | Number of stashes
??           | Number of untracked files
M            | Number of modified files
D            | Number of deleted files
A            | Number of added files
C            | Number of copied files
Files        | When using `multipull` indicate the number of updated files
Changes      | When using `multipull` indicate the number of changed lines
Insertions   | When using `multipull` indicate the number of inserted lines
Deletions    | When using `multipull` indicate the number of deleted lines
Error        | Error message
E            | Elapsed time

Note the `Files` section may contain:
* a `(n)` suffix is added when native files are updated
* a `(p)` suffix is added when a `package.json` file is updated

## Commands overview

Command       | Description
------------- | -------------
[multicheckout](#multicheckout) | `git checkout <branch>`
[multiexec](#multiexec)         | run command in each repos
[multimerge](#multimerge)       | merge pull request
[multipr](#multipr)             | create pull request
[multipull](#multipull)         | pull from remote branch
[multipush](#multipush)         | push to remote branch
[multirebase](#multirebase)     | rebase from remote branch
[multistatus](#multistatus)     | summarize repositories' status

## Commands description

### multicheckout

By default, `multicheckout [branch]` will run
  * `git checkout branch` if `branch` is provided
  * `git checkout defaultRepositoryBranch` otherwise (where `defaultRepositoryBranch` is provided in the configuration file)

in all the repositories specified in the configuration.

Notes:
* if the repository doesn't have such a branch, nothing will happen ;
* if a conflict/error happen during the checkout in one repository, the checkout of the branch in this repostory will be aborted.

### multiexec

`multiexec --exec=<command>` will run the same command in each repository

### multimerge

When on a branch different from the default branch, `multimerge` will merge any existing pull-request found related to this branch.

### multipr

`multipr` will attempt to create a pull request in all the repositories that are on the same branch as the current repository.

Note that it will abort if the current branch is the default one (eg. `main`).

#### Parameter `reviewers`

A comma separated list of GitHub user ids can be provided to be added at the list of reviewers

eg.: `multipr --reviewers=John,Jack`

Note: a GitHub `team` can be assigned by prefixing its `slug` with `team/`:

eg.: `multipr --reviewers=team/justice-league`

#### Parameter `collaborators`

A comma separated list of GitHub user ids can be provided to be added at the list of collaborators.
When creating a pull request, two ids will be picked randomly and added at the list of reviewers.

eg.: `multipr --collaborators=John,Jack`

#### Parameter `m`

Use this parameter to edit the pull request description

eg.: `multipr --m`

#### Parameter `approve`

Submit an `APPROVE` review on the current pull request.

### multipull

Execute `git pull` all repositories.

eg. `multipull`

Notes:
* will attempt to rebase if need be;
* abort pulling of a remote branch if it would produce conflicts;
* updates the outdated submodules (see below).

#### Submodules

After pulling a repository, `multipull` updates (`git submodule update --recursive`) its submodules that are not
checked out at the commit recorded in the repository, as long as no work can be lost, i.e. submodules:
* that are initialized;
* without local changes (untracked files are fine);
* checked out at a commit that is either:
  * contained in the recorded one (the submodule is behind);
  * or, on a detached HEAD, contained in a remote branch or a tag (e.g. left there by a `git submodule update` on
    another branch).

The other submodules are left untouched, and the reason is shown in the summary, e.g. `not updated: local changes`,
`not updated: on branch <branch>, with commits that <repo> doesn't have` or
`not updated: has commits that are on no branch`.

#### Parameter `no-submodule`

Don't update the submodules.

eg. `multipull --no-submodule`

### multipush

Execute `git push` in all repositories.

eg. `multipush`

#### Parameter `force`

Execute `git push --force` in all repositories.

eg. `multipush --force`

Notes:
* will refuse to force-push on default branch;
* will call `git` with `--set-upstream origin` if the current `tracking` branch is not set.

### multirebase

Execute `git rebase <orgin branch>` in all repositories where the branch is different from the default one.

### multistatus

#### Basic

Displays the status of the current repositories

eg. `multistatus`

#### With worktrees (`--worktree` or `--wt`)

Also displays the status of every linked worktree (`git worktree list`) of the repositories, below their repository
(e.g. `wt:my-feature`): current branch, tracking branch, ahead/behind counts and local changes. Stashes are shared by
all the worktrees of a repository, so they are only shown on the repository itself. Can be combined with `--pr` and
`--ci`.

eg. `multistatus --wt`

#### With Pull Request (`--pr`)

On the repositories that are on a branch different from the default branch, and have an open Github pull request,  `multistatus --pr` will output:
* the pull request's mergability status (wether it conflicts with the destination branch) ;
* Github's "checks" status ;
* the number of "approved", "request for changes" and "comments".

#### Only Pull Requests URLs (`--pr --list`)

On the repositories that are on a branch different from the default branch, and have an open Github pull request,  `multistatus --pr --list` will output the urls of each PRs.

#### Open Pull Requests URLs (`--pr --open`)

On the repositories that are on a branch different from the default branch, and have an open Github pull request,  `multistatus --pr --open` will open the PRs URLs in the default system browser.

#### With Continous Integration Report (`--ci`)

On the repositories that are on a branch different from the default branch, `multistatus --ci` will output Github's "checks" status
