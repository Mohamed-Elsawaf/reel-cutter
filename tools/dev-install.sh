#!/usr/bin/env bash
# Dev helper: package plugin/ as a .ccx and (re)install it with Adobe's UnifiedPluginInstallerAgent.
# Used because UXP Developer Tools renders a blank window on this machine. Restart Premiere afterwards.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPIA="/c/Program Files/Common Files/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.exe"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/reelcutter-dev.ccx"
rm -f "$OUT"
( cd "$ROOT/plugin" && python -I -c "
import zipfile,os,sys
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
for root,dirs,files in os.walk('.'):
    for f in files:
        p=os.path.join(root,f); z.write(p,os.path.relpath(p,'.').replace(os.sep,'/'))
z.close()" "$OUT" )
"$UPIA" //remove "Reel Cutter" 2>&1 | tail -1 || true
"$UPIA" //install "$(cygpath -w "$OUT")" 2>&1 | tail -1
ls "$APPDATA/Adobe/UXP/Plugins/External/" | grep reelcutter
