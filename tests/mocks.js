jest.mock('../lib/helpers/logger');

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

const mockDebug = jest.fn();
mockDebug.enabled = false;

jest.mock('debug', () => jest.fn().mockImplementation(() => mockDebug));

const mockGHRepo = {
  createPullRequest: jest.fn(),
  createReviewRequest: jest.fn(),
  listPullRequests: jest.fn(),
  mergePullRequest: jest.fn(),
  updatePullRequest: jest.fn(),
};
jest.mock('github-api', () => jest.fn().mockImplementation(() => ({
  getRepo() {
    return mockGHRepo;
  }
})));

const sg = {};
const simpleGit = require('simple-git/src/git');
for (const funcName of Object.keys(simpleGit.prototype)) {
  sg[funcName] = jest.fn();
}

const gitHelper = require('../lib/helpers/simple-git');
gitHelper.initSimpleGit = () => sg;

const mockedUtils = {
  exec: jest.fn(),
  getYNAnswer: jest.fn(),
  pickRandom: jest.fn()
};

const utils = require('../lib/helpers/utils');
const originalUtils = Object.assign({}, utils);
useMockedUtils();

const logger = require('../lib/helpers/logger');
exports.mocks = { debug: mockDebug, utils, logger, progress: { tick: mockProgressTick }, sg, ghRepo: mockGHRepo };

exports.useOriginalUtils = function() {
  Object.assign(utils, originalUtils);
};

exports.useMockedUtils = useMockedUtils;

function useMockedUtils() {
  Object.assign(utils, mockedUtils);
}

