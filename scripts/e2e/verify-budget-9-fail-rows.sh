#!/usr/bin/env bash
# Parallel verify: 9 scored Fail rows → 2 Maestro flows (wishes ×3 rows, chat-extended ×6 rows).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${LOG_DIR:-${ROOT}/.tmp/e2e-logs/matrix-budget-$(date +%Y-%m-%d)}"
mkdir -p "${LOG_DIR}"

eval "$("${ROOT}/scripts/secrets/export-env.sh")"

export E2E_PARALLEL_FLEET=1
export E2E_DEDICATED_SIM=0
export E2E_MAESTRO_LOCK=0
export E2E_MAESTRO_KILL_UDID_ONLY=1
export E2E_SEED_FIXTURES=1

VERIFY_LOG="${LOG_DIR}/verify-9-rows-$(date +%H%M%S).log"
echo "=== verify 9 fail rows $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee "${VERIFY_LOG}"

curl -sf -X POST http://127.0.0.1:8082/reload >/dev/null || true

# Cross-sim verify: run flows sequentially per device to avoid Maestro driver kills.
run_lane() {
  local device="$1"
  local flow="$2"
  local lane_log="${LOG_DIR}/verify-9-${device}-${flow}.log"
  echo "LANE_START ${device} ${flow} $(date -u +%H:%M:%S)" | tee -a "${VERIFY_LOG}"
  E2E_DEVICE="${device}" E2E_BUDGET_SINGLE=1 E2E_MAESTRO_KILL_RUNNERS=0 E2E_MAESTRO_LOCK=0 \
    bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" \
    >"${lane_log}" 2>&1
  local ec=$?
  if grep -q '^\[Passed\]' "${lane_log}" 2>/dev/null; then
    echo "LANE_PASS ${device} ${flow}" | tee -a "${VERIFY_LOG}"
  else
    echo "LANE_FAIL ${device} ${flow} exit=${ec}" | tee -a "${VERIFY_LOG}"
    grep -E '^\[Failed\]|Assertion|Element not found' "${lane_log}" | tail -5 | tee -a "${VERIFY_LOG}" || true
  fi
  return "${ec}"
}

fail=0
# Parallel across devices (one flow per sim — no same-UDID contention).
run_lane Budget-A budget-wishes & pid1=$!
run_lane Budget-iPad budget-chat-extended & pid2=$!
wait "${pid1}" || fail=1
wait "${pid2}" || fail=1
# Cross-check on worker sims.
run_lane Budget-Worker-3 budget-wishes & pid3=$!
run_lane Budget-Worker-2 budget-chat-extended & pid4=$!
wait "${pid3}" || fail=1
wait "${pid4}" || fail=1

echo "=== verify complete fail=${fail} $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${VERIFY_LOG}"

if (( fail == 0 )); then
  echo "ALL_NINE_ROWS_VERIFIED" | tee -a "${VERIFY_LOG}"
  exit 0
fi
echo "VERIFY_INCOMPLETE" | tee -a "${VERIFY_LOG}"
exit 1
