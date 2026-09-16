#!/usr/bin/env bash
# Maestro UI tests for Face ID / Touch ID remember-last-login on Symply Kaizen.
# Default target: Kaizen-A + com.symply.kaizen (not House).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"

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
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"

if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true
open -a Simulator --args -CurrentDeviceUDID "${UDID}" 2>/dev/null || true

# Prefer Kaizen; never leave House in the foreground for these flows.
xcrun simctl terminate "${UDID}" com.symply.house 2>/dev/null || true

if ! xcrun simctl get_app_container "${UDID}" com.symply.kaizen >/dev/null 2>&1; then
  echo "com.symply.kaizen is not installed on ${DEVICE_NAME}."
  echo "Build it first: npm run prepare:xcode:kaizen && APP_BRAND=symply-kaizen npm run ios -- --device \"${DEVICE_NAME}\""
  exit 1
fi

enroll_faceid() {
  echo "Enrolling Face ID on ${DEVICE_NAME} (${UDID}) for Symply Kaizen..."
  xcrun simctl spawn "${UDID}" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
  xcrun simctl spawn "${UDID}" notifyutil -p com.apple.BiometricKit.enrollmentChanged
  # Maestro clearState resets faceid=unset — re-enroll after that via match loop is not enough.
  /Users/andreitekhtelev/.maestro/deps/applesimutils \
    --byId "${UDID}" \
    --bundle com.symply.kaizen \
    --setPermissions "faceid=YES" 2>/dev/null || true
}
enroll_faceid

MATCH_PID=""
cleanup() {
  if [[ -n "${MATCH_PID}" ]] && kill -0 "${MATCH_PID}" 2>/dev/null; then
    kill "${MATCH_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

(
  while true; do
    xcrun simctl spawn "${UDID}" notifyutil -p com.apple.BiometricKit_Sim.pearl.match 2>/dev/null || true
    xcrun simctl spawn "${UDID}" notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match 2>/dev/null || true
    sleep 0.75
  done
) &
MATCH_PID=$!
echo "Face ID match loop pid=${MATCH_PID}"

if ! curl -sf http://localhost:8081/status >/dev/null; then
  echo "Metro is not running on :8081. Start it first: npm run start:kaizen"
  exit 1
fi

MAESTRO_ENV=()
MAESTRO_ENV+=(-e "APP_ID=com.symply.kaizen")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=kaizen")
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('kaizen://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
fi
MAESTRO_ENV+=(-e "E2E_SETUP_URL=kaizen://e2e-setup")

# Default: login chrome → settings Face ID row → remember-last-login (full path).
if [[ "${1:-}" == "" || "${1:-}" == "--" ]]; then
  TARGETS=(
    "${ROOT}/e2e/maestro/kaizen/login-screen-controls.yaml"
    "${ROOT}/e2e/maestro/kaizen/biometric-settings-row.yaml"
    "${ROOT}/e2e/maestro/kaizen/biometric-remember-last-login.yaml"
  )
  echo "Running Kaizen biometric Maestro suite (${#TARGETS[@]} flows)"
  for target in "${TARGETS[@]}"; do
    enroll_faceid
    echo "→ ${target}"
    maestro test "${MAESTRO_ENV[@]}" "${target}" --device "${UDID}"
  done
else
  TARGET="${1}"
  echo "Running Kaizen biometric Maestro UI tests: ${TARGET}"
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" --device "${UDID}" "${@:2}"
fi
