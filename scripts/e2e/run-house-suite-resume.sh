#!/usr/bin/env bash
# Resume House Maestro suite from a feature directory (skips auth/onboarding by default).
# Appends to the suite log so generate-results-from-logs.py can score the full run.
#
# Usage:
#   scripts/e2e/run-house-suite-resume.sh              # from home/
#   scripts/e2e/run-house-suite-resume.sh tasks        # from tasks/
#   LOG=/tmp/maestro-house-2026-07-18.log scripts/e2e/run-house-suite-resume.sh
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "${HOME}/.maestro/tests" "${HOME}/Library/Logs/maestro"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
LOG="${LOG:-/tmp/maestro-house-2026-07-18.log}"
START_DIR="${1:-home}"

# One list, from the registry — see maestro_house_flow_dirs().
HOUSE_FLOW_DIR_NAMES=()
while IFS= read -r _house_flow_dir; do
  [[ -n "$_house_flow_dir" ]] && HOUSE_FLOW_DIR_NAMES+=("$_house_flow_dir")
done < <(maestro_house_flow_dirs)

found=0
FLOW_PATHS=()
for name in "${HOUSE_FLOW_DIR_NAMES[@]}"; do
  if [[ "${found}" -eq 1 || "${name}" == "${START_DIR}" ]]; then
    found=1
    FLOW_PATHS+=("${ROOT}/e2e/maestro/${name}")
  fi
done

if [[ ${#FLOW_PATHS[@]} -eq 0 ]]; then
  echo "Unknown start directory: ${START_DIR}"
  exit 1
fi

echo "" >> "${LOG}"
echo "=== RESUME from ${START_DIR} at $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> "${LOG}"

export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-240000}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

DEVICE_NAME="${E2E_DEVICE:-House-A}"
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"
[[ -n "${UDID}" ]] || { echo "No simulator: ${DEVICE_NAME}"; exit 1; }

MAESTRO_ENV=()
[[ -n "${E2E_EMAIL:-}" ]] && MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
[[ -n "${E2E_PASSWORD:-}" ]] && MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplehouse://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
fi
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplehouse" -e "APP_ID=com.symply.house")
HOUSE_METRO_PORT="${HOUSE_METRO_PORT:-8083}"
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplehouse://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${HOUSE_METRO_PORT}")

HOUSE_CONFIG="${ROOT}/e2e/maestro/house/config.yaml"
CONFIG_ARGS=()
[[ -f "${HOUSE_CONFIG}" ]] && CONFIG_ARGS=(--config="${HOUSE_CONFIG}")

echo "Resuming House suite from ${START_DIR} on ${DEVICE_NAME} (${UDID})"
maestro test \
  "${MAESTRO_ENV[@]}" \
  "${CONFIG_ARGS[@]}" \
  "${FLOW_PATHS[@]}" \
  --device "${UDID}" \
  2>&1 | tee -a "${LOG}"

echo "EXIT_CODE=$?" >> "${LOG}"
