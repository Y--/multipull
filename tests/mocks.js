jest.mock('../lib/helpers/logger');
jest.mock('../lib/helpers/message-editor');

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

const mockDebug = jest.fn();
mockDebug.enabled = false;

jest.mock('debug', () => jest.fn().mockImplementation(() => mockDebug));

const mockGHRepo = {};

const ghRepoFunctionNames = [
  'approveReviewRequest',
  'createPullRequest',
  'createReviewRequest',
  'getCombinedStatus',
  'getPullRequest',
  'getReviews',
  'listPullRequests',
  'mergePullRequest',
  'updatePullRequest',
];
for (const funcName of ghRepoFunctionNames) {
  mockGHRepo[funcName] = jest.fn();
}

jest.mock('github-api', () =>
  jest.fn().mockImplementation(() => ({
    getRepo() {
      return mockGHRepo;
    },
  }))
);

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
