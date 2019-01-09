<p align="center">
  <a href="https://travis-ci.org/Y--/multipull"><img src="https://travis-ci.org/Y--/multipull.svg?branch=master" alt="Travis Build Status"></a>
  <a href="https://codecov.io/gh/Y--/multipull"><img src="https://codecov.io/gh/Y--/multipull/branch/master/graph/badge.svg" alt="Codecov badge"></a>
</p>

# multipull - Manage multiple git repositories

## Install

`npm i -g multipull`

## Configure

Add a `.multipullrc` file in your home directory with the following keys :
* `root` : the absolute path where your repos are located
* `repos` : a comma speparated list of repositories

## Usage

`$ multipull`

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
