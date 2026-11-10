# Reel Cutter — خطة بلاجن Premiere Pro (UXP)

> الملف ده هو الـ brief الكامل للتنفيذ. المنفّذ يقرأه كله قبل ما يبدأ، وينفّذ بالترتيب مرحلة مرحلة.
> تاريخ الخطة: 2026-11-10 — Premiere Pro 26.5.2 — Windows 11.

## 1. المستخدم والمشكلة

المستخدم مونتير بيطلّع ريلز من سيشنات وكورسات طويلة. مسئول المحتوى بيبعتله Google Sheet فيه لكل ريل:
مجموعة أوقات (من–إلى)، الجمل اللي بيبدأ وينتهي عندها كل مقطع، اسم الشركة، واسم ملف الفيديو.
حاليًا بيعمل الـ first cut يدوي: يقص في SEQ الفيديو الأصلي وينسخ لـ SEQ جديد. ده اللي هنأتمته.

حقائق مؤكدة من المستخدم:

- السيشن ممكن تكون ملف واحد أو 2 أو 3 ملفات فيديو. كل ملف ليه SEQ خاص بيه.
- الـ SEQ الأصلي فيه **الفيديو الخام بس** (مفيش لون/صوت خارجي/multicam)، والفيديو **بيبدأ من أول الـ SEQ بالظبط**.
  ⇒ التايمكود في الشيت = وقت جوه ملف الفيديو نفسه. يعني **مش محتاجين الـ SEQ الأصلي خالص**؛ ناخد من الـ ClipProjectItem مباشرة.
- **كل مجموعة في الشيت = ريل واحد = SEQ جديد.**
- بيدخل أكتر من وقت لنفس الفيديو، وأكتر من فيديو في نفس اللصقة.
- بيحط layers ثابتة في أغلب شغله: لوجو، بوردر أزرق، Black Matte — وعايز هو اللي يختارها.
- الكابشن بيتعمل ببلاجن تانية وبعدين بيعدّل النص يدوي. المشكلة: بيختار فونت العربي (Palestine) والإنجليزي (Impact) يدوي لكل جزء.
- استخدام شخصي دلوقتي، ويندوز بس، لكن عايزه **قابل للتحديث** وممكن يتباع ويشتغل على Mac بعدين.

## 2. شكل البيانات الداخلة

المستخدم بيعمل Copy للخلايا من Google Sheets ويلزق في textarea في البانل (TSV).

أعمدة الشيت: `الثواني` | `الجمل` | `اسم الشركة` | `الفيديو`

مثال حقيقي (كل مجموعة = ريل):

```
06:02 ل 06:56        اي Agent لحد tools
07:06 ل 08:148       الـ agent لحد بيدور عليها        ← خطأ كتابة حقيقي لازم يتمسك
08:34 ل 09:14        لما اجيلك لحد قولته دا
09:29 ل 10:08        الـ agent لحد مختلفة              AW20260826_0650.mp4 g
---
01:48:02 ل 01:48:16  تقولك لحد تمام
01:16:36 ل 01:16:48  11 Labs لحد حضراتكم              AW20260826_0651_1.mp4
```

قواعد الـ parser (لازم يبقى متسامح):

- صيغ الوقت: `m:ss`، `mm:ss`، `h:mm:ss`، `hh:mm:ss`. مفيش frames. الفاصل بين البداية والنهاية: `ل` أو `-` أو `–` أو `to` أو `الى/إلى`، مع أي مسافات.
- المجموعة ممكن تيجي بشكلين، ادعم الاتنين:
  1. خلية واحدة متعددة السطور (TSV بيحطها بين `"..."` وفيها newlines).
  2. صفوف متتالية واسم الفيديو مكتوب في صف واحد بس من المجموعة (خلايا مدموجة) — أول/آخر صف.
- **اتعرّف على الأعمدة بالمحتوى مش بالترتيب**: العمود اللي فيه نطاقات وقت = الأوقات؛ اللي فيه امتداد فيديو (`.mp4/.mov/.mxf/.mkv`) = الفيديو؛ الباقي جمل/شركة. (الشيت RTL وترتيب اللصق ممكن يتعكس.)
- اسم الفيديو: نضّفه (في المثال فيه `g` زيادة بعد الامتداد) — خد لحد الامتداد بس.
- حدود المجموعات: صف فاضي، أو ظهور اسم فيديو جديد، أو خلية multi-line جديدة.
- **حافظ على ترتيب الأوقات زي ما هي مكتوبة** (مسئول المحتوى ممكن يقصد ترتيب غير زمني — المجموعة 3 في المثال مش مترتبة). وفّر checkbox "رتّب زمنيًا" مقفول افتراضيًا.
- عدد الجمل ممكن ما يساويش عدد الأوقات ⇒ اربط بالترتيب واللي مالوش جملة يفضل فاضي.

Validation (يظهر في جدول المراجعة، والريل اللي فيه خطأ ما يتنفذش لحد ما يتصلّح أو يتعمله skip):

- صيغة غلط (`08:148`)، ثواني/دقايق ≥ 60.
- النهاية ≤ البداية.
- الوقت أكبر من مدة ملف الفيديو.
- الفيديو مش موجود في المشروع.
- تحذير (مش خطأ): مقطع أطول من 3 دقايق، أو مقطعين متداخلين في نفس الريل.

المستخدم يقدر يعدّل أي خلية في جدول المراجعة مباشرة قبل التنفيذ.

## 3. الـ Features

### F1 — القص (MVP)
لكل ريل: SEQ جديد فيه المقاطع ورا بعض على V1/A1 بالترتيب، من غير فراغات.

**مصدر المقاطع — إعداد في البانل:**
- `من الملف` (الافتراضي): المقاطع تتاخد من الـ ClipProjectItem مباشرة. الناتج كليبات عادية قابلة للتعديل، مطابقة لنسخ/لصق من SEQ خام.
- `من الـ SEQ الأصلي (Nest)` (اختياري، يتنفذ بس لو نجح في الـ spike): المقطع يتحط كـ nested sequence من الـ SEQ الأصلي بـ in/out. فايدته إن أي شغل اتعمل على الـ SEQ الأصلي (لون، صوت، scale) يتنقل معاه. المستخدم موافق على الأخذ من الـ SEQ الأصلي لأنه نسخ مش قص، والـ SEQ الأصلي ما يتعدلش في الحالتين.
- ملاحظة: الـ API مفيهوش copy/paste لـ track items بين SEQ و SEQ، فمفيش طريقة تالتة.

### F2 — Template Sequences (اللايرز الثابتة)
- المستخدم بيعمل بنفسه SEQ تمبلت (مقاس الريل + اللوجو + البوردر + Black Matte على V2 وفوق، بالـ position والإفكتات اللي عايزها). **V1/A1 محجوزين للفوتيج وبيبقوا فاضيين في التمبلت.**
- أي SEQ اسمه بيبدأ بـ `TPL_` يظهر في dropdown التمبلتس في البانل.
- عند التنفيذ: clone للتمبلت → ندخّل المقاطع → نمد كل track item في V2+ لحد آخر الريل.
- لو مفيش تمبلت مختار: SEQ جديد عادي من غير layers.

### F3 — تمبلت لكل شركة
جدول إعدادات: `اسم الشركة → تمبلت`. لو عمود الشركة في الشيت طابق، التمبلت يتختار تلقائي (والمستخدم يقدر يغيّره من جدول المراجعة). يتخزن في ملف JSON في data folder بتاع البلاجن.

### F4 — Markers بالجمل
على كل بداية مقطع في الـ SEQ الجديد: marker اسمه الجملة، والـ comment فيه التايمكود الأصلي واسم الفيديو.

### F5 — Handles
إعداد "زوّد قبل/بعد" بالثواني (افتراضي 0). بيتطبق على كل مقطع مع clamp على حدود الملف.

### F6 — تسمية وتنظيم
اسم الـ SEQ: `{الشركة}_{اسم الفيديو بدون امتداد}_R{nn}` (pattern قابل للتعديل). كله يتحط في Bin اسمه `REELS` (يتعمل لو مش موجود).

### F7 — Update check
عند فتح البانل: fetch لملف `version.json` من GitHub ⇒ لو فيه نسخة أحدث يظهر banner فيه رقم النسخة ولينك تنزيل الـ `.ccx`. فشل الشبكة يتجاهل بصمت.

### F8 — الفونت المدمج (أداة منفصلة بره البلاجن)
الـ UXP API **مفيهوش** أي طريقة لتغيير font family أو تنسيق جزء من النص (اتأكدنا من التوثيق). الحل: ملف فونت واحد فيه عربي Palestine + لاتيني Impact؛ المستخدم يختاره مرة واحدة وكل لغة تطلع بشكلها تلقائي.
التفاصيل في المرحلة 5.

### خارج النطاق دلوقتي (أفكار للبيع بعدين)
- Mac build واختباره (الكود نفسه cross-platform؛ ما تستخدمش أي حاجة Windows-only).
- ترخيص/تفعيل.
- مطابقة الجمل بالترانسكريبت (`Transcript.exportToJSON`) لتظبيط بداية/نهاية القص على الكلمة.
- قراءة الشيت مباشرة بلينك بدل اللصق.

## 4. القرارات التقنية

- **UXP plugin** (مش CEP). `manifestVersion: 5`، `host.app: "premierepro"`، `minVersion: "26.3.0"`.
- **Vanilla JS + HTML + CSS، من غير build step** (ES modules أو require حسب اللي UXP يقبله؛ يتحدد في المرحلة 0). JSDoc للأنواع. ده بيسهّل التحديث والـ debug.
- المنطق الخالص (parser, validation, naming, time math) في modules **مالهاش أي اعتماد على `premierepro`** عشان تتختبر بـ Node (`node --test`).
- كل نداءات Premiere في module واحد `src/ppro/` (adapter) عشان لو API اتغير نعدّل مكان واحد.
- الواجهة عربي RTL، بسيطة، ألوان متوافقة مع theme بريمير الغامق.
- Permissions: `network.domains` = دومين GitHub raw بس؛ `localFileSystem: "plugin"`.

هيكل مقترح:

```
E:\PR EXT\
  PLAN.md
  plugin\
    manifest.json
    index.html
    styles.css
    src\
      main.js            # UI wiring
      parser.js          # TSV → reels[]           (pure)
      validate.js        # reels[] → issues[]      (pure)
      timecode.js        # parse/format            (pure)
      naming.js          # sequence names          (pure)
      settings.js        # company→template, handles, pattern
      updater.js
      ppro\
        project.js       # find clips/sequences/bins
        builder.js       # build one reel sequence
    icons\
  tests\                 # node --test على الـ pure modules + fixture من مثال الشيت
  tools\merge-font\      # المرحلة 5
  version.json
```

نموذج البيانات:

```js
// Reel
{ id, company, videoName, templateName|null,
  segments: [{ startSec, endSec, phrase, rawText, issues: [] }],
  issues: [], skip: false }
```

## 5. الـ API المؤكد من التوثيق (developer.adobe.com/premiere-pro/uxp)

```js
const app = require('premierepro');
const project = await app.Project.getActiveProject();

// كل تعديل = Action جوه transaction:
project.lockedAccess(() => {
  project.executeTransaction((compound) => {
    compound.addAction(someAction);
  }, "Undo label");
});
```

| الغرض | الـ API |
|---|---|
| SEQ جديد | `project.createSequenceWithPresetPath(name, presetPath)` (26.3+) / `project.createSequenceFromMedia(name, clipProjectItems[], targetBin)` |
| Clone للتمبلت | `sequence.createCloneAction()` — مفيش return للنسخة ⇒ قارن `project.getSequences()` قبل وبعد |
| تحديد جزء من المصدر | `clipProjectItem.createSetInOutPointsAction(inTick, outTick)` / `createClearInOutPointsAction()` |
| Subclip (بديل) | `clipProjectItem.createSubClipAction(name, start, end, hasHardBoundaries, {takeVideo, takeAudio})` (26.3+) |
| وضع في التايم لاين | `SequenceEditor.getEditor(seq).createOverwriteItemAction(projectItem, time, vTrackIdx, aTrackIdx)` / `createInsertProjectItemAction(projectItem, time, vIdx, aIdx, limitShift)` |
| Trim لـ track item | `trackItem.createSetInPointAction / createSetOutPointAction / createSetStartAction / createSetEndAction(tick)` |
| قراءة track items | `seq.getVideoTrackCount()`, `seq.getVideoTrack(i)`, `track.getTrackItems(app.Constants.TrackItemType.CLIP, false)`, `item.getStartTime()/getEndTime()/getProjectItem()` |
| حذف track items | `editor.createRemoveItemsAction(selection, ripple, mediaType, shiftOverlapping)` + `TrackItemSelection.createEmptySelection(cb)` |
| Markers | `(await app.Markers.getMarkers(seq)).createAddMarkerAction(name, "Comment", startTick, durationTick, comments)` |
| تصفح المشروع | `project.getRootItem()` → `folder.getItems()` (recursive؛ مفيش find-by-name) — `ClipProjectItem.findItemsMatchingMediaPath(str, ignoreSubclips)` — `clip.getMediaFilePath()` |
| Bins وتسمية | `folder.createBinAction(name, makeUnique)`, `folder.createMoveItemAction(item, newParent)`, `projectItem.createSetNameAction(name)`, `seq.getProjectItem()` |
| الوقت | `app.TickTime.createWithSeconds(n)`, `.add()`, `.alignToNearestFrame(frameRate)`; `seq.getTimebase()`; `(await seq.getSettings()).getVideoFrameRate()` |
| مدة SEQ | `seq.getEndTime()` |

**مش موجود في الـ API:** تغيير الفونت/نص الجرافيكس/نص الكابشن. Razor موجود في sample بس (27.1، untyped) — **ما نعتمدش عليه**، ومش محتاجينه أصلًا.

## 6. خوارزمية بناء الريل (`builder.js`)

```
buildReel(reel):
  clip   = findClipByVideoName(reel.videoName)          // بالاسم أولًا، ثم media path
  seq    = template ? cloneTemplate(template) : createEmptyFrom(clip)
  rename seq + move to REELS bin
  cursor = 0
  for seg in reel.segments:
      in  = clamp(seg.startSec - handleBefore), out = clamp(seg.endSec + handleAfter)
      // align الاتنين لأقرب frame بمعدل فريمات الكليب
      TX1: clip.createSetInOutPointsAction(in, out)
      TX2: editor.createOverwriteItemAction(clip, cursor, 0, 0)
      marker @cursor (F4)
      cursor = seq end الفعلي على V1 بعد الإضافة   // اقراه من track item، ما تحسبوش
  TX: clip.createClearInOutPointsAction()                // رجّع الكليب زي ما كان (حتى لو حصل error — try/finally)
  لو template: مد كل track items في V2+ لـ cursor (createSetEndAction)
  return seq
```

- لو حصل خطأ في ريل: سجّله، كمّل الباقي، واعرض تقرير في الآخر (نجح/فشل/اتخطّى لكل ريل).
- progress bar + زرار إلغاء بين الريلز.
- بعد ما يخلص: افتح أول SEQ اتعمل (`project.openSequence`).
- مطابقة الفيديو: قارن الاسم بدون امتداد وcase-insensitive؛ لو أكتر من match أو صفر ⇒ dropdown في جدول المراجعة يختار منه المستخدم.

## 7. مراحل التنفيذ

### المرحلة 0 — Spike (إلزامي قبل أي حاجة)
اعمل plugin هيكلي وحمّله بـ UXP Developer Tool (Premiere: Settings → Plugins → Enable developer mode، ثم UDT → Add Plugin → Load). جرّب على مشروع تجريبي واكتب النتائج في `SPIKE_NOTES.md`:

1. هل set in/out + overwrite لازم transaction منفصلين ولا ينفع واحد؟ هل الـ overwrite بيحترم in/out فعلًا وبينزّل الصوت مع الفيديو؟
2. لو (1) فشل: جرّب البديل A = `createSubClipAction` ثم overwrite للـ subclip؛ البديل B = overwrite للكليب كامل ثم trim بـ `createSetInPointAction/OutPoint` + `createSetStartAction`. اختار الأبسط اللي شغال.
3. `createCloneAction` على SEQ: النسخة بتظهر فين وإزاي نمسكها (diff على `getSequences()` بالـ guid).
4. `createSetEndAction` على still/graphic/MOGRT/adjustment layer في V2+: بيمد فعلًا؟ إيه اللي بيحصل مع clip مدته محدودة؟
5. track index: zero-based ولا one-based في overwrite؟
6. SEQ فاضي من غير تمبلت: `createSequenceFromMedia` (بياخد إعدادات الكليب) ثم تفضية V1، ولا `createSequenceWithPresetPath` (وشكل الـ preset path إيه)؟
7. `getTrackItems` sync ولا Promise فعليًا. ثوابت الـ marker type (`app.Marker.MARKER_TYPE_COMMENT` ولا string).
8. ES modules ولا `require` لملفات البلاجن. اللصق من الكليبورد في `<textarea>` بيحافظ على tabs/newlines؟ RTL شغال؟
9. `fetch` بيشتغل مع permission الدومين.
10. Nest mode: هل `createOverwriteItemAction` بيقبل `sourceSeq.getProjectItem()`؟ وهل in/out بيتحددوا بـ `sequence.createSetInPointAction/OutPoint` على الـ SEQ الأصلي (ويترجّعوا بعد كده) ولا بـ trim للـ track item بعد الإضافة؟ لو مش شغال، شيل الاختيار من البانل وبلّغ المستخدم.

**لو أي نقطة كسرت افتراض في الخطة، وقّف وبلّغ المستخدم قبل ما تكمل.**

### المرحلة 1 — Parser + جدول المراجعة
`timecode.js`, `parser.js`, `validate.js` + tests بـ fixture من مثال القسم 2 (لازم يمسك `08:148`). واجهة: textarea لصق → زرار "حلّل" → جدول ريلز/مقاطع قابل للتعديل مع تعليم الأخطاء.
*Done:* tests خضرا، واللصق الحقيقي من Google Sheets بيطلع نفس المجموعات اللي في الشيت.

### المرحلة 2 — القص (F1)
`ppro/project.js` + `ppro/builder.js` من غير تمبلت. تقرير نتيجة.
*Done:* لصق شيت فيه 2 فيديو و5 ريلز ⇒ 5 SEQs صح، in/out مطابقين للتايمكود ±1 frame، الصوت موجود، الكليب الأصلي in/out بتاعه اتمسح، و Ctrl+Z بيرجّع.

### المرحلة 3 — Templates (F2 + F3)
*Done:* ريل بتمبلت فيه لوجو+بوردر+matte ⇒ اللايرز ممدودة بالظبط لآخر الريل ومكانها/إفكتاتها زي التمبلت؛ الشركة بتختار التمبلت تلقائي.

### المرحلة 4 — Markers, Handles, تسمية, Bin (F4–F6) + صفحة إعدادات

### المرحلة 5 — الفونت المدمج (F8)
`tools/merge-font/merge.py` بـ Python + fontTools (تأكد إن Python متسطب؛ لو لأ اسأل المستخدم):
- Input: مسار Palestine + مسار Impact (`C:\Windows\Fonts\impact.ttf`). Output: `PalestineImpact.ttf` باسم family جديد.
- القاعدة = Palestine (عشان جداول الـ shaping العربي GSUB/GPOS تفضل سليمة). استبدل/أضف glyphs اللاتيني (Basic Latin + Latin-1: حروف، أرقام 0-9، ترقيم لاتيني) من Impact، مع scale لو الـ unitsPerEm مختلف، ونقل الـ advance widths والـ kerning اللاتيني لو أمكن.
- الأرقام اللاتينية والترقيم المشترك من Impact؛ الأرقام العربية-الهندية والترقيم العربي من Palestine. (لو المستخدم عايز العكس: flag.)
- بارامتر `--latin-scale` و`--latin-baseline` لتظبيط الحجم/الارتفاع النسبي بين اللغتين.
- **تنبيه رخصة:** Impact فونت Microsoft والـ Palestine ليه رخصته — الملف المدمج للاستخدام الشخصي على جهاز المستخدم فقط، **ما يتوزعش وما يدخلش في أي نسخة للبيع**. اكتب ده في README الأداة.
*Done:* الفونت بيتسطب، وجملة ميكس في Premiere بتطلع عربي Palestine وإنجليزي Impact من غير اختيار يدوي، والحروف العربي متصلة صح.

### المرحلة 6 — Packaging + Update (F7)
- `version.json` + `updater.js`. Package بـ UDT (••• → Package) ⇒ `.ccx`.
- محتاج من المستخدم: GitHub repo (public أو raw link) يترفع عليه `version.json` والـ `.ccx`. لو مش عايز دلوقتي، سيب الـ URL في config وعطّل الـ check.
- `README.md` قصير بالعربي: التنصيب، عمل تمبلت `TPL_`، الاستخدام، التحديث.

## 8. قواعد للمنفّذ

- ما تلمسش أي SEQ أو كليب موجود غير بالـ in/out المؤقت اللي بيترجّع. كل الناتج في SEQs جديدة.
- كل عملية ليها undo label واضح.
- أي API مش في جدول القسم 5 ⇒ اتأكد من التوثيق أو جرّبه في الـ spike قبل ما تبني عليه. ما تخمّنش signatures.
- الاختبار الفعلي جوه Premiere لازم المستخدم يشارك فيه (تحميل البلاجن في UDT) — اطلب منه بوضوح الخطوات واللي المفروض يشوفه.
- خلّي الكود cross-platform (مسارات، مفيش افتراضات Windows) عشان Mac بعدين.
