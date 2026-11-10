'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSheet, parseTsv, cleanVideoName } = require('../plugin/src/parser.js');
const F = require('./fixtures.js');

function summary(result) {
  return result.reels.map(r => ({ video: r.videoName, times: r.segments.map(s => s.rawText) }));
}

const EXPECTED = [
  { video: 'AW20260826_0650.mp4', times: ['06:02 ل 06:56', '07:06 ل 08:148', '08:34 ل 09:14', '09:29 ل 10:08'] },
  { video: 'AW20260826_0651_1.mp4', times: ['01:48:02 ل 01:48:16', '01:16:36 ل 01:16:48'] }
];

test('cleanVideoName strips trailing junk after the extension', () => {
  assert.equal(cleanVideoName('AW20260826_0650.mp4 g'), 'AW20260826_0650.mp4');
  assert.equal(cleanVideoName('  clip.MOV'), 'clip.MOV');
  assert.equal(cleanVideoName('a.mxfx'), null);
  assert.equal(cleanVideoName('no video here'), null);
});

test('parseTsv handles quoted multi-line cells and doubled quotes', () => {
  const rows = parseTsv('"a\nb"\t"say ""hi"""\tc\nd\te\tf');
  assert.deepEqual(rows, [['a\nb', 'say "hi"', 'c'], ['d', 'e', 'f']]);
});

for (const [name, text] of Object.entries({
  'sample (video on last row, blank row between reels)': F.SAMPLE,
  'CRLF line endings': F.SAMPLE_CRLF,
  'reversed column order': F.SAMPLE_REVERSED,
  'with header row': F.SAMPLE_WITH_HEADER,
  'merged cells: video on first row, no blank rows': F.SAMPLE_FIRST_ROW_VIDEO,
  'multi-line cells': F.SAMPLE_MULTILINE
})) {
  test('groups reels correctly: ' + name, () => {
    const res = parseSheet(text);
    assert.deepEqual(summary(res), EXPECTED);
  });
}

test('flags the real typo 08:148 and nothing else in the sample', () => {
  const { reels } = parseSheet(F.SAMPLE);
  const bad = [];
  reels.forEach((r, ri) => r.segments.forEach((s, si) => { if (s.issues.length) bad.push([ri, si, s.issues[0].code]); }));
  assert.deepEqual(bad, [[0, 1, 'format']]);
});

test('phrases map to times in order and keep the written order (not sorted)', () => {
  const { reels } = parseSheet(F.SAMPLE);
  assert.equal(reels[0].segments[0].phrase, 'اي Agent لحد tools');
  assert.equal(reels[1].segments[1].phrase, '11 Labs لحد حضراتكم');
  assert.equal(reels[1].segments[0].startSec, 6482);
  assert.equal(reels[1].segments[1].startSec, 4596);
});

test('sortChronological option sorts segments', () => {
  const { reels } = parseSheet(F.SAMPLE, { sortChronological: true });
  assert.deepEqual(reels[1].segments.map(s => s.startSec), [4596, 6482]);
});

test('multi-line cells: phrases with quotes survive, company picked up', () => {
  const { reels } = parseSheet(F.SAMPLE_MULTILINE);
  assert.equal(reels[0].company, 'Acme');
  assert.equal(reels[1].segments[0].phrase, 'تقولك لحد "تمام"');
});

test('merged company cell: company taken from the first row of the group', () => {
  const { reels } = parseSheet(F.SAMPLE_FIRST_ROW_VIDEO);
  assert.deepEqual(reels.map(r => r.company), ['Acme', 'Beta']);
});

test('fewer phrases than times leaves the rest empty', () => {
  const text = '"1:00 ل 1:10\n2:00 ل 2:10\n3:00 ل 3:10"\t"one\ntwo"\t\tv.mp4';
  const { reels } = parseSheet(text);
  assert.deepEqual(reels[0].segments.map(s => s.phrase), ['one', 'two', '']);
});

test('reel without a video name inherits the previous one with a warning', () => {
  const text = ['1:00 ل 1:10\tx\t\tv.mp4', '\t\t\t', '2:00 ل 2:10\ty\t\t'].join('\n');
  const { reels } = parseSheet(text);
  assert.equal(reels.length, 2);
  assert.equal(reels[1].videoName, 'v.mp4');
  assert.equal(reels[1].issues[0].code, 'video-inherited');
});

test('text with no times returns a warning and no reels', () => {
  const res = parseSheet('hello\tworld');
  assert.equal(res.reels.length, 0);
  assert.equal(res.warnings.length, 1);
});

test('dash separator rows split reels', () => {
  const text = ['1:00 ل 1:10\tx\t\ta.mp4', '---', '2:00 ل 2:10\ty\t\tb.mp4'].join('\n');
  assert.deepEqual(parseSheet(text).reels.map(r => r.videoName), ['a.mp4', 'b.mp4']);
});
