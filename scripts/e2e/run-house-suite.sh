#!/usr/bin/env bash
# Full Symply House / shared-surface Maestro suite (appId: com.symply.house).
# Runs every House feature directory, including the new coverage authored for the
# onboarding funnel, reports upload, profile/task mutations, contractor↔quote workflow,
# notifications, AI-housekeeper (Mira) chat + deep screens, household/space lifecycle,
# garden/floor-plan entry, and utilities bills/charts.
#
# Usage:
#   scripts/e2e/run-house-suite.sh                 # run the whole House suite
#   scripts/e2e/run-house-suite.sh <path> [args]   # run one flow/dir (e.g. e2e/maestro/mira)
#   E2E_DEVICE="iPhone 15 Pro" scripts/e2e/run-house-suite.sh
#
# Requires: e2e/credentials.local (E2E_EMAIL / E2E_PASSWORD) for logged-in flows.
# NOTE: e2e/maestro/onboarding/* require a FRESH, un-onboarded account — the shared test
# account is already onboarded, so those flows land on Home instead. They are included for
# completeness but will not go green with the shared account (see each flow's header).
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "${HOME}/.maestro/tests" "${HOME}/Library/Logs/maestro" /tmp/maestro-house-debug
# Maestro writes command traces under ~/.maestro/tests; ensure parent exists (disk prune can remove mid-run dirs).
mkdir -p "${HOME}/.maestro/tests/$(date +%Y-%m-%d_%H%M%S)" 2>/dev/null || true
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "house"
# shellcheck source=scripts/e2e/maestro-dedicated-sim.sh
source "$(dirname "$0")/maestro-dedicated-sim.sh"
maestro_prepare_dedicated_sim house
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"
MAESTRO_DEBUG_ARGS=()
if [[ "${MAESTRO_DEBUG:-0}" == "1" ]]; then
  DEBUG_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-house-debug}"
  mkdir -p "${DEBUG_DIR}"
  MAESTRO_DEBUG_ARGS=(--flatten-debug-output --debug-output="${DEBUG_DIR}")
fi

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

DEVICE_NAME="${E2E_DEVICE:-House-A}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard "${DEVICE_NAME}"

find_udid() {
  xcrun simctl list devices available | grep "${1}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

UDID="${MAESTRO_DEDICATED_UDID:-$(find_udid "${DEVICE_NAME}")}"

if [[ -z "${UDID}" ]]; then
  DEVICE_TYPE="$(xcrun simctl list devicetypes | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro[^ ]*' | head -1 || true)"
  if [[ -z "${DEVICE_TYPE}" ]]; then
    DEVICE_TYPE="$(xcrun simctl list devicetypes | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-[^ ]*' | head -1 || true)"
  fi
  RUNTIME="$(xcrun simctl list runtimes | grep -Eo 'com.apple.CoreSimulator.SimRuntime.iOS[^ ]*' | tail -1 || true)"
  if [[ -n "${DEVICE_TYPE}" && -n "${RUNTIME}" ]]; then
    echo "Creating ${DEVICE_NAME} (${DEVICE_TYPE})"
    xcrun simctl create "${DEVICE_NAME}" "${DEVICE_TYPE}" "${RUNTIME}" >/dev/null || true
    UDID="$(find_udid "${DEVICE_NAME}")"
  fi
fi

if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found (set E2E_DEVICE)."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true
xcrun simctl bootstatus "${UDID}" -b 2>/dev/null || sleep 5
if xcrun simctl list devices 2>/dev/null | grep "${UDID}" | grep -Eq 'Shutting Down|Shutdown'; then
  xcrun simctl shutdown "${UDID}" 2>/dev/null || true
  sleep 2
  xcrun simctl boot "${UDID}"
  xcrun simctl bootstatus "${UDID}" -b 2>/dev/null || sleep 8
fi

# Face ID for biometric auth flows (House bundle).
if [[ "${E2E_ENROLL_BIOMETRIC:-1}" == "1" ]]; then
  xcrun simctl spawn "${UDID}" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 2>/dev/null || true
  xcrun simctl spawn "${UDID}" notifyutil -p com.apple.BiometricKit.enrollmentChanged 2>/dev/null || true
  /Users/andreitekhtelev/.maestro/deps/applesimutils \
    --byId "${UDID}" \
    --bundle com.symply.house \
    --setPermissions "faceid=YES, microphone=YES" 2>/dev/null || true
fi

HOUSE_METRO_PORT="${HOUSE_METRO_PORT:-8083}"
if ! curl -sf "http://localhost:${HOUSE_METRO_PORT}/status" >/dev/null; then
  echo "Metro is not running on :${HOUSE_METRO_PORT}. Start it first:"
  echo "  APP_BRAND=symply-house EXPO_PUBLIC_APP_BRAND=symply-house npx expo start --port ${HOUSE_METRO_PORT}"
  exit 1
fi

if ! xcrun simctl get_app_container "${UDID}" com.symply.house >/dev/null 2>&1; then
  echo "com.symply.house is not installed on ${DEVICE_NAME}."
  echo "Build it first: npm run prepare:xcode:house && APP_BRAND=symply-house npm run ios -- --device \"${DEVICE_NAME}\""
  exit 1
fi

# Warm-launch once so simctl openurl / Maestro openLink does not fail with LS error 115.
xcrun simctl launch "${UDID}" com.symply.house >/dev/null 2>&1 || true
sleep 3
HOUSE_DEVCLIENT_URL="simplehouse://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${HOUSE_METRO_PORT}"
xcrun simctl openurl "${UDID}" "${HOUSE_DEVCLIENT_URL}" >/dev/null 2>&1 || true
sleep 3
xcrun simctl openurl "${UDID}" "simplehouse://" >/dev/null 2>&1 || true
sleep 2

# Seed real House test documents (inspection report / bills / floor plan).
if [[ "${E2E_SEED_FIXTURES:-1}" == "1" ]]; then
  bash "$(cd "$(dirname "$0")" && pwd)/seed-fixtures.sh" "${UDID}" house || true
fi

echo "Running Symply House Maestro suite on ${DEVICE_NAME} (${UDID})"

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" ]]; then
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
fi
if [[ -n "${E2E_PASSWORD:-}" ]]; then
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
fi
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplehouse://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
fi
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplehouse")
MAESTRO_ENV+=(-e "APP_ID=com.symply.house")
HOUSE_METRO_PORT="${HOUSE_METRO_PORT:-8083}"
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplehouse://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${HOUSE_METRO_PORT}")

TARGET="${1:-}"
HOUSE_CONFIG="${ROOT}/e2e/maestro/house/config.yaml"
# house/config.yaml lists sibling globs; flows live in feature dirs (not under house/).
# `house-v2` carries the local-first surface (device sync, enrolment, Backup &
# Restore). It was absent from this list, so every `lf-*` flow on disk — 18 of
# them — was invisible coverage: written, linked from the matrix, and never run
# by the suite. That is the same defect `budgetSuiteCompleteness.test.ts` exists
# to catch on the Budget side.
#
# The cost to accept: the backup flows seal real archives, and Argon2id is
# deliberately slow — budget ~1–3 min each on a loaded simulator. Run the suite
# with a `feature:local-first` exclusion if that is too much for a given run.
# One list, from the registry — see maestro_house_flow_dirs().
HOUSE_FLOW_DIR_NAMES=()
while IFS= read -r _house_flow_dir; do
  [[ -n "$_house_flow_dir" ]] && HOUSE_FLOW_DIR_NAMES+=("$_house_flow_dir")
done < <(maestro_house_flow_dirs)

# Reinstalling the XCUITest driver is what every OTHER fleet runner opts out of
# (budget/health/language/kaizen all gate the same flag on MAESTRO_REINSTALL_DRIVER).
# House was the lone runner still reinstalling it on every invocation, and in a
# parallel fleet run that tears the driver out from under the run using it:
# observed 2026-08-25 as `Device became unreachable while processing viewHierarchy`
# → `Connection refused` on the driver port, with all 4 flows failing in 0–14s.
# Opt out by default, same as the siblings; set MAESTRO_REINSTALL_DRIVER=1 to force
# a reinstall when the driver itself is actually stale.
MAESTRO_DRIVER_ARGS=()
if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
  MAESTRO_DRIVER_ARGS+=(--no-reinstall-driver)
fi

if [[ -z "${TARGET}" ]]; then
  if [[ "${E2E_HOUSE_SERIAL:-1}" == "1" ]]; then
    # E2E_SIM_GUARD=0 for the whole sequential run — the guard has ALREADY run
    # once above, and the sequential runner re-invokes this script once per flow
    # (~140 times). Leaving it on means ~140 `du` sweeps and, far worse, an erase
    # the moment the device crosses the cap MID-SUITE: that wipes com.symply.house
    # and every remaining flow dies with "not installed". Measured 2026-08-13 —
    # 131 of 134 failures in one run came from exactly that, at
    # `[sim-guard] House-A is 3018 MB (cap 3000 MB) — erasing`.
    #
    # The guard is a BEFORE-a-suite tool, not a before-every-flow tool. Bounding
    # disk between flows is not worth destroying the run that is using the disk.
    exec env E2E_SEED_FIXTURES="${E2E_SEED_FIXTURES:-1}" MAESTRO_DEBUG="${MAESTRO_DEBUG:-0}" \
      E2E_SIM_GUARD=0 \
      bash "$(dirname "$0")/run-house-suite-sequential.sh" auth "${@:2}"
  fi
  FLOW_PATHS=()
  for name in "${HOUSE_FLOW_DIR_NAMES[@]}"; do
    FLOW_PATHS+=("${ROOT}/e2e/maestro/${name}")
  done
  CONFIG_ARGS=()
  if [[ -f "${HOUSE_CONFIG}" ]]; then
    CONFIG_ARGS=(--config="${HOUSE_CONFIG}")
  fi
  E2E_MAESTRO_CLEANUP=0 maestro test \
    ${MAESTRO_DEBUG_ARGS[@]+"${MAESTRO_DEBUG_ARGS[@]}"} \
    "${MAESTRO_ENV[@]}" \
    "${CONFIG_ARGS[@]}" \
    "${FLOW_PATHS[@]}" \
    --device "${UDID}" \
    ${MAESTRO_DRIVER_ARGS[@]+"${MAESTRO_DRIVER_ARGS[@]}"} \
    "${@:2}"
else
  E2E_MAESTRO_CLEANUP=0 maestro test ${MAESTRO_DEBUG_ARGS[@]+"${MAESTRO_DEBUG_ARGS[@]}"} "${MAESTRO_ENV[@]}" "${TARGET}" --device "${UDID}" ${MAESTRO_DRIVER_ARGS[@]+"${MAESTRO_DRIVER_ARGS[@]}"} "${@:2}"
fi
bash "$(dirname "$0")/prune-maestro-disk.sh" >/dev/null 2>&1 || true
