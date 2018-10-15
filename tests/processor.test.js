const Context = require('../lib/helpers/context');
const Processor = require('../lib/helpers/processor');
const logger = require('../lib/helpers/logger');

const repoIdRe = /repo-[0-9]+/;
const fixtureContext = createFixtureContext();
const fixtureReposCount = 3;

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));
jest.mock('../lib/helpers/logger');

beforeEach(() => jest.clearAllMocks());


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

  expect(mockProgressTick.mock.calls).toHaveLength(fixtureReposCount + 1);
  expectMockRunner(mockRunner);
  expectValidResults(results);
});

test('run a processor with multiple steps', async () => {
  const mockRunner1 = jest.fn((context, repoName) => 'step1 for ' + repoName);
  const mockRunner2 = jest.fn((context, repoName) => 'result for ' + repoName);
  const processor = new Processor(fixtureContext, [
    { runner: mockRunner1, title: 'Step 1' },
    { runner: mockRunner2, title: 'Step 2' }
  ]);

  expect(mockProgressTick.mock.calls).toHaveLength(0);
  const results = await processor.run();

  expect(logger.logInfo.mock.calls).toEqual([['Step 1'], ['Step 2']]);
  expect(mockProgressTick.mock.calls).toHaveLength(2 * (fixtureReposCount + 1));
  expectMockRunner(mockRunner1);
  expectMockRunner(mockRunner2);
  expectValidResults(results);
});

test('run interrupt processor if an error occurs during a step', async () => {
  const mockRunner1 = jest.fn((context, repoName) => {
    if (repoName === 'repo-42') {
      throw new Error('Failed');
    }
    return 'step1 for ' + repoName;
  });

  const mockRunner2 = jest.fn((context, repoName) => repoName);
  const processor = new Processor(fixtureContext, [
    { runner: mockRunner1, title: 'Step 1' },
    { runner: mockRunner2, title: 'Step 2' }
  ]);

  expect(mockProgressTick.mock.calls).toHaveLength(0);

  await expect(processor.run()).rejects.toThrowError(/Aborting execution because of 1 error in repo-42/);

  expect(logger.logInfo.mock.calls).toEqual([['Step 1']]);

  expect(mockProgressTick.mock.calls).toHaveLength(fixtureReposCount + 1);
  expectMockRunner(mockRunner1);
  expect(mockRunner2.mock.calls).toHaveLength(0);
});

function expectMockRunner(mockRunner) {
  expect(mockRunner.mock.calls).toHaveLength(fixtureReposCount);

  for (const callArgs of mockRunner.mock.calls) {
    expect(callArgs).toHaveLength(2);

    const [actualCtx, actualRepoName] = callArgs;
    expect(actualCtx).toEqual(fixtureContext);
    expect(actualRepoName).toMatch(repoIdRe);
  }
}

function expectValidResults(results) {
  expect(results).toHaveLength(3);
  for (const result of results) {
    expect(result.repo).toMatch(repoIdRe);
    expect(result.res).toEqual('result for ' + result.repo);
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  }
}

function createFixtureContext() {
  return new Context('test-multipull', {
    branches: '',
    root: '/my/root/folder',
    repos: 'repo-1,repo-42,repo-84'
  });
}