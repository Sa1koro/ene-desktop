#!/bin/sh
# One-click start on macOS / Linux: sh start.sh [browser|build]. See scripts/launch.mjs.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "[ENE] 没有找到 Node.js，请先安装 Node.js 22 LTS：https://nodejs.org/"
  exit 1
fi
exec node scripts/launch.mjs "$@"
