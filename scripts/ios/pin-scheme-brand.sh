#!/bin/bash
# Xcode scheme BUILD pre-action: pin JS-bundle brand + widget tokens for the
# scheme's brand. Native identity (bundle ID / icon / display name) comes from
# the scheme's Debug-<brand> / Release-<brand> build configuration — those are
# resolved before pre-actions, so this script must NOT be the source of SYMPLY_*.
#
#   Usage (from a scheme pre-action):  "$SRCROOT/../scripts/ios/pin-scheme-brand.sh" symply-kaizen
#
# Fast path: no pod install, no full prepare-xcode.sh.
set -euo pipefail

BRAND="${1:-}"
if [ -z "$BRAND" ]; then
  echo "error: pin-scheme-brand.sh requires a brand id (e.g. symply-kaizen)" >&2
  exit 1
fi

# $SRCROOT is the ios/ project dir when invoked from a scheme pre-action.
IOS_DIR="${SRCROOT:-$(cd "$(dirname "$0")/../../ios" && pwd)}"
ROOT="$(cd "$IOS_DIR/.." && pwd)"
cd "$ROOT"

# Preserve any pinned NODE_BINARY; rewrite brand exports so the RN "Bundle React
# Native code" phase (via with-environment.sh → .xcode.env.local) matches the scheme.
LOCAL_ENV="$IOS_DIR/.xcode.env.local"
NODE_LINE="$(grep -E '^export NODE_BINARY=' "$LOCAL_ENV" 2>/dev/null || true)"
if [ -z "$NODE_LINE" ] || [[ "$NODE_LINE" == *'command -v node'* ]]; then
  NODE_LINE="export NODE_BINARY=$("$ROOT/scripts/ios/resolve-node-binary.sh")"
fi
{
  echo "$NODE_LINE"
  echo "# Brand for local Xcode script phases — managed by pin-scheme-brand.sh."
  echo "export APP_BRAND=$BRAND"
  echo "export EXPO_PUBLIC_APP_BRAND=$BRAND"
  # Budget V2: keep local-first on for Debug/Release device + archive bundles.
  if [ "$BRAND" = "symply-budget" ]; then
    echo "export EXPO_PUBLIC_BUDGET_LOCAL_FIRST=1"
  fi
} > "$LOCAL_ENV"

export APP_BRAND="$BRAND"
export EXPO_PUBLIC_APP_BRAND="$BRAND"
if [ "$BRAND" = "symply-budget" ]; then
  export EXPO_PUBLIC_BUDGET_LOCAL_FIRST=1
fi

# Widget/Watch colors + appKey live in DesignTokens.generated.swift (compiled this
# build). Regenerating here is safe because source files are read after pre-actions.
if [ -f "$ROOT/scripts/build-tokens.mjs" ]; then
  node "$ROOT/scripts/build-tokens.mjs"
fi
if [ -f "$ROOT/scripts/sync-widget-theme.cjs" ]; then
  node "$ROOT/scripts/sync-widget-theme.cjs" || true
fi

echo "note: pinned scheme brand → $BRAND (JS bundle + widget tokens)"
exit 0
