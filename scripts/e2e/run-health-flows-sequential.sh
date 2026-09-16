#!/usr/bin/env bash
# Run Health Maestro flows one-by-one with retries (parallel-safe — use maestro-scoped-kill.sh health only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROGRESS="${1:-/tmp/maestro-health-progress.log}"
export E2E_MAESTRO_CLEANUP=0

# The flow list is DERIVED from e2e/maestro/health/config.yaml, never duplicated.
#
# It used to be hard-coded here, which made this the third place to edit when a
# flow was added (config.yaml `flowsOrder`, this array, and the matrix) — and it
# had already drifted: the list below was missing every flow added after the
# first parity pass, so a "sequential run" silently skipped two thirds of the
# suite while reporting `SUMMARY 21/21 passed`. Reading `flowsOrder` also keeps
# the ORDER, which matters: the auth pair clears the Keychain and must run last.
CONFIG="${ROOT}/e2e/maestro/health/config.yaml"
flows=()
while IFS= read -r name; do
  [[ -n "${name}" ]] && flows+=("${name}")
done < <(awk '
  /^[[:space:]]*flowsOrder:[[:space:]]*$/ { inlist = 1; next }
  inlist && /^[[:space:]]*#/             { next }
  inlist && /^[[:space:]]*-[[:space:]]/  { sub(/^[[:space:]]*-[[:space:]]*/, ""); gsub(/["'\'']/, ""); print; next }
  inlist && NF                           { exit }
' "${CONFIG}")

if ((${#flows[@]} == 0)); then
  echo "No flows parsed from ${CONFIG} — refusing to report a vacuous pass." >&2
  exit 1
fi

total=${#flows[@]}
passed=0
failed=0
declare -a failed_flows=()
: > "${PROGRESS}"

run_flow() {
  local f="$1"
  local log="/tmp/maestro-health-${f}.log"
  local attempt
  for attempt in 1 2 3; do
    xcrun simctl boot 0BB24343-E7FE-4327-AD24-7AA994EA823F 2>/dev/null || true
    if "${ROOT}/scripts/e2e/run-health-suite.sh" "${ROOT}/e2e/maestro/health/${f}.yaml" >"${log}" 2>&1; then
      if ! rg -q 'Assertion is false|Element not found|No visible element|Killed: 9|Unable to set permissions' "${log}"; then
        return 0
      fi
    fi
    if rg -q 'Killed: 9' "${log}" && (( attempt < 3 )); then
      echo "  retry ${f} (attempt ${attempt}, Maestro killed by parallel suite)" | tee -a "${PROGRESS}"
      sleep 5
      continue
    fi
    return 1
  done
  return 1
}

for f in "${flows[@]}"; do
  echo "=== ${f} ===" | tee -a "${PROGRESS}"
  if run_flow "${f}"; then
    passed=$((passed + 1))
    left=$((total - passed - failed))
    echo "PASS ${f} — ${passed}/${total} passed, ${left} left" | tee -a "${PROGRESS}"
  else
    failed=$((failed + 1))
    failed_flows+=("${f}")
    reason="$(rg -o 'Assertion is false:.*|Element not found:.*|Killed: 9.*' "/tmp/maestro-health-${f}.log" | head -1 || echo 'see log')"
    left=$((total - passed - failed))
    echo "FAIL ${f} — ${reason}" | tee -a "${PROGRESS}"
    echo "         ${passed}/${total} passed, ${left} left" | tee -a "${PROGRESS}"
  fi
done

echo "SUMMARY ${passed}/${total} passed, ${failed} failed" | tee -a "${PROGRESS}"
if ((${#failed_flows[@]} > 0)); then
  echo "Failed: ${failed_flows[*]}" | tee -a "${PROGRESS}"
fi
[[ "${failed}" -eq 0 ]]
