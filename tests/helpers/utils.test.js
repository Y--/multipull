const { setupTests } = require('../utils');
const utils = require('../../lib/helpers/utils');

setupTests(testSuiteFactory);

function testSuiteFactory(setupHooks) {
  describe('Utils', () => {
    setupHooks();

    describe('formatParmeters', () => {
      [{
        title: 'should work with an empty object',
        input: {},
        output: ''
      }, {
        title: 'should not serialize false values',
        input: { foo: false },
        output: ''
      }, {
        title: 'should not serialize null values',
        input: { foo: null },
        output: ''
      }, {
        title: 'should not serialize empty string values',
        input: { foo: '' },
        output: ''
      }, {
        title: 'should serialize true values',
        input: { foo: true },
        output: '--foo'
      }, {
        title: 'should serialize string values',
        input: { foo: 'bar' },
        output: '--foo=bar'
      }, {
        title: 'should serialize complex objects',
        input: { foo: '42', bar: null, baz: true },
        output: '--foo=42 --baz'
      }].forEach(({ title, input, output }) => {
        it(title, () => {
          const actual = utils.formatParmeters(input);
          expect(actual).toEqual(output);
        });
      });
    });
  });
}