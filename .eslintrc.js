module.exports = {
  env: {
    es6: true,
    node: true,
    'jest/globals': true,
  },
  parserOptions: { ecmaVersion: 2017 },
  extends: 'eslint:recommended',
  plugins: ['jest'],
  rules: {
    indent: ['error', 2],
    'linebreak-style': ['error', 'unix'],
    quotes: ['error', 'single'],
    semi: ['error', 'always'],
    'jest/no-disabled-tests': 'warn',
    'jest/no-focused-tests': 'error',
    'jest/no-identical-title': 'error',
    'jest/prefer-to-have-length': 'warn',
    'jest/valid-expect': 'error',
    'require-atomic-updates': 0,
  },
};
