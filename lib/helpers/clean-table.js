const CliTable = require('cli-table');

// TODO : implement it properly and make a PR.
class CleanTable extends CliTable {
  removeEmptyColumns() {
    if (!this.length) {
      return;
    }

    const nbColumns = this[0][Object.keys(this[0])[0]].length;
    const columnsWithValuesBitmap = new Array(nbColumns).fill(false);
    for (const row of this) {
      const line = row[Object.keys(row)[0]];
      for (let i = 0; i < nbColumns; ++i) {
        columnsWithValuesBitmap[i] = columnsWithValuesBitmap[i] || cellHasValue(line[i]);
      }
    }

    for (const row of this) {
      const header = Object.keys(row)[0];
      row[header] = applyBitmapFilter(row[header], columnsWithValuesBitmap);
    }

    columnsWithValuesBitmap.unshift(true);
    this.options.head = applyBitmapFilter(this.options.head, columnsWithValuesBitmap);
  }
}

function cellHasValue(cell) {
  return cell !== '' && cell !== null && cell !== undefined;
}

function applyBitmapFilter(collection, bitmap) {
  const l = collection.length;
  const result = [];
  for (let i = 0; i < l; ++i) {
    if (bitmap[i]) {
      result.push(collection[i]);
    }
  }

  return result;
}

const cliUtils = require('cli-table/lib/utils');
cliUtils.pad = function (str, len, pad, dir) {
  const printedLen = cliUtils.strlen(str);
  if (len <= printedLen) {
    return str;
  }

  const padLength = len - printedLen;
  switch (dir) {
  case 'left':
    return str.padStart(padLength, pad);
  case 'both': {
    const half = Math.ceil(padLength / 2);
    return str.padStart(padLength - half).padEnd(half);
  }
  default:
    return str.padEnd(padLength, pad);
  }
};

const originalStrLen = cliUtils.strlen;

cliUtils.strlen = function (str) {
  str = typeof str === 'string' ? str : '' + str;
  if (!str) {
    return originalStrLen(str);
  }

  const urlStartIndex = str.indexOf('\u0007');
  if (urlStartIndex > -1) {
    return str.indexOf('\u001b', urlStartIndex) - urlStartIndex - 1;
  }

  if (str.startsWith('\x1B]8;;')) {
    const spl = str.split('\x07');
    return spl[1].indexOf('\x1B');
  }

  return originalStrLen(str);
};

module.exports = CleanTable;
