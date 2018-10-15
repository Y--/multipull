const Context = require('../lib/helpers/context');
module.exports.createFixtureContext = function(repos)  {
  return new Context('test-multipull', {
    branches: '',
    root: '/my/root/folder',
    repos
  });
}