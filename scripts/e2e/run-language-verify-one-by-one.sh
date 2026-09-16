#!/usr/bin/env bash
# Run Language Maestro flows one-by-one; print pass/fail progress after each.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${LOG:-/tmp/maestro-language-verify-progress.log}"
: >"${LOG}"

FLOWS=(
  language-prime-session
  onboarding
  language-auth-validation
  shell-customize-tabs
  shell-tutor-draft
  learn-home
  assessment
  dialogue
  plan
  review
  tutor
  more-settings
  more-reset-learning
  more-sign-out
)

TOTAL=${#FLOWS[@]}
PASSED=0
FAILED=0
FAILED_LIST=()

run_one() {
  local flow="$1" yaml rc
  yaml="${ROOT}/e2e/maestro/language/${flow}.yaml"
  [[ -f "${yaml}" ]] || { echo "SKIP missing ${yaml}" | tee -a "${LOG}"; return 1; }
  echo "" | tee -a "${LOG}"
  echo ">>> [$(date +%H:%M:%S)] ${flow}" | tee -a "${LOG}"
  MAESTRO_DEBUG=0 bash "${ROOT}/scripts/e2e/run-language-suite.sh" "${yaml}" 2>&1 | tee -a "${LOG}" | tail -6
  rc=${PIPESTATUS[0]}
  sleep 5
  bash "${ROOT}/scripts/e2e/prune-maestro-disk.sh" >/dev/null 2>&1 || true
  return "${rc}"
}

for flow in "${FLOWS[@]}"; do
  if run_one "${flow}"; then
    PASSED=$((PASSED + 1))
    echo "✓ PASS ${flow} — progress ${PASSED}/${TOTAL} passed, $((TOTAL - PASSED - FAILED)) remaining" | tee -a "${LOG}"
  else
    FAILED=$((FAILED + 1))
    FAILED_LIST+=("${flow}")
    echo "✗ FAIL ${flow} — progress ${PASSED}/${TOTAL} passed, ${FAILED} failed, $((TOTAL - PASSED - FAILED)) remaining" | tee -a "${LOG}"
  fi
done

echo "" | tee -a "${LOG}"
echo "=== FINAL: ${PASSED}/${TOTAL} passed, ${FAILED} failed ===" | tee -a "${LOG}"
if ((${#FAILED_LIST[@]} > 0)); then
  echo "Failed: ${FAILED_LIST[*]}" | tee -a "${LOG}"
  exit 1
fi
exit 0
