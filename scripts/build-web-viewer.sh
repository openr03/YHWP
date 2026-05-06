#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────
# YHWP 웹 뷰어 빌드 스크립트
#
# studio-host 를 static web app 으로 빌드해서 site-youngsam/view/
# 아래로 복사한다. nginx 가 hwp.youngsam.net/view/ 로 서빙.
#
# 사용:
#   bash scripts/build-web-viewer.sh
# ────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/apps/studio-host"
DIST="$SRC/dist"
TARGET="$ROOT/site-youngsam/view"

echo ">>> 웹 뷰어 빌드 (base: /view/)"
cd "$ROOT"
HOP_WEB_BASE=/view/ pnpm --filter @golbin/hop-studio-host build

if [ ! -d "$DIST" ]; then
  echo "[ERROR] dist 없음: $DIST"
  exit 1
fi

echo ">>> 기존 site-youngsam/view/ 비우기 (assets 만 갈아끼움)"
rm -rf "$TARGET"
mkdir -p "$TARGET"

echo ">>> dist → site-youngsam/view/ 복사"
cp -a "$DIST/." "$TARGET/"

echo
echo "✓ 완료"
echo "  로컬 확인: file://$TARGET/index.html (일부 기능 제한 — nginx 권장)"
echo "  배포 URL: https://hwp.youngsam.net/view/"
echo
