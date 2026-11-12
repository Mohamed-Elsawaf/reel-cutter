// UI wiring for the Reel Cutter panel. Pure logic lives in parser/validate/naming; Premiere calls in src/ppro/.
'use strict';

const uxp = require('uxp');
let parseSheet, validateReel, hasErrors, formatTime, naming, P, buildReel, S, U;
try {
  ({ parseSheet } = require('./src/parser.js'));
  ({ validateReel, hasErrors } = require('./src/validate.js'));
  ({ formatTime } = require('./src/timecode.js'));
  naming = require('./src/naming.js');
  P = require('./src/ppro/project.js');
  ({ buildReel } = require('./src/ppro/builder.js'));
  S = require('./src/settings.js');
  U = require('./src/updater.js');
} catch (e) {
  const m = document.getElementById('parseMsg');
  if (m) { m.textContent = 'LOAD ERROR: ' + (e && e.message ? e.message : e); m.className = 'msg err'; }
  throw e;
}

const $ = (id) => document.getElementById(id);
const RLE = '‫', PDF = '‬';

const state = {
  reels: [],
  clips: [],          // sources to cut from: the user's sequences, or raw clips when there are none
  sourceKind: 'seq',  // 'seq' | 'clip'
  running: false,
  lastRun: [],        // sequences created by the last run (for the delete button)
  cancel: false,
  templates: [],      // names of TPL_ sequences in the project
  settings: S.sanitize(null)
};

function el(tag, attrs, children) {
  const e = document.createElement(tag);
  if (attrs) for (const k of Object.keys(attrs)) {
    if (k === 'text') e.textContent = attrs[k];
    else if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  (children || []).forEach(c => c && e.appendChild(c));
  return e;
}

function msg(id, text, isErr) { const m = $(id); m.textContent = text || ''; m.className = 'msg' + (isErr ? ' err' : ''); }

// ---------- project ----------
async function refreshProject() {
  const project = await P.getProject();
  const seqs = await P.scanSequences(project, { templatePrefix: S.TEMPLATE_PREFIX, reelsBin: 'REELS' });
  if (seqs.length) { state.clips = seqs; state.sourceKind = 'seq'; }
  else { state.clips = (await P.scanProject(project)).clips; state.sourceKind = 'clip'; }
  state.templates = (await P.listSequences(project)).map(q => q.name).filter(S.isTemplateName).sort();
  renderTemplateSettings();
  return project;
}

/** Template per reel: the user's pick wins, else company mapping, else the default. */
function applyTemplates() {
  for (const reel of state.reels) {
    if (reel.templateManual && (reel.templateName === '' || state.templates.includes(reel.templateName))) continue;
    reel.templateManual = false;
    reel.templateName = S.templateFor(state.settings, reel.company, state.templates);
  }
}

async function saveSettings() {
  try { await S.save(state.settings); } catch (e) { msg('parseMsg', 'معرفتش أحفظ الإعدادات: ' + (e.message || e), true); }
}

function templateSelect(current, onChange, emptyLabel) {
  const sel = el('select', { title: 'التمبلت' });
  const none = el('option', { value: '__none__', text: emptyLabel || 'بدون تمبلت' });
  if (!current) none.setAttribute('selected', 'selected');
  sel.appendChild(none);
  state.templates.forEach(n => { const o = el('option', { value: n, text: n }); if (n === current) o.setAttribute('selected', 'selected'); sel.appendChild(o); });
  if (current && !state.templates.includes(current)) { const o = el('option', { value: current, text: current + ' (مش موجود)' }); o.setAttribute('selected', 'selected'); sel.appendChild(o); }
  sel.addEventListener('change', () => onChange(sel.value === '__none__' ? '' : sel.value));
  return sel;
}

/** Default template + company mappings list. */
function renderTemplateSettings() {
  const box = $('tplSettings');
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  box.appendChild(el('div', { class: 'row-inline' }, [
    el('span', { text: 'التمبلت الافتراضي:' }),
    templateSelect(state.settings.defaultTemplate, async (v) => { state.settings.defaultTemplate = v; await saveSettings(); applyTemplates(); render(); })
  ]));
  const maps = Object.values(state.settings.companyTemplates);
  box.appendChild(el('div', { class: 'muted', text: maps.length ? 'الشركات المتسجلة:' : 'لما تختار تمبلت لريل فيه اسم شركة، البلاجن هيفتكره للشركة دي.' }));
  maps.forEach(m => {
    const del = el('div', { role: 'button', class: 'btn ghost small', text: 'شيل' });
    del.addEventListener('click', async () => { S.setCompanyTemplate(state.settings, m.company, ''); await saveSettings(); applyTemplates(); renderTemplateSettings(); render(); });
    box.appendChild(el('div', { class: 'row-inline map' }, [el('span', { text: RLE + m.company + PDF }), el('span', { class: 'muted', text: '←' }), el('span', { text: m.template }), del]));
  });
}

function entryById(id) { return state.clips.find(c => c.id === id) || null; }

/**
 * Pick the source for each reel: keep the user's choice, else auto-match the sheet's video name
 * (a sequence named like it wins over one that only contains it), else the only source there is.
 */
async function resolveClips() {
  for (const reel of state.reels) {
    if (reel.clipId && entryById(reel.clipId)) continue;
    let m = P.matchClips(state.clips, reel.videoName);
    const exact = m.filter(c => c.base === P.baseName(reel.videoName));
    if (exact.length) m = exact;
    if (!m.length && !reel.videoName && state.clips.length === 1) m = state.clips.slice();
    reel.clipId = m.length === 1 ? m[0].id : null;
    reel.candidates = m.length > 1 ? m.map(c => c.id) : [];
  }
  const used = new Set(state.reels.map(r => r.clipId).filter(Boolean));
  for (const id of used) await P.clipInfo(entryById(id));
}

function revalidate(reel) {
  const entry = reel.clipId ? entryById(reel.clipId) : null;
  validateReel(reel, {
    sourceChosen: !!entry,
    videoExists: () => !!entry,
    getDuration: () => (entry && entry.info ? entry.info.duration : null)
  });
  if (!entry && reel.candidates && reel.candidates.length > 1) {
    const i = reel.issues.find(x => x.code === 'video-missing');
    if (i) i.message = `فيه ${reel.candidates.length} ${state.sourceKind === 'seq' ? 'SEQ فيها' : 'فيديوهات بنفس الاسم'} "${reel.videoName}" — اختار واحد`;
  }
}

// ---------- review table ----------
function issueList(issues, cls) {
  return issues.map(i => el('div', { class: cls + ' ' + i.level, text: RLE + (i.level === 'error' ? '✖ ' : '⚠ ') + i.message + PDF }));
}

function renderReel(reel, index) {
  const err = hasErrors(reel);
  const warns = reel.issues.concat(...reel.segments.map(s => s.issues)).filter(i => i.level === 'warning').length;
  const box = el('div', { class: 'reel' + (err && !reel.skip ? ' has-error' : '') + (reel.skip ? ' skipped' : '') });

  const isSeq = state.sourceKind === 'seq';
  const videoSelect = el('select', { title: isSeq ? 'الـ SEQ اللي هتقص منها' : 'الفيديو في المشروع' });
  const noVid = el('option', { value: '__none__', text: isSeq ? '— اختار الـ SEQ —' : '— اختار الفيديو —' });
  if (!reel.clipId) noVid.setAttribute('selected', 'selected');
  videoSelect.appendChild(noVid);
  // Name matches first, then every other source, so a wrong auto-match can still be changed.
  const first = (reel.candidates || []).map(entryById).filter(Boolean);
  const cands = first.concat(state.clips.filter(c => !first.includes(c)));
  cands.forEach(c => { const o = el('option', { value: c.id, text: isSeq ? c.name : c.path.replace(/^\//, '') }); if (c.id === reel.clipId) o.setAttribute('selected', 'selected'); videoSelect.appendChild(o); });
  videoSelect.addEventListener('change', async () => {
    reel.clipId = videoSelect.value && videoSelect.value !== '__none__' ? videoSelect.value : null;
    if (reel.clipId) await P.clipInfo(entryById(reel.clipId));
    revalidate(reel); render();
  });

  const videoInput = el('input', { type: 'text', value: reel.videoName, title: 'اسم الفيديو في الشيت' });
  videoInput.addEventListener('change', async () => { reel.videoName = videoInput.value.trim(); reel.clipId = null; await resolveClips(); revalidate(reel); render(); });
  const companyInput = el('input', { type: 'text', value: reel.company, placeholder: 'الشركة' });
  companyInput.addEventListener('change', () => { reel.company = companyInput.value.trim(); applyTemplates(); render(); });
  const tplSel = templateSelect(reel.templateName, async (v) => {
    reel.templateName = v; reel.templateManual = true;
    if (reel.company) {
      S.setCompanyTemplate(state.settings, reel.company, v);
      await saveSettings();
      // Same company elsewhere in this paste follows the new choice.
      state.reels.forEach(o => { if (o !== reel && !o.templateManual && S.normCompany(o.company) === S.normCompany(reel.company)) o.templateName = v; });
      renderTemplateSettings();
    }
    render();
  });
  const skip = el('input', { type: 'checkbox' });
  if (reel.skip) skip.setAttribute('checked', 'checked');
  skip.addEventListener('change', () => { reel.skip = skip.checked; render(); });

  const badge = reel.skip ? el('span', { class: 'badge skip', text: 'متخطّي' })
    : err ? el('span', { class: 'badge err', text: 'فيه خطأ' })
      : warns ? el('span', { class: 'badge warn', text: `${warns} تنبيه` })
        : el('span', { class: 'badge ok', text: 'جاهز' });

  box.appendChild(el('div', { class: 'reel-head' }, [
    el('span', { class: 'num', text: 'R' + String(index + 1).padStart(2, '0') }),
    badge, videoInput, videoSelect, companyInput, tplSel,
    el('label', { class: 'check' }, [skip, el('span', { text: 'تخطّي' })])
  ]));
  issueList(reel.issues, 'seg-issue').forEach(n => box.appendChild(n));

  reel.segments.forEach((seg, si) => {
    const t = el('input', { type: 'text', class: 'time' + (seg.issues.some(i => i.level === 'error') ? ' bad' : ''), value: seg.rawText });
    t.addEventListener('change', () => { seg.rawText = t.value; revalidate(reel); render(); });
    const d = (seg.startSec != null && seg.endSec != null && seg.endSec > seg.startSec) ? formatTime(seg.endSec - seg.startSec) : '';
    box.appendChild(el('div', { class: 'seg' }, [
      el('span', { class: 'idx', text: String(si + 1) }), t,
      el('span', { class: 'dur', text: d }),
      el('span', { class: 'phrase', text: seg.phrase ? RLE + seg.phrase + PDF : '' })
    ]));
    issueList(seg.issues, 'seg-issue').forEach(n => box.appendChild(n));
  });
  return box;
}

function render() {
  const list = $('reels');
  while (list.firstChild) list.removeChild(list.firstChild);
  state.reels.forEach((r, i) => list.appendChild(renderReel(r, i)));
  const ready = state.reels.filter(r => !r.skip && !hasErrors(r)).length;
  const bad = state.reels.filter(r => !r.skip && hasErrors(r)).length;
  const skipped = state.reels.filter(r => r.skip).length;
  const sum = $('summary');
  while (sum.firstChild) sum.removeChild(sum.firstChild);
  sum.appendChild(el('span', { class: 'pill skip', text: `${state.reels.length} ريل` }));
  if (ready) sum.appendChild(el('span', { class: 'pill ok', text: `جاهز ${ready}` }));
  if (bad) sum.appendChild(el('span', { class: 'pill err', text: `فيه خطأ ${bad}` }));
  if (skipped) sum.appendChild(el('span', { class: 'pill skip', text: `متخطّي ${skipped}` }));
  $('reviewSection').hidden = state.reels.length === 0;
  $('runSection').hidden = state.reels.length === 0;
  $('run').textContent = `اعمل ${ready} ريل`;
  renderUndo();
  const off = ready === 0 || state.running;
  $('run').className = 'btn primary big' + (off ? ' disabled' : '');
}

// ---------- actions ----------
async function analyze() {
  msg('parseMsg', '');
  const text = $('paste').value;
  if (!text.trim()) { msg('parseMsg', 'الزق خلايا الشيت الأول', true); return; }
  const res = parseSheet(text, { sortChronological: $('sortChrono').checked });
  state.reels = res.reels;
  if (!res.reels.length) { msg('parseMsg', res.warnings.join(' — ') || 'ملقتش ريلز', true); render(); return; }
  try { await refreshProject(); } catch (e) { msg('parseMsg', String(e.message || e), true); }
  await resolveClips();
  applyTemplates();
  state.reels.forEach(revalidate);
  msg('parseMsg', res.warnings.join(' — '));
  updatePatternPreview();
  render();
}

async function rescan() {
  await refreshProject();
  await resolveClips();
  applyTemplates();
  state.reels.forEach(revalidate);
  render();
}

async function run() {
  if (state.running) return;
  state.running = true; state.cancel = false;
  $('cancel').hidden = false; render();
  const report = $('report');
  while (report.firstChild) report.removeChild(report.firstChild);
  const line = (text, cls) => report.appendChild(el('div', { class: 'line ' + cls, text: RLE + text + PDF }));
  let firstSeq = null;
  const built = [];
  const leftovers = [];
  try {
    const project = await refreshProject();
    await resolveClips();
    state.reels.forEach(revalidate);
    const todo = state.reels.map((r, i) => ({ r, i })).filter(x => !x.r.skip && !hasErrors(x.r));
    const bin = await P.ensureRootBin(project, 'REELS');
    const allSeqs = await P.listSequences(project);
    const existing = allSeqs.map(q => q.name);
    for (let k = 0; k < todo.length; k++) {
      const { r, i } = todo[k];
      if (state.cancel) { line(`R${String(i + 1).padStart(2, '0')}: اتلغى`, 'skip'); continue; }
      const entry = entryById(r.clipId);
      const forName = Object.assign({}, r, { videoName: r.videoName || (entry ? entry.name : '') });
      const name = reelName(forName, i + 1, existing);
      const template = r.templateName ? allSeqs.find(q => q.name === r.templateName) : null;
      if (r.templateName && !template) { line(`✖ ${name}: التمبلت ${r.templateName} مش موجود`, 'fail'); continue; }
      existing.push(name);
      msg('progress', `بعمل ${k + 1} من ${todo.length}: ${name}`);
      try {
        const out = await buildReel(project, r, entry, {
          name, bin, template, markers: state.settings.markers,
          handleBefore: state.settings.handleBefore, handleAfter: state.settings.handleAfter
        });
        if (!firstSeq) firstSeq = out.seq;
        built.push({ reel: r, seq: out.seq, entry, out });
        const total = out.segments.length ? out.segments[out.segments.length - 1].end : 0;
        const tplInfo = out.layers ? ` — ${r.templateName}: مد ${out.layers.extended} لاير` + (out.layers.skipped ? ` (${out.layers.skipped} بيبدأ بعد آخر الريل)` : '') : '';
        line(`✔ ${name} — ${out.segments.length} مقطع — ${formatTime(total)}${tplInfo}`, 'ok');
      } catch (e) {
        // A reel that failed half-way leaves an incomplete sequence: remove it, or track it if that fails.
        let note = '';
        if (e && e.partialSeq) {
          let removed = false;
          try { removed = await project.deleteSequence(e.partialSeq); } catch (e2) { removed = false; }
          if (removed) note = ' (الـ SEQ الناقص اتمسح)';
          else { leftovers.push(e.partialSeq); note = ' (فضل SEQ ناقص في REELS — زرار المسح هيشيله)'; }
        }
        line(`✖ ${name}: ${e.message || e}${note}`, 'fail');
      }
    }
    state.reels.forEach((r, i) => { if (r.skip) line(`R${String(i + 1).padStart(2, '0')}: متخطّي`, 'skip'); else if (hasErrors(r)) line(`R${String(i + 1).padStart(2, '0')}: ما اتعملش (فيه خطأ)`, 'skip'); });
    state.lastRun = built.map(b => b.seq).concat(leftovers);
    try { await writeRunLog(project, built); } catch (e) { /* log is a debugging aid only */ }
    if (firstSeq) { try { await project.openSequence(firstSeq); } catch (e) { /* not critical */ } }
    msg('progress', state.cancel ? 'اتلغى' : 'خلص');
  } catch (e) {
    msg('progress', 'حصل خطأ: ' + (e.message || e), true);
  } finally {
    state.running = false; $('cancel').hidden = true; render();
  }
}

/**
 * Sequence name for a reel. When {nn}/{n} would repeat a name from an earlier run, keep counting
 * (R01, R02 exist -> R03) instead of "R01 (2)".
 */
function reelName(reel, n, existing) {
  const pat = state.settings.pattern;
  const taken = new Set(existing.map(x => x.toLowerCase()));
  if (/\{nn?\}/.test(pat || naming.DEFAULT_PATTERN)) {
    for (let k = n; k < n + 500; k++) {
      const nm = naming.sequenceName(pat, reel, k);
      if (!taken.has(nm.toLowerCase())) return nm;
    }
  }
  return naming.uniqueName(naming.sequenceName(pat, reel, n), existing);
}

/** Debug aid: dump what was built to <plugin data folder>/last_run.txt. */
async function writeRunLog(project, built) {
  const ppro = P.ppro;
  const r3 = (t) => Math.round(t.seconds * 1000) / 1000;
  const lines = ['Reel Cutter run ' + new Date().toISOString()];
  for (const b of built) {
    lines.push(`\n== ${b.seq.name} (video ${b.reel.videoName || '-'}, source ${b.entry.kind || 'clip'} "${b.entry.name}")`);
    (b.out.pieces || []).forEach(p => lines.push(`  piece: ${p.name} in=${p.in} out=${p.out} -> at ${p.at}`));
    b.reel.segments.forEach((s, i) => lines.push(`  sheet ${i + 1}: ${s.rawText} -> ${s.startSec}-${s.endSec}`));
    const vc = await b.seq.getVideoTrackCount(), ac = await b.seq.getAudioTrackCount();
    for (const [k, n, g] of [['V', vc, 'getVideoTrack'], ['A', ac, 'getAudioTrack']]) {
      for (let i = 0; i < n; i++) {
        const items = (await b.seq[g](i)).getTrackItems(ppro.Constants.TrackItemType.CLIP, false) || [];
        for (const ti of items) lines.push(`  ${k}${i + 1}: start=${r3(await ti.getStartTime())} end=${r3(await ti.getEndTime())} in=${r3(await ti.getInPoint())} out=${r3(await ti.getOutPoint())}`);
      }
    }
    const mk = (await ppro.Markers.getMarkers(b.seq)).getMarkers() || [];
    mk.forEach(m => lines.push(`  marker @${r3(m.getStart())}: "${m.getName()}" | ${m.getComments()}`));
    for (const t of (b.out.sources || [])) {
      lines.push(`  source ${t.name} in/out before: ${t.origIn} / ${t.origOut}, now: ${r3(await t.clip.getInPoint(ppro.Constants.MediaType.VIDEO))} / ${r3(await t.clip.getOutPoint(ppro.Constants.MediaType.VIDEO))}`);
    }
    try { lines.push('  bin: ' + (await b.seq.getProjectItem()).getParentBin().name); } catch (e) { /* */ }
  }
  const folder = await uxp.storage.localFileSystem.getDataFolder();
  const f = await folder.createFile('last_run.txt', { overwrite: true });
  await f.write(lines.join('\n'));
}

// ---------- settings fields ----------
function fillSettings() {
  const st = state.settings;
  $('handleBefore').value = String(st.handleBefore);
  $('handleAfter').value = String(st.handleAfter);
  $('pattern').value = st.pattern;
  if (st.markers) $('markers').setAttribute('checked', 'checked'); else $('markers').removeAttribute('checked');
  $('markers').checked = !!st.markers;
  updatePatternPreview();
}

function updatePatternPreview() {
  const r0 = state.reels[0];
  const e0 = r0 && r0.clipId ? entryById(r0.clipId) : null;
  const sample = r0 ? Object.assign({}, r0, { videoName: r0.videoName || (e0 ? e0.name : '') }) : { company: 'Acme', videoName: 'AW20260826_0650.mp4' };
  $('patternPreview').textContent = '← ' + naming.sequenceName($('pattern').value, sample, 1);
}

function wireSettings() {
  const num = (id, key) => $(id).addEventListener('change', () => {
    const v = parseFloat($(id).value);
    state.settings[key] = isFinite(v) && v >= 0 && v <= 60 ? v : 0;
    $(id).value = String(state.settings[key]);
    saveSettings();
  });
  num('handleBefore', 'handleBefore');
  num('handleAfter', 'handleAfter');
  $('pattern').addEventListener('input', updatePatternPreview);
  $('pattern').addEventListener('change', () => {
    state.settings.pattern = $('pattern').value.trim() || naming.DEFAULT_PATTERN;
    $('pattern').value = state.settings.pattern;
    updatePatternPreview(); saveSettings();
  });
  $('markers').addEventListener('change', () => { state.settings.markers = $('markers').checked; saveSettings(); });
}

let undoArmed = false;
async function deleteLastRun() {
  const btn = $('undoRun');
  if (!undoArmed) { undoArmed = true; btn.textContent = `متأكد؟ هيتمسح ${state.lastRun.length} SEQ — اضغط تاني`; setTimeout(() => { undoArmed = false; renderUndo(); }, 4000); return; }
  undoArmed = false;
  const project = await P.getProject();
  let n = 0;
  for (const seq of state.lastRun) { try { if (await project.deleteSequence(seq)) n++; } catch (e) { /* already gone */ } }
  state.lastRun = [];
  msg('progress', `اتمسح ${n} SEQ`);
  renderUndo();
}
function renderUndo() {
  const btn = $('undoRun');
  btn.hidden = !state.lastRun.length || state.running;
  if (!undoArmed) btn.textContent = `امسح ريلز آخر تشغيل (${state.lastRun.length})`;
}

/** Read our own manifest for the version, then look for a newer release (silently skipped when offline/disabled). */
async function showVersionAndCheckUpdate() {
  let version = '';
  try {
    const folder = await uxp.storage.localFileSystem.getPluginFolder();
    const manifest = JSON.parse(await (await folder.getEntry('manifest.json')).read());
    version = manifest.version;
    $('version').textContent = 'v' + version;
  } catch (e) { return; }
  const upd = await U.checkForUpdate(version);
  if (!upd) return;
  $('updateText').textContent = RLE + `فيه نسخة جديدة ${upd.version}` + (upd.notes ? ` — ${upd.notes}` : '') + PDF;
  $('updateBanner').hidden = false;
  $('updateGet').addEventListener('click', () => { try { uxp.shell.openExternal(upd.url); } catch (e) { msg('parseMsg', upd.url); } });
}

function wire() {
  $('analyze').addEventListener('click', () => analyze().catch(e => msg('parseMsg', 'خطأ: ' + (e.message || e), true)));
  $('clear').addEventListener('click', () => { $('paste').value = ''; state.reels = []; msg('parseMsg', ''); render(); });
  $('rescan').addEventListener('click', () => rescan().catch(e => msg('parseMsg', 'خطأ: ' + (e.message || e), true)));
  $('run').addEventListener('click', () => { if (!$('run').className.includes('disabled')) run(); });
  $('undoRun').addEventListener('click', () => deleteLastRun().catch(e => msg('progress', 'خطأ: ' + (e.message || e), true)));
  $('cancel').addEventListener('click', () => { state.cancel = true; msg('progress', 'هيقف بعد الريل الحالي…'); });
  S.load().then(st => { state.settings = st; $('sortChrono').checked = !!st.sortChronological; fillSettings(); renderTemplateSettings(); render(); });
  wireSettings();
  $('toggleSettings').addEventListener('click', () => { $('settingsBox').hidden = !$('settingsBox').hidden; });
  $('sortChrono').addEventListener('change', () => { state.settings.sortChronological = $('sortChrono').checked; saveSettings(); });
  refreshProject().catch(() => { /* no project yet */ });
  showVersionAndCheckUpdate();
  render();
}

try {
  uxp.entrypoints.setup({
    panels: {
      reelCutterPanel: {
        create(rootNode) {
          const appEl = $('app');
          if (rootNode && appEl && rootNode !== document.body && !rootNode.contains(appEl)) rootNode.appendChild(appEl);
        },
        show() {}
      }
    }
  });
} catch (e) { console.log('entrypoints.setup failed', e); }
wire();
