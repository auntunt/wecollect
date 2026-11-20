#!/bin/bash
# Run on macOS with Go and the Xcode command line tools installed.
set -euo pipefail
cd "$(dirname "$0")/.."
out_dir="${1:-dist}"
mkdir -p "$out_dir"
stage="$(mktemp -d /private/tmp/wecollect-build.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
bundle="$stage/WeCollect.app"
mkdir -p "$bundle/Contents/MacOS"
cp packaging/Info.plist "$bundle/Contents/Info.plist"
export CGO_ENABLED=0
for arch in amd64 arm64; do
  GOOS=darwin GOARCH="$arch" go build -buildvcs=false -trimpath -ldflags='-s -w' -o "$stage/$arch" ./cmd/wecollect
done
lipo -create "$stage/amd64" "$stage/arm64" -output "$bundle/Contents/MacOS/WeCollect"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"
ditto --norsrc -c -k --keepParent "$bundle" "$stage/WeCollect-macOS.zip"
GOOS=windows GOARCH=amd64 go build -buildvcs=false -trimpath -ldflags='-s -w -H windowsgui' -o "$stage/WeCollect-Windows-x64.exe" ./cmd/wecollect
(cd "$stage" && shasum -a 256 WeCollect-macOS.zip WeCollect-Windows-x64.exe > SHA256SUMS)
cp "$stage/WeCollect-macOS.zip" "$stage/WeCollect-Windows-x64.exe" "$stage/SHA256SUMS" "$out_dir/"
