#!/usr/bin/env bash
# Retry all historically failed Budget flows after harness fixes.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/maestro-budget-fix-verify-$(date +%Y-%m-%d).log}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=240000

FLOWS=(
  budget-ai-screen
  budget-bills
  budget-categories
  budget-chat-assistant
  budget-chat-extended
  budget-chat-message
  budget-chat-rooms
  budget-dashboard-offline
  budget-household-switch
  budget-households
  budget-item-form
  budget-offline-sweep
  budget-savings-overview
  budget-settings
  budget-plan-delete
  budget-receipt-scan
)

: > "${OUT}"
pass=0
fail=0
failed=()

echo "Verifying ${#FLOWS[@]} previously failed Budget flows → ${OUT}"

for flow in "${FLOWS[@]}"; do
  echo "=== VERIFY ${flow} ===" | tee -a "${OUT}"
  bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-prime-session.yaml" >>"${OUT}" 2>&1 || true
  if bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" >>"${OUT}" 2>&1; then
    echo "[Passed] ${flow}" | tee -a "${OUT}"
    pass=$((pass + 1))
  else
    echo "[Failed] ${flow}" | tee -a "${OUT}"
    fail=$((fail + 1))
    failed+=("${flow}")
  fi
  bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-recover-session.yaml" >>"${OUT}" 2>&1 || true
  sleep 2
done

echo "Verify complete: ${pass} pass / ${fail} fail" | tee -a "${OUT}"
if ((${#failed[@]})); then
  echo "Still failing: ${failed[*]}" | tee -a "${OUT}"
fi
exit $(( fail > 0 ? 1 : 0 ))
