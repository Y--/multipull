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

const logger = require('../lib/helpers/logger');
exports.mocks = { debug: mockDebug, logger, progress: { tick: mockProgressTick }, sg };