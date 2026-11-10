// All Premiere access for reading the project lives here (plus tx()). Behaviour notes: SPIKE_NOTES.md.
'use strict';

const ppro = require('premierepro');

const UNSET_INOUT = -400000; // seconds returned by getInPoint/getOutPoint when no in/out is set (spike T3/T8)

/** Run actions in one undoable transaction. `build(compoundAction)` must be synchronous. */
function tx(project, label, build) {
  let ok = false;
  project.lockedAccess(() => {
    ok = project.executeTransaction((ca) => { build(ca); }, label);
  });
  if (!ok) throw new Error('Premiere رفض العملية: ' + label);
  return ok;
}

async function getProject() {
  const p = await ppro.Project.getActiveProject();
  if (!p) throw new Error('مفيش مشروع مفتوح في بريمير');
  return p;
}

function asFolder(item) {
  try { return ppro.FolderItem.cast(item) || null; } catch (e) { return null; }
}

/**
 * Walk the whole project. Returns clips (not sequences) and sequences' project items.
 * @returns {Promise<{clips: object[], folders: object[]}>}
 */
async function scanProject(project) {
  const root = await project.getRootItem();
  const clips = [], folders = [];
  async function walk(folder, path, depth) {
    if (depth > 12) return;
    let items;
    try { items = await folder.getItems(); } catch (e) { return; }
    for (const it of items) {
      const f = it.type === 2 ? asFolder(it) : null;
      if (f) { folders.push({ item: it, folder: f, path: path + '/' + it.name }); await walk(f, path + '/' + it.name, depth + 1); continue; }
      let clip = null;
      try { clip = ppro.ClipProjectItem.cast(it); } catch (e) { clip = null; }
      if (!clip) continue;
      let isSeq = false;
      try { isSeq = await clip.isSequence(); } catch (e) { /* treat as clip */ }
      if (isSeq) continue;
      clips.push({ id: it.getId(), name: it.name, base: baseName(it.name), path: path + '/' + it.name, item: it, clip });
    }
  }
  await walk(root, '', 0);
  return { root, clips, folders };
}

function baseName(name) { return String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim().toLowerCase(); }

/** Clips whose name (without extension, case-insensitive) equals the sheet's video name. */
function matchClips(clips, videoName) {
  const b = baseName(videoName);
  return clips.filter(c => c.base === b);
}

/** Duration (s) and frame rate of a clip, cached on the entry. */
async function clipInfo(entry) {
  if (entry.info) return entry.info;
  const info = { duration: null, fps: null, path: null };
  try { const m = await entry.clip.getMedia(); let d = m.getDuration(); if (d && d.then) d = await d; info.duration = d ? d.seconds : null; } catch (e) { /* unknown */ }
  try { const fi = await entry.clip.getFootageInterpretation(); info.fps = fi.getFrameRate(); } catch (e) { /* unknown */ }
  try { info.path = await entry.clip.getMediaFilePath(); } catch (e) { /* unknown */ }
  entry.info = info;
  return info;
}

/** Find a bin by name at the project root, creating it if missing. */
async function ensureRootBin(project, name) {
  const root = await project.getRootItem();
  const find = async () => {
    const items = await root.getItems();
    const hit = items.find(i => i.type === 2 && i.name === name);
    return hit ? asFolder(hit) : null;
  };
  let bin = await find();
  if (bin) return bin;
  tx(project, `Reel Cutter: إنشاء Bin ${name}`, (ca) => ca.addAction(root.createBinAction(name, false)));
  bin = await find();
  if (!bin) throw new Error('معرفتش أعمل Bin ' + name);
  return bin;
}

async function listSequences(project) {
  return await project.getSequences();
}

module.exports = { ppro, UNSET_INOUT, tx, getProject, scanProject, matchClips, clipInfo, ensureRootBin, listSequences, baseName };
