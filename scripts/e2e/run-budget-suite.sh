#!/usr/bin/env bash
#
# Symply Budget (brand `symply-budget`) Maestro E2E runner.
#
# Runs the modular flows under e2e/maestro/budget against a booted iOS simulator on
# BOTH iPhone and iPad classes. The Budget brand ships bundle id com.symply.budget
# and URL scheme simplebudget://. Budget authenticates against the LIVE staging
# Worker with the shared test account, so a real network + credentials are required
# — flows also run when the sim is already signed in.
#
# Coverage: dashboard/planning/spending/item forms, chat (rooms/message/@assistant/
# settings), savings (overview/entry/goal/recurring/import), pension, households,
# soft-transfer import/export, data-sharing, More/settings budget branch, wishes,
# bills, categories, transfer, category detail. Some sections (pension/wishes/bills)
# are not default-pinned tabs and are reached via simplebudget:/// deep links.
#
# Prereqs:
#   1. Maestro installed:  curl -fsSL https://get.maestro.mobile.dev | bash
#   2. The Budget brand built + installed on the target sim:
#        npm run prepare:xcode:budget   # (or an EAS/dev build of com.symply.budget)
#        APP_BRAND=symply-budget EXPO_PUBLIC_APP_BRAND=symply-budget npm run ios
#   3. e2e/credentials.local with E2E_EMAIL / E2E_PASSWORD (shared test account).
#
# Usage:
#   ./scripts/e2e/run-budget-suite.sh                                      # full suite
#   E2E_DEVICE=Budget-iPad ./scripts/e2e/run-budget-suite.sh               # iPad class
#   ./scripts/e2e/run-budget-suite.sh e2e/maestro/budget/budget-chat-message.yaml  # one flow
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=scripts/e2e/setup-maestro-cleanup.sh
source "$(dirname "$0")/setup-maestro-cleanup.sh"
# shellcheck source=scripts/e2e/maestro-global-lock.sh
source "$(dirname "$0")/maestro-global-lock.sh"
acquire_maestro_global_lock "budget"
# shellcheck source=scripts/e2e/maestro-dedicated-sim.sh
source "$(dirname "$0")/maestro-dedicated-sim.sh"
maestro_prepare_dedicated_sim budget
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro not found. Install: curl -fsSL https://get.maestro.mobile.dev | bash"
  exit 1
fi

DEVICE_NAME="${E2E_DEVICE:-Budget-A}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
# ONCE per suite, not once per flow.
#
# The serial loop below re-invokes this same script for every flow
# (`E2E_BUDGET_SINGLE=1 "${BASH_SOURCE[0]}" <flow>.yaml`), so this line used to
# run a full `du -sm` over the device's container tree 102 times in a row. On a
# 2.5 GB Budget-A that is hundreds of thousands of stat() calls per flow, all of
# it uninterruptible I/O — measured 2026-08-23 pushing the 1-minute load average
# from 7 to 322 mid-suite, which is itself what wedges the Maestro iOS driver
# and triggers the retry ladder. The retries then rebuild the driver (clang),
# which raises the load again: the guard was feeding the very failures it has
# nothing to do with.
#
# The guard's job is to erase an oversized device BEFORE the suite boots it, and
# a per-flow re-check cannot do that anyway — it explicitly refuses to erase
# while a suite is in flight. So the top-level invocation guards; the per-flow
# children skip.
[[ "${E2E_BUDGET_SINGLE:-0}" == "1" ]] || sim_guard "${DEVICE_NAME}"

find_udid() {
  xcrun simctl list devices available | grep "${1}" | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

UDID="${MAESTRO_DEDICATED_UDID:-$(find_udid "${DEVICE_NAME}")}"

# Auto-create a missing sim rather than failing: otherwise the brand registry
# and the machine drift, and a suite dies with a confusing "device not found".
# iPad names get an iPad device type so the same flows cover the iPad class;
# every other name (Budget-A/-B/-C, ad-hoc E2E_DEVICE) gets an iPhone.
if [[ -z "${UDID}" ]]; then
  if [[ "${DEVICE_NAME}" == *iPad* ]]; then
    DEVICE_TYPE="$(xcrun simctl list devicetypes | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro[^ ]*' | head -1 || true)"
  else
    # Clone an existing Budget-* sim's device type so C matches A/B exactly.
    # Never pick by list order: `tail -1` lands on iPhone-6s-Plus, which the
    # current iOS runtime rejects outright ("Incompatible device").
    DEVICE_TYPE="$(xcrun simctl list devices available --json 2>/dev/null \
      | /usr/bin/python3 -c 'import json,sys
d=json.load(sys.stdin)["devices"]
print(next((x.get("deviceTypeIdentifier","") for v in d.values() for x in v
  if x["name"].startswith("Budget-") and "iPad" not in x["name"]), ""))' 2>/dev/null || true)"
    if [[ -z "${DEVICE_TYPE}" ]]; then
      DEVICE_TYPE="$(xcrun simctl list devicetypes \
        | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-[0-9]+-Pro$' \
        | sort -t- -k2 -n | tail -1 || true)"
    fi
  fi
  RUNTIME="$(xcrun simctl list runtimes | grep -Eo 'com.apple.CoreSimulator.SimRuntime.iOS[^ ]*' | tail -1 || true)"
  if [[ -n "${DEVICE_TYPE}" && -n "${RUNTIME}" && "${E2E_AUTO_CREATE_SIM:-1}" == "1" ]]; then
    echo "Creating ${DEVICE_NAME} (${DEVICE_TYPE} / ${RUNTIME})"
    xcrun simctl create "${DEVICE_NAME}" "${DEVICE_TYPE}" "${RUNTIME}" >/dev/null || true
    UDID="$(find_udid "${DEVICE_NAME}")"
  fi
fi

if [[ -z "${UDID}" ]]; then
  echo "No simulator matching '${DEVICE_NAME}' found (and could not create one)."
  echo "Create one in Xcode, or set E2E_DEVICE to an existing simulator name."
  exit 1
fi

xcrun simctl boot "${UDID}" 2>/dev/null || true

# iOS Simulator Password AutoFill blocks Maestro inputText on secure fields and
# corrupts email clears — disable it on this device before the suite runs.
for _plist in \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
  "${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
do
  if [[ -f "${_plist}" ]]; then
    plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  fi
done
xcrun simctl spawn "${UDID}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true

# Seed real Budget test documents (receipts / expenses / savings statement).
if [[ "${E2E_SEED_FIXTURES:-1}" == "1" ]]; then
  bash "$(cd "$(dirname "$0")" && pwd)/seed-fixtures.sh" "${UDID}" budget || true
  # Encrypted restore UI (BUDGET-LF-011) — needs Documents/sweet-home-v2-restore.*.
  # App container must exist (app installed + launched at least once).
  bash "$(cd "$(dirname "$0")" && pwd)/seed-budget-restore-fixture.sh" "${UDID}" || true
fi

echo "Running Symply Budget Maestro E2E on ${DEVICE_NAME} (${UDID})"

MAESTRO_ENV=()
if [[ -n "${E2E_EMAIL:-}" && -n "${E2E_PASSWORD:-}" ]]; then
  # simplebudget://e2e-login — isE2ELoginUrl() matches the `e2e-login` host on any
  # scheme. Dev-build (Debug + Metro) autologin convenience; the flows fall back to
  # manual email login via the budget-login-email-if-needed subflow.
  E2E_LOGIN_URL="$(node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplebudget://e2e-login?' + params.toString());
  " "${E2E_EMAIL}" "${E2E_PASSWORD}")"
  MAESTRO_ENV+=(-e "E2E_LOGIN_URL=${E2E_LOGIN_URL}")
  MAESTRO_ENV+=(-e "E2E_EMAIL=${E2E_EMAIL}")
  MAESTRO_ENV+=(-e "E2E_PASSWORD=${E2E_PASSWORD}")
else
  echo "WARNING: E2E_EMAIL / E2E_PASSWORD unset — login will be skipped."
  echo "         Flows only pass if the sim is already signed into com.symply.budget."
fi
# Nested subflows (Maestro 2.6+) require appId — pass once for shared helpers.
MAESTRO_ENV+=(-e "APP_ID=com.symply.budget")
MAESTRO_ENV+=(-e "E2E_APP_SCHEME=simplebudget")
BUDGET_METRO_PORT="${BUDGET_METRO_PORT:-8082}"
MAESTRO_ENV+=(-e "E2E_METRO_DEVCLIENT_URL=simplebudget://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${BUDGET_METRO_PORT}")

FLOW_DIR="${ROOT}/e2e/maestro/budget"
TARGET="${1:-${FLOW_DIR}}"
CONFIG="${FLOW_DIR}/config.yaml"
DEBUG_DIR="${MAESTRO_DEBUG_DIR:-/tmp/maestro-budget-debug}"
OUTPUT_DIR="${MAESTRO_TEST_OUTPUT_DIR:-/tmp/maestro-budget-output}"
mkdir -p "${DEBUG_DIR}" "${OUTPUT_DIR}" "${HOME}/.maestro/tests"
# Prune stale Maestro artifacts only — never delete ~/.maestro/tests/* right
# before a run (Maestro writes commands-*.json there at flow end → false fail).
find "${HOME}/.maestro/tests" -mindepth 1 -maxdepth 1 -mmin +360 -exec rm -rf {} + 2>/dev/null || true
# Never prune ~/Library/Logs/maestro during an active run — Maestro finalizes
# into that directory at flow end; deleting it causes false failures.
find "${HOME}/Library/Logs/maestro" -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true

MAESTRO_DEVICE_ARGS=(
  --device "${UDID}"
  --format NOOP
)
if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
  MAESTRO_DEVICE_ARGS+=(--no-reinstall-driver)
fi
MAESTRO_ARGS=(
  --config "${CONFIG}"
  "${MAESTRO_DEVICE_ARGS[@]}"
)

EXTRA_ARGS=()
if (( $# > 1 )); then
  EXTRA_ARGS=("${@:2}")
fi

# Full-suite serial mode: run flows one-by-one with session prime between each
# (avoids iOS 26 / long-run navigation drift when Maestro batches 50 flows).
if [[ "${TARGET}" == "${FLOW_DIR}" && "${E2E_BUDGET_SINGLE:-0}" != "1" && "${E2E_BUDGET_SERIAL:-1}" == "1" && ${#EXTRA_ARGS[@]} -eq 0 ]]; then
  RUN_DATE="$(date +%Y-%m-%d)"
  RUN_ID="${MAESTRO_BUDGET_RUN_ID:-run12}"
  LOG="${MAESTRO_BUDGET_LOG:-${ROOT}/.tmp/e2e-logs/maestro-budget-full-${RUN_DATE}-${RUN_ID}.log}"
  case "${LOG}" in
    /*) ;;
    *) LOG="${ROOT}/${LOG}" ;;
  esac
  export MAESTRO_BUDGET_LOG="${LOG}"
  mkdir -p "$(dirname "${LOG}")"
  FLOWS=()
  while IFS= read -r _flow; do
    [[ -n "${_flow}" ]] && FLOWS+=("${_flow}")
  done < <(grep -A200 'flowsOrder:' "${CONFIG}" | grep '    - ' | sed 's/.*- //')
  echo "Serial Budget suite (${#FLOWS[@]} flows) → ${LOG}"
  if [[ "${MAESTRO_BUDGET_TRUNCATE:-0}" == "1" || ! -s "${LOG}" ]]; then
    : > "${LOG}"
  else
    echo "" | tee -a "${LOG}"
    echo "=== Serial suite resume $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "${LOG}"
  fi
  pass=0
  fail=0
  for flow in "${FLOWS[@]}"; do
    rm -rf "${DEBUG_DIR:?}"/* 2>/dev/null || true
    mkdir -p "${HOME}/.maestro/tests"
    echo "" | tee -a "${LOG}"
    echo "=== ${flow} ===" | tee -a "${LOG}"
    _flow_ok=0
    _max_attempts=2
    if [[ "${E2E_PARALLEL_FLEET:-0}" == "1" ]]; then
      _max_attempts=3
    fi
    for _attempt in $(seq 1 "${_max_attempts}"); do
      if E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 E2E_MAESTRO_LOCK=0 "${BASH_SOURCE[0]}" "${FLOW_DIR}/${flow}.yaml" >>"${LOG}" 2>&1; then
        _flow_ok=1
        break
      fi
      _flow_tail="$(tail -120 "${LOG}")"
      if grep -q "NoSuchFileException.*Library/Logs/maestro\|FileNotFoundException.*\.maestro/tests" <<<"${_flow_tail}" \
        && grep -q "COMPLETED\|Flow Passed\|1/1 Flow Passed" <<<"${_flow_tail}"; then
        echo "Maestro log finalize race on ${flow} — treating as pass (attempt ${_attempt})" | tee -a "${LOG}"
        _flow_ok=1
        break
      fi
      if grep -qE "IOSDriverTimeoutException|iOS driver not ready|Failed to connect|Connection refused|Killed: 9" <<<"${_flow_tail}"; then
        echo "Driver timeout on ${flow} (attempt ${_attempt}) — cooling down 45s" | tee -a "${LOG}"
        sleep 45
      else
        break
      fi
    done
    if ((_flow_ok)); then
      echo "[Passed] ${flow}" | tee -a "${LOG}"
      pass=$((pass + 1))
    else
      echo "[Failed] ${flow}" | tee -a "${LOG}"
      fail=$((fail + 1))
    fi
    if [[ "${flow}" != "budget-auth" && "${flow}" != "budget-prime-session" && "${flow}" != "budget-recover-session" ]]; then
      E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 E2E_MAESTRO_LOCK=0 "${BASH_SOURCE[0]}" "${FLOW_DIR}/budget-recover-session.yaml" >>"${LOG}" 2>&1 || true
      if [[ "${flow}" == budget-chat-* ]]; then
        E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 E2E_MAESTRO_LOCK=0 "${BASH_SOURCE[0]}" "${FLOW_DIR}/budget-recover-session.yaml" >>"${LOG}" 2>&1 || true
      fi
    fi
    sleep 2
  done
  echo "Suite complete: ${pass} pass / ${fail} fail" | tee -a "${LOG}"
  exit $(( fail > 0 ? 1 : 0 ))
fi

if [[ "${TARGET}" == *.yaml ]]; then
  bash "${ROOT}/scripts/e2e/maestro-flow-run.sh" \
    maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_DEVICE_ARGS[@]}" "${EXTRA_ARGS[@]:-}"
elif ((${#EXTRA_ARGS[@]} > 0)); then
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}" "${EXTRA_ARGS[@]}"
else
  maestro test "${MAESTRO_ENV[@]}" "${TARGET}" "${MAESTRO_ARGS[@]}"
fi
