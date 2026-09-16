#!/usr/bin/env bash
# Re-run failed House Maestro flows from a prior suite log (continues on failure).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${1:-/tmp/maestro-house-2026-07-18.log}"
OUT="${2:-/tmp/maestro-house-retry-$(date +%Y-%m-%d).log}"

if [[ ! -f "${LOG}" ]]; then
  echo "Log not found: ${LOG}"
  exit 1
fi

find_flow() {
  local name="$1"
  local hit
  hit="$(find "${ROOT}/e2e/maestro" -name "${name}.yaml" -print -quit 2>/dev/null || true)"
  if [[ -n "${hit}" ]]; then
    printf '%s\n' "${hit}"
  fi
}

FLOWS=()
while IFS= read -r _flow; do
  [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
done < <(grep '\[Failed\]' "${LOG}" | sed 's/.*\[Failed\] //;s/ (.*//;s/ (finalize-log infra)//' | sort -u)
if ((${#FLOWS[@]} == 0)); then
  echo "No failed flows in ${LOG}"
  exit 0
fi

echo "Retrying ${#FLOWS[@]} failed flow(s) from ${LOG} → ${OUT}"
: > "${OUT}"

pass=0
fail=0
for flow in "${FLOWS[@]}"; do
  path="$(find_flow "${flow}")"
  if [[ -z "${path}" ]]; then
    echo "[Skip] ${flow} — yaml not found" | tee -a "${OUT}"
    continue
  fi
  echo "=== RETRY ${flow} ===" | tee -a "${OUT}"
  E2E_SEED_FIXTURES=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" \
    "${ROOT}/e2e/maestro/smoke/house-prime-session.yaml" >>"${OUT}" 2>&1 || true
  if E2E_SEED_FIXTURES=0 bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${path}" >>"${OUT}" 2>&1; then
    echo "[Passed] ${flow} (retry)" | tee -a "${OUT}"
    pass=$((pass + 1))
  else
    echo "[Failed] ${flow} (retry)" | tee -a "${OUT}"
    fail=$((fail + 1))
  fi
  sleep 2
done

echo "Retry complete: ${pass} pass / ${fail} fail" | tee -a "${OUT}"
python3 "${ROOT}/scripts/e2e/generate-results-from-logs.py" 2026-07-18 staging "House-A, iOS 26" house \
  >>"${OUT}" 2>&1 || true
exit $(( fail > 0 ? 1 : 0 ))
