#!/bin/bash
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$BASE_DIR/swift/.build/release/CalendarCLI"

if [ ! -f "$CLI" ]; then
  echo "❌ Swift CLI 바이너리가 없습니다. 먼저 ./build.sh 를 실행하세요."
  exit 1
fi

echo "🚀 서버 시작: http://localhost:3000"
cd "$BASE_DIR/server"
node server.js
