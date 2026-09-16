#!/usr/bin/env bash
# Prepare + Archive (+ optional export) one Symply brand for TestFlight.
# Usage:
#   ./scripts/archive-brand.sh symply-house|symply-budget|symply-kaizen|symply-language|symply-health [staging|production]
# Env:
#   SKIP_EXPORT=1   — archive only (default: also export IPA)
#   SKIP_PREPARE=1  — skip prepare-xcode (Pods already ready; still pins build number)
#   UPLOAD_TF=1     — after export, upload IPA via xcrun altool (needs Apple ID auth)
#
# IMPORTANT: Expo/RN archive scripts break on spaces in the path. Prefer running via
#   /Users/…/Desktop/symply-ecosystem  (symlink without spaces) if available.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer no-space symlink when the real path contains whitespace.
# Important: do NOT resolve with pwd -P — stay on the symlink path so SRCROOT
# has no spaces (Expo/RN archive scripts + XCBuildData SQLite break otherwise).
# Preferred link lives in $HOME, NOT on the Desktop.
#
# The Desktop copy kept being deleted — three times, once MID-ARCHIVE, which
# cost a 16-minute build: the Pods xcconfigs are rewritten to point at this
# path, so losing it turns into
#   "external macro implementation type 'ExpoModulesMacros...' could not be
#    found", a failure that looks nothing like its cause.
# ~/.symply-ecosystem is hidden and outside the Desktop, so tidying sweeps and
# cleanup tools do not find it. The Desktop path is still accepted so existing
# muscle memory and older docs keep working.
SYMLINK_HOME="$HOME/.symply-ecosystem"
if [[ "$ROOT" == *" "* ]]; then
  # Use the hidden link if it is already good. Do NOT fall back to a Desktop
  # link merely because one exists — that is the fragile path this moved away
  # from, and preferring it would keep every future archive exposed. When the
  # hidden link is absent the block below creates it.
  if [[ -L "$SYMLINK_HOME" && -d "$SYMLINK_HOME/ios" ]]; then
    ROOT="$SYMLINK_HOME"
  fi
fi
# Still spaces? The symlink is missing — recreate it rather than failing.
#
# This link gets deleted routinely (cleanup sweeps, Desktop tidying), and every
# time it did, a ~15-minute archive refused to start until someone ran one
# `ln -sfn` by hand. Nothing about the link is precious: it is a pure alias for
# THIS checkout, so making it on demand is strictly better than instructing a
# human to make the identical one. Only an existing NON-symlink is left alone,
# because that would be somebody's real directory.
if [[ "$ROOT" == *" "* ]]; then
  LINK="$SYMLINK_HOME"
  if [[ -e "$LINK" && ! -L "$LINK" ]]; then
    # A real directory here is almost always debris from an archive that lost
    # its symlink mid-run: xcodebuild keeps writing to -resultBundlePath and
    # recreates the chain as real dirs. That shape — nothing but ios/build
    # inside — is safe to clear. Anything else is somebody's real data: stop.
    leftovers="$(find "$LINK" -mindepth 1 -maxdepth 1 ! -name ios 2>/dev/null | head -1)"
    if [[ -z "$leftovers" && -d "$LINK/ios/build" ]]; then
      echo "== Clearing stale archive debris at $LINK (build output only) =="
      rm -rf "${LINK:?}"
    else
      echo "ERROR: $LINK exists and is a real directory holding more than build output."
      echo "       Move it aside; the archive needs that name for a space-free path."
      exit 1
    fi
  fi
  ln -sfn "$ROOT" "$LINK"
  echo "== Created no-space symlink: $LINK -> $ROOT =="
  if [[ -d "$LINK/ios" ]]; then
    ROOT="$LINK"
  else
    echo "ERROR: $LINK does not resolve to a checkout (no ios/)."
    exit 1
  fi
fi
cd "$ROOT" || exit 1
# Guard against a real directory that replaced the symlink.
if [[ "$(pwd -P)" == *" "* ]] && [[ ! -L "$ROOT" ]]; then
  echo "ERROR: $ROOT is not a symlink to the repo (spaces in physical path)."
  exit 1
fi

BRAND="${1:?brand required: symply-house|symply-budget|symply-kaizen|symply-language|symply-health}"
API_ENV="${2:-production}"
case "$BRAND" in
  symply-house|symply-budget|symply-kaizen|symply-language|symply-health) ;;
  *) echo "bad brand"; exit 1 ;;
esac
case "$API_ENV" in
  staging|production) ;;
  *) echo "bad env"; exit 1 ;;
esac

case "$BRAND" in
  symply-house)
    SHORT=house; DISPLAY="SymplyHouse"
    if [[ "$API_ENV" == staging ]]; then SCHEME="SymplyHouse-Staging"; else SCHEME="SymplyHouse-Production"; fi
    ;;
  symply-budget)
    SHORT=budget; DISPLAY="SymplyBudget"
    if [[ "$API_ENV" == staging ]]; then SCHEME="SymplyBudget-Staging"; else SCHEME="SymplyBudget-Production"; fi
    ;;
  symply-kaizen)
    SHORT=kaizen; DISPLAY="SymplyKaizen"
    if [[ "$API_ENV" == staging ]]; then SCHEME="SymplyKaizen-Staging"; else SCHEME="SymplyKaizen-Production"; fi
    ;;
  symply-language)
    SHORT=language; DISPLAY="SymplyLanguage"
    if [[ "$API_ENV" == staging ]]; then SCHEME="SymplyLanguage-Staging"; else SCHEME="SymplyLanguage-Production"; fi
    ;;
  symply-health)
    SHORT=health; DISPLAY="SymplyHealth"
    if [[ "$API_ENV" == staging ]]; then SCHEME="SymplyHealth-Staging"; else SCHEME="SymplyHealth-Production"; fi
    ;;
esac
# Match scheme ArchiveAction (Release-<brand>). Do NOT force plain Release —
# that resolves House bundle IDs for every brand.
CONFIGURATION="Release-${SHORT}"
# Keep DerivedData off paths with spaces (SQLite build.db disk I/O failures).
# Per-brand path so a second archive cannot corrupt another's Swift PCM cache
# (shared DerivedData + overlapping xcodebuild caused "malformed precompiled file").
DERIVED_DATA="$ROOT/ios/build/DerivedData-${SHORT}"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/ios/build/archives/$BRAND-$API_ENV-$STAMP"
mkdir -p "$OUT"
ARCHIVE_PATH="$OUT/$DISPLAY.xcarchive"
EXPORT_DIR="$OUT/export"
LOG="$OUT/archive.log"

if [[ "${SKIP_PREPARE:-0}" == "1" ]]; then
  echo "== Skipping prepare (SKIP_PREPARE=1) =="
else
  echo "== Preparing $BRAND =="
  ./scripts/prepare-xcode.sh "$BRAND"
fi
# CocoaPods bakes the real (space-containing) path into Expo macro plugin
# flags. Swift's -load-plugin-executable flakes on spaces even when quoted —
# rewrite to the no-space symlink path used for archives.
MACRO_LINK="$ROOT/node_modules/@expo/expo-modules-macros-plugin"
MACRO_REAL="$(cd "$ROOT" && pwd -P)/node_modules/@expo/expo-modules-macros-plugin"
if [[ "$MACRO_REAL" == *" "* && -d "$MACRO_LINK" ]]; then
  MACRO_REAL="$MACRO_REAL" MACRO_LINK="$MACRO_LINK" SUPPORT="$ROOT/ios/Pods/Target Support Files" python3 - <<'PY'
import os
from pathlib import Path
old, new = os.environ["MACRO_REAL"], os.environ["MACRO_LINK"]
support = Path(os.environ["SUPPORT"])
n = 0
if support.is_dir():
    for xc in support.rglob("*.xcconfig"):
        text = xc.read_text(encoding="utf-8")
        if old in text:
            xc.write_text(text.replace(old, new), encoding="utf-8")
            n += 1
print(f"== Rewrote ExpoModulesMacros plugin paths in {n} xcconfigs → no-space symlink ==")
PY
fi
# Pin SYMPLY_BUILD_NUMBER on Release-<brand> from brand.cjs. Project-level
# overrides beat Brand.generated.xcconfig — skipping this leaves a stale
# CFBundleVersion and App Store Connect rejects the upload.
ruby scripts/ios/ensure-brand-configurations.rb

export APP_BRAND="$BRAND"
export EXPO_PUBLIC_APP_BRAND="$BRAND"
export SIMPLEHOUSE_API_ENV="$API_ENV"
# Required for Release embed: app still uses @react-navigation/* inside expo-router.
export EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1
# Don't fail Archive when Sentry auth/token isn't available locally.
export SENTRY_ALLOW_FAILURE=true
export SENTRY_DISABLE_AUTO_UPLOAD="${SENTRY_DISABLE_AUTO_UPLOAD:-true}"
# Budget V2: bake local-first into the JS bundle (Restore / Device sync UI).
if [[ "$BRAND" == "symply-budget" ]]; then
  export EXPO_PUBLIC_BUDGET_LOCAL_FIRST="${EXPO_PUBLIC_BUDGET_LOCAL_FIRST:-1}"
fi

# Non-interactive code signing.
#
# `-allowProvisioningUpdates` alone makes xcodebuild create/refresh profiles
# through whatever Apple ID is signed into Xcode — which is an interactive
# 2FA prompt on a machine that has never signed in, and a hard stop for any
# automated run. The same App Store Connect API key the uploader already
# resolves from the Keychain (symply.asc.*) authorises profile creation too,
# so pass it here and the whole archive→upload path runs unattended.
# Optional by design: no key in the Keychain → behave exactly as before.
ASC_AUTH_ARGS=()
_asc_key_id="$("$ROOT/scripts/secrets/get.sh" symply.asc.key_id 2>/dev/null || true)"
_asc_issuer="$("$ROOT/scripts/secrets/get.sh" symply.asc.issuer_id 2>/dev/null || true)"
_asc_key_path="$("$ROOT/scripts/secrets/get.sh" symply.asc.key_path 2>/dev/null || true)"
if [[ -n "$_asc_key_id" && -n "$_asc_issuer" && -f "$_asc_key_path" ]]; then
  ASC_AUTH_ARGS=(
    -authenticationKeyPath "$_asc_key_path"
    -authenticationKeyID "$_asc_key_id"
    -authenticationKeyIssuerID "$_asc_issuer"
  )
  echo "== Code signing: App Store Connect API key (non-interactive) =="
else
  echo "== Code signing: Xcode-signed-in account (may prompt for Apple 2FA) =="
fi

echo "== Archiving scheme: $SCHEME ($CONFIGURATION) =="
echo "   → $ARCHIVE_PATH"
echo "   log: $LOG"

# Avoid `tee` pipe deadlock on long archives; log to file and stream progress.
set +e
mkdir -p "$DERIVED_DATA"
XCODEBUILD_EXTRA=()
if [[ "$BRAND" == "symply-budget" ]]; then
  XCODEBUILD_EXTRA+=(EXPO_PUBLIC_BUDGET_LOCAL_FIRST="${EXPO_PUBLIC_BUDGET_LOCAL_FIRST:-1}")
fi
# Both arrays below expand through ${arr[@]+"${arr[@]}"}, not plain "${arr[@]}".
# macOS ships bash 3.2, where an EMPTY array expanded under `set -u` is an
# "unbound variable" error rather than nothing at all. Only symply-budget adds
# to XCODEBUILD_EXTRA, so every other brand left it empty and died here before
# xcodebuild ever started — a scheme-independent failure that read like a build
# error. ASC_AUTH_ARGS has the same shape: empty whenever the Keychain holds no
# ASC key, which would crash instead of taking the Xcode-signed-in fallback
# path the block above deliberately supports.
xcodebuild \
  -workspace "$ROOT/ios/SymplyEcosystem.xcworkspace" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED_DATA" \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  ${ASC_AUTH_ARGS[@]+"${ASC_AUTH_ARGS[@]}"} \
  -resultBundlePath "$OUT/Result.xcresult" \
  APP_BRAND="$BRAND" \
  EXPO_PUBLIC_APP_BRAND="$BRAND" \
  SIMPLEHOUSE_API_ENV="$API_ENV" \
  EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
  SENTRY_ALLOW_FAILURE=true \
  SENTRY_DISABLE_AUTO_UPLOAD=true \
  DEVELOPMENT_TEAM=B2ZY5M2YW2 \
  ${XCODEBUILD_EXTRA[@]+"${XCODEBUILD_EXTRA[@]}"} \
  archive \
  >"$LOG" 2>&1 &
XCODE_PID=$!
# Heartbeat while archiving
while kill -0 "$XCODE_PID" 2>/dev/null; do
  sleep 30
  if [[ -f "$LOG" ]]; then
    last=$(python3 -c "
import re
from pathlib import Path
p=Path('$LOG')
lines=p.read_text(errors='replace').splitlines()
pat=re.compile(r'error:|ARCHIVE|CompileSwift|Bundle React|Touching |Signing |Linking |\\*\\* ')
for l in reversed(lines):
  if pat.search(l) and len(l)<200:
    print(l); break
" 2>/dev/null || true)
    echo "[archive $(date +%H:%M:%S)] ${last:0:160}"
  fi
done
wait "$XCODE_PID"
XC=$?
set -e

if [[ "$XC" -ne 0 ]]; then
  echo "ARCHIVE FAILED ($XC). See $LOG"
  # Check the usual suspect FIRST. The Pods xcconfigs point at this link, so if
  # it vanished mid-build the compiler reports a missing ExpoModulesMacros
  # plugin — an error that gives no hint of the real cause. Say it plainly.
  if [[ "$ROOT" != "$(cd "$(dirname "$0")/.." && pwd)" && ! -L "$ROOT" ]]; then
    echo ""
    echo "  LIKELY CAUSE: the no-space symlink $ROOT is gone (deleted mid-build)."
    echo "  The Pods xcconfigs reference it, so its loss surfaces as:"
    echo "    error: external macro implementation type 'ExpoModulesMacros...' could not be found"
    echo "  Re-running this script recreates the link and should succeed."
    echo ""
  fi
  python3 -c "
from pathlib import Path
lines=Path('$LOG').read_text(errors='replace').splitlines()
for l in lines[-100:]:
  if l.strip() and len(l)<300: print(l)
" || true
  exit "$XC"
fi

echo "Archive OK: $ARCHIVE_PATH"

if [[ "${SKIP_EXPORT:-0}" == "1" ]]; then
  echo "SKIP_EXPORT=1 — done"
  exit 0
fi

# Per-brand ExportOptions (method app-store-connect)
EXPORT_PLIST="$OUT/ExportOptions.plist"
cat > "$EXPORT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>B2ZY5M2YW2</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
EOF

echo "== Exporting IPA =="
set +e
xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_PLIST" \
  -allowProvisioningUpdates \
  ${ASC_AUTH_ARGS[@]+"${ASC_AUTH_ARGS[@]}"} \
  2>&1 | tee -a "$LOG"
EX=${PIPESTATUS[0]}
set -e

if [[ "$EX" -ne 0 ]]; then
  echo "EXPORT FAILED ($EX). Archive still at $ARCHIVE_PATH — open in Xcode Organizer to distribute."
  exit "$EX"
fi

IPA="$(ls "$EXPORT_DIR"/*.ipa 2>/dev/null | head -1 || true)"
echo "IPA: ${IPA:-none}"

if [[ "${UPLOAD_TF:-0}" == "1" && -n "${IPA:-}" ]]; then
  echo "== Upload to App Store Connect =="
  # Delegate to the one uploader that resolves credentials from the Keychain
  # (symply.asc.*). This used to call altool directly with ${ASC_API_KEY} /
  # ${ASC_API_ISSUER} — env vars nothing in this repo ever sets — so altool
  # silently looked for a file named `AuthKey_.p8` and every UPLOAD_TF=1 run
  # died after a full 20-minute archive. Keep exactly one credential path.
  "$ROOT/scripts/upload-tf-ipas.sh" "$EXPORT_DIR" || \
    echo "upload failed — use Xcode Organizer or Transporter with $IPA"
fi

echo
echo "DONE $BRAND ($API_ENV)"
echo "  archive: $ARCHIVE_PATH"
echo "  export:  $EXPORT_DIR"
