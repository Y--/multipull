'use strict';

const appName = 'multipull';
const startTs = new Date();

const debug        = require('debug')(appName);
const Processor    = require('./processor');
const printResults = require('./print-results');
const configReader = require('./config');

module.exports = async function runTask(moduleName) {
  const config = configReader(appName);
  const taskFunc = require('./' + moduleName);
  debug.enabled && debug(`Will process ${config.repos.join(', ')} repos in ${config.rootDir}.`);
  const processor = new Processor(config, taskFunc);
  const res = await processor.run();
  printResults(config, startTs, res);
};
