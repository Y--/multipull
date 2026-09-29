const CliTable = require('cli-table3');

// Same colors as cli-table3's defaults, except when the output is not a terminal (piped, redirected, ...)
const NO_COLOR_STYLE = { head: [], border: [] };

class CleanTable extends CliTable {
  constructor(options = {}) {
    super(process.stdout.isTTY ? options : { ...options, style: { ...NO_COLOR_STYLE, ...options.style } });
  }

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

module.exports = CleanTable;
