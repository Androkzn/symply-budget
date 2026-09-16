#!/usr/bin/env bash
# Run all five fleet Maestro suites in parallel — one dedicated simulator + Metro each.
#
# Prereqs (each brand): sim with app installed, Metro on its port, e2e/credentials.local
#   house    :8083  House-A
#   budget   :8082  Budget-A
#   kaizen   :8081  Kaizen-A
#   language :8084  Language-A
#   health   :8085  Health-A
#
# Usage:
#   eval "$(./scripts/secrets/export-env.sh)"
#   ./scripts/e2e/preflight-fleet-parallel.sh   # sim + Metro + app install check
#   ./scripts/e2e/run-fleet-parallel.sh
#   APPS="house budget" ./scripts/e2e/run-fleet-parallel.sh
#   E2E_SEED_FIXTURES=0 ./scripts/e2e/run-fleet-parallel.sh
#   E2E_PREFLIGHT_SKIP=1 ./scripts/e2e/run-fleet-parallel.sh
#
# Parallel mode sets E2E_PARALLEL_FLEET=1, E2E_DEDICATED_SIM=0, E2E_MAESTRO_LOCK=0 so
# each brand keeps its own simulator + Metro + Maestro driver (no exclusive shutdown).
#
# Never global-pkill Maestro — use scripts/e2e/maestro-scoped-kill.sh <brand> instead.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APPS="${APPS:-house budget kaizen language health}"
LOG_DIR="${LOG_DIR:-${ROOT}/.tmp/e2e-logs/fleet-parallel-$(date +%Y-%m-%d_%H%M%S)}"
mkdir -p "${LOG_DIR}"

export E2E_MAESTRO_CLEANUP=0
export E2E_PARALLEL_FLEET=1
export E2E_DEDICATED_SIM=0
export E2E_MAESTRO_LOCK=0
export E2E_SEED_FIXTURES="${E2E_SEED_FIXTURES:-0}"
export MAESTRO_DEBUG="${MAESTRO_DEBUG:-0}"

# shellcheck source=scripts/e2e/preflight-fleet-parallel.sh
source "${ROOT}/scripts/e2e/preflight-fleet-parallel.sh"
preflight_fleet_parallel "${APPS}"

echo "Fleet parallel Maestro — logs: ${LOG_DIR}"
echo "Apps: ${APPS}"
echo "Parallel: E2E_DEDICATED_SIM=0 E2E_MAESTRO_LOCK=0 (each brand isolated)"
echo "Started $(date -u +%Y-%m-%dT%H:%M:%SZ)"

declare -a APP_LIST=()
declare -a PID_LIST=()

for app in ${APPS}; do
  runner="${ROOT}/scripts/e2e/run-${app}-suite.sh"
  if [[ ! -f "${runner}" ]]; then
    echo "!! skip ${app}: no runner ${runner}"
    continue
  fi
  APP_LIST+=("${app}")
  echo ">> starting ${app} → ${LOG_DIR}/${app}.log"
  if [[ "${app}" == "house" ]]; then
    LOG="${LOG_DIR}/${app}.log" E2E_HOUSE_DIR_ONLY=1 bash "${ROOT}/scripts/e2e/run-house-suite-sequential.sh" auth \
      >"${LOG_DIR}/${app}.log" 2>&1 &
  elif [[ "${app}" == "language" ]]; then
    MAESTRO_LANGUAGE_LOG="${LOG_DIR}/${app}.log" bash "${runner}" \
      >"${LOG_DIR}/${app}.log" 2>&1 &
  else
    bash "${runner}" >"${LOG_DIR}/${app}.log" 2>&1 &
  fi
  PID_LIST+=("$!")
done

pass=0
fail=0
failed_apps=()

for i in "${!APP_LIST[@]}"; do
  app="${APP_LIST[$i]}"
  pid="${PID_LIST[$i]}"
  if wait "${pid}"; then
    echo "[PASS] ${app}"
    pass=$((pass + 1))
  else
    echo "[FAIL] ${app} — tail ${LOG_DIR}/${app}.log"
    tail -5 "${LOG_DIR}/${app}.log" 2>/dev/null || true
    fail=$((fail + 1))
    failed_apps+=("${app}")
  fi
done

echo "=================================================================="
echo "Fleet parallel summary — pass: ${pass}, fail: ${fail}"
for a in "${failed_apps[@]:-}"; do [[ -n "${a}" ]] && echo "   - ${a}"; done
echo "Logs: ${LOG_DIR}"
exit $(( fail > 0 ? 1 : 0 ))
