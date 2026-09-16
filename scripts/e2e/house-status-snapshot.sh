#!/usr/bin/env bash
# One-line House E2E status for loop reporting.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="${ROOT}/.tmp/e2e-logs"
LATEST="$(ls -t "${LOG_DIR}"/house-serial-auth-*.log "${LOG_DIR}"/house-serial-*.log 2>/dev/null | head -1 || true)"
echo "=== House E2E status $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
if pgrep -fl 'run-house-suite-sequential|run-house-suite\.sh.*maestro/auth' >/dev/null 2>&1; then
  echo "RUNNER: active"
else
  echo "RUNNER: idle"
fi
if [[ -n "${LATEST}" && -f "${LATEST}" ]]; then
  echo "LOG: ${LATEST##*/}"
  PASS="$(rg -c '^\[Passed\]' "${LATEST}" 2>/dev/null || echo 0)"
  FAIL="$(rg -c '^\[Failed\]' "${LATEST}" 2>/dev/null || echo 0)"
  echo "THIS_RUN: pass=${PASS} fail=${FAIL}"
  echo "LAST_FLOW: $(rg '^\[Passed\]|^\[Failed\]|^>>> ' "${LATEST}" 2>/dev/null | tail -3 | tr '\n' ' | ')"
fi
BASELINE_PASS=39
BASELINE_FAIL=47
BASELINE_TESTED=86
echo "BASELINE(2026-07-18): ${BASELINE_PASS} pass / ${BASELINE_FAIL} fail of ${BASELINE_TESTED} flows scored"
