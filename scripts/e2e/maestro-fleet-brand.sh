#!/usr/bin/env bash
# Fleet brand metadata for parallel Maestro E2E (one sim + Metro port per app).
# Source from suite runners / scoped-kill — do not execute directly.
set -euo pipefail

# maestro_fleet_brand_field <brand> <field>
# Fields: device, app_id, metro_port, runner, scheme
maestro_fleet_brand_field() {
  local brand="${1:?brand}"
  local field="${2:?field}"
  case "${brand}" in
    house)
      case "${field}" in
        device) echo "House-A" ;;
        device_b) echo "House-B" ;;
        # Third single-user device, same role as Budget-C: lets a House suite
        # run while the A/B pair is already committed to a multi-member or
        # long-running suite. NOT a per-suite fork — any House suite may take it
        # via E2E_DEVICE.
        device_c) echo "House-C" ;;
        app_id) echo "com.symply.house" ;;
        metro_port) echo "8083" ;;
        runner) echo "run-house-suite.sh" ;;
        scheme) echo "simplehouse" ;;
        *) return 1 ;;
      esac
      ;;
    budget)
      case "${field}" in
        device) echo "Budget-A" ;;
        device_b) echo "Budget-B" ;;
        # Third single-user device so the long receipt-recognition quality suite
        # can run without clobbering the A/B pair a multi-member suite is using.
        # NOT a per-suite fork — any Budget suite may take it via E2E_DEVICE.
        device_c) echo "Budget-C" ;;
        app_id) echo "com.symply.budget" ;;
        metro_port) echo "8082" ;;
        runner) echo "run-budget-suite.sh" ;;
        scheme) echo "simplebudget" ;;
        *) return 1 ;;
      esac
      ;;
    kaizen)
      case "${field}" in
        device) echo "Kaizen-A" ;;
        device_b) echo "Kaizen-B" ;;
        app_id) echo "com.symply.kaizen" ;;
        metro_port) echo "8081" ;;
        runner) echo "run-kaizen-suite.sh" ;;
        scheme) echo "kaizen" ;;
        *) return 1 ;;
      esac
      ;;
    language)
      case "${field}" in
        device) echo "Language-A" ;;
        device_b) echo "Language-B" ;;
        app_id) echo "com.symply.language" ;;
        metro_port) echo "8084" ;;
        runner) echo "run-language-suite.sh" ;;
        scheme) echo "simplelanguage" ;;
        *) return 1 ;;
      esac
      ;;
    health)
      case "${field}" in
        device) echo "Health-A" ;;
        device_b) echo "Health-B" ;;
        app_id) echo "com.symply.health" ;;
        metro_port) echo "8085" ;;
        runner) echo "run-health-suite.sh" ;;
        scheme) echo "simplehealth" ;;
        *) return 1 ;;
      esac
      ;;
    *)
      echo "Unknown fleet brand: ${brand} (house|budget|kaizen|language|health)" >&2
      return 1
      ;;
  esac
}

maestro_fleet_find_udid() {
  local device_name="${1:?device name}"
  xcrun simctl list devices available 2>/dev/null \
    | grep "${device_name}" \
    | grep -Eo '[A-F0-9-]{36}' \
    | head -1 || true
}

# Resolve brand → UDID (uses E2E_DEVICE override when set for that brand's runner).
maestro_fleet_brand_udid() {
  local brand="${1:?brand}"
  local device="${E2E_DEVICE:-$(maestro_fleet_brand_field "${brand}" device)}"
  maestro_fleet_find_udid "${device}"
}

# Create a fleet iPhone sim when missing (House pattern). No-op when sim exists.
maestro_fleet_ensure_iphone_sim() {
  local device_name="${1:?device name}"
  local udid
  udid="$(maestro_fleet_find_udid "${device_name}")"
  if [[ -n "${udid}" ]]; then
    echo "${udid}"
    return 0
  fi
  if [[ "${E2E_AUTO_CREATE_SIM:-1}" != "1" ]]; then
    return 1
  fi
  local device_type runtime
  device_type="$(xcrun simctl list devicetypes 2>/dev/null | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-[0-9A-Za-z-]+' | head -1 || true)"
  if [[ -z "${device_type}" ]]; then
    device_type="$(xcrun simctl list devicetypes 2>/dev/null | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-[^ )]+' | head -1 || true)"
  fi
  runtime="$(xcrun simctl list runtimes 2>/dev/null | grep -Eo 'com.apple.CoreSimulator.SimRuntime.iOS[^ ]*' | tail -1 || true)"
  if [[ -z "${device_type}" || -z "${runtime}" ]]; then
    return 1
  fi
  echo "preflight: creating simulator '${device_name}' (${device_type})" >&2
  xcrun simctl create "${device_name}" "${device_type}" "${runtime}" >/dev/null || return 1
  maestro_fleet_find_udid "${device_name}"
}

# npm script hint for a brand's Metro (parallel fleet).
maestro_fleet_metro_start_hint() {
  local brand="${1:?brand}"
  local port
  port="$(maestro_fleet_brand_field "${brand}" metro_port)"
  echo "npm run start:${brand} -- --port ${port}"
}

# The feature directories that make up the House Maestro suite.
#
# ONE list, because there were four: run-house-suite.sh, -sequential.sh,
# -resume.sh and -live-report.sh each carried a literal copy, and they drifted.
# `house-v2` was in none of them, so the eighteen `lf-*` local-first flows were
# unscheduled by every runner AND — when run by path — filtered out of the
# report by `is_house_flow`, which renders as an empty suite rather than an
# error. Coverage that never runs is worse than no coverage: it reads as green.
#
# Same rule as the device names above: a list pinned in a runner is how the
# registry silently goes stale.
#
# Read it into an array with:
#   HOUSE_FLOW_DIR_NAMES=()
#   while IFS= read -r _d; do [[ -n "$_d" ]] && HOUSE_FLOW_DIR_NAMES+=("$_d"); done \
#     < <(maestro_house_flow_dirs)
maestro_house_flow_dirs() {
  cat <<'HOUSE_FLOW_DIRS_EOF'
auth
onboarding
home
tasks
mira
aihousekeeper
chat
reports
notifications
profile
settings
my-home
home-projects
households
spaces
task-planning
floor-plans
contractors
gardening
garden
utilities
scroll
smoke
platform
house-v2
HOUSE_FLOW_DIRS_EOF
}
