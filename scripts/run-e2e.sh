#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/e2e/setup-maestro-cleanup.sh"
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

DEVICE_NAME="${E2E_DEVICE:-Kaizen-iPad}"
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"

if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true

# Seed real test documents (Photos + Files) so upload flows can pick them.
if [[ "${E2E_SEED_FIXTURES:-1}" == "1" ]]; then
  bash "$(cd "$(dirname "$0")" && pwd)/e2e/seed-fixtures.sh" "${UDID}" "${E2E_SEED_APP:-house}" || true
fi

echo "Running Maestro E2E on ${DEVICE_NAME} (${UDID})"

APP_SCHEME="${E2E_APP_SCHEME:-simplehouse}"

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
    process.stdout.write(process.argv[3] + '://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}" "${APP_SCHEME}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
fi
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=${APP_SCHEME}")

TARGET="${1:-}"
if [[ -z "${TARGET}" ]]; then
  maestro test \
    "${MAESTRO_ENV[@]}" \
    "${ROOT}/e2e/maestro/home" \
    "${ROOT}/e2e/maestro/mira" \
    "${ROOT}/e2e/maestro/chat" \
    "${ROOT}/e2e/maestro/settings" \
    "${ROOT}/e2e/maestro/tasks" \
    "${ROOT}/e2e/maestro/budget" \
    "${ROOT}/e2e/maestro/reports" \
    "${ROOT}/e2e/maestro/contractors" \
    "${ROOT}/e2e/maestro/gardening" \
    "${ROOT}/e2e/maestro/notifications" \
    "${ROOT}/e2e/maestro/profile" \
    "${ROOT}/e2e/maestro/my-home" \
    "${ROOT}/e2e/maestro/utilities" \
    --device "${UDID}" \
    "${@:2}"
else
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" --device "${UDID}" "${@:2}"
fi
