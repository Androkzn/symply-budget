#!/usr/bin/env bash
# Android counterpart to run-budget-suite-live-report.sh: run the Budget
# Maestro suite on the Android emulator, regenerating the visual + backend
# HTML report every POLL_INTERVAL seconds while it runs.
#
# Usage:
#   ./scripts/e2e/run-budget-suite-android-live-report.sh                    # whole suite
#   ./scripts/e2e/run-budget-suite-android-live-report.sh e2e/maestro/budget/budget-chat-message.yaml
#
# Prereqs: same as run-budget-suite-android.sh (Maestro, adb, e2e/credentials.local).
# Metro is started here (same as the iOS wrapper) — you do not need to run
# `npm run android` separately first, but the emulator does need the Budget
# dev-client APK already installed at least once (`npm run android -- --port 8082`).
#
# Report: same layout/convention as the iOS wrapper — timestamped run dir
# under documents/engineering/testing/reports/budget/, `latest` symlink,
# assets/ gitignored. Override with REPORT_OUT=... for a one-off custom path.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

METRO_LOG="/tmp/metro-budget-android.log"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# Report header metadata. app.config.ts falls back Android's versionCode to
# iosBuildNumber — but that's the Expo-config layer, and this repo's android/
# is a committed bare-workflow tree that never runs `expo prebuild` (see the
# SIBLING_PACKAGES comment in AndroidManifest.xml), so app.config.ts's value
# never actually reaches the native build. The real fallback lives in
# android/app/build.gradle (androidVersionCode / EAS_BUILD_ANDROID_VERSION_CODE,
# else '23') — read the TRUTH back from whatever's actually installed on the
# target device/emulator instead of re-deriving it from a config path that
# doesn't apply here.
REPORT_PLATFORM="Android"
# Preset before report_meta_args so the adb-derived truth wins over the brand
# pack's iOS build number — the shared helper only fills what is still empty.
REPORT_BUILD_NUMBER="$(adb -s "${ANDROID_SERIAL:-$(adb devices | awk '/\tdevice$/ {print $1; exit}')}" shell dumpsys package com.symply.budget 2>/dev/null | grep -oE 'versionCode=[0-9]+' | head -1 | cut -d= -f2)"
REPORT_DEVICE="$(adb -s "${ANDROID_SERIAL:-$(adb devices | awk '/\tdevice$/ {print $1; exit}')}" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
# shellcheck source=scripts/e2e/report-meta.sh
source "$(dirname "$0")/report-meta.sh"
report_meta_args symply-budget

mkdir -p "$REPORT_OUT"
# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="$REPORT_OUT"
[[ "$(dirname "$REPORT_OUT")" == "$REPORTS_BASE" ]] && LATEST_TARGET="$(basename "$REPORT_OUT")"
ln -sfn "$LATEST_TARGET" "${REPORTS_BASE}/latest"
echo "[live-report-android] report dir: ${REPORT_OUT}  (also: ${REPORTS_BASE}/latest)"

echo "[live-report-android] starting Metro (logged, cache cleared) on :8082"
( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh budget --port 8082 ) &

echo "[live-report-android] waiting for Metro..."
for _ in $(seq 1 60); do
  curl -sf http://localhost:8082/status >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf http://localhost:8082/status >/dev/null 2>&1; then
  echo "[live-report-android] Metro did not come up in time" >&2
  exit 1
fi
echo "[live-report-android] Metro ready"

BEFORE_RUNS="$(ls -1 "$HOME/.maestro/tests" 2>/dev/null || true)"

# Same aggregation as the iOS wrapper — see run-budget-suite-live-report.sh
# for why: run-budget-suite-android.sh invokes Maestro separately per flow,
# each flow's commands.json lives one level deeper than the timestamp dir.
AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "$AGG_DIR"
rm -f "$AGG_DIR"/*

link_new_run_dirs() {
  comm -13 <(printf '%s\n' "$BEFORE_RUNS" | sort) <(ls -1 "$HOME/.maestro/tests" 2>/dev/null | sort) \
    | while IFS= read -r tname; do
        [[ -n "$tname" ]] || continue
        for flow in "$HOME/.maestro/tests/$tname"/*/; do
          flow="${flow%/}"
          [[ -f "$flow/commands.json" ]] || continue
          ln -sfn "$flow" "$AGG_DIR/${tname}__$(basename "$flow")"
        done
      done
}

echo "[live-report-android] launching Budget Android suite"
( cd "$ROOT" && ./scripts/e2e/run-budget-suite-android.sh "$@" ) &
SUITE_PID=$!

# Same generous wait as the iOS wrapper — real setup work (emulator boot
# check, autofill/stylus-overlay disabling) happens before the first
# `maestro test` process exists.
for _ in $(seq 1 200); do
  link_new_run_dirs
  [[ -n "$(ls -A "$AGG_DIR" 2>/dev/null)" ]] && break
  sleep 3
done

if [[ -z "$(ls -A "$AGG_DIR" 2>/dev/null)" ]]; then
  echo "[live-report-android] could not detect any Maestro run directory in time — will generate once at the end instead of live"
  wait "$SUITE_PID"
  SUITE_EXIT=$?
  link_new_run_dirs
else
  echo "[live-report-android] watching ${AGG_DIR} (aggregates every new flow's run dir)"
  echo "[live-report-android] report: ${REPORT_OUT}/index.html (updates every ${POLL_INTERVAL}s)"
  node "$ROOT/scripts/e2e/generate-report.mjs" \
    --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
    --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
    "${REPORT_META_ARGS[@]}" \
    >/tmp/e2e-report-budget-android-live-gen.log 2>&1
  if [[ -f "${REPORT_OUT}/index.html" ]]; then
    open "${REPORT_OUT}/index.html" 2>/dev/null || true
  fi
  while kill -0 "$SUITE_PID" 2>/dev/null; do
    link_new_run_dirs
    node "$ROOT/scripts/e2e/generate-report.mjs" \
      --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
      --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
      "${REPORT_META_ARGS[@]}" \
      >/tmp/e2e-report-budget-android-live-gen.log 2>&1
    sleep "$POLL_INTERVAL"
  done
  wait "$SUITE_PID"
  SUITE_EXIT=$?
fi

link_new_run_dirs
echo "[live-report-android] suite finished (exit=${SUITE_EXIT}) — final report regeneration"
node "$ROOT/scripts/e2e/generate-report.mjs" \
  --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
  --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
  "${REPORT_META_ARGS[@]}"

echo "[live-report-android] done. Report: ${REPORT_OUT}/index.html"
exit "$SUITE_EXIT"
