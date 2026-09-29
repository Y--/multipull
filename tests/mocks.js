jest.mock('../lib/helpers/logger');
jest.mock('../lib/helpers/message-editor');

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

const mockDebug = jest.fn();
mockDebug.enabled = false;
mockDebug.extend = () => false;

jest.mock('debug', () => {
  const debugMock = jest.fn().mockImplementation(() => mockDebug);
  debugMock.default = debugMock;
  debugMock.default.formatters = {};
  return debugMock;
});

// `@octokit/rest` is ESM-only and can't be loaded by jest: never load the real one
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

const { GitHubRepository } = require('../lib/helpers/github');
const mockGHRepo = { owner: 'foo-owner', repo: null };
for (const funcName of Object.getOwnPropertyNames(GitHubRepository.prototype)) {
  if (funcName !== 'constructor' && !funcName.startsWith('_')) {
    mockGHRepo[funcName] = jest.fn();
  }
}

const sg = {};
const simpleGitInstance = require('simple-git').simpleGit();
for (
  let proto = Object.getPrototypeOf(simpleGitInstance);
  proto && proto !== Object.prototype;
  proto = Object.getPrototypeOf(proto)
) {
  for (const funcName of Object.getOwnPropertyNames(proto)) {
    if (funcName !== 'constructor' && typeof simpleGitInstance[funcName] === 'function') {
      sg[funcName] = jest.fn();
    }
  }
}

const gitHelper = require('../lib/helpers/simple-git');
gitHelper.createGitHubRepository = (owner, repo) => {
  mockGHRepo.owner = owner;
  mockGHRepo.repo = repo;
  return mockGHRepo;
};
gitHelper.initSimpleGit = (context, repo) => {
  sg.context = context;
  sg.repo = repo;
  return sg;
};

const mockedUtils = {
  exec: jest.fn(),
  getYNAnswer: jest.fn(),
  pickRandom: jest.fn(),
};

const utils = require('../lib/helpers/utils');
const originalUtils = Object.assign({}, utils);
useMockedUtils();

const logger = require('../lib/helpers/logger');
const editor = require('../lib/helpers/message-editor');
const progress = { tick: mockProgressTick };
exports.mocks = { debug: mockDebug, editor, utils, logger, progress, sg, ghRepo: mockGHRepo };

exports.useOriginalUtils = function () {
  Object.assign(utils, originalUtils);
};

exports.useMockedUtils = useMockedUtils;

function useMockedUtils() {
  Object.assign(utils, mockedUtils);
}
