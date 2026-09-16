#!/usr/bin/env bash
# Kill Maestro processes for ONE fleet brand / simulator only.
#
# Parallel fleet E2E runs House, Budget, Kaizen, Language, and Health at the
# same time — each on its own simulator + Metro port. Never use:
#   pkill -f 'maestro.cli|run-house|run-budget|...'
# That kills every brand mid-run.
#
# Usage:
#   scripts/e2e/maestro-scoped-kill.sh house
#   scripts/e2e/maestro-scoped-kill.sh budget
#   E2E_MAESTRO_KILL_FORCE=1 scripts/e2e/maestro-scoped-kill.sh --udid UUID --app-id com.symply.house
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "${SCRIPT_DIR}/maestro-fleet-brand.sh"

usage() {
  cat <<'EOF'
Usage:
  maestro-scoped-kill.sh <house|budget|kaizen|language|health>
  maestro-scoped-kill.sh --udid UUID [--app-id BUNDLE] [--runner run-*-suite.sh]

Env:
  E2E_MAESTRO_KILL_FORCE=1     SIGKILL instead of SIGTERM
  E2E_MAESTRO_KILL_RUNNERS=0   skip killing brand suite runner shell (default 1)
EOF
}

_pgrep_pids() {
  local pattern="$1"
  pgrep -fl "${pattern}" 2>/dev/null | awk '{print $1}' || true
}

_pids_for_udid() {
  local udid="$1"
  pgrep -fl 'maestro\.cli\.AppKt' 2>/dev/null | grep -F "${udid}" | awk '{print $1}' || true
}

_pids_for_app_id() {
  local app_id="$1"
  pgrep -fl 'maestro\.cli\.AppKt' 2>/dev/null | grep -F "${app_id}" | awk '{print $1}' || true
}

_pids_for_runner() {
  local runner="$1"
  pgrep -fl "${runner}" 2>/dev/null | awk '{print $1}' || true
}

_unique_pids() {
  awk '!seen[$0]++'
}

_kill_pids() {
  local sig="$1"
  shift
  local pid
  for pid in "$@"; do
    [[ -n "${pid}" ]] || continue
    kill "-${sig}" "${pid}" 2>/dev/null || true
  done
}

maestro_scoped_kill_brand() {
  local brand="${1:?brand}"
  local udid app_id runner
  udid="$(maestro_fleet_brand_udid "${brand}")"
  app_id="$(maestro_fleet_brand_field "${brand}" app_id)"
  runner="$(maestro_fleet_brand_field "${brand}" runner)"
  if [[ -z "${udid}" ]]; then
    echo "maestro-scoped-kill: no UDID for brand ${brand}" >&2
    return 1
  fi
  maestro_scoped_kill_udid "${udid}" "${app_id}" "${runner}"
}

maestro_scoped_kill_udid() {
  local udid="${1:?udid}"
  local app_id="${2:-}"
  local runner="${3:-}"
  local force="${E2E_MAESTRO_KILL_FORCE:-0}"
  local kill_runners="${E2E_MAESTRO_KILL_RUNNERS:-1}"
  local sig="TERM"
  [[ "${force}" == "1" ]] && sig="KILL"

  local pids_raw="" pid still=()

  pids_raw="$(
    {
      _pids_for_udid "${udid}"
      if [[ "${E2E_MAESTRO_KILL_UDID_ONLY:-0}" != "1" ]]; then
        if [[ -n "${app_id}" ]]; then
          _pids_for_app_id "${app_id}"
        fi
        if [[ "${kill_runners}" == "1" && -n "${runner}" ]]; then
          _pids_for_runner "${runner}"
        fi
      fi
    } | _unique_pids
  )"

  if [[ -z "${pids_raw}" ]]; then
    if [[ -n "${app_id}" ]]; then
      xcrun simctl terminate "${udid}" "${app_id}" 2>/dev/null || true
    fi
    return 0
  fi

  echo "maestro-scoped-kill: ${sig} for ${udid}${app_id:+ / ${app_id}} → ${pids_raw//$'\n'/ }"
  # shellcheck disable=SC2046
  _kill_pids "${sig}" ${pids_raw}

  sleep 1
  if [[ "${force}" != "1" ]]; then
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      kill -0 "${pid}" 2>/dev/null && still+=("${pid}")
    done <<<"${pids_raw}"
    if ((${#still[@]} > 0)); then
      _kill_pids KILL "${still[@]}"
    fi
  fi

  if [[ -n "${app_id}" ]]; then
    xcrun simctl terminate "${udid}" "${app_id}" 2>/dev/null || true
  fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  BRAND=""
  UDID=""
  APP_ID=""
  RUNNER=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      --udid)
        UDID="${2:?--udid requires UUID}"
        shift 2
        ;;
      --app-id)
        APP_ID="${2:?--app-id requires bundle id}"
        shift 2
        ;;
      --runner)
        RUNNER="${2:?--runner requires script name}"
        shift 2
        ;;
      house | budget | kaizen | language | health)
        BRAND="$1"
        shift
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done

  if [[ -n "${BRAND}" ]]; then
    maestro_scoped_kill_brand "${BRAND}"
  elif [[ -n "${UDID}" ]]; then
    maestro_scoped_kill_udid "${UDID}" "${APP_ID}" "${RUNNER}"
  else
    usage >&2
    exit 1
  fi
fi
