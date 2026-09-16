#!/usr/bin/env bash
# Run failed + remaining Budget flows serially (append to run8 log).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${1:-/tmp/maestro-budget-full-2026-07-18-run8.log}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=240000

FLOWS=(
  budget-chat-message
  budget-dashboard-offline
  budget-household-switch
  budget-households
  budget-item-form
  budget-offline-sweep
  budget-pension
  budget-pension-interactions
  budget-pension-offline
  budget-plan-delete
  budget-receipt-scan
  budget-savings-goal
  budget-savings-import
  budget-savings-income-entry
  budget-savings-irregular-income
  budget-savings-month-stepper
  budget-savings-offline
  budget-savings-overview
  budget-savings-recurring
  budget-settings
  budget-settings-extended
  budget-settings-more
  budget-settings-offline
  budget-soft-transfer-export
  budget-soft-transfer-import
  budget-spend-mutations
  budget-spent-form
  budget-tabs
  budget-timeline-year-setup
  budget-transfer
  budget-wishes
  budget-wishes-extended
  check-spendings-layout
  budget-auth
)

pass=0
fail=0
for flow in "${FLOWS[@]}"; do
  echo "" | tee -a "${LOG}"
  echo "=== RETRY/CONT ${flow} ===" | tee -a "${LOG}"
  E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-recover-session.yaml" >>"${LOG}" 2>&1 || true
  if E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" >>"${LOG}" 2>&1; then
    echo "[Passed] ${flow} (retry)" | tee -a "${LOG}"
    pass=$((pass + 1))
  else
    echo "[Failed] ${flow} (retry)" | tee -a "${LOG}"
    fail=$((fail + 1))
  fi
  E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-recover-session.yaml" >>"${LOG}" 2>&1 || true
  sleep 2
done
echo "Retry/continue complete: ${pass} pass / ${fail} fail" | tee -a "${LOG}"
exit $(( fail > 0 ? 1 : 0 ))
