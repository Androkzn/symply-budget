#!/usr/bin/env bash
# Regenerate design tokens + icon require-map for one brand, then start Metro.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRAND="${1:-symply-budget}"
if [[ "$BRAND" != "symply-budget" ]]; then
  echo "only symply-budget is available in this standalone project" >&2
  exit 1
fi
shift

export APP_BRAND="$BRAND"
export EXPO_PUBLIC_APP_BRAND="$BRAND"

echo "[start-brand] tokens + icons for $BRAND"
npm run tokens:build
npm run icons:build

exec env APP_BRAND="$BRAND" EXPO_PUBLIC_APP_BRAND="$BRAND" \
  EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
  npx @expo/cli start "$@"
