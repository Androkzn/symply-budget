#!/usr/bin/env bash
# EAS hook: runs after `npm ci`, before the native build (gradlew/xcodebuild).
# Diagnoses + fixes hermesc losing its executable bit after npm install on
# Linux EAS builders (symptom: "A problem occurred starting process
# '.../sdks/hermesc/linux64-bin/hermesc'" during :app:createBundleReleaseJsAndAssets).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${EAS_BUILD_PLATFORM:-ios}" == "android" ]]; then
  HERMESC="node_modules/react-native/sdks/hermesc/linux64-bin/hermesc"
  echo "[eas-build-post-install] checking $HERMESC"
  if [[ -f "$HERMESC" ]]; then
    ls -la "$HERMESC"
    file "$HERMESC" || true
    chmod +x "$HERMESC"
    echo "[eas-build-post-install] after chmod:"
    ls -la "$HERMESC"
  else
    echo "[eas-build-post-install] NOT FOUND: $HERMESC"
    echo "[eas-build-post-install] contents of node_modules/react-native/sdks:"
    find node_modules/react-native/sdks -maxdepth 3 2>&1 || echo "sdks dir missing entirely"
  fi
fi

echo "[eas-build-post-install] done"
