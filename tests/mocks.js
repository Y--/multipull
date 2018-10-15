jest.mock('../lib/helpers/logger');

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

const mockDebug = jest.fn();
mockDebug.enabled = false;

jest.mock('debug', () => jest.fn().mockImplementation(() => mockDebug));

const sg = {};
const simpleGit = require('simple-git/src/git');
for (const funcName of Object.keys(simpleGit.prototype)) {
  sg[funcName] = jest.fn();
}

const gitHelper = require('../lib/helpers/simple-git');
gitHelper.initSimpleGit = () => sg;

const utils = {
  exec: jest.fn(),
  getYNAnswer: jest.fn()
};

Object.assign(require('../lib/helpers/utils'), utils);

const logger = require('../lib/helpers/logger');
exports.mocks = { debug: mockDebug, utils, logger, progress: { tick: mockProgressTick }, sg };