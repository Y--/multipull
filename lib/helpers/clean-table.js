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

module.exports = CleanTable;
