const CliTable  = require('cli-table');

// TODO : implement it properly and make a PR.
class CleanTable extends CliTable {
  removeEmptyColumns() {
    if (!this.length) { return; }

    const nbColumns  = this[0][Object.keys(this[0])[0]].length;
    const isColEmpty = new Array(nbColumns).fill(true);
    for (const row of this) {
      const header = Object.keys(row)[0];
      for (const [i, cell] of row[header].entries()) {
        isColEmpty[i] = isColEmpty[i] && (cell === '' || cell === null || cell === undefined);
      }
    }

    const idxToRemove = new Set(isColEmpty.map((x, i) => x ? i : null).filter(x => x !== null));
    const filterFunc  = (x, i) => !idxToRemove.has(i);

    for (const row of this) {
      const header = Object.keys(row)[0];
      row[header]  = row[header].filter(filterFunc);
    }

    const shifted     = this.options.head.shift();
    this.options.head = this.options.head.filter(filterFunc);
    this.options.head.unshift(shifted);
  }
}

module.exports = CleanTable;