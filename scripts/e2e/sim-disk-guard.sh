#!/usr/bin/env bash
# Bound simulator disk growth.
#
# A simulator's device dir accumulates app bundles, app data, logs, screenshots
# and crash reports on every run and NEVER shrinks on its own. Two multi-member
# devices reached 3.5 GB each before this guard existed.
#
# `sim_guard <device-name>` erases a device only when it exceeds the cap, so the
# common case costs one `du` and the reinstall penalty is paid rarely instead of
# on every run.
#
# Call it BEFORE booting a device you are about to use — never against a device
# another suite may be running on.
#
#   E2E_SIM_GUARD=0       disable entirely
#   E2E_SIM_MAX_MB=5000   per-device cap (default 5000 MB / 5 GB)
#   E2E_SIM_GUARD_VERBOSE=1
#
# Source from a runner, or execute directly to sweep every device:
#   bash scripts/e2e/sim-disk-guard.sh            # guard all (cap applies)
#   bash scripts/e2e/sim-disk-guard.sh --report   # sizes only, no erase
#   bash scripts/e2e/sim-disk-guard.sh --all      # erase every device
set -uo pipefail

E2E_SIM_GUARD="${E2E_SIM_GUARD:-1}"
# 5 GB, not 800 MB.
#
# 800 MB predates the current app: a fresh House Debug install alone is ~2.5 GB,
# so every House device was over the cap before a single flow ran and the guard
# erased it on every invocation. That is not a cheap reset — erasing a
# local-first device destroys its ENROLMENT, so the next suite pays a full cold
# login and re-pairing, and any run in flight loses the device under it. Measured
# twice on 2026-09-04: House-B mid-session (app gone, "not installed"), then
# House-iPad and House-B together at the start of the multi-member run.
#
# 5 GB leaves a normal run comfortably inside the cap while still bounding the
# unbounded growth this guard exists for. Override per run with E2E_SIM_MAX_MB.
E2E_SIM_MAX_MB="${E2E_SIM_MAX_MB:-5000}"
E2E_SIM_GUARD_VERBOSE="${E2E_SIM_GUARD_VERBOSE:-0}"
SIM_DEVICES_ROOT="${HOME}/Library/Developer/CoreSimulator/Devices"

_sg_log() { [[ "${E2E_SIM_GUARD_VERBOSE}" == "1" ]] && echo "[sim-guard] $*" >&2; return 0; }

# udid for an exact device name (avoids substring collisions like House-A / House-A-B)
sim_guard_udid() {
  local name="${1:?device name}"
  xcrun simctl list devices --json 2>/dev/null | /usr/bin/python3 -c '
import json,sys
want=sys.argv[1]
d=json.load(sys.stdin).get("devices",{})
for rt in d:
    for dev in d[rt]:
        if dev.get("name")==want and dev.get("isAvailable"):
            print(dev["udid"]); sys.exit(0)
' "${name}" 2>/dev/null
}

sim_guard_size_mb() {
  local udid="${1:?udid}"
  [[ -d "${SIM_DEVICES_ROOT}/${udid}" ]] || { echo 0; return 0; }
  du -sm "${SIM_DEVICES_ROOT}/${udid}" 2>/dev/null | cut -f1
}

# sim_guard <device-name> — erase if over cap. Safe to call when the device
# does not exist yet (no-op); the runner's own create/boot handles that.
sim_guard() {
  local name="${1:?device name}" udid size
  [[ "${E2E_SIM_GUARD}" == "0" ]] && return 0

  udid="$(sim_guard_udid "${name}")"
  [[ -z "${udid}" ]] && { _sg_log "no such device: ${name}"; return 0; }

  size="$(sim_guard_size_mb "${udid}")"
  if (( size > E2E_SIM_MAX_MB )); then
    # NEVER erase while a suite is running. Erasing removes the app under the
    # suite's feet, and every remaining flow then fails with "<app> is not
    # installed" — 131 flows lost that way on 2026-08-13 before this check
    # existed. Reclaiming disk is never worth destroying the run using it; the
    # next run's pre-flight guard collects it instead.
    if pgrep -f 'maestro test|maestro-driver-ios' >/dev/null 2>&1; then
      echo "[sim-guard] ${name} is ${size} MB (cap ${E2E_SIM_MAX_MB} MB) but a suite is IN FLIGHT — refusing to erase" >&2
      return 0
    fi
    echo "[sim-guard] ${name} is ${size} MB (cap ${E2E_SIM_MAX_MB} MB) — erasing" >&2
    xcrun simctl shutdown "${udid}" >/dev/null 2>&1 || true
    if xcrun simctl erase "${udid}" >/dev/null 2>&1; then
      echo "[sim-guard] ${name} reclaimed $(( size - $(sim_guard_size_mb "${udid}") )) MB" >&2
    else
      echo "[sim-guard] WARN could not erase ${name} (in use?)" >&2
    fi
  else
    _sg_log "${name} ${size} MB — under cap"
  fi
  return 0
}

# Guard a whole A/B pair in one call.
sim_guard_pair() { sim_guard "${1:?A}"; sim_guard "${2:?B}"; }

sim_guard_all_names() {
  xcrun simctl list devices --json 2>/dev/null | /usr/bin/python3 -c '
import json,sys
d=json.load(sys.stdin).get("devices",{})
for rt in d:
    for dev in d[rt]:
        if dev.get("isAvailable"): print(dev["name"])
' 2>/dev/null
}

sim_guard_report() {
  local total=0 name udid size
  printf "%8s  %s\n" "SIZE" "DEVICE" >&2
  while IFS= read -r name; do
    [[ -z "${name}" ]] && continue
    udid="$(sim_guard_udid "${name}")"
    [[ -z "${udid}" ]] && continue
    size="$(sim_guard_size_mb "${udid}")"
    total=$(( total + size ))
    printf "%6s MB  %s\n" "${size}" "${name}" >&2
  done < <(sim_guard_all_names)
  printf "%6s MB  TOTAL\n" "${total}" >&2
}

# Direct execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    --report) sim_guard_report ;;
    --all)
      while IFS= read -r n; do [[ -n "${n}" ]] && E2E_SIM_MAX_MB=0 sim_guard "${n}"; done < <(sim_guard_all_names)
      sim_guard_report
      ;;
    *)
      while IFS= read -r n; do [[ -n "${n}" ]] && sim_guard "${n}"; done < <(sim_guard_all_names)
      sim_guard_report
      ;;
  esac
fi
