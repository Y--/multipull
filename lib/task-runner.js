'use strict';

const appName = 'multipull';
const startTs = new Date();

const debug          = require('debug')(appName);
const Processor      = require('./helpers/processor');
const printResults   = require('./helpers/print-results');
const contextFactory = require('./helpers/context');

module.exports = async function runTask(moduleName) {
  const context = contextFactory(appName);
  const taskFunc = require('./runners/' + moduleName);
  debug.enabled && debug(`Will process ${context.repos.join(', ')} repos in ${context.rootDir}.`);
  const processor = new Processor(context, taskFunc);
  const res = await processor.run();
  printResults(context, startTs, res);
};
