
module.exports.indent = function(msg, options = { size: 2, prefix: '|' }) {
  const indentTxt = new Array(options.size + 1).join(' ');
  const parts = msg.split('\n');
  const last = parts.pop();
  const indented = parts.map(line => options.prefix + indentTxt + line);
  indented.push(last);
  return indented.join('\n');
};

module.exports.s = function(arg) {
  const count = Array.isArray(arg) ? arg.length : +arg;
  return count > 1 ? 's' : '';
};
