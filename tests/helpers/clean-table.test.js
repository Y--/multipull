const CleanTable = require('../../lib/helpers/clean-table');

const link = (url, id) => `\x1B]8;;${url}\x07${id}\x1B]8;;\x07`;
const red = (str) => `\x1B[31m${str}\x1B[39m`;

// What the terminal displays: no escape sequences, wide characters take 2 columns
function displayedLines(str) {
  const visible = str.replace(/\x1B\]8;;[^\x07]*\x07/g, '').replace(/\x1B\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
  return visible.split('\n');
}

function displayWidth(line) {
  let width = 0;
  for (const char of line) {
    width += /[⺀-鿿豈-﫿＀-｠]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1;
  }
  return width;
}

describe('CleanTable', () => {
  const originalIsTTY = process.stdout.isTTY;
  afterEach(() => {
    process.stdout.isTTY = originalIsTTY;
  });

  describe('removeEmptyColumns', () => {
    it('should remove the columns without any value, and their header', () => {
      const table = new CleanTable({ head: ['', 'A', 'Empty', 'B'] });
      table.push({ 'repo-1': ['a1', '', 'b1'] });
      table.push({ 'repo-2': ['', null, 'b2'] });
      table.push({ 'repo-3': ['', undefined, ''] });

      table.removeEmptyColumns();

      expect(table.options.head).toEqual(['', 'A', 'B']);
      expect(Array.from(table)).toEqual([{ 'repo-1': ['a1', 'b1'] }, { 'repo-2': ['', 'b2'] }, { 'repo-3': ['', ''] }]);
    });

    it('should not fail on an empty table', () => {
      const table = new CleanTable({ head: ['', 'A'] });
      table.removeEmptyColumns();
      expect(table.options.head).toEqual(['', 'A']);
    });
  });

  describe('Rendering', () => {
    it('should align hyperlinks, colors, emojis and wide characters', () => {
      process.stdout.isTTY = false;
      const table = new CleanTable({ head: ['', 'PR', 'Approved', 'Title'] });
      table.push({ 'repo-1': [link('https://github.com/o/r/pull/42', '42'), '✅', 'Fix things'] });
      table.push({ 'repo-2': [red(link('https://github.com/o/r/pull/7', 'PR#7')), '🚫', '日本語のタイトル'] });
      table.push({ 'repo-3': [null, undefined, 42] });

      const out = table.toString();
      const lines = displayedLines(out);
      const widths = new Set(lines.map(displayWidth));

      expect(widths.size).toBe(1);
      expect(lines[3]).toMatch(/^│ repo-1 │ 42 +│ ✅ +│ Fix things +│$/);
      expect(out).toContain(link('https://github.com/o/r/pull/42', '42'));
      expect(out).toContain(red(link('https://github.com/o/r/pull/7', 'PR#7')));
    });

    it('should not color the header and the borders when the output is not a terminal', () => {
      process.stdout.isTTY = false;
      const table = new CleanTable({ head: ['', 'A'] });
      table.push({ 'repo-1': ['a'] });

      expect(table.toString()).not.toMatch(/\x1B\[/); // eslint-disable-line no-control-regex
    });

    it('should keep the default header and border colors in a terminal', () => {
      process.stdout.isTTY = true;
      const table = new CleanTable({ head: ['', 'A'] });

      expect(table.options.style.head).toEqual(['red']);
      expect(table.options.style.border).toEqual(['grey']);
    });

    it('should color the header of each row like the table header in a terminal', () => {
      process.stdout.isTTY = true;
      const table = new CleanTable({ head: ['', 'A'] });
      table.push({ 'repo-1': ['a'] });
      table.push({ '  sub-repo': ['b'] });

      const out = table.toString();

      expect(out).toContain('\x1B[31mrepo-1\x1B[39m');
      expect(out).toContain('\x1B[31m  sub-repo\x1B[39m');
      expect(new Set(displayedLines(out).map(displayWidth)).size).toBe(1);
      expect(Array.from(table)).toEqual([{ 'repo-1': ['a'] }, { '  sub-repo': ['b'] }]); // Rows are left untouched
    });

    it('should keep an explicit style when the output is not a terminal', () => {
      process.stdout.isTTY = false;
      const table = new CleanTable({ head: ['', 'A'], style: { head: ['cyan'] } });

      expect(table.options.style.head).toEqual(['cyan']);
      expect(table.options.style.border).toEqual([]);
    });
  });
});
