* if no tracking: push branch when calling `multipr`
* add `--skip=repo,list`
* Improve documentation
* Migrate to GraphQL
* test latest multipr
* multipr should return `multistatus --pr` when nothing to do
* multimerge should refuse if one PR is in `blocked/draft` state (unless forced?)
* More tests
* Get assignees automatically
** `GET` `/repos/:owner/:repo/assignees/:assignee`
** cache them in `~/.multipullrc`, expire them every week or month (by default)
* After 'merge PR':
** checkout `mainBranch` on these repos
** pull on these repos
* add `--outdated` to `multistatus` => check how many outdated depedencies + check diff vs package.json