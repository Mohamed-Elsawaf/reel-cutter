'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { piecesFor } = require('../plugin/src/pieces.js');

const seq = {
  kind: 'seq',
  items: [
    { id: 'A', name: 'A.mp4', start: 0, end: 10, inPoint: 100 },
    { id: 'B', name: 'B.mp4', start: 10, end: 30, inPoint: 5 },
    { id: 'C', name: 'C.mp4', start: 40, end: 50, inPoint: 0 } // gap 30..40
  ]
};
const strip = (ps) => ps.map(p => [p.id, p.in, p.out]);

test('clip source: the range itself', () => {
  assert.deepEqual(strip(piecesFor({ kind: undefined, id: 'X', name: 'x' }, 3, 7)), [['X', 3, 7]]);
});

test('sequence source: inside one clip maps to that clip time', () => {
  assert.deepEqual(strip(piecesFor(seq, 2, 6)), [['A', 102, 106]]);
});

test('sequence source: a range across a cut becomes two pieces', () => {
  assert.deepEqual(strip(piecesFor(seq, 8, 12)), [['A', 108, 110], ['B', 5, 7]]);
});

test('sequence source: gaps are skipped, empty areas give nothing', () => {
  assert.deepEqual(strip(piecesFor(seq, 28, 42)), [['B', 23, 25], ['C', 0, 2]]);
  assert.deepEqual(strip(piecesFor(seq, 31, 39)), []);
});
