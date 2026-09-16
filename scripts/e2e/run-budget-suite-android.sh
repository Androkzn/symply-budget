#!/usr/bin/env bash
#
# Symply Budget (brand `symply-budget`) Maestro E2E runner — ANDROID.
#
# Android port of run-budget-suite.sh: same flow set (e2e/maestro/budget),
# same serial full-suite loop / retry / recovery pattern, but targets an
# Android emulator via adb/`emulator` instead of an iOS Simulator via
# `xcrun simctl`. Budget authenticates against the LIVE staging Worker with
# the shared test account, so a real network + credentials are required.
#
# Known gaps vs the iOS runner (first Android pass — see conversation/report):
#   - No fixture seeding (seed-fixtures.sh is CoreSimulator-only). Flows that
#     require real uploaded documents/photos will fail until an Android
#     equivalent (adb push + MediaStore scan) is built.
#   - iOS-only UI text in shared subflows (Face ID, Apple Sign-In, "Save
#     Password?", iOS notification-prompt copy) will no-op harmlessly via
#     `when: visible` guards but won't dismiss Android's own equivalents
#     unless those are added alongside.
#
# Prereqs:
#   1. Maestro installed:  curl -fsSL https://get.maestro.mobile.dev | bash
#   2. Budget built + installed on a running Android emulator:
#        APP_BRAND=symply-budget EXPO_PUBLIC_APP_BRAND=symply-budget npm run android -- --port 8082
#   3. e2e/credentials.local with E2E_EMAIL / E2E_PASSWORD (shared test account).
#
# Usage:
#   ./scripts/e2e/run-budget-suite-android.sh                                      # full suite
#   ./scripts/e2e/run-budget-suite-android.sh e2e/maestro/budget/budget-auth.yaml   # one flow
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "budget-android"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro not found. Install: curl -fsSL https://get.maestro.mobile.dev | bash"
  exit 1
fi
if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found. Install Android SDK platform-tools and put it on PATH."
  exit 1
fi

AVD_NAME="${E2E_ANDROID_AVD:-Budget-Pixel-8}"

find_serial() {
  adb devices | awk '/\tdevice$/ {print $1; exit}'
}

SERIAL="${ANDROID_SERIAL:-$(find_serial)}"

if [[ -z "${SERIAL}" ]]; then
  echo "No running Android device/emulator — booting ${AVD_NAME}"
  nohup emulator -avd "${AVD_NAME}" -netdelay none -netspeed full \
    >"${ROOT}/.tmp/e2e-logs/android-emulator-boot.log" 2>&1 &
  disown
  for _i in $(seq 1 60); do
    SERIAL="$(find_serial)"
    [[ -n "${SERIAL}" ]] && break
    sleep 5
  done
  if [[ -z "${SERIAL}" ]]; then
    echo "Emulator did not come up with an adb device in time."
    exit 1
  fi
fi

for _i in $(seq 1 60); do
  BOOTED="$(adb -s "${SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
  [[ "${BOOTED}" == "1" ]] && break
  sleep 5
done

export ANDROID_SERIAL="${SERIAL}"
echo "Running Symply Budget Maestro E2E on ${SERIAL}"

# Best-effort: disable the Android Autofill framework's "Save password?" /
# credential-suggestion overlays, which — like iOS Password AutoFill — can
# steal focus from Maestro's inputText on secure fields.
adb -s "${SERIAL}" shell settings put secure autofill_service null 2>/dev/null || true
# Disable Android's "Try out your stylus" handwriting-tip overlay, which pops
# up over ANY text field the first time it's focused on a stylus-capable AVD
# and swallows subsequent taps/input aimed at that field (discovered via
# budget-chat-message/-extended/-assistant all failing identically on
# "Element not found: chat-room-send/-input" — the field was there, just
# covered by this system tooltip).
adb -s "${SERIAL}" shell settings put secure stylus_handwriting_enabled 0 2>/dev/null || true
# Disable Expo Dev Client's three-finger-long-press and shake gestures for
# opening the dev menu. Both default to enabled (see expo-dev-menu's
# DevMenuPreferences.kt: touchGestureEnabled/motionGestureEnabled, both
# `true` by default) and there is no Android-side JS bridge to disable them
# at runtime — DevMenuPreferences is an Expo Module registered on iOS only in
# this SDK, so app/_layout.tsx's setPreferencesAsync call is a silent no-op
# here. The dev menu popping open mid-flow (covering the exact button/field
# Maestro is about to interact with) was traced to this: some scroll/swipe
# gesture is apparently read as a three-finger long-press. Seed the app's own
# SharedPreferences file directly (best-effort — requires the app to have
# been installed+launched at least once so shared_prefs/ already exists).
if adb -s "${SERIAL}" shell run-as com.symply.budget test -d shared_prefs 2>/dev/null; then
  DEVMENU_PREFS_TMP="$(mktemp)"
  cat > "${DEVMENU_PREFS_TMP}" <<'EOF'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
    <boolean name="touchGestureEnabled" value="false" />
    <boolean name="motionGestureEnabled" value="false" />
</map>
EOF
  adb -s "${SERIAL}" push "${DEVMENU_PREFS_TMP}" /data/local/tmp/devmenu-prefs.xml >/dev/null 2>&1 \
    && adb -s "${SERIAL}" shell run-as com.symply.budget cp /data/local/tmp/devmenu-prefs.xml shared_prefs/expo.modules.devmenu.sharedpreferences.xml 2>/dev/null \
    && adb -s "${SERIAL}" shell am force-stop com.symply.budget 2>/dev/null
  rm -f "${DEVMENU_PREFS_TMP}"
fi

if [[ "${E2E_SEED_FIXTURES:-0}" == "1" ]]; then
  echo "WARNING: E2E_SEED_FIXTURES=1 requested but seed-fixtures.sh is iOS-only — skipping."
fi

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplebudget://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
else
  echo "WARNING: E2E_EMAIL / E2E_PASSWORD unset — login will be skipped."
  echo "         Flows only pass if the device is already signed into com.symply.budget."
fi
MAESTRO_ENV+=(-e "APP_ID=com.symply.budget")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplebudget")
# e2e-verify-badge (E2EVerifyBadge.tsx) is a root-level sibling outside the
# navigator — on Android its native view sits behind react-native-screens'
# per-screen surface compositing and never reaches Maestro's UiAutomator-read
# accessibility tree, even with importantForAccessibility/collapsable fixes
# (verified: absent from 5 independent hierarchy dumps across different
# mitigations, while ~50 sibling testIDs on the same screen resolve fine).
# The underlying network verification (openLink e2e-verify-network) still
# fires and is checked — only the UI-visible PASS confirmation is unreachable
# here. Flows guard their `extendedWaitUntil: visible: id: e2e-verify-badge`
# checks behind this flag so Android runs skip just that assertion.
MAESTRO_ENV+=(-e "E2E_PLATFORM=android")
BUDGET_METRO_PORT="${BUDGET_METRO_PORT:-8082}"
# Android emulators can't reach the host as 127.0.0.1 — use the host's LAN IP
# (proven reachable: the initial `expo run:android` install already connects
# this way). Override via E2E_METRO_HOST if the network changes.
METRO_HOST="${E2E_METRO_HOST:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 10.0.2.2)}"
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplebudget://expo-development-client/?url=http%3A%2F%2F${METRO_HOST}%3A${BUDGET_METRO_PORT}")

FLOW_DIR="${ROOT}/e2e/maestro/budget"
TARGET="${1:-${FLOW_DIR}}"
CONFIG="${FLOW_DIR}/config.yaml"
DEBUG_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-budget-android-debug}"
OUTPUT_DIR="${MAESTRO_TEST_OUTPUT_DIR:-/tmp/maestro-budget-android-output}"
mkdir -p "${DEBUG_DIR}" "${OUTPUT_DIR}" "${HOME}/.maestro/tests"
find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -mmin +360 -exec rm -rf {} + 2>/dev/null || true
find "${HOME}/Library/Logs/maestro" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true

MAESTRO_DEVICE_ARGS=(
  --device "${SERIAL}"
  --format NOOP
)
if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
  MAESTRO_DEVICE_ARGS+=(--no-reinstall-driver)
fi
MAESTRO_ARGS=(
  --config "${CONFIG}"
  "${MAESTRO_DEVICE_ARGS[@]}"
)

EXTRA_ARGS=()
if (( $# > 1 )); then
  EXTRA_ARGS=("${@:2}")
fi

# Full-suite serial mode: run flows one-by-one with session prime between each
# (mirrors the iOS runner's approach to avoiding long-run navigation drift).
if [[ "${TARGET}" == "${FLOW_DIR}" && "${E2E_BUDGET_SINGLE:-0}" != "1" && "${E2E_BUDGET_SERIAL:-1}" == "1" && ${#EXTRA_ARGS[@]} -eq 0 ]]; then
  RUN_DATE="$(date +%Y-%m-%d)"
  RUN_ID="${MAESTRO_BUDGET_RUN_ID:-android-run1}"
  LOG="${MAESTRO_BUDGET_LOG:-${ROOT}/.tmp/e2e-logs/maestro-budget-android-${RUN_DATE}-${RUN_ID}.log}"
  case "${LOG}" in
    /*) ;;
    *) LOG="${ROOT}/${LOG}" ;;
  esac
  export MAESTRO_BUDGET_LOG="${LOG}"
  mkdir -p "$(dirname "${LOG}")"
  FLOWS=()
  while IFS= read -r _flow; do
    [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
  done < <(grep -A200 'flowsOrder:' "${CONFIG}" | grep '    - ' | sed 's/.*- //')
  echo "Serial Budget Android suite (${#FLOWS[@]} flows) → ${LOG}"
  if [[ "${MAESTRO_BUDGET_TRUNCATE:-0}" == "1" || ! -s "${LOG}" ]]; then
    : > "${LOG}"
  else
    echo "" | tee -a "${LOG}"
    echo "=== Serial suite resume $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
  fi
  pass=0
  fail=0
  for flow in "${FLOWS[@]}"; do
    rm -rf "${DEBUG_DIR:?}"/* 2>/dev/null || true
    mkdir -p "${HOME}/.maestro/tests"
    echo "" | tee -a "${LOG}"
    echo "=== ${flow} ===" | tee -a "${LOG}"
    _flow_ok=0
    _max_attempts=2
    for _attempt in $(seq 1 "${_max_attempts}"); do
      if E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 "${BASH_SOURCE[0]}" "${FLOW_DIR}/${flow}.yaml" >>"${LOG}" 2>&1; then
        _flow_ok=1
        break
      fi
      _flow_tail="$(tail -120 "${LOG}")"
      if grep -qE "AndroidDriverTimeoutException|driver not ready|Failed to connect|Connection refused|Killed: 9" <<<"${_flow_tail}"; then
        echo "Driver timeout on ${flow} (attempt ${_attempt}) — cooling down 45s" | tee -a "${LOG}"
        sleep 45
      else
        break
      fi
    done
    if ((_flow_ok)); then
      echo "[Passed] ${flow}" | tee -a "${LOG}"
      pass=$((pass + 1))
    else
      echo "[Failed] ${flow}" | tee -a "${LOG}"
      fail=$((fail + 1))
    fi
    if [[ "${flow}" != "budget-auth" && "${flow}" != "budget-prime-session" && "${flow}" != "budget-recover-session" ]]; then
      E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 "${BASH_SOURCE[0]}" "${FLOW_DIR}/budget-recover-session.yaml" >>"${LOG}" 2>&1 || true
    fi
    sleep 2
  done
  echo "Suite complete: ${pass} pass / ${fail} fail" | tee -a "${LOG}"
  exit $(( fail > 0 ? 1 : 0 ))
fi

if [[ "${TARGET}" == *.yaml ]]; then
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_DEVICE_ARGS[@]}" "${EXTRA_ARGS[@]:-}"
elif ((${#EXTRA_ARGS[@]} > 0)); then
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}" "${EXTRA_ARGS[@]}"
else
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}"
fi
