#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test "$(uname -m)" = arm64
out="$PWD/tools/wk-shift-controlled/out"
app="$out/Controlled WK Shift.app"
mkdir -p "$app/Contents/MacOS" "$out/results"
clang -fobjc-arc -fblocks -O0 -g -arch arm64 -framework Cocoa -framework WebKit \
  -DEXPERIMENT_COMMIT=\""${GITHUB_SHA:-$(git rev-parse HEAD)}"\" \
  tools/wk-shift-controlled/Experiment.m -o "$app/Contents/MacOS/experiment"
python3 - "$app" <<'PY'
import pathlib,plistlib,sys
p=pathlib.Path(sys.argv[1])/'Contents/Info.plist'
p.write_bytes(plistlib.dumps(dict(CFBundleIdentifier='ai.l0ng.openidea.controlled-wk-shift',CFBundleExecutable='experiment',CFBundleName='Controlled WK Shift',CFBundlePackageType='APPL',CFBundleVersion='1',NSPrincipalClass='NSApplication',NSHighResolutionCapable=True)))
PY
test "$(lipo -archs "$app/Contents/MacOS/experiment")" = arm64
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
python3 tools/wk-shift-controlled/run.py "$app/Contents/MacOS/experiment" "$out/results"
