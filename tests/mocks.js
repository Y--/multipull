const logger = require('../lib/helpers/logger');
const gitHelper = require('../lib/helpers/simple-git');
const simpleGit = require('simple-git/src/git');

jest.mock('../lib/helpers/logger');

const mockProgressTick = jest.fn();
jest.mock('progress', () => jest.fn().mockImplementation(() => ({ tick: mockProgressTick })));

const sg = {};
for (const funcName of Object.keys(simpleGit.prototype)) {
  sg[funcName] = jest.fn();
}

gitHelper.initSimpleGit = () => sg;

exports.mocks = { logger, progress: { tick: mockProgressTick }, sg };