const { styleText } = require('util');

const STYLES = ['red', 'green', 'yellow', 'gray', 'cyan', 'bold', 'bgRed', 'bgGreen'];

// `colors.red(text)`-style helpers on top of Node's `util.styleText`, which only colors when `stream`
// supports it (TTY, NO_COLOR, FORCE_COLOR, ...).
function createColors(stream) {
  const colors = {
    isEnabled() {
      return styleText('red', 'x', { stream }) !== 'x';
    },

    // Not one of `styleText`'s 16 colors: the 256 colors palette's orange, or yellow on terminals with fewer colors
    orange(text) {
      if (!colors.isEnabled()) {
        return String(text);
      }

      const depth = typeof stream.getColorDepth === 'function' ? stream.getColorDepth() : 4;
      return depth >= 8 ? `\x1B[38;5;208m${text}\x1B[39m` : styleText('yellow', String(text), { stream });
    },

    // Applies the styles in order, e.g. apply('text', ['bold', 'red'])
    apply(text, styles) {
      return styles.reduce((styled, style) => styleText(style, styled, { stream }), String(text));
    },
  };

  for (const style of STYLES) {
    colors[style] = (text) => styleText(style, String(text), { stream });
  }

  return colors;
}

module.exports = createColors(process.stdout);
module.exports.stderr = createColors(process.stderr);
module.exports.createColors = createColors;
