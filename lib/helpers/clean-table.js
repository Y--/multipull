const CliTable = require('cli-table3');
const colors = require('./colors');

// Same colors as cli-table3's defaults, unless colors are disabled for stdout (piped, NO_COLOR, ...)
const NO_COLOR_STYLE = { head: [], border: [] };

class CleanTable extends CliTable {
  constructor(options = {}) {
    super(colors.isEnabled() ? options : { ...options, style: { ...NO_COLOR_STYLE, ...options.style } });
  }

  // cli-table3 only applies the `head` style to the header row: also apply it to the header of each row
  // (`{ [header]: cells }` rows), like cli-table did
  toString() {
    const headColors = this.options.style.head;
    if (!headColors || !headColors.length) {
      return super.toString();
    }

    const rows = Array.from(this);
    rows.forEach((row, i) => {
      if (!Array.isArray(row)) {
        const [header] = Object.keys(row);
        this[i] = { [colors.apply(header, headColors)]: row[header] };
      }
    });

    try {
      return super.toString();
    } finally {
      rows.forEach((row, i) => (this[i] = row));
    }
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
