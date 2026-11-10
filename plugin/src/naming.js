// Pure helpers for sequence names. Pattern tokens: {company} {video} {nn} {n}
'use strict';

const DEFAULT_PATTERN = '{company}_{video}_R{nn}';

function stripExt(name) { return String(name || '').replace(/\.[a-z0-9]{2,4}$/i, ''); }

/** Characters Premiere/file systems dislike are replaced with "-". */
function clean(s) { return String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').trim(); }

/**
 * @param {string} pattern
 * @param {{company?:string, videoName?:string}} reel
 * @param {number} index 1-based reel number
 */
function sequenceName(pattern, reel, index) {
  const p = pattern || DEFAULT_PATTERN;
  let out = p.replace(/\{company\}/g, clean(reel.company))
    .replace(/\{video\}/g, clean(stripExt(reel.videoName)))
    .replace(/\{nn\}/g, String(index).padStart(2, '0'))
    .replace(/\{n\}/g, String(index));
  // Tidy separators left behind by empty tokens ("_AW_R01" -> "AW_R01").
  out = out.replace(/([_\- ])\1+/g, '$1').replace(/^[_\- ]+|[_\- ]+$/g, '');
  return out || ('Reel_' + String(index).padStart(2, '0'));
}

/** Make a name unique against existing names by appending " (2)", " (3)"… */
function uniqueName(name, existing) {
  const set = new Set(Array.from(existing || []).map(s => s.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) { const n = `${name} (${i})`; if (!set.has(n.toLowerCase())) return n; }
}

module.exports = { DEFAULT_PATTERN, sequenceName, uniqueName, stripExt };
