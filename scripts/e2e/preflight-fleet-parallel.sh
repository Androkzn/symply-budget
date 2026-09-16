#!/usr/bin/env bash
# Preflight for parallel fleet Maestro — one dedicated sim + Metro per brand.
#
# Usage (sourced or run directly):
#   APPS="house budget kaizen language health" ./scripts/e2e/preflight-fleet-parallel.sh
#
# Env:
#   E2E_PREFLIGHT_SKIP=1       — skip all checks
#   E2E_AUTO_CREATE_SIM=1      — create missing iPhone sims (default 1)
#   E2E_PREFLIGHT_STRICT=1     — fail when app bundle missing on sim (default 1)
#   E2E_PREFLIGHT_BOOT=1       — boot each brand sim before suites start (default 1)
set -euo pipefail

_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "${_SCRIPT_DIR}/maestro-fleet-brand.sh"

preflight_fleet_parallel() {
  local apps="${1:?space-separated brand list}"
  if [[ "${E2E_PREFLIGHT_SKIP:-0}" == "1" ]]; then
    echo "preflight-fleet-parallel: skipped (E2E_PREFLIGHT_SKIP=1)"
    return 0
  fi

  local brand device app_id port udid metro_hint
  local missing_sims=() missing_metros=() missing_apps=()
  local -a ready_udids=()

  echo "preflight-fleet-parallel: checking ${apps}"

  for brand in ${apps}; do
    device="$(maestro_fleet_brand_field "${brand}" device)"
    app_id="$(maestro_fleet_brand_field "${brand}" app_id)"
    port="$(maestro_fleet_brand_field "${brand}" metro_port)"
    metro_hint="$(maestro_fleet_metro_start_hint "${brand}")"

    udid="$(maestro_fleet_ensure_iphone_sim "${device}" || true)"
    if [[ -z "${udid}" ]]; then
      missing_sims+=("${brand}:${device}")
      continue
    fi
    ready_udids+=("${udid}")

    if ! curl -sf --connect-timeout 2 "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      missing_metros+=("${brand}:localhost:${port} → ${metro_hint}")
    fi

    if [[ "${E2E_PREFLIGHT_STRICT:-1}" == "1" ]]; then
      if ! xcrun simctl get_app_container "${udid}" "${app_id}" >/dev/null 2>&1; then
        missing_apps+=("${brand}:${app_id} on ${device}")
      fi
    fi
  done

  if ((${#missing_sims[@]} > 0)); then
    echo "preflight-fleet-parallel: missing simulators (create in Xcode or set E2E_AUTO_CREATE_SIM=1):" >&2
    for line in "${missing_sims[@]}"; do echo "  - ${line}" >&2; done
    return 1
  fi

  if ((${#missing_metros[@]} > 0)); then
    echo "preflight-fleet-parallel: Metro not running on required ports:" >&2
    for line in "${missing_metros[@]}"; do echo "  - ${line}" >&2; done
    echo "Start each Metro in a separate terminal before run-fleet-parallel.sh." >&2
    return 1
  fi

  if ((${#missing_apps[@]} > 0)); then
    echo "preflight-fleet-parallel: app not installed on dedicated sim:" >&2
    for line in "${missing_apps[@]}"; do echo "  - ${line}" >&2; done
    echo "Build + install each brand on its sim, or set E2E_PREFLIGHT_STRICT=0 to skip." >&2
    return 1
  fi

  if [[ "${E2E_PREFLIGHT_BOOT:-1}" == "1" ]]; then
    for udid in "${ready_udids[@]}"; do
      xcrun simctl boot "${udid}" 2>/dev/null || true
    done
    for udid in "${ready_udids[@]}"; do
      xcrun simctl bootstatus "${udid}" -b 2>/dev/null || sleep 3
    done
  fi

  echo "preflight-fleet-parallel: OK — ${#ready_udids[@]} sim(s), Metro ports verified"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  APPS="${APPS:-house budget kaizen language health}"
  preflight_fleet_parallel "${APPS}"
fi
