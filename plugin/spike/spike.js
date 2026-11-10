// Reel Cutter — phase 0 spike. Runs API experiments inside Premiere and prints a text report.
// Everything it creates goes into new sequences named SPIKE_* inside a new bin SPIKE_TEST.
// It never edits the user's own sequences: the template and the source sequence are cloned first.
/* eslint-disable no-undef */

const ppro = require('premierepro');
const uxp = require('uxp');

const logLines = [];
function log(...parts) {
  const line = parts.map(p => (typeof p === 'string' ? p : safeJson(p))).join(' ');
  logLines.push(line);
  const el = document.getElementById('log');
  if (el) el.value = logLines.join('\n');
}
function safeJson(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
function errStr(e) { return (e && (e.stack || e.message)) ? String(e.message || e) : String(e); }
function methodsOf(obj) {
  if (!obj) return String(obj);
  const names = new Set();
  let p = obj;
  for (let i = 0; i < 3 && p && p !== Object.prototype; i++) {
    Object.getOwnPropertyNames(p).forEach(n => names.add(n));
    p = Object.getPrototypeOf(p);
  }
  names.delete('constructor');
  return Array.from(names).sort().join(',');
}

const T = (s) => ppro.TickTime.createWithSeconds(s);
const sec = (t) => (t && typeof t.seconds === 'number') ? Math.round(t.seconds * 1000) / 1000 : t;
function isPromise(x) { return !!x && typeof x.then === 'function'; }

function tx(project, label, build) {
  let result;
  project.lockedAccess(() => {
    result = project.executeTransaction((ca) => { build(ca); }, label);
  });
  return result;
}

async function step(name, fn) {
  log('');
  log('### ' + name);
  try { await fn(); } catch (e) { log('  !! ERROR: ' + errStr(e)); }
}

// ---------- project walking ----------
async function walk(folder, path, out, depth) {
  if (depth > 8) return;
  const items = await folder.getItems();
  for (const it of items) {
    const rec = { it, path: path + '/' + it.name, isFolder: false, clip: null };
    let f = null;
    try { f = ppro.FolderItem.cast(it); } catch (e) { /* not a folder */ }
    if (f) {
      try { await f.getItems(); rec.isFolder = true; rec.folder = f; } catch (e) { /* cast gave object but not usable */ }
    }
    if (!rec.isFolder) {
      try { rec.clip = ppro.ClipProjectItem.cast(it); } catch (e) { rec.clip = null; }
    }
    out.push(rec);
    if (rec.isFolder) await walk(rec.folder, rec.path, out, depth + 1);
  }
  return out;
}

async function getTrackItemsAny(track) {
  const r = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
  if (isPromise(r)) return { items: await r, wasPromise: true };
  return { items: r, wasPromise: false };
}

async function dumpSeq(seq, title) {
  const lines = [];
  const vc = await seq.getVideoTrackCount();
  const ac = await seq.getAudioTrackCount();
  lines.push(`  [${title}] "${seq.name}" vTracks=${vc} aTracks=${ac} end=${sec(await seq.getEndTime())}`);
  for (const [kind, count, getter] of [['V', vc, 'getVideoTrack'], ['A', ac, 'getAudioTrack']]) {
    for (let i = 0; i < count; i++) {
      const tr = await seq[getter](i);
      const { items } = await getTrackItemsAny(tr);
      if (!items || items.length === 0) continue;
      for (const ti of items) {
        let extra = '';
        try { extra += ' name=' + (await ti.getName()); } catch (e) { /* */ }
        try { if (kind === 'V' && await ti.isAdjustmentLayer()) extra += ' [adjustment]'; } catch (e) { /* */ }
        lines.push(`    ${kind}[idx ${i}] start=${sec(await ti.getStartTime())} end=${sec(await ti.getEndTime())} in=${sec(await ti.getInPoint())} out=${sec(await ti.getOutPoint())}${extra}`);
      }
    }
  }
  lines.forEach(l => log(l));
}

async function allTrackItems(seq) {
  const res = [];
  const vc = await seq.getVideoTrackCount();
  const ac = await seq.getAudioTrackCount();
  for (let i = 0; i < vc; i++) { const { items } = await getTrackItemsAny(await seq.getVideoTrack(i)); (items || []).forEach(ti => res.push({ kind: 'V', idx: i, ti })); }
  for (let i = 0; i < ac; i++) { const { items } = await getTrackItemsAny(await seq.getAudioTrack(i)); (items || []).forEach(ti => res.push({ kind: 'A', idx: i, ti })); }
  return res;
}

async function emptySeq(project, seq) {
  const items = await allTrackItems(seq);
  if (items.length === 0) return 0;
  const editor = ppro.SequenceEditor.getEditor(seq);
  const ok = tx(project, 'Spike: empty sequence', (ca) => {
    ppro.TrackItemSelection.createEmptySelection((sel) => {
      items.forEach(x => sel.addItem(x.ti, true));
      ca.addAction(editor.createRemoveItemsAction(sel, false, ppro.Constants.MediaType.ANY, false));
    });
  });
  log(`  emptySeq: removed ${items.length} items, tx=${ok}`);
  return items.length;
}

async function v1End(seq, vIdx) {
  const { items } = await getTrackItemsAny(await seq.getVideoTrack(vIdx));
  let end = 0;
  for (const ti of items || []) end = Math.max(end, (await ti.getEndTime()).seconds);
  return end;
}

async function sequenceGuids(project) {
  const seqs = await project.getSequences();
  return new Map(seqs.map(s => [s.guid.toString(), s]));
}

async function cloneSequence(project, seq, label) {
  const before = await sequenceGuids(project);
  const ok = tx(project, label, (ca) => ca.addAction(seq.createCloneAction()));
  const after = await sequenceGuids(project);
  const fresh = [];
  after.forEach((s, g) => { if (!before.has(g)) fresh.push(s); });
  log(`  clone tx=${ok}; sequences before=${before.size} after=${after.size}; new: ${fresh.map(s => '"' + s.name + '"').join(', ')}`);
  return fresh[0] || null;
}

async function fromMedia(project, name, clip, bin) {
  try { return await project.createSequenceFromMedia(name, [clip], bin); }
  catch (e) {
    log('  createSequenceFromMedia(bin as FolderItem) failed: ' + errStr(e) + ' -> retry with ProjectItem.cast(bin)');
    return await project.createSequenceFromMedia(name, [clip], ppro.ProjectItem.cast(bin));
  }
}

async function findSeqByName(project, name) {
  const seqs = await project.getSequences();
  return seqs.find(s => s.name === name) || seqs.find(s => s.name.toLowerCase() === name.toLowerCase()) || null;
}

async function moveToBin(project, seq, bin) {
  try {
    const pi = await seq.getProjectItem();
    tx(project, 'Spike: move to bin', (ca) => ca.addAction(bin.createMoveItemAction(pi, bin)));
  } catch (e) { log('  move failed: ' + errStr(e)); }
}

// ---------- the run ----------
async function runAll() {
  logLines.length = 0;
  const videoName = document.getElementById('videoName').value.trim();
  const sourceSeqName = document.getElementById('sourceSeqName').value.trim();
  const templateName = document.getElementById('templateName').value.trim();
  log('Reel Cutter spike report — ' + new Date().toISOString());
  log('inputs: video="' + videoName + '" sourceSeq="' + sourceSeqName + '" template="' + templateName + '"');

  const ctx = {};

  await step('T0 environment', async () => {
    try { log('  uxp host: ' + safeJson({ name: uxp.host.name, version: uxp.host.version, os: require('os').platform() })); } catch (e) { log('  host info err ' + errStr(e)); }
    log('  premierepro exports: ' + Object.keys(ppro).sort().join(','));
    log('  TickTime.TIME_ZERO=' + typeof ppro.TickTime.TIME_ZERO + ' TIME_INVALID=' + typeof ppro.TickTime.TIME_INVALID);
    log('  Constants.TrackItemType=' + safeJson(ppro.Constants.TrackItemType) + ' MediaType=' + safeJson(ppro.Constants.MediaType) + ' ProjectItemType=' + safeJson(ppro.Constants.ProjectItemType));
    log('  Marker statics: ' + (ppro.Marker ? Object.keys(ppro.Marker).join(',') : 'no Marker export'));
  });

  await step('T1 modules (require / ES module)', async () => {
    for (const p of ['./spike/cjs-probe.js', './cjs-probe.js', 'spike/cjs-probe.js']) {
      try { const m = require(p); log(`  require("${p}") -> ${safeJson(m)}`); } catch (e) { log(`  require("${p}") FAILED: ${errStr(e)}`); }
    }
    log('  <script type=module> flag: ' + String(window.__esmProbe));
    try { const m = await import('./cjs-probe.js'); log('  dynamic import ok: ' + safeJson(Object.keys(m))); } catch (e) { log('  dynamic import FAILED: ' + errStr(e)); }
  });

  const project = await ppro.Project.getActiveProject();
  if (!project) { log('!! no active project'); return finish(); }
  ctx.project = project;
  log('project: ' + project.name);

  await step('T2 walk project / cast behaviour', async () => {
    const root = await project.getRootItem();
    ctx.root = root;
    const all = await walk(root, '', [], 0);
    ctx.all = all;
    log(`  items=${all.length} folders=${all.filter(r => r.isFolder).length}`);
    log('  first item type values: ' + all.slice(0, 6).map(r => `${r.path} type=${safeJson(r.it.type)} folder=${r.isFolder} clipCast=${r.clip ? 'obj' : 'null'}`).join(' | '));
    const want = videoName.toLowerCase().replace(/\.[a-z0-9]+$/, '');
    const cands = [];
    for (const r of all) {
      if (r.isFolder || !r.clip) continue;
      let isSeq = null; try { isSeq = await r.clip.isSequence(); } catch (e) { /* */ }
      if (isSeq) continue;
      const base = r.it.name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
      if (!want || base === want) cands.push(r);
    }
    log('  candidate clips: ' + cands.slice(0, 5).map(r => r.path).join(' | '));
    if (!cands.length) throw new Error('video not found in project');
    ctx.clipRec = cands[0];
    ctx.clip = cands[0].clip;
    ctx.clipPI = cands[0].it;
    try { log('  getMediaFilePath: ' + (await ctx.clip.getMediaFilePath())); } catch (e) { log('  getMediaFilePath err ' + errStr(e)); }
    try {
      const hits = await ctx.clip.findItemsMatchingMediaPath(ctx.clipPI.name, true);
      log('  findItemsMatchingMediaPath(name) count=' + (hits ? hits.length : 'n/a'));
    } catch (e) { log('  findItemsMatchingMediaPath err ' + errStr(e)); }
    try { log('  ProjectItem.getId=' + ctx.clipPI.getId() + ' parentBin=' + ctx.clipPI.getParentBin().name); } catch (e) { log('  getId/getParentBin err ' + errStr(e)); }
  });
  if (!ctx.clip) return finish();
  const clip = ctx.clip, clipPI = ctx.clipPI;

  await step('T3 clip media info', async () => {
    const media = await clip.getMedia();
    log('  Media methods: ' + methodsOf(media));
    let dur = null;
    try { dur = media.getDuration(); if (isPromise(dur)) { log('  getDuration returned Promise'); dur = await dur; } } catch (e) { log('  getDuration err ' + errStr(e)); }
    if (!dur) { try { dur = await media.duration; log('  used media.duration'); } catch (e) { /* */ } }
    ctx.duration = dur ? dur.seconds : null;
    log('  duration seconds = ' + ctx.duration);
    try { const st = media.getStart(); log('  media start = ' + sec(isPromise(st) ? await st : st)); } catch (e) { log('  getStart err ' + errStr(e)); }
    try {
      const fi = await clip.getFootageInterpretation();
      log('  FootageInterpretation methods: ' + methodsOf(fi));
      for (const m of ['getFrameRate', 'getOverrideFrameRate']) {
        if (typeof fi[m] === 'function') { let v = fi[m](); if (isPromise(v)) v = await v; log(`  fi.${m}() = ${safeJson(v)}`); }
      }
      ['frameRate', 'overrideFrameRate'].forEach(p => { if (p in fi) log(`  fi.${p} = ${safeJson(fi[p])}`); });
    } catch (e) { log('  footage interp err ' + errStr(e)); }
    for (const mt of ['VIDEO', 'AUDIO']) {
      try { log(`  clip in/out BEFORE (${mt}): ${sec(await clip.getInPoint(ppro.Constants.MediaType[mt]))} / ${sec(await clip.getOutPoint(ppro.Constants.MediaType[mt]))}`); } catch (e) { log(`  getIn/Out(${mt}) err ` + errStr(e)); }
    }
    if (ctx.duration !== null && ctx.duration < 60) throw new Error('video shorter than 60 s — please use a longer video');
  });

  await step('T4 create bin SPIKE_TEST', async () => {
    const root = ctx.root;
    const before = new Set((await root.getItems()).map(i => i.name));
    log('  tx=' + tx(project, 'Spike: create bin', (ca) => ca.addAction(root.createBinAction('SPIKE_TEST', true))));
    const after = await root.getItems();
    const nb = after.find(i => !before.has(i.name) && /SPIKE_TEST/.test(i.name)) || after.find(i => i.name === 'SPIKE_TEST');
    ctx.bin = ppro.FolderItem.cast(nb);
    log('  bin = ' + (nb ? nb.name : 'NOT FOUND'));
  });

  await step('T5 createSequenceFromMedia + empty it', async () => {
    const seq = await fromMedia(project, 'SPIKE_A_fromMedia', clip, ctx.bin || ctx.root);
    ctx.seqA = seq;
    log('  returned: ' + (seq ? '"' + seq.name + '" guid=' + seq.guid.toString() : String(seq)));
    try { const pi = await seq.getProjectItem(); log('  parent bin: ' + pi.getParentBin().name); } catch (e) { log('  parent err ' + errStr(e)); }
    try { log('  timebase=' + (await seq.getTimebase())); } catch (e) { log('  timebase err ' + errStr(e)); }
    try { const st = await seq.getSettings(); const fr = st.getVideoFrameRate(); ctx.fr = fr; log('  settings fps=' + fr.value + ' ticksPerFrame=' + fr.ticksPerFrame); } catch (e) { log('  settings err ' + errStr(e)); }
    try { const r = await seq.getFrameSize(); log('  frameSize=' + safeJson({ w: r.width, h: r.height })); } catch (e) { log('  frameSize err ' + errStr(e)); }
    const t0 = (await seq.getVideoTrack(0)).getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    log('  getTrackItems returns Promise? ' + isPromise(t0));
    await dumpSeq(seq, 'after create');
    await emptySeq(project, seq);
    await dumpSeq(seq, 'after empty');
  });

  await step('T6 set in/out + overwrite in ONE transaction (10s-15s @0, track 0/0)', async () => {
    const seq = ctx.seqA, editor = ppro.SequenceEditor.getEditor(seq);
    const ok = tx(project, 'Spike: in/out + overwrite (one tx)', (ca) => {
      ca.addAction(clip.createSetInOutPointsAction(T(10), T(15)));
      ca.addAction(editor.createOverwriteItemAction(clipPI, T(0), 0, 0));
    });
    log('  tx=' + ok);
    await dumpSeq(seq, 'after one-tx overwrite');
  });

  await step('T7 set in/out and overwrite in TWO transactions (20s-23s @ end of V1)', async () => {
    const seq = ctx.seqA, editor = ppro.SequenceEditor.getEditor(seq);
    const cursor = await v1End(seq, 0);
    log('  cursor (end of V idx0) = ' + cursor);
    log('  tx1=' + tx(project, 'Spike: set in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(20), T(23)))));
    log(`  clip in/out now: ${sec(await clip.getInPoint(ppro.Constants.MediaType.VIDEO))} / ${sec(await clip.getOutPoint(ppro.Constants.MediaType.VIDEO))}`);
    log('  tx2=' + tx(project, 'Spike: overwrite', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(cursor), 0, 0))));
    await dumpSeq(seq, 'after two-tx overwrite');
    log('  non-frame-aligned test: in/out 25.01-26.02 @ end');
    const c2 = await v1End(seq, 0);
    tx(project, 'Spike: odd in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(25.01), T(26.02))));
    tx(project, 'Spike: overwrite odd', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(c2), 0, 0)));
    await dumpSeq(seq, 'after odd overwrite');
  });

  await step('T8 clear in/out on the clip', async () => {
    log('  tx=' + tx(project, 'Spike: clear in/out', (ca) => ca.addAction(clip.createClearInOutPointsAction())));
    log(`  clip in/out AFTER clear: ${sec(await clip.getInPoint(ppro.Constants.MediaType.VIDEO))} / ${sec(await clip.getOutPoint(ppro.Constants.MediaType.VIDEO))}`);
  });

  await step('T9 track index base (overwrite with vIdx=1, aIdx=1)', async () => {
    const seq = await fromMedia(project, 'SPIKE_B_trackIndex', clip, ctx.bin || ctx.root);
    ctx.seqB = seq;
    await emptySeq(project, seq);
    const editor = ppro.SequenceEditor.getEditor(seq);
    tx(project, 'Spike: in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(30), T(32))));
    log('  tx=' + tx(project, 'Spike: overwrite idx1', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(0), 1, 1))));
    await dumpSeq(seq, 'after overwrite with index 1');
    tx(project, 'Spike: clear in/out', (ca) => ca.addAction(clip.createClearInOutPointsAction()));
  });

  await step('T10 alternative A: subclip then overwrite', async () => {
    const beforeIds = new Set(ctx.all.map(r => { try { return r.it.getId(); } catch (e) { return r.path; } }));
    const ok = tx(project, 'Spike: subclip', (ca) => ca.addAction(clip.createSubClipAction('SPIKE_sub', T(40), T(43), true, { takeVideo: true, takeAudio: true })));
    log('  tx=' + ok);
    const all2 = await walk(ctx.root, '', [], 0);
    const fresh = all2.filter(r => { let id; try { id = r.it.getId(); } catch (e) { id = r.path; } return !beforeIds.has(id); });
    log('  new project items: ' + fresh.map(r => r.path).join(' | '));
    const sub = fresh.find(r => /SPIKE_sub/.test(r.it.name));
    if (!sub) throw new Error('subclip not found');
    const seq = ctx.seqB, editor = ppro.SequenceEditor.getEditor(seq);
    const cursor = await v1End(seq, 0);
    log('  overwrite tx=' + tx(project, 'Spike: overwrite subclip', (ca) => ca.addAction(editor.createOverwriteItemAction(sub.it, T(Math.max(cursor, 5)), 0, 0))));
    await dumpSeq(seq, 'after subclip overwrite');
    if (ctx.bin) tx(project, 'Spike: move subclip', (ca) => ca.addAction(ctx.bin.createMoveItemAction(sub.it, ctx.bin)));
  });

  await step('T11 alternative B: whole clip then trim the track items', async () => {
    const seq = await fromMedia(project, 'SPIKE_C_trim', clip, ctx.bin || ctx.root);
    await dumpSeq(seq, 'start (whole clip)');
    let items = await allTrackItems(seq);
    log('  tx setInPoint(50)=' + tx(project, 'Spike: trim in', (ca) => items.forEach(x => ca.addAction(x.ti.createSetInPointAction(T(50))))));
    await dumpSeq(seq, 'after createSetInPointAction(50)');
    items = await allTrackItems(seq);
    log('  tx setOutPoint(54)=' + tx(project, 'Spike: trim out', (ca) => items.forEach(x => ca.addAction(x.ti.createSetOutPointAction(T(54))))));
    await dumpSeq(seq, 'after createSetOutPointAction(54)');
    items = await allTrackItems(seq);
    log('  tx setStart(0)=' + tx(project, 'Spike: set start', (ca) => items.forEach(x => ca.addAction(x.ti.createSetStartAction(T(0))))));
    await dumpSeq(seq, 'after createSetStartAction(0)');
    items = await allTrackItems(seq);
    log('  tx setEnd(4)=' + tx(project, 'Spike: set end', (ca) => items.forEach(x => ca.addAction(x.ti.createSetEndAction(T(4))))));
    await dumpSeq(seq, 'after createSetEndAction(4)');
  });

  await step('T12 markers', async () => {
    const seq = ctx.seqA;
    const markers = await ppro.Markers.getMarkers(seq);
    log('  Markers methods: ' + methodsOf(markers));
    log('  tx=' + tx(project, 'Spike: add marker', (ca) => ca.addAction(markers.createAddMarkerAction('الـ agent لحد tools', 'Comment', T(0), T(0), '06:02 → 06:56 | AW20260826_0650.mp4'))));
    const m2 = await ppro.Markers.getMarkers(seq);
    let list = null;
    try { list = m2.getMarkers(); } catch (e) { log('  getMarkers() err ' + errStr(e)); }
    if (!list) { try { list = m2.getMarkers([]); } catch (e) { log('  getMarkers([]) err ' + errStr(e)); } }
    if (isPromise(list)) list = await list;
    (list || []).forEach(m => log(`  marker: name="${m.getName()}" comments="${m.getComments()}" start=${sec(m.getStart())} type=${m.getType()}`));
  });

  await step('T13 rename sequence + parent bin', async () => {
    const pi = await ctx.seqA.getProjectItem();
    log('  rename tx=' + tx(project, 'Spike: rename', (ca) => ca.addAction(pi.createSetNameAction('SPIKE_A_renamed'))));
    log('  seq.name now = ' + ctx.seqA.name + ' ; projectItem name = ' + pi.name);
    log('  parent bin = ' + pi.getParentBin().name);
  });

  await step('T14 createSequenceWithPresetPath (9x16 30fps preset)', async () => {
    const p = 'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Settings\\SequencePresets\\Social\\Social Media Portrait 9x16 30 fps.sqpreset';
    const seq = await project.createSequenceWithPresetPath('SPIKE_D_preset', p);
    log('  returned: ' + (seq ? '"' + seq.name + '"' : String(seq)));
    if (seq) {
      const r = await seq.getFrameSize(); log('  frameSize=' + safeJson({ w: r.width, h: r.height }) + ' fps=' + (await seq.getSettings()).getVideoFrameRate().value);
      await dumpSeq(seq, 'preset seq');
      try { log('  parent bin: ' + (await seq.getProjectItem()).getParentBin().name); } catch (e) { /* */ }
      if (ctx.bin) await moveToBin(project, seq, ctx.bin);
    }
  });

  await step('T15 clone template + overwrite + extend V2+ items to 30s', async () => {
    const tpl = await findSeqByName(project, templateName);
    if (!tpl) throw new Error('template sequence "' + templateName + '" not found');
    await dumpSeq(tpl, 'template (original, read only)');
    const clone = await cloneSequence(project, tpl, 'Spike: clone template');
    if (!clone) throw new Error('could not identify the clone');
    try { log('  clone parent bin: ' + (await clone.getProjectItem()).getParentBin().name); } catch (e) { /* */ }
    if (ctx.bin) await moveToBin(project, clone, ctx.bin);
    const editor = ppro.SequenceEditor.getEditor(clone);
    // Add more layer kinds to the CLONE (the template only has a logo): Color Matte on index 2, a MOGRT on index 3.
    try {
      const matte = ctx.all.find(r => r.it.name === 'Color Matte');
      if (matte) {
        log('  add Color Matte idx2 tx=' + tx(project, 'Spike: add matte', (ca) => ca.addAction(editor.createOverwriteItemAction(matte.it, T(0), 2, 0))));
      } else log('  (no "Color Matte" item in project)');
    } catch (e) { log('  add matte err ' + errStr(e)); }
    try {
      const mogrt = 'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\Basic Title.mogrt';
      let res;
      project.lockedAccess(() => { res = editor.insertMogrtFromPath(mogrt, T(0), 3, 0); });
      if (isPromise(res)) res = await res;
      log('  insertMogrtFromPath idx3 -> ' + (res ? res.length + ' items' : String(res)));
    } catch (e) { log('  insertMogrt err ' + errStr(e)); }
    await dumpSeq(clone, 'clone with layers');
    tx(project, 'Spike: in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(10), T(22))));
    log('  overwrite tx=' + tx(project, 'Spike: overwrite into clone', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(0), 0, 0))));
    tx(project, 'Spike: clear in/out', (ca) => ca.addAction(clip.createClearInOutPointsAction()));
    await dumpSeq(clone, 'clone after overwrite');
    const items = (await allTrackItems(clone)).filter(x => x.idx >= 1);
    log('  extending ' + items.length + ' items on V/A index>=1 to 30s');
    for (const x of items) {
      const ok = tx(project, 'Spike: extend layer', (ca) => ca.addAction(x.ti.createSetEndAction(T(30))));
      let nm = ''; try { nm = await x.ti.getName(); } catch (e) { /* */ }
      log(`    ${x.kind}[${x.idx}] "${nm}" tx=${ok} end now=${sec(await x.ti.getEndTime())}`);
    }
    await dumpSeq(clone, 'clone after extend');
  });

  await step('T16 nest: source sequence (via a CLONE, original untouched)', async () => {
    const src = await findSeqByName(project, sourceSeqName);
    if (!src) throw new Error('source sequence "' + sourceSeqName + '" not found');
    const srcClone = await cloneSequence(project, src, 'Spike: clone source seq');
    if (!srcClone) throw new Error('no clone');
    if (ctx.bin) await moveToBin(project, srcClone, ctx.bin);
    const srcPI = await srcClone.getProjectItem();
    log('  clone in/out before: ' + sec(await srcClone.getInPoint()) + ' / ' + sec(await srcClone.getOutPoint()));
    const target = await fromMedia(project, 'SPIKE_E_nest', clip, ctx.bin || ctx.root);
    await emptySeq(project, target);
    const editor = ppro.SequenceEditor.getEditor(target);
    log('  (a) overwrite seq projectItem as-is tx=' + tx(project, 'Spike: nest a', (ca) => ca.addAction(editor.createOverwriteItemAction(srcPI, T(0), 0, 0))));
    await dumpSeq(target, 'after (a)');
    await emptySeq(project, target);
    log('  (b) sequence.createSetIn/OutPointAction 10-15 tx=' + tx(project, 'Spike: seq in/out', (ca) => { ca.addAction(srcClone.createSetInPointAction(T(10))); ca.addAction(srcClone.createSetOutPointAction(T(15))); }));
    log('      clone in/out now: ' + sec(await srcClone.getInPoint()) + ' / ' + sec(await srcClone.getOutPoint()));
    log('      overwrite tx=' + tx(project, 'Spike: nest b', (ca) => ca.addAction(editor.createOverwriteItemAction(srcPI, T(0), 0, 0))));
    await dumpSeq(target, 'after (b)');
    let c = await v1End(target, 0);
    let srcClip = null; try { srcClip = ppro.ClipProjectItem.cast(srcPI); } catch (e) { log('  cast seq PI -> ClipProjectItem err ' + errStr(e)); }
    if (srcClip) {
      log('  (c) ClipProjectItem(seq).createSetInOutPointsAction 20-25 tx=' + tx(project, 'Spike: seq clip in/out', (ca) => ca.addAction(srcClip.createSetInOutPointsAction(T(20), T(25)))));
      log('      overwrite tx=' + tx(project, 'Spike: nest c', (ca) => ca.addAction(editor.createOverwriteItemAction(srcPI, T(c), 0, 0))));
      await dumpSeq(target, 'after (c)');
      try { log('      isSequence=' + (await srcClip.isSequence())); } catch (e) { /* */ }
    }
  });

  await step('T17 fetch', async () => {
    try { const r = await fetch('https://raw.githubusercontent.com/adobe/premierepro-types/main/README.md'); log('  github raw status=' + r.status); } catch (e) { log('  github raw FAILED: ' + errStr(e)); }
    try { const r = await fetch('https://example.com/'); log('  example.com (not allowed) status=' + r.status); } catch (e) { log('  example.com blocked as expected: ' + errStr(e)); }
  });

  await step('T18 open sequence', async () => {
    if (ctx.seqA) log('  openSequence -> ' + (await project.openSequence(ctx.seqA)));
  });

  return finish();
}

// Second run: only the template behaviour, with more layer kinds (text graphic, adjustment layer, short video, MOGRT variants).
async function runTemplateOnly() {
  logLines.length = 0;
  const templateName = document.getElementById('templateName').value.trim();
  const videoName = document.getElementById('videoName').value.trim();
  log('Reel Cutter spike — TEMPLATE ONLY — ' + new Date().toISOString());
  const project = await ppro.Project.getActiveProject();
  const root = await project.getRootItem();
  const all = await walk(root, '', [], 0);
  const byName = (n) => all.find(r => r.it.name === n);
  const clipRec = all.find(r => r.it.name.toLowerCase() === videoName.toLowerCase());
  const bin = all.find(r => r.isFolder && r.it.name === 'SPIKE_TEST');
  const clip = clipRec.clip, clipPI = clipRec.it;

  await step('U1 template contents', async () => {
    const tpl = await findSeqByName(project, templateName);
    await dumpSeq(tpl, 'template (read only)');
    const clone = await cloneSequence(project, tpl, 'Spike: clone template 2');
    if (bin) await moveToBin(project, clone, bin.folder);
    const editor = ppro.SequenceEditor.getEditor(clone);
    const vCount = await clone.getVideoTrackCount();
    log('  clone video tracks = ' + vCount);

    const adj = byName('Adjustment Layer');
    if (adj) log('  add Adjustment Layer at idx ' + vCount + ' (beyond last track) tx=' + tx(project, 'Spike: add adj', (ca) => ca.addAction(editor.createOverwriteItemAction(adj.it, T(0), vCount, 0))));
    else log('  no Adjustment Layer item');
    log('  video tracks now = ' + (await clone.getVideoTrackCount()));

    // short video near the end of its media: in/out 115-118 of a 120 s file, on the next track up
    const vc2 = await clone.getVideoTrackCount();
    tx(project, 'Spike: in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(115), T(118))));
    log('  add short video (115-118 of 120 s) at idx ' + vc2 + ' tx=' + tx(project, 'Spike: add short vid', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(0), vc2, 2))));
    tx(project, 'Spike: in/out', (ca) => ca.addAction(clip.createSetInOutPointsAction(T(10), T(22))));
    log('  footage on V idx0 tx=' + tx(project, 'Spike: footage', (ca) => ca.addAction(editor.createOverwriteItemAction(clipPI, T(0), 0, 0))));
    tx(project, 'Spike: clear', (ca) => ca.addAction(clip.createClearInOutPointsAction()));

    const mogrt = 'C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Essential Graphics\\Basic Title.mogrt';
    for (const [v, a, inTx] of [[1, -1, false], [1, 0, false], [5, 5, false], [1, 0, true]]) {
      try {
        let res;
        if (inTx) project.lockedAccess(() => { res = editor.insertMogrtFromPath(mogrt, T(20), v, a); });
        else res = editor.insertMogrtFromPath(mogrt, T(20), v, a);
        if (isPromise(res)) res = await res;
        log(`  insertMogrtFromPath(v=${v}, a=${a}, locked=${inTx}) -> ${res ? res.length + ' items' : String(res)}`);
        break;
      } catch (e) { log(`  insertMogrtFromPath(v=${v}, a=${a}, locked=${inTx}) err ${errStr(e)}`); }
    }
    await dumpSeq(clone, 'clone before extend');
    const items = (await allTrackItems(clone)).filter(x => x.idx >= 1);
    for (const x of items) {
      const before = sec(await x.ti.getEndTime());
      const ok = tx(project, 'Spike: extend', (ca) => ca.addAction(x.ti.createSetEndAction(T(30))));
      let nm = ''; try { nm = await x.ti.getName(); } catch (e) { /* */ }
      log(`    ${x.kind}[${x.idx}] "${nm}" end ${before} -> ${sec(await x.ti.getEndTime())} (tx=${ok})`);
    }
    await dumpSeq(clone, 'clone after extend to 30');
    // shrink test: reel shorter than template layers
    const items2 = (await allTrackItems(clone)).filter(x => x.idx >= 1);
    tx(project, 'Spike: shrink', (ca) => items2.forEach(x => ca.addAction(x.ti.createSetEndAction(T(3)))));
    await dumpSeq(clone, 'clone after setEnd(3) on all layers in ONE tx');
  });
  return finish();
}

async function finish() {
  log('');
  log('=== END ===');
  const text = logLines.join('\n');
  try {
    const folder = await uxp.storage.localFileSystem.getDataFolder();
    const f = await folder.createFile('spike_log.txt', { overwrite: true });
    await f.write(text);
    const p = folder.nativePath + ' \\ spike_log.txt';
    document.getElementById('savedPath').textContent = 'اتحفظ كمان في: ' + p;
    log('saved to ' + p);
  } catch (e) { log('save failed: ' + errStr(e)); }
}

function analyzePaste() {
  const t = document.getElementById('paste').value;
  const count = (re) => (t.match(re) || []).length;
  logLines.push('');
  logLines.push('### PASTE TEST');
  logLines.push(`  length=${t.length} tabs=${count(/\t/g)} LF=${count(/\n/g)} CR=${count(/\r/g)} quotes=${count(/"/g)}`);
  logLines.push('  raw(first 600)=' + JSON.stringify(t.slice(0, 600)));
  document.getElementById('log').value = logLines.join('\n');
  finish();
}

async function copyLog() {
  const text = document.getElementById('log').value;
  try {
    if (navigator.clipboard && navigator.clipboard.setContent) await navigator.clipboard.setContent({ 'text/plain': text });
    else await navigator.clipboard.writeText(text);
    document.getElementById('copyLog').textContent = 'اتنسخ ✓';
  } catch (e) {
    document.getElementById('copyLog').textContent = 'النسخ فشل — حدّد النص بإيدك وCtrl+C';
  }
}

function wire() {
  document.getElementById('runAll').addEventListener('click', () => { runAll().catch(e => { log('FATAL ' + errStr(e)); finish(); }); });
  document.getElementById('runTpl').addEventListener('click', () => { runTemplateOnly().catch(e => { log('FATAL ' + errStr(e)); finish(); }); });
  document.getElementById('analyzePaste').addEventListener('click', analyzePaste);
  document.getElementById('copyLog').addEventListener('click', copyLog);
}

try {
  uxp.entrypoints.setup({
    panels: {
      reelCutterPanel: {
        create(rootNode) {
          const appEl = document.getElementById('app');
          if (rootNode && appEl && rootNode !== document.body && !rootNode.contains(appEl)) rootNode.appendChild(appEl);
        },
        show() {}
      }
    }
  });
} catch (e) { console.log('entrypoints.setup failed', e); }
wire();
