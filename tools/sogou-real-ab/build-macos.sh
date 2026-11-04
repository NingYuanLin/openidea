#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test "$(uname -m)" = arm64
root=tools/sogou-real-ab
out="$PWD/$root/out"
mkdir -p "$out/apps"
export OI_COMMIT="${GITHUB_SHA:-$(git rev-parse HEAD)}"
export OI_HTML_SHA="$(shasum -a 256 "$root/shared/index.html" | cut -d ' ' -f 1)"
flags=(-fobjc-arc -fblocks -O1 -arch arm64 -mmacosx-version-min=11.0 -framework Carbon -framework Cocoa -framework WebKit -DOI_COMMIT=\""$OI_COMMIT"\" -DOI_HTML_SHA=\""$OI_HTML_SHA"\")
clang "${flags[@]}" "$root/ProbeTests.m" -o "$out/native-tests"
"$out/native-tests" | tee "$out/NATIVE-TESTS.txt"
clang "${flags[@]}" "$root/Bare.m" "$root/shared/Probe.m" "$root/shared/TextObserver.m" -o "$out/sogou-real-ab"
python3 - <<'PY'
import pathlib,plistlib,shutil,os
root=pathlib.Path('tools/sogou-real-ab');out=root/'out';contents=out/'apps/Sogou Real AB v5.app/Contents'
(contents/'MacOS').mkdir(parents=True,exist_ok=True);(contents/'Resources').mkdir(exist_ok=True)
shutil.copy2(out/'sogou-real-ab',contents/'MacOS/sogou-real-ab');shutil.copy2(root/'shared/index.html',contents/'Resources/index.html')
info={'CFBundleName':'Sogou Real AB v5','CFBundleDisplayName':'Sogou Real AB v5','CFBundleIdentifier':'ai.l0ng.openidea.sogou-real-ab-v5','CFBundleExecutable':'sogou-real-ab','CFBundlePackageType':'APPL','CFBundleVersion':'5','CFBundleShortVersionString':'0.5.0','LSMinimumSystemVersion':'11.0','NSHighResolutionCapable':True,'NSPrincipalClass':'NSApplication','OICommit':os.environ['OI_COMMIT'],'OIHTMLSHA256':os.environ['OI_HTML_SHA']}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
PY
app="$out/apps/Sogou Real AB v5.app"
binary="$app/Contents/MacOS/sogou-real-ab"
test "$(lipo -archs "$binary")" = arm64
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
codesign -dvv "$app" 2>&1 | tee "$out/SIGNATURE.txt"
grep -q 'Signature=adhoc' "$out/SIGNATURE.txt"
for mode in default off on; do
 "$binary" --diagnostic-self-test -mode "$mode" > "$out/SMOKE-$mode.txt" 2>&1 & pid=$!
 ( sleep 45; kill "$pid" 2>/dev/null || true ) & guard=$!
 if wait "$pid"; then kill "$guard" 2>/dev/null || true; else cat "$out/SMOKE-$mode.txt"; exit 1; fi
 cat "$out/SMOKE-$mode.txt"
 grep -q 'PASS v5 packaged' "$out/SMOKE-$mode.txt"
done
cp "$root/使用说明.txt" "$out/apps/使用说明.txt"
hdiutil create -volname 'Sogou Real AB v5' -srcfolder "$out/apps" -ov -format UDZO "$out/Sogou-Real-AB-v5-arm64.dmg"
hdiutil verify "$out/Sogou-Real-AB-v5-arm64.dmg"
mountpoint="$out/mounted"; mkdir -p "$mountpoint"
hdiutil attach "$out/Sogou-Real-AB-v5-arm64.dmg" -readonly -nobrowse -mountpoint "$mountpoint"
trap 'hdiutil detach "$mountpoint" || true' EXIT
codesign --verify --deep --strict "$mountpoint/Sogou Real AB v5.app"
test "$(lipo -archs "$mountpoint/Sogou Real AB v5.app/Contents/MacOS/sogou-real-ab")" = arm64
hdiutil detach "$mountpoint"; trap - EXIT
(cd "$out" && shasum -a 256 *.dmg | tee SHA256SUMS.txt)
printf 'commit=%s\nhtmlSHA256=%s\nReal WKWebView, synthetic native Shift in CI, no Sogou verification. Ad-hoc signed, not notarized.\n' "$OI_COMMIT" "$OI_HTML_SHA" > "$out/BUILD.txt"
