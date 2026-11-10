// Fixtures built from the real sample in PLAN.md section 2.
// Columns in sheet order: الثواني | الجمل | اسم الشركة | الفيديو
'use strict';

const rowsLastRowVideo = [
  ['06:02 ل 06:56', 'اي Agent لحد tools', '', ''],
  ['07:06 ل 08:148', 'الـ agent لحد بيدور عليها', '', ''],
  ['08:34 ل 09:14', 'لما اجيلك لحد قولته دا', '', ''],
  ['09:29 ل 10:08', 'الـ agent لحد مختلفة', '', 'AW20260826_0650.mp4 g'],
  ['', '', '', ''],
  ['01:48:02 ل 01:48:16', 'تقولك لحد تمام', '', ''],
  ['01:16:36 ل 01:16:48', '11 Labs لحد حضراتكم', '', 'AW20260826_0651_1.mp4']
];

const toTsv = rows => rows.map(r => r.join('\t')).join('\n');

/** Same sample, consecutive rows, blank row between reels, video on the last row. */
const SAMPLE = toTsv(rowsLastRowVideo);

/** Same, Windows line endings and an extra trailing newline (Sheets adds one sometimes). */
const SAMPLE_CRLF = SAMPLE.replace(/\n/g, '\r\n') + '\r\n';

/** Columns pasted in reverse order (RTL copy). */
const SAMPLE_REVERSED = toTsv(rowsLastRowVideo.map(r => r.slice().reverse()));

/** Header row included. */
const SAMPLE_WITH_HEADER = toTsv([['الثواني', 'الجمل', 'اسم الشركة', 'الفيديو']].concat(rowsLastRowVideo));

/** Merged cells copied from Sheets: video/company only on the FIRST row of each group, no blank rows. */
const SAMPLE_FIRST_ROW_VIDEO = toTsv([
  ['06:02 ل 06:56', 'اي Agent لحد tools', 'Acme', 'AW20260826_0650.mp4'],
  ['07:06 ل 08:148', 'الـ agent لحد بيدور عليها', '', ''],
  ['08:34 ل 09:14', 'لما اجيلك لحد قولته دا', '', ''],
  ['09:29 ل 10:08', 'الـ agent لحد مختلفة', '', ''],
  ['01:48:02 ل 01:48:16', 'تقولك لحد تمام', 'Beta', 'AW20260826_0651_1.mp4'],
  ['01:16:36 ل 01:16:48', '11 Labs لحد حضراتكم', '', '']
]);

/** One multi-line cell per reel (Sheets wraps such cells in quotes). */
const q = s => '"' + s.replace(/"/g, '""') + '"';
const SAMPLE_MULTILINE = [
  [q('06:02 ل 06:56\n07:06 ل 08:148\n08:34 ل 09:14\n09:29 ل 10:08'),
    q('اي Agent لحد tools\nالـ agent لحد بيدور عليها\nلما اجيلك لحد قولته دا\nالـ agent لحد مختلفة'),
    'Acme', 'AW20260826_0650.mp4 g'].join('\t'),
  [q('01:48:02 ل 01:48:16\n01:16:36 ل 01:16:48'), q('تقولك لحد "تمام"\n11 Labs لحد حضراتكم'), '', 'AW20260826_0651_1.mp4'].join('\t')
].join('\n');

module.exports = { SAMPLE, SAMPLE_CRLF, SAMPLE_REVERSED, SAMPLE_WITH_HEADER, SAMPLE_FIRST_ROW_VIDEO, SAMPLE_MULTILINE };
