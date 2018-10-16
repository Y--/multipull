
jest.mock('readline');
const readline = require('readline');

const rlMock = {};
{
  const close = jest.fn();
  const question = jest.fn();
  readline.createInterface = () => ({ close, question });
  Object.assign(rlMock, { close, question });
}

const { setupTests } = require('../utils');
const { useOriginalUtils, useMockedUtils } = require('../mocks');
const utils = require('../../lib/helpers/utils');

setupTests(testSuiteFactory);


function testSuiteFactory(setupHooks) {
  describe('Utils', () => {
    beforeAll(useOriginalUtils);

    setupHooks();

    afterAll(useMockedUtils);

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

    describe('getYNAnswer', () => {
      [
        { input: 'y',    output: true  },
        { input: 'yes',  output: true  },
        { input: 'Y',    output: true  },
        { input: 'Yeah', output: true  },
        { input: 'yay',  output: true  },
        { input: 'n',    output: false },
        { input: 'N',    output: false },
        { input: 'nay',  output: false },
        { input: 'No',   output: false },
      ].forEach(({ input, output }) => {
        it(`should return ${output} when the user types "${input}"`, async () => {
          rlMock.question.mockImplementationOnce((question, done) => done(input));
          const actualResult = await utils.getYNAnswer('my question');
          expect(actualResult).toEqual(output);
        });
      });

      it('should ask again if prompted with an invalid input" (with true)', async () => {
        rlMock.question
          .mockImplementationOnce((question, done) => done('wrong'))
          .mockImplementationOnce((question, done) => done('y'));
        const actualResult = await utils.getYNAnswer('my question');
        expect(actualResult).toEqual(true);
      });

      it('should ask again if prompted with an invalid input" (with false)', async () => {
        rlMock.question
          .mockImplementationOnce((question, done) => done('wrong'))
          .mockImplementationOnce((question, done) => done('n'));
        const actualResult = await utils.getYNAnswer('my question');
        expect(actualResult).toEqual(false);
      });

    });
  });
}
