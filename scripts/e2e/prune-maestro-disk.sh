#!/usr/bin/env bash
# Prune Maestro / xcodebuild temp artifacts (macOS System Data under /var/folders).
#
# Safe during parallel E2E: skips maestro_xctestrunner_* dirs referenced by live
# xcodebuild processes. Set E2E_MAESTRO_CLEANUP=0 to disable.
set -euo pipefail

if [[ "${E2E_MAESTRO_CLEANUP:-1}" == "0" ]]; then
  exit 0
fi

mkdir -p "${HOME}/.maestro/tests" "${HOME}/Library/Logs/maestro"

VERBOSE="${E2E_MAESTRO_CLEANUP_VERBOSE:-0}"

log_prune() {
  [[ "${VERBOSE}" == "1" ]] && echo "$@"
}

collect_temp_roots() {
  local seen="" root darwin_tmp
  for root in "${TMPDIR:-/tmp}"; do
    [[ -z "${root}" ]] && continue
    root="${root%/}"
    [[ "${seen}" == *"|${root}|"* ]] && continue
    seen="${seen}|${root}|"
    echo "${root}"
  done
  darwin_tmp="$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null || true)"
  darwin_tmp="${darwin_tmp%/}"
  if [[ -n "${darwin_tmp}" && "${seen}" != *"|${darwin_tmp}|"* ]]; then
    echo "${darwin_tmp}"
  fi
}

active_xctest_temp_dirs() {
  pgrep -lf xcodebuild 2>/dev/null \
    | grep -o 'maestro_xctestrunner_xcodebuild_output[0-9]*' \
    | sort -u || true
}

is_active_xctest_dir() {
  local base="$1" active
  while IFS= read -r active; do
    [[ -z "${active}" ]] && continue
    [[ "${base}" == "${active}" ]] && return 0
  done < <(active_xctest_temp_dirs)
  return 1
}

is_path_used_by_xcodebuild() {
  local path="$1" line
  while IFS= read -r line; do
    [[ "${line}" == *"${path}"* ]] && return 0
  done < <(pgrep -lf xcodebuild 2>/dev/null || true)
  return 1
}

prune_old_maestro_dirs() {
  # Drop debug bundles older than 2 hours; keep the 5 newest either way.
  # Never touch ~/Library/Logs/maestro — Maestro finalizeRun zips those dirs.
  find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -type d -mmin +120 2>/dev/null | head -40 | while read -r d; do
    rm -rf "$d" 2>/dev/null || true
  done
  local count
  count="$(find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "${count}" -gt 5 ]]; then
    find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null \
      | xargs -0 ls -dt 2>/dev/null | tail -n +6 | while read -r d; do
        rm -rf "$d" 2>/dev/null || true
      done
  fi
}

prune_maestro_xctest_temp() {
  local root deleted=0 kept=0 base dir
  while IFS= read -r root; do
    [[ -d "${root}" ]] || continue
    for dir in "${root}"/maestro_xctestrunner_xcodebuild_output*; do
      [[ -d "${dir}" ]] || continue
      base="$(basename "${dir}")"
      if is_active_xctest_dir "${base}"; then
        kept=$((kept + 1))
        continue
      fi
      rm -rf "${dir}" 2>/dev/null || true
      deleted=$((deleted + 1))
    done
  done < <(collect_temp_roots)

  if [[ "${deleted}" -gt 0 ]]; then
    log_prune "Maestro cleanup: removed ${deleted} stale xctestrunner temp dir(s) (kept ${kept} active)."
  fi
}

prune_brand_derived_temp() {
  local root dir removed=0
  while IFS= read -r root; do
    [[ -d "${root}" ]] || continue
    for dir in "${root}"/*-dd; do
      [[ -d "${dir}" ]] || continue
      if is_path_used_by_xcodebuild "${dir}"; then
        continue
      fi
      rm -rf "${dir}" 2>/dev/null || true
      removed=$((removed + 1))
    done
  done < <(collect_temp_roots)

  if [[ "${removed}" -gt 0 ]]; then
    log_prune "Maestro cleanup: removed ${removed} stale brand DerivedData temp dir(s)."
  fi
}

prune_maestro_driver_temp() {
  # Maestro leaves one xctestrun staging dir per flow (~26MB each); thousands pile up as System Data.
  local root active_file deleted=0 kept=0 dir
  while IFS= read -r root; do
    [[ -d "${root}" ]] || continue
    active_file="$(mktemp "${root}/.maestro-active.XXXXXX")"
    pgrep -lf 'xcodebuild|maestro\.cli' 2>/dev/null \
      | grep -oE "${root}/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}[0-9]+" \
      | sort -u > "${active_file}" || true

    for dir in "${root}"/[0-9A-F]*-[0-9A-F]*-[0-9A-F]*-[0-9A-F]*-[0-9A-F]*[0-9]*; do
      [[ -d "${dir}" ]] || continue
      if grep -qxF "${dir}" "${active_file}" 2>/dev/null; then
        kept=$((kept + 1))
        continue
      fi
      rm -rf "${dir}" 2>/dev/null || true
      deleted=$((deleted + 1))
    done
    rm -f "${active_file}" 2>/dev/null || true
  done < <(collect_temp_roots)

  if [[ "${deleted}" -gt 0 ]]; then
    log_prune "Maestro cleanup: removed ${deleted} stale driver staging dir(s) (kept ${kept} active)."
  fi
}

####
# Leaked simulator log collectors — the biggest disk leak this repo has.
#
# Maestro captures the device log by spawning `simctl spawn <udid> log stream`.
# When the run ends badly — the JVM killed, a crash, a `kill` from a wrapper —
# the collector is NOT reaped. It keeps appending to
# `$TMPDIR/device-simulator*.log` at roughly 40KB/s FOREVER, with no rotation
# and no size cap. On 2026-09-02 three of them had reached 21-31GB each (~81GB
# total, ~10GB/day between them) and had taken the disk to 168MB free.
#
# Nothing else in this file caught it: the logs are loose files in TMPDIR, not
# `maestro_xctestrunner_*` dirs, so every prune pass walked straight past them.
#
# Safe during parallel runs, because it does not guess. A collector belonging to
# a LIVE run has maestro as an ancestor; an orphan has been reparented to launchd
# (PPID 1). Only orphans are killed, so another agent's in-flight suite on a
# different device is untouched.
reap_orphaned_log_collectors() {
  local pid ppid killed=0 root

  while read -r pid ppid; do
    [[ -z "${pid}" ]] && continue
    # PPID 1 == the parent that owned this collector is gone.
    [[ "${ppid}" != "1" ]] && continue
    kill "${pid}" 2>/dev/null && killed=$((killed + 1))
  done < <(pgrep -f 'simctl spawn .* log stream|log stream --style syslog' 2>/dev/null \
             | xargs -r ps -o pid=,ppid= -p 2>/dev/null)

  # Reclaim the files themselves. TRUNCATE FIRST: space is not returned while
  # any process still holds the descriptor, so `rm` alone can free nothing at
  # all — the file just vanishes from the listing and the blocks stay pinned.
  for root in $(collect_temp_roots); do
    for f in "${root}"/device-simulator*.log; do
      [[ -e "${f}" ]] || continue
      : > "${f}" 2>/dev/null || true
      rm -f "${f}" 2>/dev/null || true
    done
  done

  if [[ "${killed}" -gt 0 ]]; then
    log_prune "Maestro cleanup: reaped ${killed} orphaned device-log collector(s)."
  fi
}

prune_low_disk_extras() {
  local avail_gb threshold_gb
  threshold_gb="${E2E_DISK_CLEANUP_THRESHOLD_GB:-25}"
  avail_gb="$(df -g /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}' || echo 999)"
  if [[ "${avail_gb}" -ge "${threshold_gb}" ]]; then
    return 0
  fi

  echo "Disk low (${avail_gb}GB free) — extra Maestro temp prune…"
  rm -rf /tmp/maestro-house-debug/* 2>/dev/null || true
  mkdir -p /tmp/maestro-house-debug
  df -h /System/Volumes/Data | tail -1
}

reap_orphaned_log_collectors
prune_old_maestro_dirs
prune_maestro_xctest_temp
prune_maestro_driver_temp
prune_brand_derived_temp
prune_low_disk_extras
