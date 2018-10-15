const { mocks } = require('../mocks');
const { createFixtureContext } = require('../utils');
const Processor = require('../../lib/helpers/processor');

const repoIdRe = /repo-[0-9]+/;
const fixtureReposCount = 3;
const fixtureContext = createFixtureContext('repo-1,repo-42,repo-84');

describe('Processor', () => {
  it('should creates a processor', () => {
    new Processor(fixtureContext, () => {});
    expect(mocks.progress.tick.mock.calls).toHaveLength(0);
  });

  it('should run a processor with a simple runner function', async () => {
    const mockRunner = jest.fn((context, repoName) => 'result for ' + repoName);
    const processor = new Processor(fixtureContext, mockRunner);

    expect(mocks.progress.tick.mock.calls).toHaveLength(0);
    const results = await processor.run();

    const fixtureReposCount = 3;

    expect(mocks.progress.tick.mock.calls).toHaveLength(fixtureReposCount + 1);
    expectMockRunner(mockRunner);
    expectValidResults(results);
  });

  it('should run a processor with multiple steps', async () => {
    const mockRunner1 = jest.fn((context, repoName) => 'step1 for ' + repoName);
    const mockRunner2 = jest.fn((context, repoName) => 'result for ' + repoName);
    const processor = new Processor(fixtureContext, [
      { runner: mockRunner1, title: 'Step 1' },
      { runner: mockRunner2, title: 'Step 2' }
    ]);

    expect(mocks.progress.tick.mock.calls).toHaveLength(0);
    const results = await processor.run();

    expect(mocks.logger.logInfo.mock.calls).toEqual([['Step 1'], ['Step 2']]);
    expect(mocks.progress.tick.mock.calls).toHaveLength(2 * (fixtureReposCount + 1));
    expectMockRunner(mockRunner1);
    expectMockRunner(mockRunner2);
    expectValidResults(results);
  });

  it('should interrupt processor if an error occurs during a step', async () => {
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

    expect(mocks.progress.tick.mock.calls).toHaveLength(0);

    await expect(processor.run()).rejects.toThrowError(/Aborting execution because of 1 error in repo-42/);

    expect(mocks.logger.logInfo.mock.calls).toEqual([['Step 1']]);

    expect(mocks.progress.tick.mock.calls).toHaveLength(fixtureReposCount + 1);
    expectMockRunner(mockRunner1);
    expect(mockRunner2.mock.calls).toHaveLength(0);
  });

  it('run a processor with multiple a single step', async () => {
    const mockRunner1 = jest.fn((context, repoName) => 'step1 for ' + repoName);
    const mockSingle = jest.fn(() => ['single']);
    const mockRunner2 = jest.fn((context, repoName) => 'result for ' + repoName);
    const processor = new Processor(fixtureContext, [
      { runner: mockRunner1, title: 'Step 1' },
      { runner: mockSingle, title: 'Single', single: true },
      { runner: mockRunner2, title: 'Step 2' }
    ]);

    expect(mocks.progress.tick.mock.calls).toHaveLength(0);
    const results = await processor.run();

    expect(mocks.logger.logInfo.mock.calls).toEqual([['Step 1'], ['Single'], ['Step 2']]);
    expect(mocks.progress.tick.mock.calls).toHaveLength(2 * (fixtureReposCount + 1));
    expectMockRunner(mockRunner1);
    expectMockRunner(mockRunner2);

    expect(mockSingle.mock.calls).toHaveLength(1);
    for (const callArgs of mockSingle.mock.calls) {
      expect(callArgs).toHaveLength(2);

      const [actualCtx, actualPreviousResults] = callArgs;
      expect(actualCtx).toEqual(fixtureContext);
      expect(actualPreviousResults).toMatchObject([
        { elapsed: expect.any(Number), repo: 'repo-1',  res: 'step1 for repo-1'  },
        { elapsed: expect.any(Number), repo: 'repo-42', res: 'step1 for repo-42' },
        { elapsed: expect.any(Number), repo: 'repo-84', res: 'step1 for repo-84' }
      ]);
    }

    expectValidResults(results);
  });

  it('interrupt processor manually', async () => {
    const mockRunner1 = jest.fn((context, repoName) => {
      if (repoName === 'repo-42') {
        context.interrupt();
      }
      return 'result for ' + repoName;
    });

    const mockRunner2 = jest.fn((context, repoName) => 'not for ' + repoName);
    const processor = new Processor(fixtureContext, [
      { runner: mockRunner1, title: 'Step 1' },
      { runner: mockRunner2, title: 'Step 2' }
    ]);

    expect(mocks.progress.tick.mock.calls).toHaveLength(0);
    const results = await processor.run();

    expect(mocks.logger.logInfo.mock.calls).toEqual([['Step 1']]);
    expect(mocks.progress.tick.mock.calls).toHaveLength(fixtureReposCount + 1);
    expectMockRunner(mockRunner1);

    expect(mockRunner2.mock.calls).toHaveLength(0);

    expectValidResults(results);
  });
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