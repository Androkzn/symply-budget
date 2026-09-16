#!/usr/bin/env bash
#
# Two-member household sync E2E for Symply Budget V2 (local-first).
#
# Two booted simulators, two different Symply accounts, ONE household. The
# verification phases drive BOTH devices CONCURRENTLY — two Maestro processes
# at once — so each member is acting while the other acts, which is the real
# shape of a shared household ledger.
#
# Concurrency needs no rendezvous channel because the flows rendezvous on the
# data itself: every parallel flow does its own half and then polls sync until
# the PEER's change appears. Whichever device gets there first simply waits
# inside its own poll loop.
#
# Enrolment is the exception and stays sequential — an owner cannot approve a
# claim the invitee has not made yet.
#
# Devices — DEDICATED to this suite, so it can run alongside the single-device
# Budget suite and the chat-pair suite without either disturbing the other:
#   A = owner    (E2E_DEVICE_A, default Budget-A) — E2E_EMAIL
#   B = invitee  (E2E_DEVICE_B, default Budget-B) — E2E_EMAIL_SECONDARY
# It also runs its own Metro (:8092) and takes no Maestro global lock.
#
# Usage:
#   ./scripts/e2e/run-budget-multi-member-sync.sh
#   MM_PARALLEL=0 ./scripts/e2e/run-budget-multi-member-sync.sh   # serial fallback
#
# NOTE ON LOAD: two concurrently driven iOS-26 simulators is the condition this
# repo's notes flag for XCUITest driver drops. If steps fail with
# "Failed to connect to 127.0.0.1:<port> / Connection refused", that is the
# driver dying under load, not the app — re-run on an idle machine, or use
# MM_PARALLEL=0.
#
# Report: documents/engineering/testing/reports/budget-multi-member/<ts>/index.html
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW_DIR="${ROOT}/e2e/maestro/budget-multi-member"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

MM_PARALLEL="${MM_PARALLEL:-1}"
# DEDICATED RESOURCES. This suite shares a machine (and a git checkout) with
# other Budget runs, so it owns nothing they use: its own two simulators, its
# own Metro port, its own log. It never takes the Maestro global lock and never
# touches Budget-A / Budget-B, which the single-device suite and the
# chat-pair suite drive.
METRO_PORT="${BUDGET_METRO_PORT:-8092}"
METRO_LOG="${METRO_LOG:-/tmp/metro-budget-mm.log}"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget-multi-member"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"

# Titles carry the run timestamp so a re-run never collides with rows an
# earlier run left behind on either device's ledger.
OWNER_TITLE="${OWNER_TITLE:-MM Owner ${RUN_TS}}"
MEMBER_TITLE="${MEMBER_TITLE:-MM Member ${RUN_TS}}"
# Deliberately odd amounts: the convergence check greps the rendered hierarchy,
# and round numbers collide with other rows on a real ledger.
OWNER_AMOUNT="41.17"
MEMBER_AMOUNT="58.93"
OWNER_AMOUNT_2="63.21"
MEMBER_AMOUNT_2="77.45"
# Lists render ROUNDED whole dollars, and the assertions are regexes where "$"
# would be an anchor — so pass digits only: 63.21 -> "63", 77.45 -> "77".
OWNER_AMOUNT_2_SHOWN="63"
MEMBER_AMOUNT_2_SHOWN="77"
# Concurrent edit of the SAME row. No expected winner is declared — the runner
# reads both devices afterwards and requires them to agree.
OWNER_CONFLICT_AMOUNT="88.12"
MEMBER_CONFLICT_AMOUNT="94.36"
# Rendered forms: lists round to whole dollars, and "$" is a regex anchor, so
# every on-screen comparison uses digits only.
OWNER_CONFLICT_SHOWN="88"
MEMBER_CONFLICT_SHOWN="94"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "${ROOT}/e2e/credentials.local"
  set +a
fi

if ! command -v maestro >/dev/null 2>&1; then
  echo "Maestro not found. Install: curl -fsSL https://get.maestro.mobile.dev | bash" >&2
  exit 1
fi
for var in E2E_EMAIL E2E_PASSWORD E2E_EMAIL_SECONDARY E2E_PASSWORD_SECONDARY; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing ${var} — set it in e2e/credentials.local. Two DIFFERENT accounts are required." >&2
    exit 1
  fi
done
if [[ "${E2E_EMAIL}" == "${E2E_EMAIL_SECONDARY}" ]]; then
  echo "E2E_EMAIL and E2E_EMAIL_SECONDARY are the same account — this test needs two members." >&2
  exit 1
fi

DEVICE_A_NAME="${E2E_DEVICE_A:-Budget-A}"
DEVICE_B_NAME="${E2E_DEVICE_B:-Budget-B}"
source "$(dirname "${BASH_SOURCE[0]}")/sim-disk-guard.sh"
sim_guard_pair "${DEVICE_A_NAME}" "${DEVICE_B_NAME}"

find_udid() {
  xcrun simctl list devices available \
    | grep -F "${1} (" \
    | grep -Eo '[A-F0-9-]{36}' | head -1 || true
}

UDID_A="$(find_udid "${DEVICE_A_NAME}")"
UDID_B="$(find_udid "${DEVICE_B_NAME}")"

# Create either device on first run so the suite is self-provisioning.
create_sim() {
  local name="$1" device_type runtime
  device_type="$(xcrun simctl list devicetypes | grep -Eo 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro' | head -1 || true)"
  runtime="$(xcrun simctl list runtimes | grep -Eo 'com.apple.CoreSimulator.SimRuntime.iOS[^ ]*' | tail -1 || true)"
  if [[ -z "${device_type}" || -z "${runtime}" ]]; then
    echo "Cannot create ${name}: no iPhone device type / iOS runtime found." >&2
    return 1
  fi
  echo "[mm] creating ${name} (${device_type} / ${runtime})"
  xcrun simctl create "${name}" "${device_type}" "${runtime}" >/dev/null
}
[[ -z "${UDID_A}" ]] && { create_sim "${DEVICE_A_NAME}" || exit 1; UDID_A="$(find_udid "${DEVICE_A_NAME}")"; }
[[ -z "${UDID_B}" ]] && { create_sim "${DEVICE_B_NAME}" || exit 1; UDID_B="$(find_udid "${DEVICE_B_NAME}")"; }
if [[ -z "${UDID_A}" || -z "${UDID_B}" ]]; then
  echo "Simulator not found (A='${DEVICE_A_NAME}' B='${DEVICE_B_NAME}')." >&2
  exit 1
fi

# Refuse to run against another brand's generated files rather than rebuilding
# them: tokens/icons are shared checkout state, and regenerating mid-run would
# clobber whatever brand a concurrent session is building (see the
# concurrent-brand-build hazard in the repo notes).
BRAND_LINE="$(head -1 "${ROOT}/src/brand/tokens.generated.ts" 2>/dev/null || true)"
if [[ "${BRAND_LINE}" != *"APP_BRAND=symply-budget"* ]]; then
  echo "Generated brand files are not symply-budget:" >&2
  echo "  ${BRAND_LINE}" >&2
  echo "Another session is mid-build. Wait for it, or run: APP_BRAND=symply-budget npm run tokens:build && npm run icons:build" >&2
  exit 1
fi

# Disk headroom, checked BEFORE anything runs.
#
# Maestro keeps a screenshot + view hierarchy for every step of every run, and
# ~/.maestro/tests grows without bound — it reached 44 GB in a single day here
# and filled the volume. A full disk does not announce itself: the simulator
# wedges, taps stop registering, forms refuse to close, saves never complete.
# That looks exactly like an app bug and is not one, so guard it up front.
MM_FREE_MB="$(df -m / | awk 'NR==2 {print $4}')"
if (( MM_FREE_MB < 5000 )); then
  echo "[mm] only ${MM_FREE_MB}MB free — pruning Maestro artifacts older than the 10 most recent runs"
  ls -1t "${HOME}/.maestro/tests" 2>/dev/null | tail -n +11 | while IFS= read -r _d; do
    [[ -n "${_d}" ]] && rm -rf "${HOME}/.maestro/tests/${_d}"
  done
  MM_FREE_MB="$(df -m / | awk 'NR==2 {print $4}')"
fi
if (( MM_FREE_MB < 2000 )); then
  echo "[mm] ABORTING: only ${MM_FREE_MB}MB free. A full disk wedges the simulator and the" >&2
  echo "[mm] failures it causes look like app bugs. Free space and re-run." >&2
  exit 1
fi
echo "[mm] disk headroom: ${MM_FREE_MB}MB free"

echo "[mm] other Metro instances (left alone):"
for _p in 8081 8082 8083 8084 8085; do
  [[ "${_p}" == "${METRO_PORT}" ]] && continue
  curl -sf "http://localhost:${_p}/status" >/dev/null 2>&1 && echo "[mm]   :${_p} in use by another session"
done

echo "[mm] owner   A=${DEVICE_A_NAME} ${UDID_A}  <${E2E_EMAIL}>"
echo "[mm] invitee B=${DEVICE_B_NAME} ${UDID_B}  <${E2E_EMAIL_SECONDARY}>"
echo "[mm] parallel driving: ${MM_PARALLEL}"

xcrun simctl boot "${UDID_A}" 2>/dev/null || true
xcrun simctl boot "${UDID_B}" 2>/dev/null || true

# Password AutoFill hijacks inputText on secure fields — off on both devices.
for udid in "${UDID_A}" "${UDID_B}"; do
  for _plist in \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
  do
    [[ -f "${_plist}" ]] && plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  done
  xcrun simctl spawn "${udid}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true
done

# Both devices need the app, and NEITHER may have it.
#
# This used to read "install A's bundle if B has none", which assumed A is the
# device you last built to. `sim_guard_pair` above breaks that assumption every
# time it fires: a run leaves each device well over the 800 MB cap, so the next
# run erases BOTH, and an erase takes the app with it. The suite then aborted
# with "not installed on Budget-B and no bundle was found on Budget-A" — telling
# you to build, which grows the device, which trips the guard, which erases it
# again. The guard and the installer deadlocked, and the suite could not start
# at all until someone installed by hand between the two.
#
# So the bundle is resolved from three places in order — whichever device still
# has it, then the build products on disk — and installed on every device that
# is missing it. DerivedData is the one that matters after an erase: it is a
# dev-client build, so the JS still comes from Metro and a native shell built
# days ago is exactly as current as the working tree it loads.
find_app_bundle() {
  local udid path
  for udid in "${UDID_A}" "${UDID_B}"; do
    path="$(xcrun simctl listapps "${udid}" 2>/dev/null \
      | grep -A4 '"com.symply.budget"' | grep -Eo '/[^"]*\.app' | head -1 || true)"
    [[ -n "${path}" && -d "${path}" ]] && { echo "${path}"; return 0; }
  done
  # Newest simulator build product whose bundle id actually matches. The name is
  # not enough: every brand builds as SymplyEcosystem.app, so a House or Kaizen
  # build would install cleanly and then fail every flow on a missing scheme.
  local candidate
  while IFS= read -r candidate; do
    [[ -d "${candidate}" ]] || continue
    if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
      "${candidate}/Info.plist" 2>/dev/null)" == "com.symply.budget" ]]; then
      echo "${candidate}"
      return 0
    fi
  done < <(ls -1dt "${HOME}"/Library/Developer/Xcode/DerivedData/*/Build/Products/Debug-iphonesimulator/*.app 2>/dev/null)
  return 1
}

MM_APP_PATH=""
for _u in "${UDID_A}" "${UDID_B}"; do
  xcrun simctl listapps "${_u}" 2>/dev/null | grep -q "com.symply.budget" && continue
  if [[ -z "${MM_APP_PATH}" ]]; then
    MM_APP_PATH="$(find_app_bundle || true)"
    if [[ -z "${MM_APP_PATH}" ]]; then
      echo "com.symply.budget is on neither device and no matching .app was found in DerivedData." >&2
      echo "Build Budget once (npm run prepare:xcode:budget && npm run ios) and re-run." >&2
      exit 1
    fi
  fi
  echo "[mm] installing ${MM_APP_PATH} on ${_u}"
  xcrun simctl boot "${_u}" 2>/dev/null || true
  xcrun simctl install "${_u}" "${MM_APP_PATH}"
done

mkdir -p "${REPORT_OUT}" "${HOME}/.maestro/tests"
# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="${REPORT_OUT}"
[[ "$(dirname "${REPORT_OUT}")" == "${REPORTS_BASE}" ]] && LATEST_TARGET="$(basename "${REPORT_OUT}")"
ln -sfn "${LATEST_TARGET}" "${REPORTS_BASE}/latest"
AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "${AGG_DIR}"
# A timestamp that does NOT move once the run starts.
#
# The live report used to select flow dirs `-newer "${SUMMARY}"`, but
# summary.log is rewritten after every verdict — so it was always newer than the
# flow that had just finished, the find matched nothing, `.run-dirs` stayed
# empty, and index.html was never written. The banner promised a self-refreshing
# report and none ever appeared.
RUN_MARK="${REPORT_OUT}/.run-start"
: > "${RUN_MARK}"
BEFORE_RUNS="$(ls -1 "${HOME}/.maestro/tests" 2>/dev/null || true)"

# Metro: one dedicated instance serves BOTH of this suite's simulators.
# Started directly rather than through start-brand.sh/start-metro-logged.sh:
# those regenerate tokens+icons and pass --clear, which would rewrite shared
# checkout state and wipe a transform cache another session's Metro is using.
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  echo "[mm] starting dedicated Metro on :${METRO_PORT} (log ${METRO_LOG})"
  : > "${METRO_LOG}"
  (
    cd "${ROOT}" && APP_BRAND=symply-budget EXPO_PUBLIC_APP_BRAND=symply-budget \
      EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
      npx @expo/cli start --port "${METRO_PORT}" --dev-client 2>&1 | tee -a "${METRO_LOG}"
  ) &
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 && break
    sleep 2
  done
fi
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  echo "[mm] Metro did not come up on :${METRO_PORT}" >&2
  exit 1
fi
echo "[mm] Metro ready on :${METRO_PORT}"

# Build the bundle ONCE before any device asks for it. A cold Metro only starts
# bundling when the first client connects, and the dev client sits on a black
# screen with a spinner for the whole download — which reads exactly like a hung
# app and timed out sign-in on run 5. Doing it here also means device B does not
# pay for it again.
echo "[mm] pre-building the iOS bundle (cold Metro builds ~5k modules)"
BUNDLE_START="$(date +%s)"
curl -s -o /dev/null -w "" --max-time 900 \
  "http://localhost:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=ios&dev=true" || true
echo "[mm] bundle ready in $(( $(date +%s) - BUNDLE_START ))s"

login_url() {
  node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplebudget://e2e-login?' + params.toString());
  " "$1" "$2"
}

DEVCLIENT_URL="simplebudget://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}"
LOGIN_URL_A="$(login_url "${E2E_EMAIL}" "${E2E_PASSWORD}")"
LOGIN_URL_B="$(login_url "${E2E_EMAIL_SECONDARY}" "${E2E_PASSWORD_SECONDARY}")"

# LIVE report: regenerate every POLL seconds while the suite runs, and open it
# once. Waiting for the end means staring at nothing for a multi-hour run.
# NOTE commands.json lives at ~/.maestro/tests/<run>/<flow>/commands.json — depth
# 3; a shallower find silently links nothing.
start_live_report() {
  (
    local opened=0
    while :; do
      find "${HOME}/.maestro/tests" -maxdepth 3 -name commands.json -newer "${RUN_MARK}" 2>/dev/null \
        | while IFS= read -r _c; do
            _flow="$(dirname "${_c}")"; _ts="$(basename "$(dirname "${_flow}")")"
            ln -sfn "${_flow}" "${AGG_DIR}/${_ts}__$(basename "${_flow}")"
          done
      if [[ -n "$(ls -A "${AGG_DIR}" 2>/dev/null)" ]]; then
        node "${ROOT}/scripts/e2e/generate-report.mjs" \
          --maestro-dir "${AGG_DIR}" --metro-log "${METRO_LOG}" --out "${REPORT_OUT}" \
          --platform iOS --environment "${EXPO_PUBLIC_API_ENV:-staging}" \
          --device "${DEVICE_A_NAME}+${DEVICE_B_NAME}" \
          --progress-total "${MM_TOTAL_FLOWS}" --verdicts "${SUMMARY}" >/dev/null 2>&1
        if (( opened == 0 )) && [[ -f "${REPORT_OUT}/index.html" ]]; then
          open "${REPORT_OUT}/index.html" 2>/dev/null || true
          opened=1
        fi
      fi
      sleep "${MM_REPORT_POLL:-30}"
    done
  ) &
  LIVE_REPORT_PID=$!
}

FAILED=0
# Maestro invocations a full green run performs, for the report's progress bar:
# 2 sign-ins + 3 enrolment steps + 2 devices x 4 parallel phases + 4 cleanups.
MM_TOTAL_FLOWS=20
SUMMARY="${REPORT_OUT}/summary.log"
: > "${SUMMARY}"

note() {
  echo "$*" | tee -a "${SUMMARY}"
}

# run <A|B> <flow.yaml> [KEY=VALUE ...] — one Maestro invocation, own log file.
# Concurrency-safe: each device writes to its own log, never a shared one.
run() {
  local who="$1"; shift
  local flow="$1"; shift
  local udid email password login_url log
  if [[ "${who}" == "A" ]]; then
    udid="${UDID_A}"; email="${E2E_EMAIL}"; password="${E2E_PASSWORD}"; login_url="${LOGIN_URL_A}"
  else
    udid="${UDID_B}"; email="${E2E_EMAIL_SECONDARY}"; password="${E2E_PASSWORD_SECONDARY}"; login_url="${LOGIN_URL_B}"
  fi
  log="${REPORT_OUT}/steps-${who}.log"

  {
    echo ""
    echo "=== [${who}] ${flow} $* ==="
  } >>"${log}"

  local args=(
    test
    --device "${udid}"
    --format NOOP
    -e "APP_ID=com.symply.budget"
    -e "E2E_APP_SCHEME=simplebudget"
    -e "E2E_PLATFORM=ios"
    -e "E2E_METRO_DEVCLIENT_URL=${DEVCLIENT_URL}"
    -e "MM_METRO_PORT=${METRO_PORT}"
    -e "E2E_LOGIN_URL=${login_url}"
    -e "E2E_EMAIL=${email}"
    -e "E2E_PASSWORD=${password}"
  )
  if [[ "${MAESTRO_REINSTALL_DRIVER:-0}" != "1" ]]; then
    args+=(--no-reinstall-driver)
  fi
  while (( $# > 0 )); do
    args+=(-e "$1")
    shift
  done
  args+=("${FLOW_DIR}/${flow}")

  # Retry ONLY when the XCUITest driver died, never on a real assertion.
  #
  # Every step is its own `maestro test` invocation, and each spawns its own
  # `xcodebuild test-without-building` driver; on a busy machine those stack up
  # and contend for the device, and one dies mid-flow with
  # "Device became unreachable" / "Connection refused". That is infrastructure,
  # not a defect in the app, so it is worth another attempt — whereas retrying a
  # failed assertion would just launder a real regression into a pass. Same
  # policy (and same signatures) run-budget-suite.sh already uses.
  local attempt max_attempts=3 tail_out
  for attempt in $(seq 1 "${max_attempts}"); do
    if maestro "${args[@]}" >>"${log}" 2>&1; then
      (( attempt > 1 )) && echo "    (passed on attempt ${attempt})" >>"${log}"
      return 0
    fi
    tail_out="$(tail -80 "${log}")"
    # `kAXError…` / "Detected app crash during snapshot" is the iOS-26
    # accessibility-server flake: the AX server fails to hand back the main
    # window and Maestro reports it as an app crash, while the app itself is
    # fine and keeps serving requests. A REAL crash still fails the step — it
    # just reproduces on all three attempts rather than passing.
    if ! grep -qE "DeviceUnreachableException|became unreachable|IOSDriverTimeoutException|iOS driver not ready|Failed to connect|Connection refused|Killed: 9|kAXError|Detected app crash during snapshot" <<<"${tail_out}"; then
      return 1  # genuine flow failure — stop here
    fi
    if (( attempt < max_attempts )); then
      echo "    driver dropped on attempt ${attempt}/${max_attempts} — restarting it" >>"${log}"
      # Reap this device's stale driver so the next attempt starts a clean one.
      pkill -f "maestro-driver-ios-config.xctestrun.*${udid}" 2>/dev/null || true
      pkill -f "destination id=${udid}" 2>/dev/null || true
      sleep 12
    fi
  done
  return 1
}

# pair <label> -- <A flow + env...> -- <B flow + env...>
# Runs both devices at once (or one after the other when MM_PARALLEL=0).
pair() {
  local label="$1"; shift
  [[ "$1" == "--" ]] && shift
  local a_args=()
  while (( $# > 0 )) && [[ "$1" != "--" ]]; do a_args+=("$1"); shift; done
  [[ "$1" == "--" ]] && shift
  local b_args=("$@")

  local rc_a rc_b
  if [[ "${MM_PARALLEL}" == "1" ]]; then
    run A "${a_args[@]}" & local pid_a=$!
    # Stagger the second launch. Two Maestro processes performing the XCUITest
    # driver handshake at the same instant knock each other over ("Failed to
    # connect to 127.0.0.1:<port> / Connection refused", observed 2026-08-10).
    # The flows rendezvous on data, not on clock time, so a head start costs
    # nothing — the devices still overlap for the whole body of the flow.
    sleep "${MM_STAGGER_SECONDS:-25}"
    run B "${b_args[@]}" & local pid_b=$!
    wait "${pid_a}"; rc_a=$?
    wait "${pid_b}"; rc_b=$?
  else
    run A "${a_args[@]}"; rc_a=$?
    run B "${b_args[@]}"; rc_b=$?
  fi

  if (( rc_a == 0 )); then note "    PASS [A] ${label}"; else note "    FAIL [A] ${label}"; FAILED=1; fi
  if (( rc_b == 0 )); then note "    PASS [B] ${label}"; else note "    FAIL [B] ${label}"; FAILED=1; fi
  if (( FAILED != 0 )) && [[ "${MM_FAIL_FAST:-1}" == "1" ]]; then
    note "[mm] FAIL FAST — stopping the run at '${label}'"
  fi
  (( rc_a == 0 && rc_b == 0 ))
}

# single <who> <label> <flow> [env...] — for the ordered enrolment steps.
single() {
  local who="$1" label="$2"; shift 2
  if run "${who}" "$@"; then
    note "    PASS [${who}] ${label}"
    return 0
  fi
  note "    FAIL [${who}] ${label}"
  FAILED=1
  if [[ "${MM_FAIL_FAST:-1}" == "1" ]]; then
    note "[mm] FAIL FAST — stopping the run at '${label}'"
  fi
  return 1
}

# Scrape the invite the owner just created off the Metro log. This is the
# harness standing in for the person who reads the code out loud.
read_invite() {
  local line
  # Only lines written after this run started — an earlier run's invite is
  # expired/claimed and would fail the join in a confusing way.
  line="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
    | grep -a '\[E2E-INVITE\]' | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[mm] no [E2E-INVITE] line in ${METRO_LOG} — did Create invite succeed?" >&2
    return 1
  fi
  MM_CODE="$(sed -n 's/.*code=\([^ ]*\).*/\1/p' <<<"${line}")"
  MM_SECRET="$(sed -n 's/.*secret=\([^ ]*\).*/\1/p' <<<"${line}")"
  [[ -n "${MM_CODE}" && -n "${MM_SECRET}" ]]
}

# The verification digits, carried the other way — invitee → owner.
#
# The invitee's device derives them from ITS OWN enrolment keys; the owner's
# derives them from what the control plane reports those keys to be. Carrying
# this number across and asserting the owner's screen shows it is what makes the
# approval a real check rather than a tap.
scrape_join_sas() {
  local line
  line="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
    | grep -a '\[E2E-JOIN-SAS\]' | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[mm] no [E2E-JOIN-SAS] line in ${METRO_LOG} — did the join succeed?" >&2
    return 1
  fi
  local digits
  digits="$(sed -n 's/.*sas=\([0-9]*\).*/\1/p' <<<"${line}")"
  [[ "${digits}" =~ ^[0-9]{6}$ ]] || return 1
  # Grouped to match how the screen renders it — see the pair runner.
  MM_SAS="${digits:0:3} ${digits:3:3}"
}

# Does this device currently render <text> anywhere in its view hierarchy?
# `--device` is a GLOBAL option and must precede the subcommand. RN text lands
# in the `accessibilityText` attribute, which --compact includes.
device_shows() {
  local udid="$1" needle="$2"
  maestro --device "${udid}" hierarchy --compact --no-reinstall-driver 2>/dev/null \
    | grep -Fq "${needle}"
}

# The amount rendered ON THE ROW whose label contains <title>, e.g. "88".
#
# Scanning the whole screen for a number cannot answer "what does the contested
# row say" — the list holds rows from every earlier phase, so both candidate
# amounts are present at once and the comparison is meaningless (observed:
# A($88=1 $94=1) B($88=1 $94=1) on ten consecutive reads). Read the row itself.
device_row_amount() {
  local udid="$1" title="$2"
  idb ui describe-all --udid "${udid}" 2>/dev/null | python3 -c "
import sys, json, re
title = sys.argv[1]
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for e in els:
    label = (e.get('AXLabel') or '')
    if title in label:
        m = re.findall(r'\\\$([0-9,]+)', label)
        if m:
            print(m[-1].replace(',', ''))
        break
" "${title}"
}

# Row gestures (swipe tray open, tap Delete, confirm the native alert) live in
# their own file so they can be exercised against a booted simulator without
# running the suite. See the header there for why neither half survives in
# Maestro.
# shellcheck source=lib/idb-row.sh
source "$(dirname "$0")/lib/idb-row.sh"

INVITE_MARK="$(wc -l < "${METRO_LOG}" 2>/dev/null | tr -d ' ' || echo 0)"
INVITE_MARK="${INVITE_MARK:-0}"

start_live_report
note "[mm] live report: ${REPORT_OUT}/index.html (opens shortly, self-refreshes)"
note "[mm] === phase 1: enrolment (ordered) ==="
# Sign-in runs one device at a time ON PURPOSE, even though the two sign-ins are
# logically independent: this is each device's first Maestro invocation, so it
# is where the XCUITest driver cold-starts. Doing both at once is what killed
# run 3 — the drivers raced and both died. Serial here leaves both drivers warm,
# and every later phase (the ones that actually test sync) runs concurrently.
single A "mm-01-signin" mm-01-signin.yaml || true
(( FAILED == 0 )) && single B "mm-01-signin" mm-01-signin.yaml || true

# Something for the joiner to INHERIT, recorded before the invite is even
# minted. The rest of phase 1 proves the key arrives; this is what makes it
# possible to ask the question after it — does a brand-new member get the budget
# that was already there? Ordering is the whole point: written before the invite
# exists, so it can only reach B as history, never as a live op B happened to be
# online for.
BACKFILL_TITLE="Backfill ${RUN_TS}"
if (( FAILED == 0 )); then
  single A "mm-13-owner-pre-invite-spending" mm-13-owner-pre-invite-spending.yaml \
    "MM_SECTION=spending" "MM_TITLE=${BACKFILL_TITLE}" "MM_AMOUNT=${OWNER_AMOUNT}" || true
fi

if (( FAILED == 0 )); then
  single A "mm-02-owner-create-invite" mm-02-owner-create-invite.yaml || true
fi
if (( FAILED == 0 )); then
  sleep 2
  if read_invite; then
    note "[mm] invite code=${MM_CODE}"
    # One pasted link instead of two typed fields — see mm-03 for why.
    MM_LINK="symply-budget://lf-invite?secret=${MM_SECRET}&code=${MM_CODE}"
    single B "mm-03-member-join" mm-03-member-join.yaml "MM_LINK=${MM_LINK}" || true
    # The digits travel the OTHER way — invitee → owner. Scraped after the join
    # stage, because they do not exist until that device has claimed.
    (( FAILED == 0 )) && scrape_join_sas || true
    (( FAILED == 0 )) && single A "mm-04-owner-approve" mm-04-owner-approve.yaml "MM_SAS=${MM_SAS}" || true
    (( FAILED == 0 )) && single B "mm-05-member-enrol-sync" mm-05-member-enrol-sync.yaml || true
    # The acceptance question: joining a household fetches ALL of it, by itself.
    # mm-12 taps no sync — it only waits — so a pass means the device went and
    # got the pre-invite spending on its own.
    (( FAILED == 0 )) && single B "mm-12-member-backfill" mm-12-member-backfill.yaml \
      "MM_TITLE=${BACKFILL_TITLE}" || true
  else
    FAILED=1
  fi
fi

if (( FAILED == 0 )); then
  note "[mm] === phase 2: both members create, each sees the other (PARALLEL) ==="
  # A works in Spending, B in Planning — so this also proves the projection
  # covers more than one entity type.
  pair "mm-20-add-and-await-peer" -- \
    mm-20-add-and-await-peer.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" "MM_AMOUNT=${OWNER_AMOUNT}" \
      "MM_PEER_SECTION=planning" "MM_PEER_TITLE=${MEMBER_TITLE}" -- \
    mm-20-add-and-await-peer.yaml \
      "MM_SECTION=planning" "MM_TITLE=${MEMBER_TITLE}" "MM_AMOUNT=${MEMBER_AMOUNT}" \
      "MM_PEER_SECTION=spending" "MM_PEER_TITLE=${OWNER_TITLE}" || true
fi

if (( FAILED == 0 )); then
  note "[mm] === phase 3: both members modify, each sees the other's edit (PARALLEL) ==="
  pair "mm-21-modify-and-await-peer" -- \
    mm-21-modify-and-await-peer.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" "MM_AMOUNT=${OWNER_AMOUNT_2}" \
      "MM_PEER_SECTION=planning" "MM_PEER_TITLE=${MEMBER_TITLE}" "MM_PEER_AMOUNT=${MEMBER_AMOUNT_2}" "MM_PEER_AMOUNT_SHOWN=${MEMBER_AMOUNT_2_SHOWN}" -- \
    mm-21-modify-and-await-peer.yaml \
      "MM_SECTION=planning" "MM_TITLE=${MEMBER_TITLE}" "MM_AMOUNT=${MEMBER_AMOUNT_2}" \
      "MM_PEER_SECTION=spending" "MM_PEER_TITLE=${OWNER_TITLE}" "MM_PEER_AMOUNT=${OWNER_AMOUNT_2}" "MM_PEER_AMOUNT_SHOWN=${OWNER_AMOUNT_2_SHOWN}" || true
fi

if (( FAILED == 0 )); then
  note "[mm] === phase 4: concurrent edit of the SAME row → conflict resolution (PARALLEL) ==="
  pair "mm-23-conflict-parallel" -- \
    mm-23-conflict-parallel.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" "MM_AMOUNT=${OWNER_CONFLICT_AMOUNT}" "MM_AMOUNT_SHOWN=${OWNER_CONFLICT_SHOWN}" -- \
    mm-23-conflict-parallel.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" "MM_AMOUNT=${MEMBER_CONFLICT_AMOUNT}" "MM_AMOUNT_SHOWN=${MEMBER_CONFLICT_SHOWN}" || true

  if (( FAILED == 0 )); then
    # Winner-agnostic convergence: read the rendered amount off BOTH devices and
    # require them to agree on exactly one of the two candidates. Asserting a
    # fixed winner here would be asserting this machine's timing, not §8.4.
    note "[mm] --- convergence check (reading both devices) ---"
    CONVERGED=0
    for _try in $(seq 1 10); do
      A_VAL="$(device_row_amount "${UDID_A}" "${OWNER_TITLE}")"
      B_VAL="$(device_row_amount "${UDID_B}" "${OWNER_TITLE}")"
      note "[mm] attempt ${_try}: A row=\$${A_VAL:-?}  B row=\$${B_VAL:-?}"
      if [[ -n "${A_VAL}" && "${A_VAL}" == "${B_VAL}" ]]; then
        if [[ "${A_VAL}" == "${OWNER_CONFLICT_SHOWN}" ]]; then
          note "    PASS convergence — both devices show \$${A_VAL} (owner's edit won)"
        elif [[ "${A_VAL}" == "${MEMBER_CONFLICT_SHOWN}" ]]; then
          note "    PASS convergence — both devices show \$${A_VAL} (member's edit won)"
        else
          note "    PASS convergence — both devices show \$${A_VAL}"
        fi
        CONVERGED=1
        break
      fi
      sleep 6
    done
    if (( CONVERGED == 0 )); then
      note "    FAIL convergence — contested row differs: A=\$${A_VAL:-?} B=\$${B_VAL:-?}"
      FAILED=1
    fi

    # BR-044: the replica that discarded an incoming write must say so.
    #
    # Only ONE side can detect this without causality tracking — the replica
    # that received an op older than its own value — so accept it on either.
    # Retried, because the count reaches the sync store on the NEXT sync after
    # the merge, i.e. slightly after the values themselves converge.
    CONFLICT_SEEN=0
    for _try in $(seq 1 8); do
      for _u in "${UDID_A}" "${UDID_B}"; do
        if idb ui describe-all --udid "${_u}" 2>/dev/null | grep -q "merge conflict"; then
          CONFLICT_SEEN=1
          break
        fi
      done
      (( CONFLICT_SEEN == 1 )) && break
      sleep 5
    done
    if (( CONFLICT_SEEN == 1 )); then
      note "    PASS conflict surfaced to a member (BR-044)"
    else
      note "    FAIL no merge-conflict indicator on either device"
      FAILED=1
    fi
  fi
fi

if (( FAILED == 0 )); then
  note "[mm] === phase 5: both members delete, each sees the removal (PARALLEL) ==="
  # Three steps rather than one flow: Maestro parks each device on its row, the
  # runner performs the swipe + confirm through idb (see device_delete_row for
  # why neither half survives in Maestro), then Maestro verifies both the local
  # removal and the peer's tombstone arriving.
  pair "mm-22a-delete-open-confirm" -- \
    mm-22a-delete-open-confirm.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" -- \
    mm-22a-delete-open-confirm.yaml \
      "MM_SECTION=planning" "MM_TITLE=${MEMBER_TITLE}" || true
fi

if (( FAILED == 0 )); then
  note "[mm] both members delete their own row (idb gesture + native confirm)"
  DEL_A=0; DEL_B=0
  device_delete_row "${UDID_A}" "${OWNER_TITLE}" A || DEL_A=1
  device_delete_row "${UDID_B}" "${MEMBER_TITLE}" B || DEL_B=1
  if (( DEL_A == 0 )); then note "    PASS [A] mm-22-delete-gesture"; else note "    FAIL [A] mm-22-delete-gesture"; FAILED=1; fi
  if (( DEL_B == 0 )); then note "    PASS [B] mm-22-delete-gesture"; else note "    FAIL [B] mm-22-delete-gesture"; FAILED=1; fi
  if (( FAILED != 0 )) && [[ "${MM_FAIL_FAST:-1}" == "1" ]]; then
    note "[mm] FAIL FAST — stopping the run at 'mm-22-delete-gesture'"
  fi
fi

if (( FAILED == 0 )); then
  pair "mm-22b-delete-verify-peer" -- \
    mm-22b-delete-verify-peer.yaml \
      "MM_SECTION=spending" "MM_TITLE=${OWNER_TITLE}" \
      "MM_PEER_SECTION=planning" "MM_PEER_TITLE=${MEMBER_TITLE}" -- \
    mm-22b-delete-verify-peer.yaml \
      "MM_SECTION=planning" "MM_TITLE=${MEMBER_TITLE}" \
      "MM_PEER_SECTION=spending" "MM_PEER_TITLE=${OWNER_TITLE}" || true
fi

# Cleanup only after a GREEN run. On failure the run stops immediately
# (MM_FAIL_FAST=0 to disable) so the fix/re-run loop is not paying for four
# more Maestro invocations that prove nothing. Rows are timestamped per run, so
# leftovers never collide with the next attempt.
if (( FAILED == 0 )); then
  note "[mm] === cleanup ==="
  pair "mm-11-cleanup" -- \
    mm-11-cleanup.yaml "MM_TITLE=${OWNER_TITLE}" -- \
    mm-11-cleanup.yaml "MM_TITLE=${MEMBER_TITLE}" || true
else
  note "[mm] stopping after first failure — skipping cleanup (fail fast)"
fi

[[ -n "${LIVE_REPORT_PID:-}" ]] && kill "${LIVE_REPORT_PID}" 2>/dev/null

# Aggregate every flow run dir this session produced for the HTML report.
comm -13 <(printf '%s\n' "${BEFORE_RUNS}" | sort) <(ls -1 "${HOME}/.maestro/tests" 2>/dev/null | sort) \
  | while IFS= read -r tname; do
      [[ -n "${tname}" ]] || continue
      for flow in "${HOME}/.maestro/tests/${tname}"/*/; do
        flow="${flow%/}"
        [[ -f "${flow}/commands.json" ]] || continue
        ln -sfn "${flow}" "${AGG_DIR}/${tname}__$(basename "${flow}")"
      done
    done

if [[ -n "$(ls -A "${AGG_DIR}" 2>/dev/null)" ]]; then
  node "${ROOT}/scripts/e2e/generate-report.mjs" \
    --maestro-dir "${AGG_DIR}" --metro-log "${METRO_LOG}" --out "${REPORT_OUT}" \
    --platform iOS --environment "${EXPO_PUBLIC_API_ENV:-staging}" \
    --device "${DEVICE_A_NAME}+${DEVICE_B_NAME}" \
    --progress-total "${MM_TOTAL_FLOWS}" \
    --verdicts "${SUMMARY}" --final || true
  open "${REPORT_OUT}/index.html" 2>/dev/null || true
fi

echo ""
echo "[mm] report:  ${REPORT_OUT}/index.html"
echo "[mm] summary: ${SUMMARY}"
echo "[mm] steps:   ${REPORT_OUT}/steps-A.log , steps-B.log"
if (( FAILED != 0 )); then
  echo "[mm] RESULT: FAILED"
  exit 1
fi
echo "[mm] RESULT: PASSED"
