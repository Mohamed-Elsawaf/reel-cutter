# Spike notes (phase 0) — results

**Date:** 2026-11-10. **Setup:** Premiere 26.5.2 on Windows 11 (UXP host 26.5.2), test project `E:\PR EXT\Untitled.prproj`.
Test video `spike_media/AW_TEST_0001.mp4` (generated): 120 s, 1080x1920, 25 fps, stereo AAC, time burned onto the frame.
Raw log: spike runs 1 and 2. Run 1 = all tests, run 2 = template only. The code is in `plugin/spike/spike.js`.

## ملخص بالعربي
- كل حاجة الخطة معتمدة عليها **شغالة**، ومفيش حاجة كسرت الخطة.
- **تحديد in/out + الـ overwrite لازم يبقوا في عمليتين منفصلتين.** لو اتعملوا في عملية واحدة، بريمير بيتجاهل الـ in/out وبيحط الفيديو كله. وفي عمليتين بينزل المقطع مظبوط والصوت معاه.
- **التمبلت:** النسخة بتطلع باسم `TPL_x Copy`، ولازم نتعرّف عليها بمقارنة قايمة الـ SEQs قبل وبعد. اللوجو والـ Color Matte والنص والـ MOGRT والـ Adjustment Layer كلهم اتمدّوا لآخر الريل.
- **وضع الـ Nest ينفع:** بنحط الـ in/out على الـ SEQ الأصلي كـ "كليب" في المشروع، مش على التايم لاين بتاعه.
- **UXP Developer Tools بيفتح شاشة بيضا على الجهاز ده.** بقينا نسطّب البلاجن كملف `.ccx` عن طريق مثبّت Adobe (`tools/dev-install.sh`)، وده نفس طريقة التوزيع في الآخر.
- **عيب في العرض:** الجمل اللي فيها عربي وإنجليزي مع بعض بتظهر بترتيب كلمات غلط جوه البانل (`dir="rtl"` مش بيشتغل). البيانات نفسها سليمة، والمشكلة في العرض بس. هتتعالج في واجهة المرحلة 1.

## Answers to PLAN.md §7

| # | Question | Result |
|---|---|---|
| 1 | in/out + overwrite | **One transaction does NOT work**: overwrite ignores in/out and lays the whole clip (T6). **Two transactions work** (T7): `createSetInOutPointsAction` in tx 1, `createOverwriteItemAction` in tx 2. The item lands with in=20 out=23, start at the cursor, and **audio comes too** (A idx 0, same times). Times that don't fall on a frame are snapped by Premiere (25.01–26.02 became 25–26 at 25 fps). |
| 2 | Fallbacks | Both work, but neither is needed. A: `createSubClipAction` + overwrite works; the subclip is created in the clip's own bin. B: overwriting the whole clip and then trimming works: `createSetInPointAction(50)` moves the *start* to 50 as well, `createSetStartAction(0)` keeps the in point aligned. |
| 3 | Clone | `createCloneAction()` creates `"<name> Copy"`. A guid diff of `project.getSequences()` before and after finds it reliably. `getParentBin()` right after the clone reports the root; after `createMoveItemAction` it is in the target bin (verified in the Project panel). |
| 4 | Extend V2+ | `createSetEndAction(30s)` extended **PNG still, Color Matte, Type-tool text ("Graphic"), MOGRT (Basic Title), Adjustment Layer**. Each item's in/out grows with it (e.g. 3600→3630). **Video layer near the end of its file**: the API happily reports out=145 on a 120 s file. **Not checked visually** what Premiere shows past the media end, so phase 3 should clamp video layers to their media duration or warn. `createSetEndAction(t)` with t < the item's start throws "Invalid parameter". |
| 5 | Track index | **Zero-based.** `(vIdx=1, aIdx=1)` landed on V2/A2. Overwrite to an index **beyond the last track creates a new track** (V4, V5 appeared). |
| 6 | Empty sequence | **Use `createSequenceFromMedia(name, [clip], bin)` and then remove all items.** It takes the clip's size and fps (1080x1920, 25 fps), lands directly in `bin`, and removal via `TrackItemSelection.createEmptySelection` + `createRemoveItemsAction(sel, false, MediaType.ANY, false)` works. `createSequenceWithPresetPath` also works (9x16 preset), but it lands in the project root and needs an install-specific preset path. |
| 7 | Sync / async; markers | `track.getTrackItems(CLIP, false)` is **synchronous** (array). `Markers.getMarkers(seq)` is async; `createAddMarkerAction(name, "Comment", start, TickTime 0, comments)` works with Arabic text, and `markers.getMarkers()` reads them back. Undocumented constants exist too: `ppro.Marker.MARKER_TYPE_COMMENT` etc. |
| 8 | Modules, paste, RTL | **CommonJS only**: `require('./spike/cjs-probe.js')` works, and the path is relative to the **plugin root** when called from a `<script>`. `<script type="module">` did not run and `import()` threw "Not supported". **Paste**: textarea keeps tabs, LF and `""` quotes exactly (tested with the clipboard holding Sheets-style TSV, *not yet a real copy from Google Sheets*). **RTL**: Arabic letters join correctly, but `dir="rtl"` is not applied as the base direction, so mixed Arabic/Latin lines show words in the wrong order. Also, a `<textarea rows=5>` renders one line tall, so it needs a CSS height. |
| 9 | fetch | `raw.githubusercontent.com` → 200. Non-listed domain → "Permission denied … Manifest entry not found". |
| 10 | Nest | Overwriting `sourceSeq.getProjectItem()` gives a nested clip (track item named after the sequence). `sequence.createSetIn/OutPointAction` is **ignored** by overwrite. **`ClipProjectItem.cast(seqProjectItem).createSetInOutPointsAction(in, out)` works** (two transactions, like a clip): it gave in=20 out=25. So Nest mode is feasible. It temporarily sets source in/out on the user's sequence *project item*, which must be restored afterwards, just like the clip. All tests used a clone of the user's sequence. |

## Other facts learned (use these, don't re-derive)
- `ClipProjectItem.getInPoint/getOutPoint(MediaType.VIDEO)` return **-400000 s** when no in/out is set (the "unset" sentinel). `createClearInOutPointsAction` brings it back to that. **Builder rule:** read in/out before, and afterwards restore the original values, or clear them when they were unset. Don't just clear, or the user would lose an in/out they had set.
- Media duration: `(await clip.getMedia()).getDuration().seconds` (sync on Media). `getStart()` = 0 for this file. Untested: camera files with embedded timecode (`Sample Media Clip` items show Media Start 16:20:22:08). Check whether in/out are relative to the media start before using such files.
- Clip frame rate: `(await clip.getFootageInterpretation()).getFrameRate()` → 25. Sequence: `(await seq.getSettings()).getVideoFrameRate().value`.
- Telling folders from clips on 26.5: `item.type` **does exist** (1 = clip/sequence, 2 = bin) even though the docs say 27.0, and `Constants.ProjectItemType` is undefined. `ClipProjectItem.cast(folder)` returns null. `FolderItem.cast` + `getItems()` is the reliable test. Sequences are clips with `isSequence() === true`.
- `TickTime.TIME_ZERO` exists. `Constants.MediaType.*` are opaque objects; pass them through.
- `executeTransaction` returns `true` on success. `insertMogrtFromPath(path, time, vIdx, aIdx)` works **outside** a transaction with `aIdx=0`; `aIdx=-1` → "Invalid parameter".
- `project.openSequence(seq)` → true.
- Renaming via `projectItem.createSetNameAction` updates `seq.name` immediately.

## Dev workflow
**Update after reboot (17:10): UDT works.** Plugin added from `plugin/manifest.json`, "Load & Watch" → edits reload the panel by themselves. The .ccx route below is the fallback.

### Fallback when UDT is blank
- UXP Developer Tools 2.x installed from Creative Cloud. After "Add Plugin" its window went blank and stayed blank across restarts, a cleared Local Storage and `--disable-gpu`. Its service on port 14001 runs and Premiere connects, but the UI never draws.
- Workaround: `bash tools/dev-install.sh` packs `plugin/` into `dist/reelcutter-dev.ccx` and runs `UnifiedPluginInstallerAgent /remove` + `/install`. Bump `manifest.version` each time. Then **close the panel and reopen it from Window → UXP Plugins → Reel Cutter**; no Premiere restart needed.
- Note: removing the plugin wipes its data folder (`PluginsStorage/.../PluginData`). Settings saved there (company→template table) would be lost on every reinstall during development, and possibly on user updates. Keep that in mind for F3/F7.
- Premiere "Enable developer mode" is ticked (Preferences → Plugins).

## Not covered / still open
- A real copy from Google Sheets (merged cells, RTL sheet). Needs the user's sheet.
- What a video layer looks like when extended past its media end (see #4).
- Undo (Ctrl+Z) behaviour across the per-segment transactions. That belongs to phase 2's test.
- Media with non-zero start timecode.

## Phase 2 findings (verified in Premiere, 2026-11-10 17:20)
- 5 reels from 2 videos built exactly (start/end/in/out to the ms, audio on A1, Arabic markers, REELS bin). Log: `<PluginData>/last_run.txt`.
- A user in/out on the source clip (2 / 7.04) is restored exactly; unset clips go back to unset.
- **Undo:** each reel = about 4 + 3×segments History steps. Premiere's History shows 32 by default, so Ctrl+Z cannot undo a whole run. Added a panel button "امسح ريلز آخر تشغيل" that calls `project.deleteSequence` on the run's sequences (verified: 5 deleted, shows as "Delete Project Items").
- UXP needs an explicit scroll container (`#app { height:100%; overflow-y:auto }`). Flex rows ignore `direction: rtl`, so use `row-reverse`. Mixed Arabic/Latin text renders correctly when wrapped in U+202B … U+202C.

## Phase 3 findings (verified in Premiere, 2026-11-10 17:37)
- Reels built on `TPL_TEST` (V2 logo PNG, V3 Type-tool text): the clone is renamed to the reel name and moved to REELS in one transaction, footage goes on V1/A1, and every V2+ item ends exactly at the reel end. Longer reels extend them (11 s, 7 s); a 3 s reel trims the 5 s layers to 3 s. Position/effects come with the clone (checked visually in the Program monitor).
- The company → template mapping is stored in `<PluginData>/settings.json`. Picking a template for a reel that has a company saves the mapping and updates the other reels of that company in the same paste.
- The dropdown lists every sequence starting with `TPL_`, including the spike's leftover "TPL_TEST Copy" clones. The plugin's own clones are renamed, so they don't show up.
- Not handled yet: a template video layer shorter than the reel gets extended past its media end (see #4 above). Rare; revisit if the user's templates contain video.

## Phase 4 findings (verified in Premiere, 2026-11-10 17:48)
- Settings box in the panel: handles before/after (s), SEQ name pattern with live preview, markers on/off. Saved to `settings.json` and reloaded on panel open.
- Handles 1 s / 0.5 s: 0–3 → 0–3.5 (clamped at file start); 10–12 → 9–12.5; 88–90 on a 90 s file → 87–90 (clamped at file end). The marker sits on the phrase start (4.5 s), not on the handle start.
- Pattern `{video}_{company}_H{n}` gave `AW_TEST_0001_Acme_H1`. Settings were reset to the defaults after the test.
- After a run Premiere opens the first reel, which un-maximises the panel (cosmetic).

## Phase 5 (2026-11-10 18:05) — confirmed by the user in Premiere
- `tools/merge-font/` (merge.py CLI + gui.pyw window, README with licence warning). Any Arabic .ttf + any Latin .ttf; defaults Palestine (Downloads) + Impact (Windows).
- The user built and installed the merged font from the window and tested a mixed caption in Premiere: "كله مظبوط".
- The user also has a second "Impact" (v1.0, `unicode.impact.ttf`) installed per-user; the tool defaults to the Windows one.

## UI redesign (2026-11-10 18:16) — UXP CSS facts learned
- Visual reference: `DESIGN.md` (Linear, from github.com/VoltAgent/awesome-design-md via getdesign.md), adapted in `plugin/styles.css`.
- `<button>` ignores background/border styling in UXP → use `<div role="button" class="btn">`; "disabled" is a class.
- An author `display:` beats the `hidden` attribute → `[hidden] { display:none !important }`.
- Under `direction: rtl`, UXP flips `text-align`: `left` renders on the right. Flex rows ignore rtl → `row-reverse`.
- `<select>` won't display an option whose value is `''` → use a sentinel value (`__none__`).
- Restarting Premiere unloads a UDT-loaded plugin; reload it from UDT ("Load & Watch").

## Phase 6 (2026-11-10 18:50) — packaging
- `python tools/package.py` → `dist/ReelCutter-<v>/` (`.ccx`, `install-windows.bat`, README) + `dist/ReelCutter-<v>.zip` + root `version.json`. `spike/` is excluded.
- Verified: v1.0.0 installed with the .bat (UnifiedPluginInstallerAgent), shows in Window > UXP Plugins without UDT, panel shows v1.0.0 (read from its own manifest), analysis works against the project.
- **Settings survive an update install** (1.0.0 → 1.0.1 over the top kept PluginData/settings.json); only an uninstall (`/remove`) wipes them.
- Update check (`src/updater.js`) is off until `UPDATE_URL` is set; needs `launchProcess: https` for the download button (added to the manifest).
- Don't load the dev copy in UDT while the .ccx is installed (same plugin id).
