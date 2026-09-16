#!/usr/bin/env bash
# One fleet brand → one dedicated simulator. Shut down other fleet sims and kill
# their Maestro drivers before a suite runs. Set E2E_DEDICATED_SIM=0 to disable.
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "${_SCRIPT_DIR}/maestro-fleet-brand.sh"
# shellcheck source=scripts/e2e/maestro-scoped-kill.sh
source "${_SCRIPT_DIR}/maestro-scoped-kill.sh"

MAESTRO_FLEET_BRANDS=(house budget kaizen language health)

# maestro_prepare_dedicated_sim <brand>
# Exports: E2E_DEVICE, MAESTRO_DEDICATED_UDID, E2E_FLEET_BRAND
maestro_prepare_dedicated_sim() {
  local brand="${1:?brand (house|budget|kaizen|language|health)}"
  if [[ "${E2E_DEDICATED_SIM:-1}" == "0" || "${E2E_PARALLEL_FLEET:-0}" == "1" ]]; then
    export E2E_FLEET_BRAND="${brand}"
    device="${E2E_DEVICE:-$(maestro_fleet_brand_field "${brand}" device)}"
    export E2E_DEVICE="${device}"
    udid="${MAESTRO_DEDICATED_UDID:-$(maestro_fleet_find_udid "${device}")}"
    if [[ -z "${udid}" ]]; then
      echo "maestro-dedicated-sim: no simulator named '${device}' — create it in Xcode" >&2
      return 1
    fi
    xcrun simctl boot "${udid}" 2>/dev/null || true
    xcrun simctl bootstatus "${udid}" -b 2>/dev/null || sleep 3
    export MAESTRO_DEDICATED_UDID="${udid}"
    metro_port="$(maestro_fleet_brand_field "${brand}" metro_port)"
    echo "maestro-dedicated-sim: ${brand} → ${device} (${udid}) Metro :${metro_port} (parallel — other fleet sims untouched)" >&2
    return 0
  fi

  local device device_b app_id udid metro_port
  device="$(maestro_fleet_brand_field "${brand}" device)"
  device_b="$(maestro_fleet_brand_field "${brand}" device_b 2>/dev/null || true)"
  app_id="$(maestro_fleet_brand_field "${brand}" app_id)"
  metro_port="$(maestro_fleet_brand_field "${brand}" metro_port)"

  # A brand owns a PAIR of devices: `device` (A, the default) and `device_b`
  # (B, the peer used by two-device suites). Both are registered, so both are
  # legitimate targets — previously only A was accepted and `E2E_DEVICE=<B>`
  # was silently overridden to A, which is worse than refusing: the suite runs
  # green on a device the caller never asked for. Anything outside the pair is
  # still rejected, so a typo can't send a suite to another brand's simulator.
  if [[ -n "${E2E_DEVICE:-}" && "${E2E_DEVICE}" != "${device}" ]]; then
    if [[ -n "${device_b}" && "${E2E_DEVICE}" == "${device_b}" ]]; then
      device="${device_b}"
    else
      echo "maestro-dedicated-sim: E2E_DEVICE=${E2E_DEVICE} ignored — ${brand} uses ${device}${device_b:+ or ${device_b}} only" >&2
    fi
  fi
  export E2E_DEVICE="${device}"
  export E2E_FLEET_BRAND="${brand}"

  local other other_device other_udid other_app other_runner
  for other in "${MAESTRO_FLEET_BRANDS[@]}"; do
    [[ "${other}" == "${brand}" ]] && continue
    other_device="$(maestro_fleet_brand_field "${other}" device)"
    other_app="$(maestro_fleet_brand_field "${other}" app_id)"
    other_runner="$(maestro_fleet_brand_field "${other}" runner)"
    other_udid="$(maestro_fleet_find_udid "${other_device}")"
    [[ -n "${other_udid}" ]] || continue
    E2E_MAESTRO_KILL_FORCE=1 maestro_scoped_kill_udid "${other_udid}" "${other_app}" "${other_runner}" 2>/dev/null || true
    # Maestro driver xcodebuild holds simulators booted — kill by destination UDID.
    pgrep -fl 'xcodebuild.*maestro-driver-ios' 2>/dev/null | grep -F "id=${other_udid}" | awk '{print $1}' | while read -r xpid; do
      [[ -n "${xpid}" ]] && kill -9 "${xpid}" 2>/dev/null || true
    done || true
  done

  # Shut down every simulator, then boot only this brand's device (exclusive).
  xcrun simctl shutdown all 2>/dev/null || true
  sleep 2

  # Any Maestro job targeting a different bundle id must not run alongside us.
  local stray
  stray="$(pgrep -fl 'maestro\.cli\.AppKt' 2>/dev/null | grep -v "${app_id}" | awk '{print $1}' | head -5 || true)"
  if [[ -n "${stray}" ]]; then
    echo "maestro-dedicated-sim: stopping Maestro for other apps → ${stray//$'\n'/ }" >&2
    # shellcheck disable=SC2046
    kill -9 ${stray} 2>/dev/null || true
    sleep 2
  fi

  # Resolve from ${device}, not from the brand — the brand helper always returns
  # the A device, which would silently boot A after B was selected above.
  udid="$(maestro_fleet_find_udid "${device}")"
  if [[ -z "${udid}" ]]; then
    echo "maestro-dedicated-sim: no simulator named '${device}' — create it in Xcode" >&2
    return 1
  fi

  xcrun simctl boot "${udid}" 2>/dev/null || true
  xcrun simctl bootstatus "${udid}" -b 2>/dev/null || sleep 5

  export MAESTRO_DEDICATED_UDID="${udid}"
  export BUDGET_METRO_PORT="${metro_port}"
  echo "maestro-dedicated-sim: ${brand} → ${device} (${udid}) Metro :${metro_port}; other fleet sims shut down" >&2
}
