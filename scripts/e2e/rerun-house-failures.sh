#!/usr/bin/env bash
# Re-run Maestro flows that failed in a House suite log.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${1:-/tmp/maestro-house-2026-07-18.log}"
export PATH="${HOME}/.maestro/bin:${PATH}"

if [[ ! -f "${LOG}" ]]; then
  echo "Log not found: ${LOG}"
  exit 1
fi

mapfile() { :; }
FAILED=()
while IFS= read -r line; do
  FAILED+=("$line")
done < <(rg -o '\[Failed\] \K[a-z0-9-]+' "${LOG}" | sort -u)
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "No failures in ${LOG}"
  exit 0
fi

echo "Re-running ${#FAILED[@]} failed flow(s) from ${LOG}"
FAIL=0
for base in "${FAILED[@]}"; do
  flow="$(find "${ROOT}/e2e/maestro" -name "${base}.yaml" | head -1)"
  if [[ -z "${flow}" ]]; then
    echo "!! missing flow file for ${base}"
    FAIL=1
    continue
  fi
  echo "→ ${base}"
  if bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${flow}"; then
    echo "   PASS"
  else
    echo "   FAIL"
    FAIL=1
  fi
done

exit "${FAIL}"
