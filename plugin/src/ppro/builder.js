// Builds one reel = one new sequence. Rules from the spike (SPIKE_NOTES.md):
//  - set clip in/out and overwrite in TWO separate transactions (one tx ignores the in/out);
//  - track indices are zero-based; the cursor is read back from the timeline, never computed;
//  - the clip's original in/out is restored afterwards (-400000 = unset -> clear).
'use strict';

const { ppro, UNSET_INOUT, tx } = require('./project.js');

const T = (s) => ppro.TickTime.createWithSeconds(s);

function clipItems(track) {
  const r = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  return r || [];
}

async function trackEnd(seq, videoIdx) {
  const track = await seq.getVideoTrack(videoIdx);
  let end = 0;
  for (const ti of clipItems(track)) end = Math.max(end, (await ti.getEndTime()).seconds);
  return end;
}

/** Remove every clip item from every track of a sequence we just created. */
async function emptySequence(project, seq) {
  const all = [];
  const vc = await seq.getVideoTrackCount(), ac = await seq.getAudioTrackCount();
  for (let i = 0; i < vc; i++) clipItems(await seq.getVideoTrack(i)).forEach(t => all.push(t));
  for (let i = 0; i < ac; i++) clipItems(await seq.getAudioTrack(i)).forEach(t => all.push(t));
  if (!all.length) return;
  const editor = ppro.SequenceEditor.getEditor(seq);
  tx(project, 'Reel Cutter: تفضية الـ SEQ', (ca) => {
    ppro.TrackItemSelection.createEmptySelection((sel) => {
      all.forEach(t => sel.addItem(t, true));
      ca.addAction(editor.createRemoveItemsAction(sel, false, ppro.Constants.MediaType.ANY, false));
    });
  });
}

/**
 * @param {object} project Premiere Project
 * @param {object} reel parsed + validated reel
 * @param {object} entry clip entry from scanProject (item, clip, info)
 * @param {{name:string, bin:object, handleBefore?:number, handleAfter?:number, markers?:boolean}} opts
 * @returns {Promise<{seq:object, segments:{start:number,end:number,in:number,out:number}[]}>}
 */
async function buildReel(project, reel, entry, opts) {
  const clip = entry.clip, item = entry.item;
  const duration = entry.info && entry.info.duration;
  const hb = Math.max(0, opts.handleBefore || 0), ha = Math.max(0, opts.handleAfter || 0);

  let seq;
  if (opts.template) {
    seq = await cloneTemplate(project, opts.template, opts.name, opts.bin);
  } else {
    seq = await project.createSequenceFromMedia(opts.name, [clip], opts.bin);
    if (!seq) throw new Error('معرفتش أعمل Sequence');
    await emptySequence(project, seq);
  }
  const editor = ppro.SequenceEditor.getEditor(seq);
  const markers = opts.markers ? await ppro.Markers.getMarkers(seq) : null;

  const origIn = (await clip.getInPoint(ppro.Constants.MediaType.VIDEO)).seconds;
  const origOut = (await clip.getOutPoint(ppro.Constants.MediaType.VIDEO)).seconds;
  const placed = [];
  try {
    for (const seg of reel.segments) {
      let a = seg.startSec - hb, b = seg.endSec + ha;
      if (a < 0) a = 0;
      if (typeof duration === 'number' && b > duration) b = duration;
      tx(project, 'Reel Cutter: تحديد المقطع', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(a), T(b))));
      const cursor = await trackEnd(seq, 0);
      tx(project, 'Reel Cutter: إضافة المقطع', (ca) => ca.addAction(editor.createOverwriteItemAction(item, T(cursor), 0, 0)));
      const end = await trackEnd(seq, 0);
      if (end <= cursor) throw new Error(`المقطع ${seg.rawText} ما اتحطش في التايم لاين`);
      placed.push({ start: cursor, end, in: a, out: b });
      if (markers) {
        const comment = `${seg.rawText} | ${reel.videoName}`;
        // With a handle before, the phrase itself starts (seg.startSec - a) seconds into the piece.
        const at = cursor + Math.max(0, seg.startSec - a);
        tx(project, 'Reel Cutter: marker', (ca) => ca.addAction(markers.createAddMarkerAction(seg.phrase || seg.rawText, 'Comment', T(at), T(0), comment)));
      }
    }
  } finally {
    // Put the source clip back exactly as it was.
    try {
      const inSet = origIn > UNSET_INOUT + 1, outSet = origOut > UNSET_INOUT + 1;
      tx(project, 'Reel Cutter: رجوع in/out الكليب', (ca) => {
        ca.addAction(clip.createClearInOutPointsAction());
        if (inSet && outSet) ca.addAction(clip.createSetInOutPointsAction(T(origIn), T(origOut)));
        else if (inSet) ca.addAction(clip.createSetInPointAction(T(origIn)));
        else if (outSet) ca.addAction(clip.createSetOutPointAction(T(origOut)));
      });
    } catch (e) { /* reported by caller through the thrown error, if any */ }
  }
  let layers = null;
  if (opts.template && placed.length) layers = await extendLayers(project, seq, placed[placed.length - 1].end);
  return { seq, segments: placed, layers };
}

/**
 * Clone a template sequence, find the copy (guid diff; the API returns nothing), rename it and move it to `bin`.
 * V1 and A1 of the template must be empty (they receive the footage).
 */
async function cloneTemplate(project, template, name, bin) {
  for (const [getter, label] of [['getVideoTrack', 'V1'], ['getAudioTrack', 'A1']]) {
    const tr = await template[getter](0);
    if (tr && clipItems(tr).length) throw new Error(`التمبلت "${template.name}": ${label} لازم يبقى فاضي`);
  }
  const before = new Set((await project.getSequences()).map(s => s.guid.toString()));
  tx(project, `Reel Cutter: نسخ التمبلت ${template.name}`, (ca) => ca.addAction(template.createCloneAction()));
  const fresh = (await project.getSequences()).filter(s => !before.has(s.guid.toString()));
  if (fresh.length !== 1) throw new Error(`معرفتش ألاقي نسخة التمبلت (${fresh.length})`);
  const seq = fresh[0];
  const pi = await seq.getProjectItem();
  tx(project, 'Reel Cutter: تسمية الريل', (ca) => {
    ca.addAction(pi.createSetNameAction(name));
    ca.addAction(bin.createMoveItemAction(pi, bin));
  });
  return seq;
}

/**
 * Make every item on V2 and above end exactly at `endSec` (longer or shorter).
 * Items that start at or after the reel end are left alone and reported.
 */
async function extendLayers(project, seq, endSec) {
  const items = [];
  const vc = await seq.getVideoTrackCount();
  for (let i = 1; i < vc; i++) clipItems(await seq.getVideoTrack(i)).forEach(ti => items.push({ ti, track: i }));
  const fit = [], skipped = [];
  for (const x of items) {
    const start = (await x.ti.getStartTime()).seconds;
    if (start >= endSec) skipped.push(x); else fit.push(x);
  }
  if (fit.length) {
    tx(project, 'Reel Cutter: مد اللايرز لآخر الريل', (ca) => fit.forEach(x => ca.addAction(x.ti.createSetEndAction(T(endSec)))));
  }
  return { extended: fit.length, skipped: skipped.length };
}

module.exports = { buildReel, emptySequence, trackEnd, cloneTemplate, extendLayers };
