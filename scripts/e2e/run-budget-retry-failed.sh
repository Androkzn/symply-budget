#!/usr/bin/env bash
# Re-run failed Budget Maestro flows from a prior suite log (continues on failure).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${1:-/tmp/maestro-budget-full-2026-07-18.log}"
OUT="${2:-/tmp/maestro-budget-retry-$(date +%Y-%m-%d).log}"

if [[ ! -f "${LOG}" ]]; then
  echo "Log not found: ${LOG}"
  exit 1
fi

FLOWS=()
while IFS= read -r _flow; do
  [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
done < <(grep '\[Failed\]' "${LOG}" | sed 's/.*\[Failed\] //;s/ (.*//')
if ((${#FLOWS[@]} == 0)); then
  echo "No failed flows in ${LOG}"
  exit 0
fi

echo "Retrying ${#FLOWS[@]} failed flow(s) from ${LOG} → ${OUT}"
: > "${OUT}"

pass=0
fail=0
for flow in "${FLOWS[@]}"; do
  echo "=== RETRY ${flow} ===" | tee -a "${OUT}"
  bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/budget-prime-session.yaml" >>"${OUT}" 2>&1 || true
  if bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${ROOT}/e2e/maestro/budget/${flow}.yaml" >>"${OUT}" 2>&1; then
    echo "[Passed] ${flow} (retry)" | tee -a "${OUT}"
    pass=$((pass + 1))
  else
    echo "[Failed] ${flow} (retry)" | tee -a "${OUT}"
    fail=$((fail + 1))
  fi
  sleep 3
done

echo "Retry complete: ${pass} pass / ${fail} fail" | tee -a "${OUT}"
exit $(( fail > 0 ? 1 : 0 ))
