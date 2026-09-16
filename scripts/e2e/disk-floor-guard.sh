#!/usr/bin/env bash
# Keep a Maestro suite from filling the disk — preflight AND mid-run.
#
# WHY THIS EXISTS. Two consecutive House suite runs on 2026-08-13 were lost to
# harness problems, and the second was caused by the fix for the first:
#
#   Run 1 — `sim_guard` runs once per flow in sequential mode, crossed its cap
#           mid-suite, erased the device and destroyed the installed app.
#           131 of 134 failures were that one event.
#   Run 2 — with per-flow guarding disabled, NOTHING bounded growth during the
#           run. ~140 flows of screenshots, screen-hierarchy dumps and an
#           unbounded `tee`'d Metro log consumed 33 GB, the volume hit zero,
#           Metro died, and 47 flows failed. The log's own evidence:
#           `java.io.IOException: No space left on device`.
#
# Neither run was gradeable, and both looked like product failures. The standing
# rule already says to check `df` before a run and abort below 2 GB — but a
# preflight alone cannot catch a run that STARTS with 33 GB and eats all of it.
#
# So this guards both ends:
#   - `disk_floor_preflight` — refuse to start without real headroom.
#   - `disk_floor_check`     — called between flows; stops the suite cleanly the
#                              moment free space drops under the floor, so the
#                              run ends with one honest message instead of
#                              dozens of phantom failures.
#
#   E2E_DISK_MIN_START_GB=15   headroom required to begin (default 15)
#   E2E_DISK_FLOOR_GB=5        abort-mid-run floor (default 5)
#   E2E_DISK_GUARD=0           disable entirely
set -uo pipefail

E2E_DISK_GUARD="${E2E_DISK_GUARD:-1}"
E2E_DISK_MIN_START_GB="${E2E_DISK_MIN_START_GB:-15}"
E2E_DISK_FLOOR_GB="${E2E_DISK_FLOOR_GB:-5}"

/usr/bin/true

disk_free_gb() {
  # Data volume, not `/` — on APFS the root volume is read-only and reports its
  # own tiny figure, so checking `/` would always look fine.
  df -g /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $4}'
}

disk_floor_preflight() {
  [[ "${E2E_DISK_GUARD}" == "0" ]] && return 0
  local free
  free="$(disk_free_gb)"
  [[ -z "${free}" ]] && return 0
  if (( free < E2E_DISK_MIN_START_GB )); then
    echo "[disk-guard] ${free} GB free — below the ${E2E_DISK_MIN_START_GB} GB needed to start a suite." >&2
    echo "[disk-guard] A suite that runs out of disk mid-way produces dozens of failures that look like app bugs." >&2
    echo "[disk-guard] Reclaim first:" >&2
    echo "[disk-guard]   rm -rf ~/.maestro/tests/* /tmp/metro-*.log /tmp/e2e-report" >&2
    echo "[disk-guard]   rm -rf ~/Library/Developer/Xcode/DerivedData/*" >&2
    echo "[disk-guard]   xcrun simctl shutdown all && xcrun simctl erase all" >&2
    return 1
  fi
  echo "[disk-guard] ${free} GB free — ok to start (floor ${E2E_DISK_FLOOR_GB} GB)." >&2
  return 0
}

# disk_floor_check [context] — 0 to keep going, 1 to stop the suite.
disk_floor_check() {
  [[ "${E2E_DISK_GUARD}" == "0" ]] && return 0
  local free context="${1:-}"
  free="$(disk_free_gb)"
  [[ -z "${free}" ]] && return 0
  if (( free < E2E_DISK_FLOOR_GB )); then
    echo "[disk-guard] STOPPING: ${free} GB free, under the ${E2E_DISK_FLOOR_GB} GB floor${context:+ (at ${context})}." >&2
    echo "[disk-guard] Everything after this point would fail for lack of disk, not because it is broken." >&2
    return 1
  fi
  return 0
}

# Bound a log that a suite appends to for hours. `tee` has no rotation, and the
# Metro log alone reached multiple GB across ~140 flows because it captures a
# full `--clear` bundle plus every app log line.
disk_floor_trim_log() {
  local file="${1:?log path}" max_mb="${2:-200}" size_mb
  [[ -f "${file}" ]] || return 0
  size_mb="$(( $(stat -f%z "${file}" 2>/dev/null || echo 0) / 1048576 ))"
  if (( size_mb >= max_mb )); then
    # Keep the tail: the end of a log is what explains a failure.
    tail -c $(( max_mb * 1048576 / 2 )) "${file}" > "${file}.trim" 2>/dev/null &&
      mv "${file}.trim" "${file}" &&
      echo "[disk-guard] trimmed ${file} (was ${size_mb} MB)" >&2
  fi
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    --check) disk_floor_check "${2:-manual}" ;;
    *) disk_floor_preflight ;;
  esac
fi
