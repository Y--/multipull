'use strict';

const fs       = require('fs');
const jshintrc = JSON.parse(fs.readFileSync(`${__dirname}/.jshintrc`, 'utf8'));
const globals  = jshintrc.predef.reduce((acc, v) => { acc[v] = true; return acc; }, {});

module.exports = {
  extends : 'eslint:recommended',
  env     : { es6: true, node: true, browser: true },
  globals : globals,
  rules   : {
    'linebreak-style' : [ 2, 'unix' ],
    'semi'            : [ 2, 'always' ],
    'prefer-const'    : [ 'error', { destructuring: 'any' } ],
    'prefer-spread'   : [ 'error'],
    'no-unmodified-loop-condition' : [ 'error' ],
    'prefer-rest-params' : [ 'error' ]
  }
};
