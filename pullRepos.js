'use strict';

const appName = 'multipull';
const startTs = new Date();

const debug        = require('debug')(appName);
const Processor    = require('./lib/processor');
const printResults = require('./lib/print-results');
const doPullRepo   = require('./lib/pull-repo');
const configReader = require('./lib/config');

(async function main() {
  const config = configReader(appName);
  debug.enabled && debug(`Will process ${config.repos.join(', ')} repos in ${config.rootDir}.`);
  const processor = new Processor(config, doPullRepo);
  const res = await processor.run();
  printResults(config, startTs, res);
})();
