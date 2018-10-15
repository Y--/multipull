const Progress = require('progress');
const Context = require('../lib/helpers/context');
const Processor = require('../lib/helpers/processor');

const fixtureContext = createFixtureContext();

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

beforeEach(() => {
  mockProgressTick.mockClear();
  Progress.mockClear();
});


test('creates a processor', () => {
  new Processor(fixtureContext, () => {});
  expect(mockProgressTick.mock.calls).toHaveLength(0);
});

test('run a processor with a simple runner function', async () => {
  const mockRunner = jest.fn((context, repoName) => 'result for ' + repoName);
  const processor = new Processor(fixtureContext, mockRunner);

  expect(mockProgressTick.mock.calls).toHaveLength(0);
  const results = await processor.run();

  const fixtureReposCount = 3;
  const repoIdRe = /repo-[0-9]+/;
  expect(mockProgressTick.mock.calls).toHaveLength(fixtureReposCount + 1);
  expect(mockRunner.mock.calls).toHaveLength(fixtureReposCount);

  for (const callArgs of mockRunner.mock.calls) {
    expect(callArgs).toHaveLength(2);

    const [actualCtx, actualRepoName] = callArgs;
    expect(actualCtx).toEqual(fixtureContext);
    expect(actualRepoName).toMatch(repoIdRe);
  }

  expect(results).toHaveLength(3);
  for (const result of results) {
    expect(result.repo).toMatch(repoIdRe);
    expect(result.res).toEqual('result for ' + result.repo);
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  }
});

function createFixtureContext() {
  return new Context('test-multipull', {
    branches: '',
    root: '/my/root/folder',
    repos: 'repo-1,repo-42,repo-84'
  });
}