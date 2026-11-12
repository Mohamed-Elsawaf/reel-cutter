'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet } = require('../plugin/src/parser.js');
const { validateReels, validateReel, hasErrors } = require('../plugin/src/validate.js');
const F = require('./fixtures.js');

const codes = seg => seg.issues.map(i => i.code);

test('sample: reel 1 has the 08:148 error, reel 2 is clean', () => {
  const { reels } = parseSheet(F.SAMPLE);
  validateReels(reels, { videoExists: () => true, getDuration: () => 3 * 3600 });
  assert.equal(hasErrors(reels[0]), true);
  assert.deepEqual(codes(reels[0].segments[1]), ['format']);
  assert.equal(hasErrors(reels[1]), false);
});

test('editing the raw text in the review table fixes the error on re-validate', () => {
  const { reels } = parseSheet(F.SAMPLE);
  validateReels(reels);
  reels[0].segments[1].rawText = '07:06 ل 08:14';
  validateReel(reels[0]);
  assert.equal(hasErrors(reels[0]), false);
  assert.equal(reels[0].segments[1].endSec, 494);
});

test('end before start, beyond duration, missing video', () => {
  const { reels } = parseSheet('"05:00 ل 04:00\n09:00 ل 11:00\n12:00 ل 12:30"\t\t\tv.mp4');
  validateReels(reels, { videoExists: () => false, getDuration: () => 600 });
  assert.deepEqual(codes(reels[0].segments[0]), ['end-before-start']);
  assert.deepEqual(codes(reels[0].segments[1]), ['beyond-duration']);
  assert.deepEqual(codes(reels[0].segments[2]), ['beyond-duration']);
  assert.equal(reels[0].issues[0].code, 'video-missing');
});

test('long segment warns; overlapping ranges are allowed (no issue)', () => {
  const { reels } = parseSheet('"00:00 ل 04:00\n03:00 ل 05:00"\t\t\tv.mp4');
  validateReels(reels, { videoExists: () => true, getDuration: () => 600 });
  assert.deepEqual(codes(reels[0].segments[0]), ['long-segment']);
  assert.deepEqual(codes(reels[0].segments[1]), []);
  assert.equal(hasErrors(reels[0]), false);
});

test('no video name is an error', () => {
  const { reels } = parseSheet('1:00 ل 1:10\tx');
  validateReels(reels);
  assert.equal(reels[0].issues[0].code, 'no-video');
});

test('a source chosen in the panel is enough without a video name', () => {
  const { reels } = parseSheet('٥:٤٥ ل ٥:٥٠ حضرتك لحد غلط');
  validateReels(reels, { sourceChosen: true, videoExists: () => false, getDuration: () => 600 });
  assert.equal(hasErrors(reels[0]), false);
  validateReels(reels, { sourceChosen: true, getDuration: () => 340 });
  assert.deepEqual(codes(reels[0].segments[0]), ['beyond-duration']);
});

test('unknown duration skips the duration check', () => {
  const { reels } = parseSheet('59:00 ل 59:30\tx\t\tv.mp4');
  validateReels(reels, { getDuration: () => null });
  assert.equal(hasErrors(reels[0]), false);
});
