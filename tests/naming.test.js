'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sequenceName, uniqueName } = require('../plugin/src/naming.js');

test('default pattern', () => {
  assert.equal(sequenceName(null, { company: 'Acme', videoName: 'AW_0650.mp4' }, 3), 'Acme_AW_0650_R03');
});
test('empty company leaves no leading underscore', () => {
  assert.equal(sequenceName(null, { company: '', videoName: 'AW_0650.mp4' }, 1), 'AW_0650_R01');
});
test('bad characters are replaced', () => {
  assert.equal(sequenceName('{company} {n}', { company: 'A/B:C' }, 2), 'A-B-C 2');
});
test('uniqueName', () => {
  assert.equal(uniqueName('X', ['x', 'X (2)']), 'X (3)');
  assert.equal(uniqueName('Y', ['x']), 'Y');
});
