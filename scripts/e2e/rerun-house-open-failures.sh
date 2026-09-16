#!/usr/bin/env bash
# Re-run known House failure flows after fixes (one at a time).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT=240000
LOG="${LOG:-/tmp/maestro-house-failures-rerun.log}"
: >"${LOG}"

FLOWS=(
  e2e/maestro/aihousekeeper/approvals.yaml
  e2e/maestro/aihousekeeper/settings.yaml
  e2e/maestro/chat/chat-gaps.yaml
  e2e/maestro/chat/chat-rooms-screen.yaml
  e2e/maestro/notifications/notifications-comprehensive.yaml
  e2e/maestro/notifications/notifications-screen.yaml
  e2e/maestro/reports/report-upload-source-modal.yaml
  e2e/maestro/reports/reports-screen-controls.yaml
  e2e/maestro/reports/reports-upload-contract.yaml
  e2e/maestro/tasks/tasks-screen-controls.yaml
)

FAIL=0
for rel in "${FLOWS[@]}"; do
  flow="${ROOT}/${rel}"
  base="$(basename "${flow}" .yaml)"
  tmp_out="$(mktemp /tmp/maestro-flow.XXXXXX)"
  {
    echo ""
    echo ">>> ${flow}"
  } >> "${LOG}"
  if bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${flow}" >"${tmp_out}" 2>&1; then
    tail -8 "${tmp_out}" >> "${LOG}"
    echo "[Passed] ${base}" >> "${LOG}"
  else
    tail -25 "${tmp_out}" >> "${LOG}"
    echo "[Failed] ${base}" >> "${LOG}"
    FAIL=1
  fi
  rm -f "${tmp_out}"
  bash "${ROOT}/scripts/e2e/prune-maestro-disk.sh" || true
done
exit "${FAIL}"
