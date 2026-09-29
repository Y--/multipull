const Context = require('../lib/helpers/context');
const { mocks } = require('./mocks');

exports.createFixtureContext = function (repos, branches = '') {
  const context = new Context('test-multipull', { branches, root: '/my/root/folder', repos });
  context.submoduleToParentMap = new Map();
  context.config._ = []; // `rc` parses jest's own argv: don't pick up the test file path as the working branch
  return context;
};

const scenarios = [{ debug: true }, { debug: false }];

exports.setupTests = function (testSuiteFactory) {
  for (const scenario of scenarios) {
    describe(`With ${JSON.stringify(scenario)}`, () => {
      testSuiteFactory(...genHooks(scenario));
    });
  }
};

function genHooks(params) {
  return [
    () => {
      beforeAll(() => {
        mocks.debug.enabled = params.debug;
      });
    },
    params,
  ];
}
