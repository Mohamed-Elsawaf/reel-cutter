// Pure time helpers: parse "m:ss", "mm:ss", "h:mm:ss", "hh:mm:ss" and "start ل end" ranges.
// No Premiere dependency, so it runs under `node --test` and inside UXP via require().
'use strict';

/** Convert Arabic-Indic (٠-٩) and Eastern Arabic/Persian (۰-۹) digits to 0-9. */
function normalizeDigits(s) {
  return String(s).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/**
 * @typedef {{level:'error'|'warning', code:string, message:string}} Issue
 * @typedef {{ok:true, sec:number} | {ok:false, error:Issue}} TimeResult
 */

function err(code, message) { return { level: 'error', code, message }; }

/**
 * Parse one time value. Seconds must be exactly two digits; minutes/seconds must be < 60.
 * @param {string} text
 * @returns {TimeResult}
 */
function parseTime(text) {
  const t = normalizeDigits(text).trim().replace(/\s*[:：]\s*/g, ':');
  if (!/^\d+(:\d+){1,2}$/.test(t)) return { ok: false, error: err('format', `"${text.trim()}" مش وقت بصيغة دقايق:ثواني`) };
  const parts = t.split(':');
  const secStr = parts[parts.length - 1];
  if (secStr.length !== 2) return { ok: false, error: err('format', `"${text.trim()}": الثواني لازم رقمين (لقيت ${secStr})`) };
  const nums = parts.map(Number);
  let h = 0, m, s;
  if (parts.length === 3) {
    [h, m, s] = nums;
    if (parts[1].length !== 2) return { ok: false, error: err('format', `"${text.trim()}": الدقايق لازم رقمين بعد الساعة`) };
    if (parts[0].length > 2) return { ok: false, error: err('format', `"${text.trim()}": الساعات كتير`) };
  } else {
    [m, s] = nums;
    if (parts[0].length > 2) return { ok: false, error: err('format', `"${text.trim()}": الدقايق أكتر من رقمين`) };
  }
  if (s >= 60) return { ok: false, error: err('range', `"${text.trim()}": الثواني ${s} لازم أقل من 60`) };
  if (m >= 60) return { ok: false, error: err('range', `"${text.trim()}": الدقايق ${m} لازم أقل من 60`) };
  return { ok: true, sec: h * 3600 + m * 60 + s };
}

// Anything that looks like a time token (validated afterwards by parseTime).
const TIME_TOKEN = /\d+(?:\s*[:：]\s*\d+)+/g;
// Words/characters allowed between the two times.
const SEPARATOR = /^\s*(?:ل|-|–|—|to|الى|إلى|الي|إلي)?\s*$/i;

/**
 * Parse a range like "06:02 ل 06:56", "1:48:02 - 1:48:16", "07:06 to 08:14".
 * @param {string} text
 * @returns {{ok:true, start:number, end:number} | {ok:false, start:number|null, end:number|null, error:Issue}}
 */
function parseRange(text) {
  const src = normalizeDigits(text || '');
  const tokens = [];
  let m;
  TIME_TOKEN.lastIndex = 0;
  while ((m = TIME_TOKEN.exec(src)) !== null) tokens.push({ str: m[0], index: m.index });
  if (tokens.length === 0) return { ok: false, start: null, end: null, error: err('format', `"${String(text).trim()}" مفيهوش وقت`) };
  if (tokens.length === 1) {
    const one = parseTime(tokens[0].str);
    return { ok: false, start: one.ok ? one.sec : null, end: null, error: err('missing-end', `"${String(text).trim()}": وقت النهاية ناقص`) };
  }
  if (tokens.length > 2) return { ok: false, start: null, end: null, error: err('format', `"${String(text).trim()}": فيه أكتر من وقتين في نفس السطر`) };
  const between = src.slice(tokens[0].index + tokens[0].str.length, tokens[1].index);
  const a = parseTime(tokens[0].str);
  const b = parseTime(tokens[1].str);
  const start = a.ok ? a.sec : null;
  const end = b.ok ? b.sec : null;
  if (!a.ok) return { ok: false, start, end, error: a.error };
  if (!b.ok) return { ok: false, start, end, error: b.error };
  if (!SEPARATOR.test(between)) return { ok: false, start, end, error: err('format', `"${String(text).trim()}": الفاصل بين الوقتين مش مفهوم`) };
  return { ok: true, start, end };
}

/** True if the text contains something that looks like a time. */
function looksLikeTime(text) {
  TIME_TOKEN.lastIndex = 0;
  return TIME_TOKEN.test(normalizeDigits(text || ''));
}

/**
 * Format seconds as "mm:ss" or "h:mm:ss" (fractions shown with up to 2 decimals).
 * @param {number} sec
 */
function formatTime(sec) {
  if (typeof sec !== 'number' || !isFinite(sec)) return '';
  const neg = sec < 0; let s = Math.abs(sec);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const whole = Math.floor(s + 1e-9);
  const frac = Math.round((s - whole) * 100);
  const ss = String(whole).padStart(2, '0') + (frac ? '.' + String(frac).padStart(2, '0').replace(/0$/, '') : '');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
  return (neg ? '-' : '') + body;
}

module.exports = { normalizeDigits, parseTime, parseRange, looksLikeTime, formatTime };
