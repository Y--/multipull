const colors = require('../../lib/helpers/colors');

const { Writable } = require('stream');

// `util.styleText` requires a real stream: a writable that looks like a terminal or a pipe
function createStream(isTTY) {
  const stream = new Writable({ write: (chunk, encoding, cb) => cb() });
  stream.isTTY = isTTY;
  if (isTTY) {
    stream.getColorDepth = () => 8;
  }
  return stream;
}

const TTY = createStream(true);
const PIPE = createStream(false);

describe('colors', () => {
  it('should use the same escape codes as before (colors/safe)', () => {
    const c = colors.createColors(TTY);
    expect(c.red('x')).toBe('\x1B[31mx\x1B[39m');
    expect(c.green('x')).toBe('\x1B[32mx\x1B[39m');
    expect(c.yellow('x')).toBe('\x1B[33mx\x1B[39m');
    expect(c.gray('x')).toBe('\x1B[90mx\x1B[39m');
    expect(c.cyan('x')).toBe('\x1B[36mx\x1B[39m');
    expect(c.bold('x')).toBe('\x1B[1mx\x1B[22m');
    expect(c.isEnabled()).toBe(true);
  });

  it('should accept numbers', () => {
    expect(colors.createColors(TTY).green(42)).toBe('\x1B[32m42\x1B[39m');
    expect(colors.createColors(PIPE).green(42)).toBe('42');
  });

  it('should not color when the stream is not a terminal', () => {
    const c = colors.createColors(PIPE);
    expect(c.red('x')).toBe('x');
    expect(c.isEnabled()).toBe(false);
  });

  // NO_COLOR / FORCE_COLOR are read by Node itself from the real environment: check them in a child process
  describe('Environment variables', () => {
    const { spawnSync } = require('child_process');
    const helperPath = require.resolve('../../lib/helpers/colors');
    const run = (env) =>
      spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(helperPath)}).red('x'))`], {
        env: { PATH: process.env.PATH, ...env },
        encoding: 'utf8',
      }).stdout;

    it('should not color stdout when it is piped', () => {
      expect(run({})).toBe('x');
    });

    it('should color piped stdout with FORCE_COLOR', () => {
      expect(run({ FORCE_COLOR: '1' })).toBe('\x1B[31mx\x1B[39m');
    });

    it('should let FORCE_COLOR take precedence over NO_COLOR, like Node', () => {
      expect(run({ FORCE_COLOR: '1', NO_COLOR: '1' })).toBe('\x1B[31mx\x1B[39m');
    });
  });

  it('should use the orange of the 256 colors palette, or yellow with fewer colors', () => {
    expect(colors.createColors(TTY).orange('x')).toBe('\x1B[38;5;208mx\x1B[39m');
    const ttyWith16Colors = createStream(true);
    ttyWith16Colors.getColorDepth = () => 4;
    expect(colors.createColors(ttyWith16Colors).orange('x')).toBe('\x1B[33mx\x1B[39m');
    expect(colors.createColors(PIPE).orange('x')).toBe('x');
  });

  it('should apply the styles in order', () => {
    expect(colors.createColors(TTY).apply('x', ['bold', 'red'])).toBe('\x1B[31m\x1B[1mx\x1B[22m\x1B[39m');
    expect(colors.createColors(PIPE).apply('x', ['bold', 'red'])).toBe('x');
  });

  it('should check stdout and stderr independently', () => {
    expect(typeof colors.red).toBe('function');
    expect(typeof colors.stderr.red).toBe('function');
    expect(colors.stderr).not.toBe(colors);
  });
});
