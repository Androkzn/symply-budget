#!/usr/bin/env bash
# Run full Budget serial suite; retry failed flows until all pass or max rounds.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${ROOT}/.tmp/e2e-logs"
mkdir -p "${LOG_DIR}"
RUN_DATE="$(date +%Y-%m-%d)"
RUN_ID="${MAESTRO_BUDGET_RUN_ID:-run13}"
LOG="${MAESTRO_BUDGET_LOG:-${LOG_DIR}/maestro-budget-full-${RUN_DATE}-${RUN_ID}.log}"
case "${LOG}" in
  /*) ;;
  *) LOG="${ROOT}/${LOG}" ;;
esac
RETRY_LOG="${LOG_DIR}/maestro-budget-retry-${RUN_DATE}.log"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000
export MAESTRO_BUDGET_LOG="${LOG}"
MAX_ROUNDS="${MAX_ROUNDS:-5}"

echo "=== Budget until-green started $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"

round=1
while (( round <= MAX_ROUNDS )); do
  echo "" | tee -a "${LOG}"
  echo "=== ROUND ${round}/${MAX_ROUNDS} full suite ===" | tee -a "${LOG}"
  export MAESTRO_BUDGET_TRUNCATE=$([[ "${round}" -eq 1 && ! -s "${LOG}" ]] && echo 1 || echo 0)
  if bash "${ROOT}/scripts/e2e/run-budget-suite.sh" >>"${LOG}" 2>&1; then
    echo "ALL GREEN after round ${round}" | tee -a "${LOG}"
    python3 "${ROOT}/scripts/e2e/generate-results-from-logs.py" "${RUN_DATE}" staging "Budget-A, iOS 26.5" budget
    exit 0
  fi

  FAILED=()
  while IFS= read -r _flow; do
    [[ -n "${_flow}" && "${_flow}" != "budget-prime-session" && "${_flow}" != "budget-recover-session" ]] && FAILED+=("${_flow}")
  done < <(grep '\[Failed\]' "${LOG}" | sed 's/.*\[Failed\] //;s/ (.*//' | sort -u)

  if ((${#FAILED[@]} == 0)); then
    echo "Suite failed but no [Failed] markers — check log" | tee -a "${LOG}"
    exit 1
  fi

  echo "Round ${round} failures (${#FAILED[@]}): ${FAILED[*]}" | tee -a "${LOG}"
  : > "${RETRY_LOG}"
  still_fail=()
  for flow in "${FAILED[@]}"; do
    echo "=== RETRY ${flow} (round ${round}) ===" | tee -a "${RETRY_LOG}"
    bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-prime-session.yaml" >>"${RETRY_LOG}" 2>&1 || true
    if bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" >>"${RETRY_LOG}" 2>&1; then
      echo "[Passed] ${flow} (retry round ${round})" | tee -a "${LOG}" "${RETRY_LOG}"
      sed -i '' "/\[Failed\] ${flow}$/d" "${LOG}" 2>/dev/null || sed -i "/\[Failed\] ${flow}$/d" "${LOG}" 2>/dev/null || true
    else
      echo "[Failed] ${flow} (retry round ${round})" | tee -a "${LOG}" "${RETRY_LOG}"
      still_fail+=("${flow}")
    fi
    bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-recover-session.yaml" >>"${RETRY_LOG}" 2>&1 || true
    sleep 2
  done

  if ((${#still_fail[@]} == 0)); then
    echo "All retries green — re-running full suite to confirm" | tee -a "${LOG}"
  fi
  round=$((round + 1))
done

echo "Max rounds (${MAX_ROUNDS}) reached — still failing" | tee -a "${LOG}"
grep '\[Failed\]' "${LOG}" | sort -u | tee -a "${LOG}"
exit 1
