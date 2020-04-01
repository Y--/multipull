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
      [
        {
          title: 'should work with an empty object',
          input: {},
          output: '',
        },
        {
          title: 'should not serialize false values',
          input: { foo: false },
          output: '',
        },
        {
          title: 'should not serialize null values',
          input: { foo: null },
          output: '',
        },
        {
          title: 'should not serialize empty string values',
          input: { foo: '' },
          output: '',
        },
        {
          title: 'should serialize true values',
          input: { foo: true },
          output: '--foo',
        },
        {
          title: 'should serialize string values',
          input: { foo: 'bar' },
          output: '--foo=bar',
        },
        {
          title: 'should serialize string values that have spaces with quote',
          input: { foo: 'bar baz' },
          output: '--foo="bar baz"',
        },
        {
          title: 'should serialize complex objects',
          input: { foo: '42', bar: null, baz: true },
          output: '--foo=42 --baz',
        },
      ].forEach(({ title, input, output }) => {
        it(title, () => {
          const actual = utils.formatParmeters(input);
          expect(actual).toEqual(output);
        });
      });
    });

    describe('getYNAnswer', () => {
      [
        { input: 'y', output: true },
        { input: 'yes', output: true },
        { input: 'Y', output: true },
        { input: 'Yeah', output: true },
        { input: 'yay', output: true },
        { input: 'n', output: false },
        { input: 'N', output: false },
        { input: 'nay', output: false },
        { input: 'No', output: false },
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

    describe('pickRandom', () => {
      describe('Normal case', () => {
        const originalRandom = Math.random;
        const mathRandomMock = jest.fn();

        // We should not mock `random` and throw errors...
        // https://github.com/babel/babel/issues/5426#issuecomment-284839994
        beforeEach(() => (Math.random = mathRandomMock));
        afterEach(() => (Math.random = originalRandom));

        const eps = 1e-3;

        [
          { collection: [1, 2, 3], count: 1, randomValues: [1 / 3 - eps], expectedResults: [1] },
          { collection: [1, 2, 3], count: 1, randomValues: [2 / 3 - eps], expectedResults: [2] },
          { collection: [1, 2, 3], count: 1, randomValues: [1 - eps], expectedResults: [3] },
          { collection: [1, 2, 3], count: 2, randomValues: [1 / 3 - eps, 1 / 2 - eps], expectedResults: [1, 2] },
          { collection: [1, 2, 3], count: 2, randomValues: [2 / 3 - eps, 1 - eps], expectedResults: [2, 3] },
          { collection: [1, 2, 3], count: 2, randomValues: [1 - eps, 1 / 2 - eps], expectedResults: [3, 1] },
        ].forEach(({ collection, count, randomValues, expectedResults }) => {
          const ret = `return ${JSON.stringify(expectedResults)}`;
          it(`should ${ret} when selecting ${count} in ${JSON.stringify(collection)} "`, async () => {
            for (const val of randomValues) {
              mathRandomMock.mockImplementationOnce(() => val);
            }

            const actualResult = utils.pickRandom(collection, count);
            expect(actualResult).toEqual(expectedResults);
          });
        });
      });

      describe('Errors', () => {
        it('should throw an error if the collection have no element', async () => {
          expect(() => utils.pickRandom([], 1)).toThrowError(/Cannot select 1 element: collection has only 0 element/);
        });

        it('should throw an error if the collection does not have enough elements', async () => {
          expect(() => utils.pickRandom([42], 2)).toThrowError(
            /Cannot select 2 elements: collection has only 1 element/
          );
        });

        it('should throw an error if the count is not a number', async () => {
          expect(() => utils.pickRandom([], 'hello')).toThrowError('Invalid count: hello');
        });
      });
    });
  });
}
