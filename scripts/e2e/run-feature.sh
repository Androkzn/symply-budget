#!/usr/bin/env bash
# Run a tagged Maestro feature slice for one app.
#
# Usage:
#   scripts/e2e/run-feature.sh <app> <feature> [extra maestro args...]
#   npm run test:e2e:feature -- budget savings
#   npm run test:e2e:feature -- house tasks
#   npm run test:e2e:feature -- language learn
#
# Kaizen: deferred — use npm run test:e2e:kaizen:suite until Kaizen tagging lands.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"

APP="${1:-}"
FEATURE="${2:-}"
shift 2 || true

if [[ -z "${APP}" || -z "${FEATURE}" ]]; then
  echo "Usage: $0 <app> <feature> [maestro args...]"
  echo "  apps: house | budget | language | health"
  echo "  feature: savings | tasks | learn | home | st | … (Strategy §4.4.1)"
  exit 1
fi

if [[ "${APP}" == "kaizen" ]]; then
  echo "Kaizen feature slices are deferred while Kaizen is under active development."
  echo "Use: npm run test:e2e:kaizen:suite"
  exit 2
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

DEVICE_NAME="${E2E_DEVICE:-Kaizen-iPad}"
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"
if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found (set E2E_DEVICE)."
  exit 1
fi
xcrun simctl boot "${UDID}" 2>/dev/null || true

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" ]]; then
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
fi
if [[ -n "${E2E_PASSWORD:-}" ]]; then
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
fi

case "${APP}" in
  budget)
    CONFIG="${ROOT}/e2e/maestro/budget/config.yaml"
    TARGET="${ROOT}/e2e/maestro/budget"
    ;;
  house)
    CONFIG="${ROOT}/e2e/maestro/house/config.yaml"
    TARGET="${ROOT}/e2e/maestro/house"
    ;;
  language)
    CONFIG="${ROOT}/e2e/maestro/language/config.yaml"
    TARGET="${ROOT}/e2e/maestro/language"
    ;;
  health)
    CONFIG="${ROOT}/e2e/maestro/health/config.yaml"
    TARGET="${ROOT}/e2e/maestro/health"
    ;;
  *)
    echo "Unknown app: ${APP}"
    exit 1
    ;;
esac

if [[ "${FEATURE}" == slice:* ]]; then
  TAG="${FEATURE}"
elif [[ "${FEATURE}" == feature:* ]]; then
  TAG="${FEATURE}"
else
  TAG="feature:${FEATURE}"
fi

echo "Maestro feature slice: app=${APP} tag=${TAG} device=${DEVICE_NAME}"
maestro test \
  "${MAESTRO_ENV[@]}" \
  --config="${CONFIG}" \
  --include-tags="${TAG}" \
  "${TARGET}" \
  --device "${UDID}" \
  "$@"
