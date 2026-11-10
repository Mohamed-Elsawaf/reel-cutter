"""Merge an Arabic font and a Latin font into one font file.

The Arabic font is the base (its GSUB/GPOS shaping stays intact). Latin glyphs
(Basic Latin + Latin-1, digits and shared punctuation) are copied from the Latin
font, scaled to the base font's units-per-em, and the cmap is pointed at them.
Latin kerning from the Latin font's 'kern' table is added as a new GPOS lookup.

Defaults: Arabic = Palestine (from Downloads), Latin = Impact (Windows).
Personal use only - see README.md (font licences).

CLI:
  python merge.py [--arabic PATH] [--latin PATH] [--name NAME] [--latin-scale 100]
                  [--latin-baseline 0] [--shared-from-arabic] [--out DIR] [--install]
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from pathlib import Path

from fontTools.ttLib import TTFont, newTable
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.otlLib import builder as otl
from fontTools.ttLib.tables import otTables as ot

HOME = Path.home()
DEFAULT_ARABIC = HOME / "Downloads" / "alfont_com_Palestine-Regular.ttf"
DEFAULT_LATIN = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "impact.ttf"
DEFAULT_OUT = Path(__file__).resolve().parent / "output"

# Code points taken from the Latin font.
LATIN_LETTERS = [c for c in range(0x41, 0x5B)] + [c for c in range(0x61, 0x7B)] + \
    [c for c in range(0xC0, 0x100) if c not in (0xD7, 0xF7)]
DIGITS = list(range(0x30, 0x3A))
SHARED_PUNCT = [c for c in range(0x21, 0x7F) if c not in LATIN_LETTERS and c not in DIGITS] + \
    [c for c in range(0xA1, 0xC0)] + [0xD7, 0xF7] + \
    [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC]
# Never replaced: spaces stay with the Arabic font so Arabic word spacing doesn't change.
KEEP_FROM_ARABIC = {0x20, 0xA0}


def font_family(font: TTFont) -> str:
    name = font["name"].getDebugName(16) or font["name"].getDebugName(1) or "Font"
    return name


def default_name(arabic: TTFont, latin: TTFont) -> str:
    def clean(s): return re.sub(r"[^A-Za-z0-9]", "", s) or "Font"
    return clean(font_family(arabic)) + clean(font_family(latin))


def wanted_codepoints(shared_from_arabic: bool) -> list[int]:
    cps = list(LATIN_LETTERS)
    if not shared_from_arabic:
        cps += DIGITS + SHARED_PUNCT
    return [c for c in cps if c not in KEEP_FROM_ARABIC]


def copy_glyph(src: TTFont, src_name: str, scale: float, dy: float):
    """Return (TTGlyph, advance) of src_name decomposed, scaled and shifted."""
    gs = src.getGlyphSet()
    rec = DecomposingRecordingPen(gs)
    gs[src_name].draw(rec)
    pen = TTGlyphPen(None)
    rec.replay(TransformPen(pen, (scale, 0, 0, scale, 0, dy)))
    glyph = pen.glyph()
    adv = round(src["hmtx"][src_name][0] * scale)
    return glyph, adv


def latin_kern_pairs(src: TTFont, names: set[str]) -> dict[tuple[str, str], int]:
    pairs = {}
    if "kern" in src:
        for sub in src["kern"].kernTables:
            if getattr(sub, "format", 0) != 0:
                continue
            for (l, r), v in sub.kernTable.items():
                if l in names and r in names and v:
                    pairs[(l, r)] = v
    return pairs


def add_kerning(font: TTFont, pairs: dict[tuple[str, str], int]) -> int:
    """Add one PairPos lookup for the Latin pairs, hooked to 'kern' in latn + DFLT."""
    if not pairs or "GPOS" not in font:
        return 0
    gpos = font["GPOS"].table
    pp = {(l, r): (otl.buildValue({"XAdvance": v}), None) for (l, r), v in pairs.items()}
    sub = otl.buildPairPosGlyphsSubtable(pp, font.getReverseGlyphMap())
    lookup = otl.buildLookup([sub])
    gpos.LookupList.Lookup.append(lookup)
    gpos.LookupList.LookupCount = len(gpos.LookupList.Lookup)
    li = len(gpos.LookupList.Lookup) - 1

    fr = ot.FeatureRecord()
    fr.FeatureTag = "kern"
    fr.Feature = ot.Feature()
    fr.Feature.FeatureParams = None
    fr.Feature.LookupListIndex = [li]
    fr.Feature.LookupCount = 1
    gpos.FeatureList.FeatureRecord.append(fr)
    gpos.FeatureList.FeatureCount = len(gpos.FeatureList.FeatureRecord)
    fi = len(gpos.FeatureList.FeatureRecord) - 1

    # Latin runs are shaped with script 'latn'; fall back to DFLT for engines that use it.
    scripts = {s.ScriptTag: s for s in gpos.ScriptList.ScriptRecord}
    if "latn" not in scripts:
        sr = ot.ScriptRecord()
        sr.ScriptTag = "latn"
        sr.Script = ot.Script()
        sr.Script.DefaultLangSys = ot.LangSys()
        sr.Script.DefaultLangSys.LookupOrder = None
        sr.Script.DefaultLangSys.ReqFeatureIndex = 0xFFFF
        sr.Script.DefaultLangSys.FeatureIndex = [fi]
        sr.Script.DefaultLangSys.FeatureCount = 1
        sr.Script.LangSysRecord = []
        sr.Script.LangSysCount = 0
        gpos.ScriptList.ScriptRecord.append(sr)
        gpos.ScriptList.ScriptRecord.sort(key=lambda s: s.ScriptTag)
        gpos.ScriptList.ScriptCount = len(gpos.ScriptList.ScriptRecord)
    if "DFLT" in scripts and scripts["DFLT"].Script.DefaultLangSys is not None:
        ls = scripts["DFLT"].Script.DefaultLangSys
        ls.FeatureIndex = list(ls.FeatureIndex) + [fi]
        ls.FeatureCount = len(ls.FeatureIndex)
    # GSUB also needs a 'latn' script entry or some engines skip the font's GSUB for Latin runs (harmless if absent).
    return len(pairs)


def set_names(font: TTFont, family: str, version_note: str):
    name = font["name"]
    ps = re.sub(r"[^A-Za-z0-9-]", "", family) + "-Regular"
    for nid in (1, 2, 3, 4, 6, 16, 17, 21, 22):
        name.removeNames(nameID=nid)
    values = {1: family, 2: "Regular", 3: f"{family} Regular; {version_note}", 4: f"{family} Regular", 6: ps}
    for nid, val in values.items():
        name.setName(val, nid, 3, 1, 0x409)
        name.setName(val, nid, 1, 0, 0)
    return ps


def merge(arabic_path: Path, latin_path: Path, family: str | None = None, latin_scale: float = 100.0,
          latin_baseline: float = 0.0, shared_from_arabic: bool = False, out_dir: Path = DEFAULT_OUT,
          log=print) -> Path:
    base = TTFont(str(arabic_path))
    lat = TTFont(str(latin_path))
    if "glyf" not in base or "glyf" not in lat:
        raise ValueError("الخطين لازم يكونوا TrueType (.ttf). ملفات .otf (CFF) مش مدعومة لسه.")
    family = family or default_name(base, lat)
    upem = base["head"].unitsPerEm
    scale = upem / lat["head"].unitsPerEm * (latin_scale / 100.0)
    dy = upem * latin_baseline / 100.0

    lat_cmap = lat.getBestCmap()
    order = list(base.getGlyphOrder())
    existing = set(order)
    new_map = {}       # codepoint -> new glyph name
    src_to_new = {}    # latin glyph name -> new glyph name
    glyf, hmtx = base["glyf"], base["hmtx"]
    for cp in wanted_codepoints(shared_from_arabic):
        src_name = lat_cmap.get(cp)
        if not src_name:
            continue
        new_name = src_to_new.get(src_name)
        if not new_name:
            new_name = "lat." + src_name
            i = 1
            while new_name in existing:
                new_name = f"lat.{src_name}.{i}"; i += 1
            glyph, adv = copy_glyph(lat, src_name, scale, dy)
            order.append(new_name); existing.add(new_name)
            base.setGlyphOrder(order)
            glyf[new_name] = glyph
            glyph.recalcBounds(glyf)
            hmtx[new_name] = (adv, getattr(glyph, "xMin", 0) if glyph.numberOfContours else 0)
            src_to_new[src_name] = new_name
        new_map[cp] = new_name
    base.setGlyphOrder(order)

    for table in base["cmap"].tables:
        if table.isUnicode():
            for cp, gn in new_map.items():
                if table.format == 4 and cp > 0xFFFF:
                    continue
                table.cmap[cp] = gn

    # Kerning between the copied Latin glyphs.
    pairs = latin_kern_pairs(lat, set(src_to_new))
    kerned = add_kerning(base, {(src_to_new[l], src_to_new[r]): round(v * scale) for (l, r), v in pairs.items()})

    # Vertical metrics: make sure nothing gets clipped.
    ymax = max([glyf[g].yMax for g in src_to_new.values() if glyf[g].numberOfContours] + [0])
    ymin = min([glyf[g].yMin for g in src_to_new.values() if glyf[g].numberOfContours] + [0])
    os2, hhea = base["OS/2"], base["hhea"]
    os2.usWinAscent = max(os2.usWinAscent, ymax)
    os2.usWinDescent = max(os2.usWinDescent, -ymin)
    hhea.ascent = max(hhea.ascent, ymax)
    hhea.descent = min(hhea.descent, ymin)
    # Tell Windows the font covers Latin too (Basic Latin, Latin-1; code pages 1252 + 1256).
    os2.ulUnicodeRange1 |= (1 << 0) | (1 << 1)
    if os2.version >= 1:
        os2.ulCodePageRange1 |= (1 << 0) | (1 << 6)

    for t in ("DSIG", "hdmx", "LTSH", "VDMX"):
        if t in base:
            del base[t]
    ps = set_names(base, family, f"merged {Path(arabic_path).name} + {Path(latin_path).name}")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{ps}.ttf"
    if out.exists():
        try:
            out.unlink()
        except PermissionError:  # installed/in use: write a new file name
            n = 2
            while (out_dir / f"{ps}_{n}.ttf").exists():
                n += 1
            out = out_dir / f"{ps}_{n}.ttf"
    base.save(str(out))
    log(f"اتعمل: {out}")
    log(f"  اسم الخط في البرامج: {family}")
    log(f"  حروف لاتيني اتنقلت: {len(new_map)} (scale {latin_scale:g}%, baseline {latin_baseline:g}%)")
    log(f"  kerning لاتيني: {kerned} زوج")
    return out


def install_for_user(path: Path, family: str, log=print) -> Path:
    """Install a TTF for the current Windows user only (no admin). Premiere must be restarted to see it."""
    if sys.platform != "win32":
        raise OSError("التسطيب التلقائي على ويندوز بس")
    import winreg
    fonts_dir = Path(os.environ["LOCALAPPDATA"]) / "Microsoft" / "Windows" / "Fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    dest = fonts_dir / path.name
    shutil.copyfile(path, dest)
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Fonts", 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, f"{family} (TrueType)", 0, winreg.REG_SZ, str(dest))
    try:  # tell running apps the font list changed
        import ctypes
        ctypes.windll.gdi32.AddFontResourceW(str(dest))
        ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x001D, 0, 0, 0x0002, 1000, None)
    except Exception:
        pass
    log(f"اتسطّب لليوزر الحالي: {dest}")
    return dest


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ap =argparse.ArgumentParser(description="Merge an Arabic font with a Latin font (personal use).")
    ap.add_argument("--arabic", type=Path, default=DEFAULT_ARABIC)
    ap.add_argument("--latin", type=Path, default=DEFAULT_LATIN)
    ap.add_argument("--name", default=None, help="family name of the result (default: ArabicLatin, e.g. PalestineImpact)")
    ap.add_argument("--latin-scale", type=float, default=100.0, help="Latin size in percent (default 100)")
    ap.add_argument("--latin-baseline", type=float, default=0.0, help="move Latin up (+) or down (-), percent of em")
    ap.add_argument("--shared-from-arabic", action="store_true", help="keep digits 0-9 and punctuation from the Arabic font")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--install", action="store_true", help="install for the current Windows user")
    a = ap.parse_args(argv)
    out = merge(a.arabic, a.latin, a.name, a.latin_scale, a.latin_baseline, a.shared_from_arabic, a.out)
    if a.install:
        install_for_user(out, TTFont(str(out))["name"].getDebugName(1))


if __name__ == "__main__":
    main()
