#!/usr/bin/env bash
# Run House Maestro flows one-at-a-time (avoids driver death when batching 80+ flows).
#
# Usage:
#   scripts/e2e/run-house-suite-sequential.sh tasks
#   scripts/e2e/run-house-suite-sequential.sh tasks mira
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${LOG:-/tmp/maestro-house-2026-07-18.log}"
# Rotate huge logs so append does not fill the disk mid-suite.
if [[ -f "${LOG}" ]]; then
  log_mb="$(($(stat -f%z "${LOG}" 2>/dev/null || echo 0) / 1048576))"
  if [[ "${log_mb}" -ge 5 ]]; then
    mv "${LOG}" "${LOG%.log}-$(date -u +%H%M%S).log" 2>/dev/null || : >"${LOG}"
  fi
fi
touch "${LOG}"
# Refuse to start without headroom, and stop cleanly if the run eats it.
# A suite that runs out of disk mid-way fails every remaining flow for reasons
# that look like app bugs — 47 of them on 2026-08-13 before this existed.
# shellcheck source=scripts/e2e/disk-floor-guard.sh
source "$(dirname "$0")/disk-floor-guard.sh"
disk_floor_preflight || exit 1

START_DIR="${1:-auth}"
ONLY_DIR="${E2E_HOUSE_DIR_ONLY:-0}"
shift || true

BIOMETRIC_MATCH_PID=""
stop_biometric_match_loop() {
  if [[ -n "${BIOMETRIC_MATCH_PID}" ]] && kill -0 "${BIOMETRIC_MATCH_PID}" 2>/dev/null; then
    kill "${BIOMETRIC_MATCH_PID}" 2>/dev/null || true
  fi
}
trap stop_biometric_match_loop EXIT

start_biometric_match_loop_if_auth() {
  if [[ "${START_DIR}" != "auth" && "${E2E_BIOMETRIC_MATCH_LOOP:-0}" != "1" ]]; then
    return 0
  fi
  local udid
  udid="$(xcrun simctl list devices available | grep "${E2E_DEVICE:-House-A}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true)"
  [[ -n "${udid}" ]] || return 0
  (
    while true; do
      xcrun simctl spawn "${udid}" notifyutil -p com.apple.BiometricKit_Sim.pearl.match 2>/dev/null || true
      xcrun simctl spawn "${udid}" notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match 2>/dev/null || true
      sleep 0.75
    done
  ) &
  BIOMETRIC_MATCH_PID=$!
  echo "Face ID match loop pid=${BIOMETRIC_MATCH_PID}" >> "${LOG}"
}

start_biometric_match_loop_if_auth

# Set when the disk floor is hit, so the remaining flows are skipped rather
# than run into a wall.
DISK_STOP=0

run_flow() {
  local flow="$1"
  local base
  base="$(basename "${flow}" .yaml)"

  if [[ "${DISK_STOP}" == "1" ]]; then
    echo "[skipped-no-disk] ${base}" >> "${LOG}"
    return 0
  fi
  if ! disk_floor_check "${base}"; then
    DISK_STOP=1
    echo "[Aborted] out of disk before ${base} — remaining flows skipped" >> "${LOG}"
    return 1
  fi
  # The two logs that grow for the whole run. `tee` has no rotation.
  disk_floor_trim_log "${LOG}" 200
  disk_floor_trim_log "/tmp/metro-house.log" 400
  local tmp_out
  tmp_out="$(mktemp /tmp/maestro-flow.XXXXXX)"
  {
    echo ""
    echo ">>> ${flow}"
  } >> "${LOG}"
  if bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${flow}" >"${tmp_out}" 2>&1; then
    tail -8 "${tmp_out}" >> "${LOG}"
    echo "[Passed] ${base}" >> "${LOG}"
    rm -f "${tmp_out}"
    return 0
  fi
  # Maestro sometimes passes the flow then crashes zipping debug logs (NoSuchFileException).
  if rg -q 'DebugLogStore\.finalizeRun|NoSuchFileException.*Library/Logs/maestro|MaestroSession\.close|IOSDriver\.close' "${tmp_out}" 2>/dev/null \
    && ! rg -q 'FAILED|Assertion is false|Flow failed|Parsing Failed' "${tmp_out}" 2>/dev/null; then
    tail -8 "${tmp_out}" >> "${LOG}"
    echo "[Passed] ${base} (finalize-log infra)" >> "${LOG}"
    rm -f "${tmp_out}"
    return 0
  fi
  # OOM / parallel-suite pressure can SIGKILL maestro mid-flow without a real assertion failure.
  if rg -q 'Killed: 9.*maestro test' "${tmp_out}" 2>/dev/null \
    && ! rg -q 'FAILED|Assertion is false|Flow failed|Parsing Failed' "${tmp_out}" 2>/dev/null; then
    echo "[infra-retry] ${base} killed — retrying once…" >> "${LOG}"
    sleep 5
    if bash "${ROOT}/scripts/e2e/run-house-suite.sh" "${flow}" >"${tmp_out}" 2>&1; then
      tail -8 "${tmp_out}" >> "${LOG}"
      echo "[Passed] ${base} (killed-retry)" >> "${LOG}"
      rm -f "${tmp_out}"
      return 0
    fi
  fi
  tail -25 "${tmp_out}" >> "${LOG}"
  echo "[Failed] ${base}" >> "${LOG}"
  rm -f "${tmp_out}"
  return 1
}

# `house-v2` carries the local-first surface (device sync, enrolment, Backup &
# Restore). It was absent from this list, so every `lf-*` flow on disk — 18 of
# them — was invisible coverage: written, linked from the matrix, and never run
# by the suite. That is the same defect `budgetSuiteCompleteness.test.ts` exists
# to catch on the Budget side.
#
# The cost to accept: the backup flows seal real archives, and Argon2id is
# deliberately slow — budget ~1–3 min each on a loaded simulator. Run the suite
# with a `feature:local-first` exclusion if that is too much for a given run.
# One list, from the registry — see maestro_house_flow_dirs().
HOUSE_FLOW_DIR_NAMES=()
while IFS= read -r _house_flow_dir; do
  [[ -n "$_house_flow_dir" ]] && HOUSE_FLOW_DIR_NAMES+=("$_house_flow_dir")
done < <(maestro_house_flow_dirs)

# A flow tagged `util` is a HELPER, not a test.
#
# `e2e/maestro/subflows/**` is the usual home for these, but three of them live
# in `house-v2/` alongside their callers — `lf-backup-open-backup-screen`,
# `lf-backup-open-restore-screen` and `lf-backup-reset-state` — because every
# caller refers to them by a bare relative name. They carry `tags: [util]`
# exactly like the ones under `subflows/`, and they deliberately do NOT launch
# or log in: their headers say so, because a helper that launched would hide
# that ordering from the flow depending on it.
#
# Running one standalone therefore fails on its first step ("Element not found:
# tab-settings") and is reported as a suite failure, which is noise that looks
# like a regression. Enumerating by directory has to honour the tag the repo
# already uses to mark them.
is_util_flow() {
  head -20 "${1:?flow}" 2>/dev/null | awk '
    /^tags:/ { intags = 1; next }
    intags && /^[[:space:]]*-[[:space:]]*util[[:space:]]*$/ { found = 1 }
    intags && /^[^[:space:]-]/ { intags = 0 }
    END { exit found ? 0 : 1 }
  '
}

found=0
for name in "${HOUSE_FLOW_DIR_NAMES[@]}"; do
  if [[ "${found}" -eq 1 || "${name}" == "${START_DIR}" ]]; then
    found=1
    dir="${ROOT}/e2e/maestro/${name}"
    [[ -d "${dir}" ]] || continue
    while IFS= read -r flow; do
      is_util_flow "${flow}" && continue
      run_flow "${flow}" || true
    done < <(find "${dir}" -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort)
    if [[ "${ONLY_DIR}" == "1" ]]; then
      break
    fi
  fi
done

for extra in "$@"; do
  dir="${ROOT}/e2e/maestro/${extra}"
  [[ -d "${dir}" ]] || continue
  while IFS= read -r flow; do
    is_util_flow "${flow}" && continue
    run_flow "${flow}" || true
  done < <(find "${dir}" -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' | sort)
done
