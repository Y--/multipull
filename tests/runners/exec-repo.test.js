const { mocks } = require('../mocks');
const { createFixtureContext, setupTests } = require('../utils');
const execRepo = require('../../lib/runners/exec-repo');

const REPO_NAME = 'repo-1';

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks, testParams) {
  describe('Exec Repo', () => {
    setupHooks();

    it('Should refuse to work if no command is provided', async () => {
      const fixtureContext = createFixtureContext(REPO_NAME);
      await expect(execRepo(fixtureContext, REPO_NAME)).rejects.toThrowError(/No command to execute/);
      expectDebugCalls();
    });

    it('Should not do anything if the --match flag does not math the repo name', async () => {
      const fixtureContext = createFixtureContext(REPO_NAME);
      fixtureContext.config.match = 'bar';
      const res = await execRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual(undefined);
      expectDebugCalls();
    });

    it('Should return the result of the `exec` command', async () => {
      const fixtureContext = createFixtureContext(REPO_NAME);
      fixtureContext.config.exec = 'foo-command bar-args';
      mocks.utils.exec.mockImplementation(() => 42);
      const res = await execRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual(42);
      expectDebugCalls();
    });

    it('Should return the error if the `exec` command fails', async () => {
      const fixtureContext = createFixtureContext(REPO_NAME);
      fixtureContext.config.exec = 'foo-command bar-args';
      const someError = new Error();
      mocks.utils.exec.mockImplementation(() => { throw someError; });
      const res = await execRepo(fixtureContext, REPO_NAME);
      expect(res).toEqual(someError);
      expectDebugCalls();
    });
  });

  function expectDebugCalls() {
    if (testParams.debug) {
      expect(mocks.debug.mock.calls).toHaveLength(1);
      expect(mocks.debug.mock.calls[0]).toHaveLength(1);
      expect(mocks.debug.mock.calls[0][0]).toEqual('Processing repository repo-1...');
    } else {
      expect(mocks.debug.mock.calls).toHaveLength(0);
    }
  }
}