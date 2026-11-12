'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, parseRange, formatTime, normalizeDigits } = require('../plugin/src/timecode.js');

test('parseTime accepts m:ss, mm:ss, h:mm:ss, hh:mm:ss', () => {
  assert.equal(parseTime('6:02').sec, 362);
  assert.equal(parseTime('06:02').sec, 362);
  assert.equal(parseTime('1:48:02').sec, 6482);
  assert.equal(parseTime('01:48:02').sec, 6482);
  assert.equal(parseTime(' 0:00 ').sec, 0);
});

test('parseTime rejects the real typo 08:148 and out-of-range values', () => {
  assert.equal(parseTime('08:148').ok, false);
  assert.equal(parseTime('08:148').error.code, 'format');
  assert.equal(parseTime('08:60').ok, false);
  assert.equal(parseTime('08:60').error.code, 'range');
  assert.equal(parseTime('1:60:00').error.code, 'range');
  assert.equal(parseTime('75:30').error.code, 'range');
  assert.equal(parseTime('8:5').ok, false);
  assert.equal(parseTime('abc').ok, false);
  assert.equal(parseTime('123:00').ok, false);
});

test('Arabic-Indic digits are accepted', () => {
  assert.equal(normalizeDigits('٠٦:٠٢'), '06:02');
  assert.equal(parseTime('٠٦:٠٢').sec, 362);
  assert.equal(parseRange('۰۶:۰۲ ل ۰۶:۵۶').end, 416);
});

test('parseRange handles every separator', () => {
  for (const sep of ['ل', '-', '–', '—', 'to', 'TO', 'الى', 'إلى', '']) {
    const r = parseRange(`06:02 ${sep} 06:56`);
    assert.equal(r.ok, true, sep);
    assert.equal(r.start, 362); assert.equal(r.end, 416);
  }
  assert.deepEqual(parseRange('06:02ل06:56'), { ok: true, start: 362, end: 416 });
  assert.deepEqual(parseRange('01:48:02 ل 01:48:16'), { ok: true, start: 6482, end: 6496 });
});

test('parseRange reports problems', () => {
  const typo = parseRange('07:06 ل 08:148');
  assert.equal(typo.ok, false);
  assert.equal(typo.start, 426);
  assert.equal(typo.end, null);
  assert.equal(parseRange('06:02').error.code, 'missing-end');
  assert.equal(parseRange('hello').error.code, 'format');
  assert.equal(parseRange('06:02 و كمان 06:56').ok, false);
  assert.equal(parseRange('1:00 ل 2:00 ل 3:00').ok, false);
});

test('formatTime', () => {
  assert.equal(formatTime(362), '06:02');
  assert.equal(formatTime(6482), '1:48:02');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(61.5), '01:01.5');
});

test('splitRangeText', () => {
  const { splitRangeText } = require('../plugin/src/timecode.js');
  assert.deepEqual(splitRangeText('06:02 ل 06:56 كلام هنا'), { range: '06:02 ل 06:56', phrase: 'كلام هنا' });
  assert.deepEqual(splitRangeText('كلام - 1:48:02 - 1:48:16'), { range: '1:48:02 - 1:48:16', phrase: 'كلام' });
  assert.deepEqual(splitRangeText('06:02 ل 06:56'), { range: '06:02 ل 06:56', phrase: '' });
  assert.deepEqual(splitRangeText('06:02 ل 06:56 ل 07:00'), { range: '06:02 ل 06:56 ل 07:00', phrase: '' });
});
