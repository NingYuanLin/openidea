#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test "$(uname -m)" = arm64
out="$PWD/tools/native-input/out"
mkdir -p "$out/apps"
export OI_COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD)}"
export OI_HTML_SHA="$(shasum -a 256 tools/native-input/shared/index.html | cut -d ' ' -f 1)"
flags=(-fobjc-arc -fblocks -O1 -arch arm64 -mmacosx-version-min=11.0 -framework Carbon -framework Cocoa -framework WebKit -DOI_COMMIT=\""$OI_COMMIT"\" -DOI_HTML_SHA=\""$OI_HTML_SHA"\")
clang "${flags[@]}" tools/native-input/ProbeTests.m -o "$out/native-tests"
"$out/native-tests" | tee "$out/NATIVE-TESTS.txt"
clang "${flags[@]}" tools/native-input/Bare.m tools/native-input/shared/Probe.m -o "$out/shift-native-appkit"
cargo build --locked --release --target aarch64-apple-darwin --manifest-path tools/native-input/tauri/Cargo.toml
python3 - <<'PY'
import pathlib,tomllib
lock=tomllib.loads(pathlib.Path('tools/native-input/tauri/Cargo.lock').read_text())
for name,version in [('tauri','2.12.4'),('tauri-runtime-wry','2.12.2'),('wry','0.57.0'),('tao','0.37.1')]:
 values=[p['version'] for p in lock['package'] if p['name']==name]
 assert values==[version], (name,values)
 print('Verified dependency',name,version)
PY
python3 - <<'PY'
import pathlib,plistlib,shutil,os
root=pathlib.Path('tools/native-input');out=root/'out'
for host,display,binary in [('appkit','Shift Native AppKit v4',out/'shift-native-appkit'),('tauri','Shift Native Tauri v4',root/'tauri/target/aarch64-apple-darwin/release/shift-native-tauri')]:
 app=out/'apps'/(display+'.app');contents=app/'Contents'
 (contents/'MacOS').mkdir(parents=True,exist_ok=True);(contents/'Resources').mkdir(exist_ok=True)
 shutil.copy2(binary,contents/'MacOS'/('shift-native-'+host));shutil.copy2(root/'shared/index.html',contents/'Resources/index.html')
 info={'CFBundleName':display,'CFBundleDisplayName':display,'CFBundleIdentifier':'ai.l0ng.openidea.shift-native.'+host+'-v4','CFBundleExecutable':'shift-native-'+host,'CFBundlePackageType':'APPL','CFBundleVersion':'4','CFBundleShortVersionString':'0.4.0','LSMinimumSystemVersion':'11.0','NSHighResolutionCapable':True,'NSPrincipalClass':'NSApplication','OICommit':os.environ['OI_COMMIT'],'OIHTMLSHA256':os.environ['OI_HTML_SHA']}
 (contents/'Info.plist').write_bytes(plistlib.dumps(info))
PY
for host in appkit tauri; do
  if [ "$host" = appkit ]; then app="$out/apps/Shift Native AppKit v4.app"; else app="$out/apps/Shift Native Tauri v4.app"; fi
  binary="$app/Contents/MacOS/shift-native-$host"
  test "$(lipo -archs "$binary")" = arm64
  codesign --force --deep --sign - "$app"
  codesign --verify --deep --strict "$app"
  codesign -dvv "$app" 2>&1 | tee "$out/SIGNATURE-$host.txt"
  grep -q 'Signature=adhoc' "$out/SIGNATURE-$host.txt"
  "$binary" --diagnostic-self-test > "$out/SMOKE-$host.txt" 2>&1 &
  pid=$!
  # The app has a 25-second internal failure timeout; external guard handles startup failure.
  ( sleep 45; kill "$pid" 2>/dev/null || true ) & guard=$!
  if wait "$pid"; then kill "$guard" 2>/dev/null || true; else cat "$out/SMOKE-$host.txt"; exit 1; fi
  cat "$out/SMOKE-$host.txt"
  grep -q 'PASS v4 packaged' "$out/SMOKE-$host.txt"
done
cmp "$out/apps/Shift Native AppKit v4.app/Contents/Resources/index.html" "$out/apps/Shift Native Tauri v4.app/Contents/Resources/index.html"
cp tools/native-input/使用说明.txt "$out/apps/使用说明.txt"
hdiutil create -volname 'Shift Native Comparison v4' -srcfolder "$out/apps" -ov -format UDZO "$out/Shift-Native-Comparison-v4-arm64.dmg"
hdiutil verify "$out/Shift-Native-Comparison-v4-arm64.dmg"
mountpoint="$out/mounted"
mkdir -p "$mountpoint"
hdiutil attach "$out/Shift-Native-Comparison-v4-arm64.dmg" -readonly -nobrowse -mountpoint "$mountpoint"
trap 'hdiutil detach "$mountpoint" || true' EXIT
for app in "$mountpoint"/*.app; do
 codesign --verify --deep --strict "$app"
 for binary in "$app/Contents/MacOS/"*; do test "$(lipo -archs "$binary")" = arm64; done
done
hdiutil detach "$mountpoint"
trap - EXIT
(cd "$out" && shasum -a 256 *.dmg | tee SHA256SUMS.txt)
printf 'commit=%s\nhtmlSHA256=%s\nAd-hoc signed; not notarized. Synthetic tests only, no native Sogou verification.\n' "$OI_COMMIT" "$OI_HTML_SHA" > "$out/BUILD.txt"
