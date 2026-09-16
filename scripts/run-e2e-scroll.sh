#!/usr/bin/env bash
# Run Maestro scroll-contract E2E (House + Budget + Kaizen).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.maestro/bin:${PATH}"

BRAND="${E2E_SCROLL_BRAND:-house}"

case "${BRAND}" in
  house)
    exec "${ROOT}/scripts/run-e2e.sh" "${ROOT}/e2e/maestro/scroll/all-screens-scroll.yaml" "$@"
    ;;
  budget)
    exec "${ROOT}/scripts/run-e2e.sh" "${ROOT}/e2e/maestro/scroll/budget-scroll.yaml" "$@"
    ;;
  kaizen)
    exec "${ROOT}/scripts/run-e2e-kaizen.sh" "${ROOT}/e2e/maestro/kaizen/scroll-all-screens.yaml" "$@"
    ;;
  all)
    "${ROOT}/scripts/run-e2e.sh" "${ROOT}/e2e/maestro/scroll/all-screens-scroll.yaml" "$@"
    "${ROOT}/scripts/run-e2e.sh" "${ROOT}/e2e/maestro/scroll/budget-scroll.yaml" "$@"
    "${ROOT}/scripts/run-e2e-kaizen.sh" "${ROOT}/e2e/maestro/kaizen/scroll-all-screens.yaml" "$@"
    ;;
  *)
    echo "Unknown E2E_SCROLL_BRAND=${BRAND} (house|budget|kaizen|all)"
    exit 1
    ;;
esac
