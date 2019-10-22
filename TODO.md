* Improve documentation
* More tests
* Get assignees automatically
** `GET` `/repos/:owner/:repo/assignees/:assignee`
** cache them in `~/.multipullrc`, expire them every week or month (by default)
* Implement "browse" flag when creating PR
* After 'merge PR':
** checkout master on these repos
** pull on these repos
