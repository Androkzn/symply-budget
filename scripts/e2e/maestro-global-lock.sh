#!/usr/bin/env bash
# Machine-wide Maestro lock — only one suite driver at a time (prevents Killed:9 OOM).
# Uses mkdir (portable on macOS; flock is often missing). Set E2E_MAESTRO_LOCK=0 to skip.
MAESTRO_GLOBAL_LOCK_FILE="${MAESTRO_GLOBAL_LOCK_FILE:-${TMPDIR:-/tmp}/symply-maestro-suite.lock}"
MAESTRO_GLOBAL_LOCK_DIR="${MAESTRO_GLOBAL_LOCK_FILE}.d"
MAESTRO_GLOBAL_LOCK_WAIT="${MAESTRO_GLOBAL_LOCK_WAIT:-7200}"

# Is the recorded owner still alive?
#
# The lock is released by an EXIT trap, which does NOT run when the runner is
# SIGKILLed — and an OOM kill is exactly what this lock exists to prevent, so
# that is the common case, not the rare one. Without this check a killed run
# WEDGES every later suite on the machine for the full two-hour wait, and the
# symptom is a run that produces no output at all and is eventually killed
# itself. Observed for real on 2026-07-26: a 04:58 owner pid that no longer
# existed silently blocked two Health runs, four hours apart.
_maestro_lock_owner_alive() {
  local owner_file="${MAESTRO_GLOBAL_LOCK_DIR}/owner"
  # A lock dir with no owner file yet is a race with a live acquirer, not a
  # stale lock — treat it as held and wait.
  [[ -f "${owner_file}" ]] || return 0
  local pid
  pid="$(awk 'NR==1 {print $1}' "${owner_file}" 2>/dev/null)"
  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  kill -0 "${pid}" 2>/dev/null
}

acquire_maestro_global_lock() {
  if [[ "${E2E_MAESTRO_LOCK:-1}" == "0" || "${E2E_PARALLEL_FLEET:-0}" == "1" || -n "${MAESTRO_GLOBAL_LOCK_HELD:-}" ]]; then
    return 0
  fi
  local waited=0
  while ! mkdir "${MAESTRO_GLOBAL_LOCK_DIR}" 2>/dev/null; do
    if ! _maestro_lock_owner_alive; then
      echo "Maestro global lock: breaking stale lock held by a dead process ($(cat "${MAESTRO_GLOBAL_LOCK_DIR}/owner" 2>/dev/null))" >&2
      rm -rf "${MAESTRO_GLOBAL_LOCK_DIR}"
      continue
    fi
    sleep 2
    waited=$((waited + 2))
    # Say WHY nothing is happening. A silent wait is indistinguishable from a
    # hung runner, which is how the stale lock above went unnoticed.
    if (( waited % 60 == 0 )); then
      echo "Maestro global lock: waiting ${waited}s for $(cat "${MAESTRO_GLOBAL_LOCK_DIR}/owner" 2>/dev/null)" >&2
    fi
    if (( waited >= MAESTRO_GLOBAL_LOCK_WAIT )); then
      echo "Maestro global lock timeout (${MAESTRO_GLOBAL_LOCK_WAIT}s): ${MAESTRO_GLOBAL_LOCK_DIR}" >&2
      exit 1
    fi
  done
  export MAESTRO_GLOBAL_LOCK_HELD=1
  printf '%s %s %s\n' "$$" "$(basename "$0")" "${1:-}" >"${MAESTRO_GLOBAL_LOCK_DIR}/owner"
}

release_maestro_global_lock() {
  if [[ -n "${MAESTRO_GLOBAL_LOCK_HELD:-}" ]]; then
    rm -rf "${MAESTRO_GLOBAL_LOCK_DIR}"
    unset MAESTRO_GLOBAL_LOCK_HELD
  fi
}

trap release_maestro_global_lock EXIT
