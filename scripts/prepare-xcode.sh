#!/usr/bin/env bash
# Prepare ios/ + tokens for a local Xcode Run/Archive of one brand.
#
# The committed ios/ tree is BRAND-NEUTRAL: bundle IDs, App Group, display names and
# URL schemes all resolve from $(SYMPLY_*) variables in ios/Brand.xcconfig (the Xcode
# project-level base config). Preparing a brand therefore just writes the gitignored
# ios/Brand.generated.xcconfig (via apply-brand-ios.cjs), refreshes design tokens/icon,
# and pins the JS-bundle brand. No find/replace, no baseline drift, no split-brain.
#
# Usage:
#   ./scripts/prepare-xcode.sh symply-budget
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRAND="${1:?Usage: $0 symply-budget}"

# Keep ios/.xcode.env.local's brand in lock-step with the prepared native tree. This
# file is gitignored AND sourced after .xcode.env by RN's with-environment.sh during the
# "Bundle React Native code" phase — a stale brand here bakes the WRONG app's JS into a
# correctly branded native shell. Any pinned NODE_BINARY is preserved.
pin_local_env() {
  local brand="$1"
  local f="ios/.xcode.env.local"
  local node_line
  node_line="$(grep -E '^export NODE_BINARY=' "$f" 2>/dev/null || true)"
  if [ -z "$node_line" ] || [[ "$node_line" == *'command -v node'* ]]; then
    node_line="export NODE_BINARY=$("$ROOT/scripts/ios/resolve-node-binary.sh")"
  fi
  {
    echo "$node_line"
    echo "# Brand for local Xcode script phases — MUST match the prepared native tree."
    echo "# Managed by scripts/prepare-xcode.sh; do not hand-edit the brand below."
    echo "export APP_BRAND=$brand"
    echo "export EXPO_PUBLIC_APP_BRAND=$brand"
  } > "$f"
  echo "   pinned $f → $brand"
}

case "$BRAND" in
  symply-budget) ;;
  *)
    echo "Unsupported brand: $BRAND"
    echo "Use: symply-budget"
    exit 1
    ;;
esac

export APP_BRAND="$BRAND"
export EXPO_PUBLIC_APP_BRAND="$BRAND"

SCHEME_STAGING="SymplyBudget-Staging"
SCHEME_PROD="SymplyBudget-Production"
METRO="npm run start:budget"

echo "== Prepare Xcode for $BRAND =="

echo "-- validate brand"
node scripts/validate-brand.cjs "$BRAND"

echo "-- design tokens (RN + Widget)"
npm run design:build

echo "-- assert widget DesignTokens match $BRAND"
node scripts/validate-brand.cjs "$BRAND" --assert-generated-tokens

echo "-- brand identity (Brand.generated.xcconfig) + app icon"
node scripts/ios/apply-brand-ios.cjs

echo "-- pin JS-bundle brand (ios/.xcode.env.local) to $BRAND"
pin_local_env "$BRAND"

echo "-- CocoaPods (sync Podfile.lock ↔ Manifest.lock)"
./scripts/ios/ensure-xcode-archive-patches.sh
# Never call bare `pod`: the version on PATH may be 1.16.x, which silently
# generates a Pods project without Expo's ExpoModulesMacros plugin wiring and
# breaks the archive at compile time. scripts/ios/pod.sh enforces the floor.
(cd ios && ../scripts/ios/pod.sh install)
# Re-apply after pod install (Pods project + RN bundle script)
./scripts/ios/ensure-xcode-archive-patches.sh
./scripts/ios/fix-rn-bundle-shell-script.sh
# Quote Sentry debug-files path (spaces in project path)
python3 - <<'PY'
from pathlib import Path
p = Path("ios/SymplyEcosystem.xcodeproj/project.pbxproj")
t = p.read_text()
old = 'shellScript = "/bin/sh ../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh";'
new = 'shellScript = "/bin/sh \\"${SRCROOT}/../node_modules/@sentry/react-native/scripts/sentry-xcode-debug-files.sh\\"";'
if old in t:
    p.write_text(t.replace(old, new, 1))
    print("sentry debug-files script quoted")
else:
    print("sentry debug-files already patched or missing")
PY

# git checkout resets .xcode.env — re-apply archive-time exports
python3 - <<'PY'
from pathlib import Path
p = Path("ios/.xcode.env")
text = p.read_text() if p.exists() else ""
block = """
# App uses expo-router + @react-navigation native stacks (fleet navigators).
export EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1
# Local Archive must not fail on missing Sentry upload credentials.
export SENTRY_ALLOW_FAILURE=true
export SENTRY_DISABLE_AUTO_UPLOAD=true
"""
if "EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK" not in text:
    p.write_text(text.rstrip() + "\n" + block)
    print("restored .xcode.env archive exports")
else:
    print(".xcode.env archive exports present")
PY

BUNDLE="$(node -e "console.log(require('./brands/$BRAND/brand.cjs').iosBundleId)")"
DISPLAY="$(node -e "console.log(require('./brands/$BRAND/brand.cjs').displayName)")"

cat <<EOF

Ready for Xcode: $DISPLAY ($BRAND)
  Bundle ID: $BUNDLE   (widget: $BUNDLE.widget · watch: $BUNDLE.watchkitapp)

Next steps (two terminals):

  1) Metro (must match brand):
       $METRO

  2) Open workspace:
       open ios/SymplyEcosystem.xcworkspace

  3) Select scheme (uses Debug-/Release-<brand> configs; pre-action pins JS brand):
       Staging → "$SCHEME_STAGING"
       Production → "$SCHEME_PROD"

  4) Run on simulator/device, or Product → Archive for TestFlight.

Tip: day-to-day brand switching only needs the matching scheme (+ Metro).
prepare:xcode:* is for pods sync / CLI archives. Optional restore:
       ./scripts/prepare-xcode.sh restore

EOF
