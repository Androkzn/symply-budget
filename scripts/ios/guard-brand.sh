#!/bin/bash
# Legacy Xcode scheme BUILD pre-action guard (kept for CLI / manual checks).
#
# Brand schemes now use Debug-<brand> / Release-<brand> configurations plus
# scripts/ios/pin-scheme-brand.sh — select the scheme in Xcode; no prepare:xcode:*.
#
# Xcode resolves build settings BEFORE running pre-actions, so a pre-action cannot
# reliably re-point the xcconfig for the current build. This guard FAILS when the
# prepared Brand.generated.xcconfig does not match the expected brand (useful if
# someone still builds with legacy Debug/Release + a generated override).
#
# Deliberately conservative: it reads only grep/sed (no node, no network) and exits 0 on
# ANY ambiguity (missing files, unreadable value). A bug here can never block a build —
# it only fails on a definitively detected brand mismatch.
#
#   Usage:  "$SRCROOT/../scripts/ios/guard-brand.sh" symply-budget

EXPECTED="${1:-}"
[ -z "$EXPECTED" ] && exit 0

# $SRCROOT is the ios/ project dir when invoked from a scheme pre-action.
IOS_DIR="${SRCROOT:-$(cd "$(dirname "$0")/../../ios" && pwd)}"
GEN="$IOS_DIR/Brand.generated.xcconfig"
DEF="$IOS_DIR/Brand.xcconfig"

read_brand() { [ -f "$1" ] && grep -m1 '^SYMPLY_BRAND_ID' "$1" 2>/dev/null | sed 's/.*=[[:space:]]*//' | tr -d '[:space:]'; }

active="$(read_brand "$GEN")"
[ -z "$active" ] && active="$(read_brand "$DEF")"   # fall back to committed House default
[ -z "$active" ] && exit 0                          # couldn't determine → don't block

expected_short="${EXPECTED#symply-}"
if [ "$active" != "$expected_short" ]; then
  echo "error: This scheme builds brand '$expected_short', but the native tree is prepared for '$active'." >&2
  echo "error: Run  npm run prepare:xcode:$expected_short  then build again." >&2
  exit 1
fi
exit 0
