#!/usr/bin/env bash
# Re-verify Language matrix flows that failed in the last serial run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${ROOT}"

export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DEBUG=0
export E2E_MAESTRO_CLEANUP=0
export MAESTRO_DRIVER_STARTUP_TIMEOUT=300000

set -a
# shellcheck source=/dev/null
source e2e/credentials.local
set +a

FLOWS=(
  shell-tutor-draft
  learn-home
  assessment
  dialogue
  review
  tutor
  more-settings
  more-reset-learning
  more-sign-out
)

LOG="/tmp/language-rerun-failed-$(date +%H%M).log"
: > "${LOG}"
pass=0
fail=0

curl -sf -X POST http://127.0.0.1:8084/reload >/dev/null || true

for flow in "${FLOWS[@]}"; do
  echo "=== ${flow} ===" | tee -a "${LOG}"
  if MAESTRO_DEBUG=0 E2E_LANGUAGE_SINGLE=1 bash scripts/e2e/run-language-suite.sh \
    "e2e/maestro/language/${flow}.yaml" >>"${LOG}" 2>&1; then
    echo "[PASS] ${flow}" | tee -a "${LOG}"
    pass=$((pass + 1))
  else
    echo "[FAIL] ${flow}" | tee -a "${LOG}"
    tail -8 "${LOG}" | tee -a "${LOG}"
    fail=$((fail + 1))
  fi
  MAESTRO_DEBUG=0 E2E_LANGUAGE_SINGLE=1 bash scripts/e2e/run-language-suite.sh \
    e2e/maestro/language/subflows/language-recover-learn.yaml >>"${LOG}" 2>&1 || true
  sleep 4
done

echo "RERUN_DONE pass=${pass} fail=${fail} log=${LOG}" | tee -a "${LOG}"
exit $(( fail > 0 ? 1 : 0 ))
