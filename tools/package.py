"""Build the installable plugin: dist/ReelCutter-<version>/ with the .ccx, an installer .bat and version.json.

Usage:  python tools/package.py [--url-base https://github.com/<user>/<repo>/releases/download] [--notes "..."]
The version comes from plugin/manifest.json. The spike/ folder (phase-0 experiments) is left out.
"""
import argparse
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugin"
EXCLUDE_DIRS = {"spike"}

INSTALL_BAT = r"""@echo off
chcp 65001 >nul
echo Installing Reel Cutter {version} ...
set "UPIA=%CommonProgramFiles%\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe"
if not exist "%UPIA%" (
  echo Creative Cloud installer not found. Double-click the .ccx file instead.
  pause
  exit /b 1
)
"%UPIA%" /install "%~dp0ReelCutter-{version}.ccx"
echo.
echo Done. Restart Premiere Pro, then open: Window ^> UXP Plugins ^> Reel Cutter
pause
"""


def build(url_base: str, notes: str) -> Path:
    manifest = json.loads((PLUGIN / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    out_dir = ROOT / "dist" / f"ReelCutter-{version}"
    out_dir.mkdir(parents=True, exist_ok=True)
    ccx = out_dir / f"ReelCutter-{version}.ccx"
    with zipfile.ZipFile(ccx, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(PLUGIN.rglob("*")):
            rel = p.relative_to(PLUGIN)
            if p.is_dir() or rel.parts[0] in EXCLUDE_DIRS:
                continue
            z.write(p, rel.as_posix())
    (out_dir / "README.md").write_text((ROOT / "README.md").read_text(encoding="utf-8"), encoding="utf-8")
    (out_dir / "install-windows.bat").write_text(INSTALL_BAT.format(version=version), encoding="utf-8")
    url = f"{url_base.rstrip('/')}/v{version}/{ccx.name}" if url_base else ""
    vjson = {"version": version, "url": url, "notes": notes}
    (ROOT / "version.json").write_text(json.dumps(vjson, ensure_ascii=False, indent=2), encoding="utf-8")
    bundle = out_dir.parent / (out_dir.name + ".zip")
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(out_dir.iterdir()):
            z.write(p, f"{out_dir.name}/{p.name}")
    print(f"bundle {bundle}")
    names = zipfile.ZipFile(ccx).namelist()
    print(f"built {ccx} ({ccx.stat().st_size // 1024} KB, {len(names)} files)")
    print("files:", ", ".join(names))
    return ccx


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url-base", default="")
    ap.add_argument("--notes", default="")
    a = ap.parse_args()
    build(a.url_base, a.notes)
