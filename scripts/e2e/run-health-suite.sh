#!/usr/bin/env bash
#
# Symply Health (brand `symply-health`) Maestro E2E runner.
#
# Runs the modular flows under e2e/maestro/health against a booted iOS simulator,
# on BOTH iPhone and iPad classes. The Health brand ships bundle id
# `com.symply.health`.
#
# Prereqs:
#   1. Maestro installed:  curl -fsSL https://get.maestro.mobile.dev | bash
#   2. Health Metro on :8085:  npm run start:health -- --port 8085
#      To get a visual + backend HTML report afterward (screenshots + every
#      API call each step triggered), start Metro through the logging wrapper
#      instead:  ./scripts/e2e/start-metro-logged.sh health --port 8085
#      then after the run:  ./scripts/e2e/e2e-report.sh --brand health
#   3. Health brand built + installed (com.symply.health) with Debug-health config:
#        npm run prepare:xcode:health
#        cd ios && xcodebuild -workspace SymplyEcosystem.xcworkspace \
#          -scheme SymplyHealth-Staging -configuration Debug-health \
#          -destination 'platform=iOS Simulator,name=Health-A' build
#        xcrun simctl install booted …/Debug-health-iphonesimulator/SymplyEcosystem.app
#      AppDelegate pins com.symply.health → localhost:8085 (parallel fleet Metros).
#   4. e2e/credentials.local with E2E_EMAIL / E2E_PASSWORD (fleet seed via
#      node scripts/e2e/seed-fleet-test-users.mjs --pair staging).
#
# Usage:
#   ./scripts/e2e/run-health-suite.sh                                   # whole suite
#   E2E_DEVICE=Health-iPad ./scripts/e2e/run-health-suite.sh
#   ./scripts/e2e/run-health-suite.sh e2e/maestro/health/login-screen-controls.yaml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "health"
# shellcheck source=scripts/e2e/maestro-dedicated-sim.sh
source "$(dirname "$0")/maestro-dedicated-sim.sh"
maestro_prepare_dedicated_sim health
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
# Prune script deletes ~/.maestro/tests mid-run when parallel suites compete; disable during this runner.
export E2E_MAESTRO_CLEANUP="${E2E_MAESTRO_CLEANUP:-0}"

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

DEVICE_NAME="${E2E_DEVICE:-Health-A}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard "${DEVICE_NAME}"
HEALTH_METRO_PORT="${HEALTH_METRO_PORT:-8085}"

find_udid() {
  xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
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

if ! curl -sf "http://localhost:${HEALTH_METRO_PORT}/status" >/dev/null; then
  echo "Metro is not running on :${HEALTH_METRO_PORT}. Start it first:"
  echo "  npm run start:health -- --port ${HEALTH_METRO_PORT}"
  exit 1
fi

if ! xcrun simctl get_app_container "${UDID}" com.symply.health >/dev/null 2>&1; then
  echo "com.symply.health is not installed on ${DEVICE_NAME}."
  echo "Build Debug-health, then: xcrun simctl install ${UDID} …/SymplyEcosystem.app"
  exit 1
fi

# NOTE: do NOT POST /reload here. It swaps the JS runtime of an already-running app,
# which re-runs Expo module registration in the same process. Flows cold-launch the app
# themselves (subflows/launch-health.yaml), so a reload buys nothing and only adds a
# runtime swap — the exact condition that used to crash the app.
sleep 1

echo "Running Symply Health Maestro E2E on ${DEVICE_NAME} (${UDID})"

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplehealth://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
else
  echo "WARNING: E2E_EMAIL / E2E_PASSWORD unset — login subflows will fail."
fi
MAESTRO_ENV+=(-e "APP_ID=com.symply.health")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplehealth")
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplehealth://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${HEALTH_METRO_PORT}")

CONFIG="${ROOT}/e2e/maestro/health/config.yaml"
MAESTRO_ARGS=(
  --config "${CONFIG}"
  --device "${UDID}"
  --format NOOP
)
if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
  MAESTRO_ARGS+=(--no-reinstall-driver)
fi

TARGET="${1:-${ROOT}/e2e/maestro/health}"
EXTRA_ARGS=()
if (( $# > 1 )); then
  EXTRA_ARGS=("${@:2}")
fi

if (( ${#EXTRA_ARGS[@]} > 0 )); then
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}" "${EXTRA_ARGS[@]}"
else
  if ! xcrun simctl list devices booted | grep -qF "${UDID}"; then
    xcrun simctl boot "${UDID}" 2>/dev/null || true
    xcrun simctl bootstatus "${UDID}" -b 2>/dev/null || sleep 8
  fi
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}"
fi
