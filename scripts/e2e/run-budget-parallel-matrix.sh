#!/usr/bin/env bash
# Run Budget Maestro flows in parallel across N simulators (same Metro :8082).
#
# Usage:
#   WORKERS=5 ./scripts/e2e/run-budget-parallel-matrix.sh
#   WORKERS=4 FLOWS="budget-wishes budget-chat-extended" ./scripts/e2e/run-budget-parallel-matrix.sh
#
# Env:
#   WORKERS          — parallel sim lanes (default 5: iPhone, iPad, Worker-1..3)
#   FLOWS            — space-separated flow basenames (default: all flowsOrder in config)
#   E2E_AUTO_CREATE_SIM=1 — create Budget-Worker-* sims when missing (default 1)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "${ROOT}/scripts/e2e/maestro-fleet-brand.sh"

WORKERS="${WORKERS:-5}"
LOG_DIR="${LOG_DIR:-${ROOT}/.tmp/e2e-logs/matrix-budget-$(date +%Y-%m-%d)}"
mkdir -p "${LOG_DIR}"

export E2E_PARALLEL_FLEET=1
export E2E_DEDICATED_SIM=0
export E2E_MAESTRO_LOCK=0
export E2E_MAESTRO_CLEANUP=0
export E2E_MAESTRO_KILL_UDID_ONLY=1
export E2E_BUDGET_SINGLE=1
export E2E_SEED_FIXTURES=0

APP_ID="com.symply.budget"
CONFIG="${ROOT}/e2e/maestro/budget/config.yaml"
FLOW_DIR="${ROOT}/e2e/maestro/budget"

if [[ -n "${FLOWS:-}" ]]; then
  # shellcheck disable=SC2206
  FLOW_LIST=(${FLOWS})
else
  FLOW_LIST=()
  while IFS= read -r _flow; do
    [[ -n "${_flow}" ]] && FLOW_LIST+=("${_flow}")
  done < <(grep -A200 'flowsOrder:' "${CONFIG}" | grep '    - ' | sed 's/.*- //')
fi

if ((${#FLOW_LIST[@]} == 0)); then
  echo "No flows to run" >&2
  exit 1
fi

# Lane device names (reuse fleet iPhone/iPad + optional workers).
LANE_DEVICES=()
LANE_DEVICES+=("Budget-A")
LANE_DEVICES+=("Budget-iPad")
for ((i = 1; i <= WORKERS - 2; i++)); do
  LANE_DEVICES+=("Budget-Worker-${i}")
done
LANE_COUNT="${#LANE_DEVICES[@]}"
if ((LANE_COUNT > WORKERS)); then
  LANE_DEVICES=("${LANE_DEVICES[@]:0:WORKERS}")
  LANE_COUNT="${WORKERS}"
fi

echo "Budget parallel matrix — ${LANE_COUNT} sim lane(s), ${#FLOW_LIST[@]} flow(s)"
echo "Logs: ${LOG_DIR}/parallel-lane-*.log"

if ! curl -sf --connect-timeout 2 http://127.0.0.1:8082/status >/dev/null 2>&1; then
  echo "Metro :8082 not running — start: npm run start:budget -- --port 8082" >&2
  exit 1
fi

# Ensure simulators exist + boot.
declare -a LANE_UDIDS=()
for device in "${LANE_DEVICES[@]}"; do
  udid="$(maestro_fleet_ensure_iphone_sim "${device}" || true)"
  if [[ -z "${udid}" ]]; then
    echo "Missing simulator: ${device} (set E2E_AUTO_CREATE_SIM=1)" >&2
    exit 1
  fi
  xcrun simctl boot "${udid}" 2>/dev/null || true
  LANE_UDIDS+=("${udid}")
done

for udid in "${LANE_UDIDS[@]}"; do
  if xcrun simctl list devices booted 2>/dev/null | grep -q "${udid}"; then
    continue
  fi
  xcrun simctl bootstatus "${udid}" -b 2>/dev/null || sleep 2
done

# Install app on every lane (reuse latest Budget Debug build).
resolve_budget_app_bundle() {
  local ref_udid="$1"
  local bundle=""
  local bid=""

  # Prefer an already-installed Budget app on the reference sim (correct brand).
  if [[ -n "${ref_udid}" ]] && xcrun simctl get_app_container "${ref_udid}" "${APP_ID}" >/dev/null 2>&1; then
    bundle="$(xcrun simctl get_app_container "${ref_udid}" "${APP_ID}")"
    bid="$(plutil -extract CFBundleIdentifier raw "${bundle}/Info.plist" 2>/dev/null || true)"
    if [[ "${bid}" == "${APP_ID}" && -d "${bundle}" ]]; then
      echo "${bundle}"
      return 0
    fi
  fi

  # Per-brand Xcode config (see documents/ecosystem/XCODE_LOCAL.md).
  while IFS= read -r candidate; do
    [[ -d "${candidate}" ]] || continue
    bid="$(plutil -extract CFBundleIdentifier raw "${candidate}/Info.plist" 2>/dev/null || true)"
    if [[ "${bid}" == "${APP_ID}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done < <(
    find "${HOME}/Library/Developer/Xcode/DerivedData"/SymplyEcosystem-*/Build/Products \
      -path '*/Debug-budget-iphonesimulator/SymplyEcosystem.app' 2>/dev/null
  )

  return 1
}

if ! xcrun simctl get_app_container "${LANE_UDIDS[0]}" "${APP_ID}" >/dev/null 2>&1; then
  echo "com.symply.budget missing on ${LANE_DEVICES[0]} — build Budget once first:" >&2
  echo "  APP_BRAND=symply-budget npm run ios  (or Xcode → Symply Budget scheme)" >&2
  exit 1
fi

APP_BUNDLE="$(resolve_budget_app_bundle "${LANE_UDIDS[0]}")"
if [[ -z "${APP_BUNDLE}" || ! -d "${APP_BUNDLE}" ]]; then
  echo "Could not resolve com.symply.budget .app bundle for parallel install" >&2
  exit 1
fi
echo "Using Budget app: ${APP_BUNDLE}"

for idx in "${!LANE_UDIDS[@]}"; do
  udid="${LANE_UDIDS[$idx]}"
  device="${LANE_DEVICES[$idx]}"
  if xcrun simctl get_app_container "${udid}" "${APP_ID}" >/dev/null 2>&1; then
    echo "  ${device}: com.symply.budget installed"
  else
    # Wrong-brand installs from legacy Debug-iphonesimulator pollute worker sims.
    if xcrun simctl get_app_container "${udid}" com.symply.house >/dev/null 2>&1; then
      echo "  ${device}: removing wrong com.symply.house"
      xcrun simctl uninstall "${udid}" com.symply.house 2>/dev/null || true
    fi
    echo "  ${device}: installing com.symply.budget"
    xcrun simctl install "${udid}" "${APP_BUNDLE}"
  fi
done

# Fresh worker sims have no Keychain session — prime login serially before parallel lanes.
# Fleet sims (Budget-A / Budget-iPad) usually already have a session — skip them.
if [[ "${E2E_SKIP_LANE_PRIME:-0}" != "1" ]]; then
  prime_targets=()
  for idx in "${!LANE_UDIDS[@]}"; do
    device="${LANE_DEVICES[$idx]}"
    if [[ "${device}" == Budget-Worker-* ]]; then
      prime_targets+=("${idx}")
    else
      echo "  skip prime ${device} (fleet sim — existing session)"
    fi
  done
  if ((${#prime_targets[@]} > 0)); then
    echo "Priming ${#prime_targets[@]} worker lane(s) with budget-prime-session (serial)…"
    for idx in "${prime_targets[@]}"; do
      device="${LANE_DEVICES[$idx]}"
      udid="${LANE_UDIDS[$idx]}"
      echo "  prime ${device} (${udid})"
      E2E_DEVICE="${device}" \
        MAESTRO_DEDICATED_UDID="${udid}" \
        E2E_MAESTRO_KILL_RUNNERS=1 \
        bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${FLOW_DIR}/budget-prime-session.yaml" \
        >>"${LOG_DIR}/parallel-lane-prime-${device// /-}.log" 2>&1 || {
          echo "WARNING: prime failed on ${device} — see ${LOG_DIR}/parallel-lane-prime-${device// /-}.log" >&2
        }
      sleep 3
    done
  else
    echo "No worker lanes to prime."
  fi
fi

# Partition flows round-robin across lanes.
declare -a LANE_FLOWS
for ((i = 0; i < LANE_COUNT; i++)); do
  LANE_FLOWS[i]=""
done
for i in "${!FLOW_LIST[@]}"; do
  lane=$((i % LANE_COUNT))
  LANE_FLOWS[lane]="${LANE_FLOWS[lane]} ${FLOW_LIST[$i]}"
done

run_lane() {
  local lane_idx="$1"
  local device="${LANE_DEVICES[$lane_idx]}"
  local udid="${LANE_UDIDS[$lane_idx]}"
  local log="${LOG_DIR}/parallel-lane-${lane_idx}-${device// /-}.log"
  local flows
  flows="${LANE_FLOWS[$lane_idx]# }"
  [[ -n "${flows}" ]] || return 0

  {
    echo "=== lane ${lane_idx} ${device} (${udid}) ==="
    echo "flows:${flows}"
    for flow in ${flows}; do
      echo ""
      echo "=== ${flow} $(date -u +%H:%M:%S) ==="
      E2E_DEVICE="${device}" \
        MAESTRO_DEDICATED_UDID="${udid}" \
        E2E_MAESTRO_KILL_RUNNERS=0 \
        bash "${ROOT}/scripts/e2e/run-budget-suite.sh" "${FLOW_DIR}/${flow}.yaml" || {
          echo "[Failed] ${flow}"
          continue
        }
      echo "[Passed] ${flow}"
    done
    echo "=== lane ${lane_idx} complete ==="
  } >>"${log}" 2>&1
}

pids=()
for ((lane = 0; lane < LANE_COUNT; lane++)); do
  [[ -n "${LANE_FLOWS[$lane]# }" ]] || continue
  run_lane "${lane}" &
  pids+=("$!")
  echo "Started lane ${lane} (${LANE_DEVICES[$lane]}) pid $!"
done

fail=0
for pid in "${pids[@]}"; do
  wait "${pid}" || fail=1
done

echo ""
echo "Parallel matrix complete — lane logs:"
for ((lane = 0; lane < LANE_COUNT; lane++)); do
  log="${LOG_DIR}/parallel-lane-${lane}-${LANE_DEVICES[$lane]// /-}.log"
  [[ -f "${log}" ]] || continue
  passed="$(grep -c '^\[Passed\]' "${log}" 2>/dev/null || true)"
  failed="$(grep -c '^\[Failed\]' "${log}" 2>/dev/null || true)"
  echo "  lane ${lane} ${LANE_DEVICES[$lane]}: pass=${passed} fail=${failed} → ${log}"
done

exit "${fail}"
