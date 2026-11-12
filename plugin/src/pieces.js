// Pure: map a time range of the chosen source to the source-clip ranges that make it up.
'use strict';

/**
 * Which source clip ranges make up sequence/clip time a..b.
 * Clip source: the range itself. Sequence source: the part of each V1 clip that a..b covers,
 * converted to that clip's own time (so the result is ordinary clips, like copy/paste from the sequence).
 */
function piecesFor(entry, a, b) {
  if (entry.kind !== 'seq') return [{ item: entry.item, clip: entry.clip, id: entry.id, name: entry.name, in: a, out: b }];
  const out = [];
  for (const it of entry.items) {
    const s = Math.max(a, it.start), e = Math.min(b, it.end);
    if (e - s <= 1e-6) continue;
    out.push({ item: it.item, clip: it.clip, id: it.id, name: it.name, in: it.inPoint + (s - it.start), out: it.inPoint + (e - it.start) });
  }
  return out;
}

module.exports = { piecesFor };
