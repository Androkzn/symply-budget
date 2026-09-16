#!/usr/bin/env bash
#
# Symply Kaizen (brand `symply-kaizen`) FULL Maestro E2E suite runner.
#
# Default: serial one-flow-at-a-time (Budget pattern) — avoids iOS 26 driver
# teardown when Maestro batches 39 flows. Destructive flows (clearState) are
# tagged `destructive` and run only when E2E_INCLUDE_DESTRUCTIVE=1.
#
# Usage:
#   ./scripts/e2e/run-kaizen-suite.sh
#   E2E_DEVICE=Kaizen-iPad ./scripts/e2e/run-kaizen-suite.sh
#   E2E_ONLY=profile,books ./scripts/e2e/run-kaizen-suite.sh
#   E2E_KAIZEN_SERIAL=0 ./scripts/e2e/run-kaizen-suite.sh   # legacy batch mode
#   E2E_INCLUDE_DESTRUCTIVE=1 ./scripts/e2e/run-kaizen-suite.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "kaizen"
# shellcheck source=scripts/e2e/maestro-dedicated-sim.sh
source "$(dirname "$0")/maestro-dedicated-sim.sh"
maestro_prepare_dedicated_sim kaizen
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-240000}"

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

DEVICE_NAME="${E2E_DEVICE:-Kaizen-A}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard "${DEVICE_NAME}"

find_udid() {
  xcrun simctl list devices available | grep "${1}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

UDID="${MAESTRO_DEDICATED_UDID:-$(find_udid "${DEVICE_NAME}")}"

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
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true
if [[ "${E2E_SIM_REBOOT:-0}" == "1" ]]; then
  xcrun simctl shutdown "${UDID}" 2>/dev/null || true
  sleep 2
  xcrun simctl boot "${UDID}" 2>/dev/null || true
  xcrun simctl bootstatus "${UDID}" -b 2>/dev/null || sleep 8
fi
sleep 3

# Prime the File Provider store so SymplyE2E surfaces in UIDocumentPickerViewController.
xcrun simctl launch "${UDID}" com.apple.DocumentsApp >/dev/null 2>&1 || true
sleep 2
xcrun simctl terminate "${UDID}" com.apple.DocumentsApp >/dev/null 2>&1 || true

if ! xcrun simctl get_app_container "${UDID}" com.symply.kaizen >/dev/null 2>&1; then
  echo "com.symply.kaizen is not installed on ${DEVICE_NAME}."
  echo "Build it first: npm run prepare:xcode:kaizen && APP_BRAND=symply-kaizen npm run ios -- --device \"${DEVICE_NAME}\""
  exit 1
fi

if [[ "${E2E_SEED_FIXTURES:-1}" == "1" ]]; then
  bash "$(cd "$(dirname "$0")" && pwd)/seed-fixtures.sh" "${UDID}" kaizen || true
fi

echo "Running Symply Kaizen FULL Maestro suite on ${DEVICE_NAME} (${UDID})"

if ! curl -sf http://localhost:8081/status >/dev/null; then
  echo "Metro is not running on :8081. Start it first: npm run start:kaizen"
  exit 1
fi

curl -sf -X POST http://localhost:8081/reload >/dev/null 2>&1 || true
sleep 2

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "${HOME}/.maestro/tests" "${HOME}/Library/Logs/maestro"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "${SCRIPT_DIR}/setup-maestro-cleanup.sh"
MAESTRO_ARGS=(--format NOOP)
if [[ "${MAESTRO_DEBUG:-1}" != "0" ]]; then
  KAIZEN_OUTPUT_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-kaizen-output}"
  mkdir -p "${KAIZEN_OUTPUT_DIR}"
  MAESTRO_ARGS+=(--flatten-debug-output --debug-output="${KAIZEN_OUTPUT_DIR}")
fi
if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
  MAESTRO_ARGS+=(--no-reinstall-driver)
fi

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('kaizen://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
else
  echo "WARNING: E2E_EMAIL / E2E_PASSWORD unset — login subflows will fail."
fi
MAESTRO_ENV+=(-e "E2E_SETUP_URL=kaizen://e2e-setup")
MAESTRO_ENV+=(-e "APP_ID=com.symply.kaizen")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=kaizen")
KAIZEN_METRO_PORT="${KAIZEN_METRO_PORT:-8081}"
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=kaizen://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${KAIZEN_METRO_PORT}")

shell_prime_kaizen_session() {
  if [[ "${E2E_SHELL_PRIME:-1}" != "1" || -z "${E2E_LOGIN_URL:-}" ]]; then
    return 0
  fi
  echo "Shell-priming Kaizen (Metro + auth + setup) on ${UDID}..."
  xcrun simctl boot "${UDID}" 2>/dev/null || true
  xcrun simctl launch "${UDID}" com.symply.kaizen >/dev/null 2>&1 || true
  sleep 6
  xcrun simctl openurl "${UDID}" "kaizen://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${KAIZEN_METRO_PORT}" >/dev/null 2>&1 || true
  sleep 25
  xcrun simctl openurl "${UDID}" "${E2E_LOGIN_URL}" >/dev/null 2>&1 || true
  sleep 8
  xcrun simctl openurl "${UDID}" "kaizen://e2e-setup" >/dev/null 2>&1 || true
  sleep 10
  xcrun simctl openurl "${UDID}" "kaizen://today" >/dev/null 2>&1 || true
  sleep 8
  echo "Shell prime complete."
}

shell_prime_kaizen_session

FLOW_DIR="${ROOT}/e2e/maestro/kaizen"
CONFIG="${FLOW_DIR}/config.yaml"

read_config_flows() {
  grep -A200 'flowsOrder:' "${CONFIG}" | grep '    - ' | sed 's/.*- //'
}

run_maestro_test() {
  local tmplog
  tmplog="$(mktemp /tmp/maestro-kaizen-run.XXXXXX)"
  set +e
  maestro test "${MAESTRO_ARGS[@]}" "$@" 2>&1 | tee "${tmplog}"
  local rc=${PIPESTATUS[0]}
  set -e
  if (( rc != 0 )); then
    if grep -qE "NoSuchFileException:.*Library/Logs/maestro|FileNotFoundException:.*commands-\(" "${tmplog}" && \
       ! grep -qE "Assert that .* FAILED|Assertion is false|Element not found:|Failed to connect|Unable to launch|IOSDriverTimeoutException|App crashed" "${tmplog}"; then
      echo "NOTE: Maestro finalizeRun debug artifact failed — treating run as passed"
      rm -f "${tmplog}"
      return 0
    fi
  fi
  rm -f "${tmplog}"
  return $rc
}

run_single_flow() {
  local flow="$1"
  local flow_path="${FLOW_DIR}/${flow}.yaml"
  if [[ ! -f "${flow_path}" ]]; then
    echo "Missing flow: ${flow_path}"
    return 1
  fi
  xcrun simctl boot "${UDID}" 2>/dev/null || true
  sleep 2
  run_maestro_test "${MAESTRO_ENV[@]}" "${flow_path}" --device "${UDID}"
}

run_serial_flows() {
  local -a flows=("$@")
  local log="${KAIZEN_SUITE_LOG:-/tmp/kaizen-suite-serial.log}"
  local pass=0
  local fail=0
  : > "${log}"
  echo "Serial Kaizen suite (${#flows[@]} flows) → ${log}"
  for flow in "${flows[@]}"; do
    echo "" | tee -a "${log}"
    echo "=== ${flow} ===" | tee -a "${log}"
    local ok=0
    local max_attempts=2
    if [[ "${E2E_PARALLEL_FLEET:-0}" == "1" ]]; then
      max_attempts=3
    fi
    for attempt in $(seq 1 "${max_attempts}"); do
      if run_single_flow "${flow}" >>"${log}" 2>&1; then
        ok=1
        break
      fi
      if grep -qE "IOSDriverTimeoutException|Failed to connect|Connection refused|Killed: 9" "${log}" 2>/dev/null; then
        echo "Driver/resource flake on ${flow} (attempt ${attempt}) — cooling down 45s" | tee -a "${log}"
        sleep 45
        run_maestro_test "${MAESTRO_ENV[@]}" "${FLOW_DIR}/kaizen-recover-session.yaml" --device "${UDID}" >>"${log}" 2>&1 || true
      else
        break
      fi
    done
    if (( ok )); then
      echo "[Passed] ${flow}" | tee -a "${log}"
      pass=$((pass + 1))
    else
      echo "[Failed] ${flow}" | tee -a "${log}"
      fail=$((fail + 1))
      sleep 3
    fi
    if [[ "${flow}" != "kaizen-recover-session" ]]; then
      run_maestro_test "${MAESTRO_ENV[@]}" "${FLOW_DIR}/kaizen-recover-session.yaml" --device "${UDID}" >>"${log}" 2>&1 || true
    fi
    sleep 2
  done
  echo "Suite complete: ${pass} pass / ${fail} fail (log: ${log})"
  return $(( fail > 0 ? 1 : 0 ))
}

run_maestro_batch() {
  local label="$1"
  shift
  local extra_args=("$@")
  echo ""
  echo "==================================================================="
  echo "==> ${label}"
  echo "==================================================================="
  if run_maestro_test "${MAESTRO_ENV[@]}" "${extra_args[@]}" "${FLOW_DIR}" --config "${CONFIG}" --device "${UDID}"; then
    return 0
  fi
  return 1
}

FAIL=0

if [[ -n "${E2E_ONLY:-}" ]]; then
  IFS=',' read -ra wanted <<< "${E2E_ONLY}"
  if [[ "${E2E_KAIZEN_SERIAL:-1}" == "1" ]]; then
    if ! run_serial_flows "${wanted[@]}"; then
      FAIL=1
    fi
  else
    flow_paths=()
    for base in "${wanted[@]}"; do
      flow="${FLOW_DIR}/${base}.yaml"
      if [[ ! -f "${flow}" ]]; then
        echo "Missing flow: ${flow}"
        FAIL=1
        continue
      fi
      flow_paths+=("${flow}")
    done
    if (( ${#flow_paths[@]} > 0 )); then
      if ! run_maestro_test "${MAESTRO_ENV[@]}" "${flow_paths[@]}" --device "${UDID}"; then
        echo "!! FAILED: ${E2E_ONLY}"
        FAIL=1
      fi
    fi
  fi
else
  PRIME_FLOW="${FLOW_DIR}/subflows/kaizen-prime-session.yaml"
  if [[ -f "${PRIME_FLOW}" && "${E2E_SKIP_PRIME:-0}" != "1" ]]; then
    echo ""
    echo "==================================================================="
    echo "==> Prime Kaizen session"
    echo "==================================================================="
    if ! run_maestro_test "${MAESTRO_ENV[@]}" "${PRIME_FLOW}" --device "${UDID}"; then
      echo "WARNING: session prime failed — continuing with main pass"
    fi
  fi
  if [[ "${E2E_KAIZEN_SERIAL:-1}" == "1" ]]; then
    FLOWS=()
    while IFS= read -r _flow; do
      [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
    done < <(read_config_flows)
    if ! run_serial_flows "${FLOWS[@]}"; then
      FAIL=1
    fi
  else
    if ! run_maestro_batch "Kaizen flows (batch session)" --exclude-tags destructive; then
      FAIL=1
    fi
  fi
  if [[ "${E2E_INCLUDE_DESTRUCTIVE:-0}" == "1" ]]; then
    if ! run_maestro_batch "Kaizen destructive auth/biometric flows" --include-tags destructive; then
      FAIL=1
    fi
  fi
fi

if (( FAIL != 0 )); then
  echo ""
  echo "Kaizen suite finished with failures."
  exit 1
fi

echo ""
echo "All Kaizen Maestro flows passed."
