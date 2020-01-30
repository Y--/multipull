const logger = require('../../lib/helpers/logger');
const colors = require('colors/safe');

describe('Logger', () => {

  const spies = {};
  beforeEach(() => {
    for (const level of ['log', 'error']) {
      spies[level] = jest.spyOn(console, level).mockImplementation();
    }

    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    for (const spy of Object.values(spies)) {
      spy.mockRestore();
    }
  });

  it('Should call `console.error` when calling `logError`', () => {
    logger.logError(1, 2, 3);
    expect(spies.error.mock.calls).toEqual([[1, 2, 3]]);
    expect(spies.log.mock.calls).toEqual([]);
  });

  it('Should format strings in red', () => {
    logger.logError('Hello', 2, 'world!');
    expect(spies.error.mock.calls).toEqual([[colors.red('Hello'), 2, colors.red('world!')]]);
    expect(spies.log.mock.calls).toEqual([]);
  });
});
// }