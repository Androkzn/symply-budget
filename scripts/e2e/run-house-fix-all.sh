#!/usr/bin/env bash
# Process house-failed-queue.txt one flow at a time with verify + progress logging.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUEUE="${ROOT}/documents/engineering/testing/matrices/house-failed-queue.txt"
PROGRESS="/tmp/house-fix-progress.log"
FIXED_LIST="/tmp/house-fix-fixed.txt"
LOG="/tmp/house-fix-all-$(date +%Y-%m-%d).log"
TOTAL=47

: > "${LOG}"
echo "House fix-all started $(date)" | tee -a "${PROGRESS}" "${LOG}"

FLOWS=()
while IFS= read -r _line; do
  [[ -n "${_line}" ]] && FLOWS+=("${_line}")
done < <(grep -v '^#' "${QUEUE}" | grep -v '^[[:space:]]*$' || true)

for flow in "${FLOWS[@]}"; do
  if grep -qx "${flow}" "${FIXED_LIST}" 2>/dev/null; then
    fixed="$(wc -l <"${FIXED_LIST}" | tr -d ' ')"
    echo "[Skip] ${flow} already green (${fixed}/${TOTAL})" | tee -a "${PROGRESS}" "${LOG}"
    continue
  fi
  bash "${ROOT}/scripts/e2e/run-house-verify-one.sh" "${flow}" 8 "${PROGRESS}" "${TOTAL}" "${FIXED_LIST}" \
    >>"${LOG}" 2>&1 || true
  sleep 3
done

fixed="$(wc -l <"${FIXED_LIST}" 2>/dev/null | tr -d ' ' || echo 0)"
left=$((TOTAL - fixed))
echo "FIX-ALL DONE: ${fixed}/${TOTAL} green, ${left} remaining $(date)" | tee -a "${PROGRESS}" "${LOG}"
python3 "${ROOT}/scripts/e2e/generate-results-from-logs.py" 2026-07-18 staging "House-A, iOS 26" house >>"${LOG}" 2>&1 || true
