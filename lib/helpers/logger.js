const colors = require('./colors').stderr; // Errors are printed on stderr

module.exports.logInfo = console.log.bind(console);

module.exports.logError = (...args) => {
  const colored = args.map((arg) => (typeof arg === 'string' ? colors.red(arg) : arg));
  console.error(...colored);
};
