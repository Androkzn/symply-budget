#!/usr/bin/env bash
# Serial fix-verify loop for Budget's 9 scored Fail rows (2 flows).
# One Maestro job at a time — no parallel verify contention.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${LOG_DIR:-${ROOT}/.tmp/e2e-logs/matrix-budget-$(date +%Y-%m-%d)}"
mkdir -p "${LOG_DIR}"
PROGRESS="${LOG_DIR}/serial-fix-progress.md"

eval "$("${ROOT}/scripts/secrets/export-env.sh")"
export E2E_PARALLEL_FLEET=1 E2E_DEDICATED_SIM=0 E2E_MAESTRO_LOCK=0 E2E_MAESTRO_KILL_UDID_ONLY=1 E2E_SEED_FIXTURES=1

FLOWS=(
  "Budget-iPad:budget-chat-extended"
  "Budget-A:budget-wishes"
)

log() { echo "$*" | tee -a "${LOG_DIR}/serial-fix.log"; }

pause_parallel_matrix() {
  pkill -f 'run-budget-parallel-matrix\.sh' 2>/dev/null || true
  sleep 2
  "${ROOT}/scripts/e2e/maestro-scoped-kill.sh" budget >/dev/null 2>&1 || true
}

run_one() {
  local device="$1" flow="$2"
  local slug="${flow%.yaml}"
  local lane_log="${LOG_DIR}/serial-${device}-${slug}-$(date +%H%M%S).log"
  log "SERIAL_START ${device} ${flow} $(date -u +%H:%M:%SZ)"
  pause_parallel_matrix
  curl -sf -X POST http://127.0.0.1:8082/reload >/dev/null || true
  E2E_DEVICE="${device}" E2E_BUDGET_SINGLE=1 E2E_MAESTRO_KILL_RUNNERS=0 \
    bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" \
    >"${lane_log}" 2>&1
  local ec=$?
  if grep -q '^\[Passed\]' "${lane_log}" 2>/dev/null; then
    log "SERIAL_PASS ${device} ${flow}"
    echo "| ${flow} | ${device} | **GREEN** | $(date -u +%H:%M:%SZ) |" >>"${PROGRESS}"
    return 0
  fi
  log "SERIAL_FAIL ${device} ${flow} exit=${ec}"
  grep -E '^\[Failed\]|Parsing Failed|Assertion|Element not found' "${lane_log}" | tail -8 | tee -a "${LOG_DIR}/serial-fix.log" || true
  echo "| ${flow} | ${device} | **FAIL** | $(date -u +%H:%M:%SZ) |" >>"${PROGRESS}"
  echo "log: ${lane_log}" >>"${PROGRESS}"
  return 1
}

{
  echo "# Serial scored-fail fix progress — $(date -u +%Y-%m-%d)"
  echo ""
  echo "| Flow | Device | Status | Time |"
  echo "|------|--------|--------|------|"
} >"${PROGRESS}"

log "SERIAL_PAUSE parallel matrix for exclusive verify"
pause_parallel_matrix

fail=0
for entry in "${FLOWS[@]}"; do
  device="${entry%%:*}"
  flow="${entry#*:}"
  run_one "${device}" "${flow}" || fail=1
done

if (( fail == 0 )); then
  log "SERIAL_ALL_GREEN"
  exit 0
fi
log "SERIAL_INCOMPLETE"
exit 1
