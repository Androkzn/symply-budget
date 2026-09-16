#!/usr/bin/env bash
# Platform shell Maestro suite (com.symply.house — shared auth/settings/notifications).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

DEVICE_NAME="${E2E_DEVICE:-Kaizen-A}"
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"
[[ -n "${UDID}" ]] || { echo "No simulator '${DEVICE_NAME}'"; exit 1; }
xcrun simctl boot "${UDID}" 2>/dev/null || true

MAESTRO_ENV=(-e "E2E_APP_SCHEME=simplehouse" -e "APP_ID=com.symply.house")
[[ -n "${E2E_EMAIL:-}" ]] && MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
[[ -n "${E2E_PASSWORD:-}" ]] && MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")

TARGET="${1:-${ROOT}/e2e/maestro/platform}"
maestro test "${MAESTRO_ENV[@]}" --config="${ROOT}/e2e/maestro/platform/config.yaml" "${TARGET}" --device "${UDID}" "${@:2}"
