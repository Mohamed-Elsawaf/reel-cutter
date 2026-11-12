// Pure parser: text copied from Google Sheets (TSV) -> reels[].
// Columns are recognised by their content, not their order (the sheet is RTL and the order can flip).
'use strict';

const { parseRange, splitRangeText, looksLikeTime } = require('./timecode.js');

const VIDEO_EXT = /^(.*?\.(?:mp4|mov|mxf|mkv|m4v|mts|avi))(?=$|[^a-z0-9])/i;
const HEADER_WORDS = {
  time: /الثواني|الوقت|التايم|time/i,
  phrase: /الجمل|الجملة|phrase/i,
  company: /الشركة|شركة|company|client/i,
  video: /الفيديو|فيديو|video|file/i
};

/**
 * Split TSV text into rows of cells. Handles quoted cells (with tabs/newlines inside, "" = ").
 * @param {string} text
 * @returns {string[][]}
 */
function parseTsv(text) {
  const s = String(text || '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [], cell = '', i = 0, inQuotes = false, cellStart = true;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"' && cellStart) { inQuotes = true; cellStart = false; i++; continue; }
    if (c === '\t') { row.push(cell); cell = ''; cellStart = true; i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; cellStart = true; i++; continue; }
    cell += c; cellStart = false; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Keep only the file name up to its extension ("AW_0650.mp4 g" -> "AW_0650.mp4"). */
function cleanVideoName(cell) {
  const t = String(cell || '').trim();
  const m = t.match(VIDEO_EXT);
  return m ? m[1].trim() : null;
}

function isBlankRow(cells) {
  return cells.every(c => /^[\s\-–—_=.]*$/.test(c));
}

function isHeaderRow(cells) {
  let hits = 0;
  cells.forEach(c => { if (Object.values(HEADER_WORDS).some(re => re.test(c)) && !looksLikeTime(c) && !cleanVideoName(c)) hits++; });
  return hits >= 2;
}

/**
 * Decide which column holds what.
 * @param {string[][]} rows data rows (no header)
 * @param {string[]|null} header
 * @returns {{time:number, phrase:number, company:number, video:number}} -1 = absent
 */
function detectColumns(rows, header) {
  const width = Math.max(0, ...rows.map(r => r.length), header ? header.length : 0);
  const cols = { time: -1, phrase: -1, company: -1, video: -1 };
  if (header) {
    header.forEach((h, i) => {
      for (const k of ['time', 'phrase', 'company', 'video']) {
        if (cols[k] === -1 && HEADER_WORDS[k].test(h)) { cols[k] = i; break; }
      }
    });
    if (cols.time !== -1) return cols;
  }
  const timeScore = new Array(width).fill(0), videoScore = new Array(width).fill(0), filled = new Array(width).fill(0);
  rows.forEach(r => r.forEach((c, i) => {
    if (!c.trim()) return;
    filled[i]++;
    if (looksLikeTime(c)) timeScore[i]++;
    if (cleanVideoName(c)) videoScore[i]++;
  }));
  const argmax = (arr, skip) => { let best = -1; arr.forEach((v, i) => { if (v > 0 && !skip.includes(i) && (best === -1 || v > arr[best])) best = i; }); return best; };
  cols.time = argmax(timeScore, []);
  cols.video = argmax(videoScore, [cols.time]);
  const rest = [];
  for (let i = 0; i < width; i++) if (i !== cols.time && i !== cols.video) rest.push(i);
  if (cols.time === -1) return cols;
  // The phrase column sits next to the time column, the company column next to the video column.
  const dist = (i, j) => (j === -1 ? 0 : Math.abs(i - j));
  if (rest.length >= 2) {
    const byTime = rest.slice().sort((a, b) => dist(a, cols.time) - dist(b, cols.time) || filled[b] - filled[a]);
    cols.phrase = byTime[0];
    const others = rest.filter(i => i !== cols.phrase);
    others.sort((a, b) => (cols.video === -1 ? filled[b] - filled[a] : dist(a, cols.video) - dist(b, cols.video)));
    cols.company = others[0];
  } else if (rest.length === 1) {
    // One extra column: phrases if filled about as often as times, otherwise company.
    const i = rest[0];
    if (filled[i] >= timeScore[cols.time] * 0.6) cols.phrase = i; else cols.company = i;
  }
  return cols;
}

function splitLines(cell) {
  return String(cell || '').split('\n').map(l => l.trim());
}

let idCounter = 0;
function newReel() {
  idCounter++;
  return { id: 'r' + Date.now().toString(36) + '_' + idCounter, company: '', videoName: '', templateName: null, segments: [], issues: [], skip: false };
}

function makeSegment(rawText, phrase) {
  // No phrase of its own: the phrase may be written on the same line as the range.
  if (!String(phrase || '').trim()) {
    const sp = splitRangeText(rawText);
    rawText = sp.range; phrase = sp.phrase;
  }
  const r = parseRange(rawText);
  return { startSec: r.start, endSec: r.end, phrase: phrase || '', rawText: String(rawText).trim(), issues: r.ok ? [] : [r.error] };
}

/**
 * Parse pasted sheet text into reels.
 * @param {string} text
 * @param {{sortChronological?: boolean}} [options]
 * @returns {{reels: object[], columns: object, warnings: string[]}}
 */
function parseSheet(text, options) {
  const opts = Object.assign({ sortChronological: false }, options || {});
  const all = parseTsv(text).map(r => r.map(c => c.replace(/ /g, ' ')));
  const warnings = [];
  let header = null;
  const firstNonBlank = all.findIndex(r => !isBlankRow(r));
  if (firstNonBlank !== -1 && isHeaderRow(all[firstNonBlank])) header = all[firstNonBlank];
  const rows = all.filter((r, i) => !(header && i === firstNonBlank));
  const cols = detectColumns(rows.filter(r => !isBlankRow(r)), header);
  if (cols.time === -1) return { reels: [], columns: cols, warnings: ['ملقتش أي عمود فيه أوقات'] };

  const cell = (r, k) => (cols[k] === -1 ? '' : (r[cols[k]] || ''));
  const dataRows = rows.map(r => ({ r, blank: isBlankRow(r), multi: cell(r, 'time').includes('\n'), video: cleanVideoName(cell(r, 'video')) }));

  // Where does the video name sit inside a group made of consecutive rows? Look at the first group.
  let videoOnLastRow = false;
  {
    const firstIdx = dataRows.findIndex(d => !d.blank && !d.multi);
    if (firstIdx !== -1 && !dataRows[firstIdx].video) videoOnLastRow = true;
  }

  const reels = [];
  let cur = null;
  const close = () => { if (cur && (cur.segments.length || cur.videoName)) reels.push(cur); cur = null; };
  const absorb = (reel, r) => {
    const v = cleanVideoName(cell(r, 'video'));
    if (v && !reel.videoName) reel.videoName = v;
    const co = cell(r, 'company').trim();
    if (co && !reel.company) reel.company = co.split('\n')[0].trim();
  };

  for (const d of dataRows) {
    if (d.blank) { close(); continue; }
    const r = d.r;
    if (d.multi) {
      // One cell holds the whole reel: time lines map to phrase lines by position.
      close();
      const reel = newReel();
      const times = splitLines(cell(r, 'time'));
      const phrases = splitLines(cell(r, 'phrase')).filter(Boolean);
      let p = 0;
      times.forEach(t => { if (t) reel.segments.push(makeSegment(t, phrases[p++] || '')); });
      if (phrases.length > p) warnings.push(`فيه ${phrases.length - p} جملة زيادة من غير وقت في ريل ${reels.length + 1}`);
      absorb(reel, r);
      reels.push(reel);
      continue;
    }
    const timeText = cell(r, 'time').trim();
    if (!videoOnLastRow && d.video && cur && cur.videoName) close();
    if (!cur) cur = newReel();
    if (timeText) cur.segments.push(makeSegment(timeText, cell(r, 'phrase').trim()));
    else if (cell(r, 'phrase').trim()) warnings.push(`سطر من غير وقت اتجاهل: "${cell(r, 'phrase').trim()}"`);
    absorb(cur, r);
    if (videoOnLastRow && d.video) close();
  }
  close();

  // A merged video cell can cover several reels: inherit the previous reel's video name.
  reels.forEach((reel, i) => {
    if (!reel.videoName && i > 0 && reels[i - 1].videoName) {
      reel.videoName = reels[i - 1].videoName;
      reel.issues.push({ level: 'warning', code: 'video-inherited', message: `اسم الفيديو مش مكتوب؛ اتاخد من الريل اللي قبله (${reel.videoName})` });
    }
    if (!reel.company && i > 0 && reels[i - 1].company && reel.videoName === reels[i - 1].videoName) reel.company = reels[i - 1].company;
    if (opts.sortChronological) reel.segments.sort((a, b) => (a.startSec ?? Infinity) - (b.startSec ?? Infinity));
  });

  return { reels, columns: cols, warnings };
}

module.exports = { parseTsv, cleanVideoName, detectColumns, parseSheet };
