#!/usr/bin/env bash
#
# Symply Language (brand `symply-language`) Maestro E2E runner.
#
# Runs the modular flows under e2e/maestro/language against a booted iOS simulator on
# BOTH iPhone and iPad classes. The Language brand ships bundle id com.symply.language
# and URL scheme simplelanguage://. Language authenticates against the LIVE donor
# /api/v1 (simple-language-api[-staging].a-tekhtelev.workers.dev), so a real network +
# the shared test account are required — flows also run when the sim is already signed in.
#
# Prereqs:
#   1. Maestro installed:  curl -fsSL https://get.maestro.mobile.dev | bash
#   2. The Language brand built + installed on the target sim:
#        npm run prepare:xcode:language   # (or an EAS/dev build of com.symply.language)
#        APP_BRAND=symply-language EXPO_PUBLIC_APP_BRAND=symply-language npm run ios
#   3. e2e/credentials.local with E2E_EMAIL / E2E_PASSWORD (shared test account).
#
# Usage:
#   ./scripts/e2e/run-language-suite.sh                                  # full suite (config.yaml order)
#   E2E_DEVICE=Language-iPad ./scripts/e2e/run-language-suite.sh          # iPad class
#   ./scripts/e2e/run-language-suite.sh e2e/maestro/language/tutor.yaml   # one flow
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "language"
# shellcheck source=scripts/e2e/maestro-dedicated-sim.sh
source "$(dirname "$0")/maestro-dedicated-sim.sh"
maestro_prepare_dedicated_sim language
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

DEVICE_NAME="${E2E_DEVICE:-Language-A}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard "${DEVICE_NAME}"

find_udid() {
  xcrun simctl list devices available | grep "${1}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

UDID="${MAESTRO_DEDICATED_UDID:-$(find_udid "${DEVICE_NAME}")}"

# Auto-create an iPad sim on first run so the same flows cover iPad too.
if [[ -z "${UDID}" && "${DEVICE_NAME}" == *iPad* ]]; then
  DEVICE_TYPE="$(xcrun simctl list devicetypes | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro[^ ]*' | head -1 || true)"
  RUNTIME="$(xcrun simctl list runtimes | grep -Eo 'com.apple.CoreSimulator.SimRuntime.iOS[^ ]*' | tail -1 || true)"
  if [[ -n "${DEVICE_TYPE}" && -n "${RUNTIME}" ]]; then
    echo "Creating ${DEVICE_NAME} (${DEVICE_TYPE} / ${RUNTIME})"
    xcrun simctl create "${DEVICE_NAME}" "${DEVICE_TYPE}" "${RUNTIME}" >/dev/null || true
    UDID="$(find_udid "${DEVICE_NAME}")"
  fi
fi

if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found (and could not create one)."
  echo "Create one in Xcode, or set E2E_DEVICE to an existing simulator name."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true
xcrun simctl bootstatus "${UDID}" -b 2>/dev/null || sleep 8

LANGUAGE_METRO_PORT="${LANGUAGE_METRO_PORT:-8084}"
if ! curl -sf "http://localhost:${LANGUAGE_METRO_PORT}/status" >/dev/null; then
  echo "Metro is not running on :${LANGUAGE_METRO_PORT}. Start it first:"
  echo "  npm run start:language -- --port ${LANGUAGE_METRO_PORT}"
  exit 1
fi

if ! xcrun simctl get_app_container "${UDID}" com.symply.language >/dev/null 2>&1; then
  echo "com.symply.language is not installed on ${DEVICE_NAME}."
  echo "Build with Debug-language config, then: xcrun simctl install ${UDID} …/SymplyEcosystem.app"
  exit 1
fi

curl -sf -X POST "http://localhost:${LANGUAGE_METRO_PORT}/reload" >/dev/null 2>&1 || true

for _plist in \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
do
  if [[ -f "${_plist}" ]]; then
    plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  fi
done
xcrun simctl spawn "${UDID}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true

echo "Running Symply Language Maestro E2E on ${DEVICE_NAME} (${UDID})"

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  # simplelanguage://e2e-login — isE2ELoginUrl() matches the `e2e-login` host on any scheme.
  # Dev-build (Debug + Metro) autologin convenience; the flows fall back to manual email login.
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplelanguage://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
else
  echo "WARNING: E2E_EMAIL / E2E_PASSWORD unset — login will be skipped."
  echo "         Flows only pass if the sim is already signed into com.symply.language."
fi
# Nested subflows (Maestro 2.6+) require appId — pass once for shared helpers.
MAESTRO_ENV+=(-e "APP_ID=com.symply.language")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplelanguage")
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplelanguage://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${LANGUAGE_METRO_PORT}")

TARGET="${1:-${ROOT}/e2e/maestro/language}"
EXTRA_ARGS=()
if (( $# > 1 )); then
  EXTRA_ARGS=("${@:2}")
fi

mkdir -p "${HOME}/.maestro/tests"
# Prune only stale artifacts — never wipe ~/.maestro/tests right before a run
# (Maestro writes commands-*.json at flow end → FileNotFoundException false fail).
find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -mmin +360 -exec rm -rf {} + 2>/dev/null || true
find "${HOME}/Library/Logs/maestro" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true

MAESTRO_ARGS=(--format NOOP --no-reinstall-driver)
if [[ "${MAESTRO_DEBUG:-0}" == "1" ]]; then
  DEBUG_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-language-debug}"
  mkdir -p "${DEBUG_DIR}"
  MAESTRO_ARGS+=(--flatten-debug-output "--debug-output=${DEBUG_DIR}")
fi

FLOW_DIR="${ROOT}/e2e/maestro/language"
CONFIG="${FLOW_DIR}/config.yaml"

# Full-suite serial mode: one flow per Maestro session (avoids iOS 26 driver death
# when Maestro batches flowsOrder + parallel fleet contention).
if [[ "${TARGET}" == "${FLOW_DIR}" && "${E2E_LANGUAGE_SINGLE:-0}" != "1" && "${E2E_LANGUAGE_SERIAL:-1}" == "1" && ${#EXTRA_ARGS[@]} -eq 0 ]]; then
  RUN_DATE="$(date +%Y-%m-%d)"
  LOG="${MAESTRO_LANGUAGE_LOG:-${ROOT}/.tmp/e2e-logs/maestro-language-full-${RUN_DATE}.log}"
  case "${LOG}" in
    /*) ;;
    *) LOG="${ROOT}/${LOG}" ;;
  esac
  export MAESTRO_LANGUAGE_LOG="${LOG}"
  mkdir -p "$(dirname "${LOG}")"
  FLOWS=()
  while IFS= read -r _flow; do
    [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
  done < <(grep -A200 'flowsOrder:' "${CONFIG}" | grep '^    - ' | sed 's/^    - //')
  echo "Serial Language suite (${#FLOWS[@]} flows) → ${LOG}"
  : > "${LOG}"
  echo ">>> Prime session" | tee -a "${LOG}"
  _prime_ok=0
  for _attempt in 1 2 3; do
    E2E_LANGUAGE_SINGLE=1 MAESTRO_REINSTALL_DRIVER=1 "${BASH_SOURCE[0]}" "${FLOW_DIR}/language-prime-session.yaml" >>"${LOG}" 2>&1 || true
    if tail -30 "${LOG}" | grep -qE '(\[Passed\] language-prime-session|Flow Passed|1/1 Flow Passed)'; then
      _prime_ok=1
      break
    fi
    if grep -q "Killed: 9\|IOSDriverTimeoutException\|Failed to connect to /127.0.0.1" "${LOG}" 2>/dev/null; then
      echo "Prime attempt ${_attempt} interrupted — cooling down 30s" | tee -a "${LOG}"
      sleep 30
    else
      break
    fi
  done
  if ((_prime_ok)); then
    echo "[Passed] language-prime-session" | tee -a "${LOG}"
  else
    echo "[Failed] language-prime-session" | tee -a "${LOG}"
    exit 1
  fi
  pass=1
  fail=0
  for flow in "${FLOWS[@]}"; do
    echo "" | tee -a "${LOG}"
    echo "=== ${flow} ===" | tee -a "${LOG}"
    _flow_ok=0
    _flow_start=$(wc -l <"${LOG}" | tr -d ' ')
    for _attempt in 1 2; do
      E2E_LANGUAGE_SINGLE=1 "${BASH_SOURCE[0]}" "${FLOW_DIR}/${flow}.yaml" >>"${LOG}" 2>&1 || true
      _flow_tail="$(tail -n +"${_flow_start}" "${LOG}")"
      if echo "${_flow_tail}" | grep -qE "(\[Passed\] ${flow} \(|Flow Passed|1/1 Flow Passed)" \
        && ! echo "${_flow_tail}" | grep -qE "\[Failed\] ${flow} \("; then
        _flow_ok=1
        break
      fi
      if echo "${_flow_tail}" | grep -qE 'NoSuchFileException.*Library/Logs/maestro|DebugLogStore\.finalizeRun' \
        && echo "${_flow_tail}" | grep -qE '(Flow Passed|1/1 Flow Passed|\[Passed\])'; then
        echo "Maestro finalize race on ${flow} — treating as pass (attempt ${_attempt})" | tee -a "${LOG}"
        _flow_ok=1
        E2E_MAESTRO_KILL_RUNNERS=0 bash "${ROOT}/scripts/e2e/maestro-scoped-kill.sh" language 2>/dev/null || true
        break
      fi
      if echo "${_flow_tail}" | grep -qE 'Killed: 9|App crashed or stopped while executing flow'; then
        echo "Maestro/app interrupted on ${flow} (attempt ${_attempt}) — cooling down 30s" | tee -a "${LOG}"
        E2E_MAESTRO_KILL_RUNNERS=0 bash "${ROOT}/scripts/e2e/maestro-scoped-kill.sh" language 2>/dev/null || true
        xcrun simctl boot "${UDID}" 2>/dev/null || true
        sleep 30
      elif grep -q "IOSDriverTimeoutException\|iOS driver not ready\|Failed to connect to /127.0.0.1" "${LOG}" 2>/dev/null; then
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
    if [[ "${flow}" != "language-auth-validation" ]]; then
      E2E_LANGUAGE_SINGLE=1 "${BASH_SOURCE[0]}" "${FLOW_DIR}/subflows/language-recover-learn.yaml" >>"${LOG}" 2>&1 || true
    fi
    sleep 5
    bash "${ROOT}/scripts/e2e/prune-maestro-disk.sh" >/dev/null 2>&1 || true
  done
  echo "Suite complete: ${pass} pass / ${fail} fail" | tee -a "${LOG}"
  exit $(( fail > 0 ? 1 : 0 ))
fi

# Single-flow runs must not pass workspace config (would execute the whole matrix).
if [[ "${TARGET}" == *.yaml ]]; then
  bash "${ROOT}/scripts/e2e/maestro-flow-run.sh" \
    maestro test "${MAESTRO_ENV[@]}" "${TARGET}" --device "${UDID}" "${MAESTRO_ARGS[@]}" "${EXTRA_ARGS[@]:-}"
else
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" --config "${CONFIG}" --device "${UDID}" "${MAESTRO_ARGS[@]}" "${EXTRA_ARGS[@]:-}"
fi
