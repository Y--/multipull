const Context = require('../lib/helpers/context');
const { mocks } = require('./mocks');

exports.createFixtureContext = function(repos)  {
  return new Context('test-multipull', {
    branches: '',
    root: '/my/root/folder',
    repos
  });
};

exports.setupTests = function(testSuiteFactory) {
  testSuiteFactory(...genHooks({ debug: true }));
  testSuiteFactory(...genHooks({ debug: false }));
};

function genHooks(params) {
  return [() => {
    beforeAll(() => {
      mocks.debug.enabled = params.debug;
    });
  }, params];
}