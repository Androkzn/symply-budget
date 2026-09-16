#!/usr/bin/env bash
# Run House failed flows from RESULTS queue; prime session once, track pass/fail progress.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUEUE="${1:-${ROOT}/documents/engineering/testing/matrices/house-failed-queue.txt}"
PROGRESS="${2:-/tmp/house-fix-progress.log}"
LOG="${3:-/tmp/house-fix-queue-$(date +%Y-%m-%d).log}"

find_flow() {
  find "${ROOT}/e2e/maestro" -name "$1.yaml" -print -quit 2>/dev/null || true
}

if [[ ! -f "${QUEUE}" ]]; then
  echo "Queue file not found: ${QUEUE}"
  exit 1
fi

FLOWS=()
while IFS= read -r _line; do
  [[ -n "${_line}" ]] && FLOWS+=("${_line}")
done < <(grep -v '^#' "${QUEUE}" | grep -v '^[[:space:]]*$' || true)
total=${#FLOWS[@]}
if (( total == 0 )); then
  echo "Queue empty"
  exit 0
fi

: > "${LOG}"
echo "House fix queue: ${total} flow(s) → ${LOG}" | tee -a "${PROGRESS}"

echo "Priming session..." | tee -a "${LOG}" "${PROGRESS}"
E2E_SEED_FIXTURES=0 MAESTRO_DEBUG=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" \
  "${ROOT}/e2e/maestro/smoke/house-prime-session.yaml" >>"${LOG}" 2>&1 || true

pass=0
fail=0
left=${total}
for flow in "${FLOWS[@]}"; do
  path="$(find_flow "${flow}")"
  if [[ -z "${path}" ]]; then
    echo "[Skip] ${flow} — yaml not found" | tee -a "${LOG}" "${PROGRESS}"
    left=$((left - 1))
    continue
  fi
  echo "=== FIX-VERIFY ${flow} (${pass}/${total} done, ${left} left) ===" | tee -a "${LOG}" "${PROGRESS}"
  if E2E_SEED_FIXTURES=0 MAESTRO_DEBUG=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${path}" >>"${LOG}" 2>&1; then
    pass=$((pass + 1))
    left=$((left - 1))
    echo "[GREEN] ${flow} — ${pass}/${total} fixed, ${left} remaining" | tee -a "${LOG}" "${PROGRESS}"
  else
    fail=$((fail + 1))
    left=$((left - 1))
    echo "[RED] ${flow} — ${pass}/${total} fixed, ${left} remaining (${fail} still failing)" | tee -a "${LOG}" "${PROGRESS}"
  fi
  sleep 1
done

echo "QUEUE DONE: ${pass}/${total} green, ${fail} still red" | tee -a "${LOG}" "${PROGRESS}"
python3 "${ROOT}/scripts/e2e/generate-results-from-logs.py" 2026-07-18 staging "House-A, iOS 26" house \
  >>"${LOG}" 2>&1 || true
exit $(( fail > 0 ? 1 : 0 ))
