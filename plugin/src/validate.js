// Pure validation of parsed reels. Re-parses each segment's rawText so edits in the review table are picked up.
'use strict';

const { parseRange, formatTime } = require('./timecode.js');

const LONG_SEGMENT_SEC = 180;

/**
 * @typedef {{level:'error'|'warning', code:string, message:string}} Issue
 * @typedef {{
 *   videoExists?: (videoName:string) => boolean,
 *   getDuration?: (videoName:string) => (number|null|undefined)
 * }} ValidateContext
 */

/**
 * Validate one reel in place and return it. Segment issues go on each segment, reel issues on the reel.
 * @param {object} reel
 * @param {ValidateContext} [ctx]
 */
function validateReel(reel, ctx) {
  const c = ctx || {};
  // Keep warnings the parser added (like an inherited video name); recompute everything else.
  reel.issues = (reel.issues || []).filter(i => i.code === 'video-inherited');

  if (!reel.videoName) reel.issues.push({ level: 'error', code: 'no-video', message: 'اسم الفيديو ناقص' });
  else if (c.videoExists && !c.videoExists(reel.videoName)) reel.issues.push({ level: 'error', code: 'video-missing', message: `الفيديو "${reel.videoName}" مش موجود في المشروع` });
  if (!reel.segments.length) reel.issues.push({ level: 'error', code: 'no-segments', message: 'الريل مفيهوش أوقات' });

  const duration = reel.videoName && c.getDuration ? c.getDuration(reel.videoName) : null;

  reel.segments.forEach(seg => {
    const r = parseRange(seg.rawText);
    seg.startSec = r.start; seg.endSec = r.end;
    seg.issues = r.ok ? [] : [r.error];
    if (!r.ok) return;
    if (seg.endSec <= seg.startSec) seg.issues.push({ level: 'error', code: 'end-before-start', message: `النهاية (${formatTime(seg.endSec)}) لازم تبقى بعد البداية (${formatTime(seg.startSec)})` });
    if (typeof duration === 'number' && isFinite(duration)) {
      if (seg.startSec >= duration) seg.issues.push({ level: 'error', code: 'beyond-duration', message: `البداية ${formatTime(seg.startSec)} بعد آخر الفيديو (${formatTime(duration)})` });
      else if (seg.endSec > duration) seg.issues.push({ level: 'error', code: 'beyond-duration', message: `النهاية ${formatTime(seg.endSec)} بعد آخر الفيديو (${formatTime(duration)})` });
    }
    if (seg.endSec - seg.startSec > LONG_SEGMENT_SEC) seg.issues.push({ level: 'warning', code: 'long-segment', message: `المقطع طويل (${formatTime(seg.endSec - seg.startSec)})` });
  });

  // Overlaps between segments of the same reel (warning only).
  const ok = reel.segments.map((s, i) => ({ s, i })).filter(x => !x.s.issues.some(is => is.level === 'error'));
  for (let a = 0; a < ok.length; a++) {
    for (let b = a + 1; b < ok.length; b++) {
      const A = ok[a].s, B = ok[b].s;
      if (A.startSec < B.endSec && B.startSec < A.endSec) {
        B.issues.push({ level: 'warning', code: 'overlap', message: `متداخل مع المقطع ${ok[a].i + 1} (${A.rawText})` });
      }
    }
  }
  return reel;
}

/** @param {object[]} reels @param {ValidateContext} [ctx] */
function validateReels(reels, ctx) {
  reels.forEach(r => validateReel(r, ctx));
  return reels;
}

/** True when the reel (or any of its segments) has an error. */
function hasErrors(reel) {
  return reel.issues.some(i => i.level === 'error') || reel.segments.some(s => s.issues.some(i => i.level === 'error'));
}

module.exports = { validateReel, validateReels, hasErrors, LONG_SEGMENT_SEC };
