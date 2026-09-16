#!/usr/bin/env bash
# Run tasks+budget E2E flows one-by-one (avoids Maestro driver cascade failures).
set -uo pipefail

ROOT="$(cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=scripts/e2e/maestro-scoped-kill.sh
source "${ROOT}/scripts/e2e/maestro-scoped-kill.sh"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-120000}"

DEVICE_NAME="${E2E_DEVICE:-Kaizen-iPad}"
UDID="$(xcrun simctl list devices available | grep "${DEVICE_NAME}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"
if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true

APP_ID="${E2E_APP_ID:-com.symply.house}"
FLOW_TIMEOUT_SEC="${E2E_FLOW_TIMEOUT_SEC:-180}"
DEBUG_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-debug}"
mkdir -p "${DEBUG_DIR}"

FLOWS=(
  "${ROOT}/e2e/maestro/tasks/add-task-manual-form.yaml"
  "${ROOT}/e2e/maestro/tasks/add-task-smart-capture.yaml"
  "${ROOT}/e2e/maestro/tasks/task-detail-sections.yaml"
  "${ROOT}/e2e/maestro/tasks/task-detail-ui.yaml"
  "${ROOT}/e2e/maestro/tasks/tasks-screen-controls.yaml"
  "${ROOT}/e2e/maestro/budget/budget-ai-screen.yaml"
  "${ROOT}/e2e/maestro/budget/budget-dashboard-controls.yaml"
  "${ROOT}/e2e/maestro/budget/budget-item-form.yaml"
  "${ROOT}/e2e/maestro/budget/budget-settings.yaml"
  "${ROOT}/e2e/maestro/budget/budget-tabs.yaml"
)

pass=0
fail=0

reset_simulator_app() {
  maestro_scoped_kill_udid "${UDID}" "${APP_ID}" || true
  sleep 2
}

run_flow_with_timeout() {
  local flow_path="$1"
  local log_path="$2"
  maestro test "${flow_path}" \
    --udid="${UDID}" \
    --flatten-debug-output \
    --debug-output="${DEBUG_DIR}" \
    >"${log_path}" 2>&1 &
  local pid=$!
  local elapsed=0
  while kill -0 "${pid}" 2>/dev/null; do
    if (( elapsed >= FLOW_TIMEOUT_SEC )); then
      kill "${pid}" 2>/dev/null || true
      maestro_scoped_kill_udid "${UDID}" "${APP_ID}" || true
      echo "TIMEOUT after ${FLOW_TIMEOUT_SEC}s" >>"${log_path}"
      wait "${pid}" 2>/dev/null || true
      return 124
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  wait "${pid}"
}

printf '%-28s %s\n' "FLOW" "RESULT"
printf '%-28s %s\n' "----" "------"

for f in "${FLOWS[@]}"; do
  name="$(basename "${f}" .yaml)"
  rm -f /tmp/e2e-one.log
  reset_simulator_app
  attempt=1
  max_attempts=2
  flow_ok=false
  while (( attempt <= max_attempts )); do
    if run_flow_with_timeout "${f}" /tmp/e2e-one.log; then
      flow_ok=true
      break
    fi
    if rg -q 'kAXErrorInvalidUIElement|viewHierarchy failed' /tmp/e2e-one.log && (( attempt < max_attempts )); then
      reset_simulator_app
      sleep 5
      attempt=$((attempt + 1))
      continue
    fi
    break
  done
  if [[ "${flow_ok}" == true ]]; then
    printf '%-28s ✅ PASS\n' "${name}"
    pass=$((pass + 1))
  else
    err="$(rg -o 'Assertion is false:.*|Element not found:.*|No visible element found:.*|Unable to set permissions.*|TIMEOUT after.*|kAXErrorInvalidUIElement' /tmp/e2e-one.log | head -1 | cut -c1-90 || true)"
    printf '%-28s ❌ FAIL  %s\n' "${name}" "${err:-see /tmp/e2e-one.log}"
    fail=$((fail + 1))
  fi
  reset_simulator_app
  sleep 3
done

printf '\nTotal: %s pass, %s fail / %s\n' "${pass}" "${fail}" "${#FLOWS[@]}"
exit "${fail}"
