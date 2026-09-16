#!/usr/bin/env bash
# EAS hook: refresh design tokens before brand patchers (matches prepare-xcode order).
# Runs on every platform; iOS-native sync steps are gated so Android-only builds
# skip widget/watch verification when EAS_BUILD_PLATFORM=android.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[eas-build-pre-install] validate brand"
node scripts/validate-brand.cjs

echo "[eas-build-pre-install] design tokens (RN)"
npm run tokens:build
npm run icons:build

if [[ "${EAS_BUILD_PLATFORM:-ios}" != "android" ]]; then
  echo "[eas-build-pre-install] widget/watch token sync (iOS build)"
  npm run sync:widget-theme
  npm run sync:watch-icons
  echo "[eas-build-pre-install] assert widget DesignTokens match APP_BRAND"
  node scripts/validate-brand.cjs --assert-generated-tokens
else
  echo "[eas-build-pre-install] skipping widget/watch sync (android build)"
fi

echo "[eas-build-pre-install] brand patchers"
if [[ "${EAS_BUILD_PLATFORM:-ios}" != "android" ]]; then
  node scripts/ios/apply-brand-ios.cjs
fi
node scripts/android/apply-brand-android.cjs

echo "[eas-build-pre-install] done"
