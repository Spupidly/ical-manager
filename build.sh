#!/bin/bash
set -e

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Swift CLI 빌드 ==="
cd "$BASE_DIR/swift"
PLIST="$(pwd)/Sources/CalendarCLI/Info.plist"
swift build -c release \
    -Xlinker -sectcreate \
    -Xlinker __TEXT \
    -Xlinker __info_plist \
    -Xlinker "$PLIST"

BINARY=".build/arm64-apple-macosx/release/CalendarCLI"
ENTS="$(pwd)/entitlements.plist"
codesign --force --sign - --identifier "com.spupidly.CalendarCLI" --entitlements "$ENTS" "$BINARY"
echo "✅ Swift 빌드 완료 + 코드사인: $BINARY"

echo ""
echo "=== Node.js 의존성 설치 ==="
cd "$BASE_DIR/server"
npm install
echo "✅ npm install 완료"

echo ""
echo "빌드 완료! 서버 시작: ./start.sh"
