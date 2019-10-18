<p align="center">
  <a href="https://travis-ci.org/Y--/multipull"><img src="https://travis-ci.org/Y--/multipull.svg?branch=master" alt="Travis Build Status"></a>
  <a href="https://codecov.io/gh/Y--/multipull"><img src="https://codecov.io/gh/Y--/multipull/branch/master/graph/badge.svg" alt="Codecov badge"></a>
</p>

# multipull - Manage multiple git repositories

## Install

`npm i -g multipull`

## Configure

Add a `.multipullrc` file in your home directory containing a JSON with the following keys :

* `root` : the absolute path where your repositories are located
* `repos` : an array of repositories names
* `branches` : the default branch in the repository if not `master`

Example:

```json
{
  "root": "/your/workspace/root/path",
  "collaborators": "your,comma,separated,list,of,collaborators",
  "repos": ["an", "array", "of", "repositories", "in", "root"],
  "branches": {
    "my-repo1": "my-default-branch"
  }
}
```

## Usage

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

Note that it will abort if the current branch is the default one (eg. master).

#### Parameter `reviewers`

A comma separated list of GitHub user ids can be provided to be added at the list of reviewers

eg.: `multipr --reviewers=John,Jack`

#### Parameter `collaborators`

A comma separated list of GitHub user ids can be provided to be added at the list of collaborators.
When creating a pull request, two ids will be picked randomly and added at the list of reviewers.

eg.: `multipr --collaborators=John,Jack`

#### Parameter `m`

Use this parameter to edit the pull request description

eg.: `multipr --m`

### multipull
### multipush
### multirebase
### multistatus

#### Basic


#### With Pull Request

On the repositories that are on a branch different from the default branch, and have an open Github pull request,  `multistatus --pr` will output:
* the pull request's mergability status (wether it conflicts with the destination branch) ;
* Github's "checks" status ;
* the number of "approved", "request for changes" and "comments".

#### With Continous Integration Report

On the repositories that are on a branch different from the default branch, `multistatus --ci` will output Github's "checks" status


## TODO
 * Documentation
 * More tests
 * Get assignees automatically
  ** `GET` `/repos/:owner/:repo/assignees/:assignee`
  ** cache them in `~/.multipullrc`, expire them every week or month (by default)
 * Implement "browse" flag when creating PR
 * After 'merge PR':
  ** checkout master on these repos
  ** pull on these repos
