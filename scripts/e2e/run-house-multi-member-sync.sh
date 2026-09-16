#!/usr/bin/env bash
#
# Two-member household sync E2E for Symply House V2 (local-first) — stage H12.
#
# Ported from the proven Budget suite
# (scripts/e2e/run-budget-multi-member-sync.sh +
#  documents/engineering/testing/BUDGET_MULTI_MEMBER_SYNC_E2E.md), with the four
# additions the House plan §12 requires: property switch mid-sync (H5),
# attachment round trip (H6), reminder scheduling from the local scheduler (H7)
# and widget projection after a peer's write (H7/N4).
#
# Two booted simulators, two different Symply accounts, ONE household. The
# verification phases drive BOTH devices CONCURRENTLY — two Maestro processes at
# once — so each member is acting while the other acts, which is the real shape
# of a shared household.
#
# Concurrency needs no rendezvous channel because the flows rendezvous on the
# data itself: every parallel flow does its own half and then polls sync until
# the PEER's change appears. Whichever device gets there first waits inside its
# own poll loop.
#
# Enrolment is the exception and stays sequential — an owner cannot approve a
# claim the invitee has not made yet.
#
# DEVICES come from the fleet registry (scripts/e2e/maestro-fleet-brand.sh,
# fields `device` / `device_b`), never hardcoded here:
#   A = owner    House-A — E2E_EMAIL
#   B = invitee  House-B — E2E_EMAIL_SECONDARY
# Override per run with E2E_DEVICE_A / E2E_DEVICE_B. Missing devices are created.
#
# Usage:
#   ./scripts/e2e/run-house-multi-member-sync.sh
#   MM_PARALLEL=0 ./scripts/e2e/run-house-multi-member-sync.sh   # serial fallback
#
# NOTE ON LOAD: two concurrently driven iOS-26 simulators is the condition this
# repo's notes flag for XCUITest driver drops. If steps fail with "Failed to
# connect to 127.0.0.1:<port> / Connection refused", that is the driver dying
# under load, not the app — re-run on an idle machine, or use MM_PARALLEL=0.
#
# Report: documents/engineering/testing/reports/house-multi-member/<ts>/index.html
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FLOW_DIR="${ROOT}/e2e/maestro/house-multi-member"
export PATH="${HOME}/.maestro/bin:${PATH}"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"
# Cap the Maestro JVM.
#
# Unbounded, the JVM sizes its heap off physical RAM (a quarter of 36 GB here),
# and on a machine running several suites at once that makes it the biggest
# single reservation on the box — so it is what the kernel kills first. On
# 2026-09-05 device B's `maestro test` was SIGKILLed before it executed one
# step, with swap at 26.0 GB of 26.6 GB; the suite reported a failed sign-in for
# a flow that never ran.
#
# Maestro drives a device over a socket. It does not need a gigabyte, and this
# suite runs TWO of them at once, so the cap is what lets the pair coexist with
# whatever else is on the machine.
export MAESTRO_OPTS="${MAESTRO_OPTS:--Xmx768m -XX:MaxMetaspaceSize=256m}"

MM_PARALLEL="${MM_PARALLEL:-1}"
# Run ONLY the enrolment chain — sign-in, the pre-invite row, create/join/approve
# and the key hand-off — and stop before the convergence phases.
#
# The invite process is the one part of this suite that is strictly ORDERED and
# strictly sequential (an owner cannot approve a claim nobody has made), so it
# is also the part worth re-running on its own while it is being repaired:
# phases 2-10 take hours and cannot start until it is green anyway. Phase 1 is
# unaffected by this switch; every later phase is gated by `phase_guard`, which
# is where the stop is applied.
MM_ENROLMENT_ONLY="${MM_ENROLMENT_ONLY:-0}"
BRAND="house"
APP_ID="com.symply.house"

# ---------------------------------------------------------------------------
# Disk. Checked BEFORE anything else, because a suite that runs out of disk
# mid-way produces dozens of failures that look like app bugs — 47 of them in
# one House run on 2026-08-13, all dying at `Open ${E2E_METRO_DEVCLIENT_URL}`
# with `java.io.IOException: No space left on device` in the log. The preflight
# refuses to start under 15 GB; `disk_floor_check` between phases stops the run
# cleanly the moment free space drops under 5 GB.
# shellcheck source=scripts/e2e/disk-floor-guard.sh
source "$(dirname "$0")/disk-floor-guard.sh"
disk_floor_preflight || exit 1

# ---------------------------------------------------------------------------
# Device names come from ONE registry. A name hardcoded in a runner is how
# registries silently go stale.
# maestro-fleet-brand.sh sets `set -euo pipefail`; this script deliberately runs
# without -e (every step is checked explicitly and a failed flow must not abort
# the reporting), so restore that immediately after sourcing.
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
set +e
set -uo pipefail

DEVICE_A_NAME="${E2E_DEVICE_A:-$(maestro_fleet_brand_field "${BRAND}" device)}"
DEVICE_B_NAME="${E2E_DEVICE_B:-$(maestro_fleet_brand_field "${BRAND}" device_b)}"
APP_SCHEME="$(maestro_fleet_brand_field "${BRAND}" scheme)"
# The registry's House port (8083) belongs to the SINGLE-DEVICE House suite.
# This suite runs its own Metro so the two can coexist, exactly as the Budget
# pair suite runs on :8092 beside the single-device :8082.
FLEET_METRO_PORT="$(maestro_fleet_brand_field "${BRAND}" metro_port)"
METRO_PORT="${HOUSE_MM_METRO_PORT:-8093}"
METRO_LOG="${METRO_LOG:-/tmp/metro-house-mm.log}"

RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/house-multi-member"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"

# ---------------------------------------------------------------------------
# Titles carry the run timestamp so a re-run never collides with rows an earlier
# run left behind on either device's ledger.
#
# House tasks have NO numeric field (TaskFormBody has no amount/cost input), so
# unlike Budget — which edits an amount and keeps the title as a stable anchor —
# this suite edits the TITLE and keeps a stable ANCHOR prefix. Every phase
# matches on the anchor; the trailing token is what changes.
OWNER_ANCHOR="${OWNER_ANCHOR:-MM Owner ${RUN_TS}}"
MEMBER_ANCHOR="${MEMBER_ANCHOR:-MM Member ${RUN_TS}}"
OWNER_TITLE_1="${OWNER_ANCHOR} v1"
# Phase 10 (garden). Distinct from the task anchors so the plan-list match
# cannot be satisfied by a row phase 2 created.
OWNER_GARDEN_TITLE="MM Yard A ${RUN_TS}"
MEMBER_GARDEN_TITLE="MM Yard B ${RUN_TS}"
MEMBER_TITLE_1="${MEMBER_ANCHOR} v1"
OWNER_TITLE_2="${OWNER_ANCHOR} v2"
MEMBER_TITLE_2="${MEMBER_ANCHOR} v2"
# Concurrent edit of the SAME row. No expected winner is declared — the runner
# reads both devices afterwards and requires them to agree on one of these.
OWNER_CONFLICT_TOKEN="A88"
MEMBER_CONFLICT_TOKEN="B94"
OWNER_CONFLICT_TITLE="${OWNER_ANCHOR} ${OWNER_CONFLICT_TOKEN}"
MEMBER_CONFLICT_TITLE="${OWNER_ANCHOR} ${MEMBER_CONFLICT_TOKEN}"
# House additions.
# The BACKFILL row: written by the owner BEFORE the invite is minted, so it can
# only ever reach the joiner as history. Its own anchor, because every other
# phase matches on OWNER_ANCHOR and would otherwise sweep this one up.
BACKFILL_TITLE="${BACKFILL_TITLE:-MM Backfill ${RUN_TS}}"
PROPERTY_ANCHOR="${PROPERTY_ANCHOR:-MM Prop Switch ${RUN_TS}}"
REMINDER_ANCHOR="${REMINDER_ANCHOR:-MM Reminder ${RUN_TS}}"
MM_DUE_PHRASE="${MM_DUE_PHRASE:-tomorrow}"
# STABLE (no timestamp) on purpose: the second property is created once and
# reused by every later run. A timestamped name would leave a new property
# behind on the shared test account on every execution, and mm-11 deliberately
# does not delete properties.
MM_PROPERTY_B="${MM_PROPERTY_B:-MM Second Property}"
# The SHARED household's display name. Scraped from the invite marker when the
# H3 screen provides it (see LF_* contract below); settable by hand otherwise.
MM_PROPERTY_A="${MM_PROPERTY_A:-}"

# ---------------------------------------------------------------------------
# THE SELECTOR CONTRACT — read this before blaming a flow.
#
# House has NO local-first UI yet. `src/features/house/local/` ships the whole
# sync client but contains zero .tsx files, House Settings has no device-sync
# row, and there is no sync banner or conflict indicator anywhere; the invite /
# enrolment screen lands with H3 (plan §5.1, "House needs a real screen").
# Budget's card is unreachable from this brand — `isBudgetLocalFirst()` gates on
# `brand.id === 'symply-budget'` — and forcing it would drive Budget's ledger.
#
# So the ids below are NOT discovered values. They are the contract the H3
# screen must satisfy, named by taking Budget's proven ids and swapping the
# brand prefix. They live here, in one place, and are injected into every flow:
# when H3 lands with different names, change them HERE, not in 20 YAML files.
#
# Everything else this suite touches IS a real, in-source id (tasks, settings,
# household management, login) — see the table in
# documents/engineering/testing/HOUSE_MULTI_MEMBER_SYNC_E2E.md.
#
# REPOINTED 2026-08-14, when the H3 §5.1 screens landed and were routed.
# These are no longer a contract to be satisfied later — every value below is
# now a REAL id, read out of the shipped screens. The suite's own instruction
# was to repoint them here rather than edit eight flows, which is what this is.
#
#   src/screens/house-v2/enrolment/HouseDeviceSyncScreen.tsx  — card/sync/status/conflicts
#   src/screens/house-v2/enrolment/HouseInviteScreen.tsx      — invite + requests
#   src/screens/house-v2/enrolment/HouseJoinScreen.tsx        — join + confirm
#   src/components/house/HouseSyncSharingSection.tsx          — the device-sync row
#
# Four of them (card, sync-now, status, conflicts) were spelled to match the
# original contract exactly and did not move. The invite/join ids ship under the
# screens' own `lf-*` vocabulary, so those ten are repointed here.
LF_SCREEN="${LF_SCREEN:-profile-screen}"                                    # REAL — the row moved to Profile
LF_SETTINGS_ROW="${LF_SETTINGS_ROW:-settings-row-device-sync}"              # REAL — HouseSyncSharingSection
LF_SYNC_CARD="${LF_SYNC_CARD:-house-local-first-sync-card}"                 # REAL
LF_SYNC_NOW="${LF_SYNC_NOW:-house-settings-sync-now}"                       # REAL
LF_SYNC_STATUS="${LF_SYNC_STATUS:-house-sync-status}"                       # REAL
LF_SYNC_CONFLICTS="${LF_SYNC_CONFLICTS:-house-sync-conflicts}"              # REAL — renders only when conflicts > 0
LF_CREATE_INVITE="${LF_CREATE_INVITE:-lf-invite-create}"                    # REAL
LF_JOIN_PANEL="${LF_JOIN_PANEL:-lf-join-panel}"                             # REAL
LF_JOIN_LINK="${LF_JOIN_LINK:-lf-join-link}"                                # REAL
LF_JOIN_HOUSEHOLD="${LF_JOIN_HOUSEHOLD:-lf-join-submit}"                    # REAL
LF_JOIN_CONFIRM_PANEL="${LF_JOIN_CONFIRM_PANEL:-lf-join-confirm-panel}"     # REAL
LF_JOIN_CONFIRM="${LF_JOIN_CONFIRM:-lf-join-confirm}"                       # REAL
LF_JOIN_STATUS="${LF_JOIN_STATUS:-lf-join-status}"                          # REAL
LF_JOIN_REQUESTS="${LF_JOIN_REQUESTS:-lf-invite-requests-refresh}"          # REAL
LF_JOIN_REQUESTS_PANEL="${LF_JOIN_REQUESTS_PANEL:-lf-invite-requests-panel}"  # REAL
LF_INVITE_APPROVE="${LF_INVITE_APPROVE:-lf-invite-approve-request}"          # REAL
# The invite's SECOND field. The screen takes the code and the secret separately
# (HouseJoinScreen.tsx:505,514) and mm-03 fills both, because typing a whole
# invite LINK into the code field races the field's own splitter.
LF_JOIN_SECRET="${LF_JOIN_SECRET:-lf-join-secret}"                          # REAL
#
# NOT a hub route. The enrolment surface also exists as four separate screens
# behind `settings-row-house-invite`, and driving the suite through those looks
# tidier right up to the point it reaches the invitee: a phone holding key-less
# homes renders `HouseRecoverHomeScreen` over the whole stack, and that gate
# steps aside for `RECOVERY_ROUTES = ['/device-sync', '/house-backup']` only.
# `HouseDeviceSyncScreen` composes all three bodies (:339-348), so the combined
# surface `mm-open-lf-settings.yaml` opens is both sufficient and the only one
# an un-enrolled device can reach.

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
    echo "Missing ${var} — set it in e2e/credentials.local." >&2
    echo "Two DIFFERENT accounts are required: a two-member test signed in as one" >&2
    echo "account twice proves nothing about a household. As of this suite being" >&2
    echo "written the repo's credentials.local declares the *_SECONDARY keys but" >&2
    echo "leaves them EMPTY — the second Symply account still has to be created." >&2
    exit 1
  fi
done
if [[ "${E2E_EMAIL}" == "${E2E_EMAIL_SECONDARY}" ]]; then
  echo "E2E_EMAIL and E2E_EMAIL_SECONDARY are the same account — this test needs two members." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Size-cap the devices BEFORE booting them. A simulator's device dir only ever
# grows; the two Budget pair devices reached 3.5 GB each before this guard
# existed. sim_guard refuses to erase while a suite is in flight, so it can
# never destroy the app underneath a running run.
# shellcheck source=scripts/e2e/sim-disk-guard.sh
source "$(dirname "$0")/sim-disk-guard.sh"
sim_guard_pair "${DEVICE_A_NAME}" "${DEVICE_B_NAME}"

# Auto-create either device when absent — the registry and the machine must not
# be allowed to drift into a confusing "device not found".
UDID_A="$(maestro_fleet_ensure_iphone_sim "${DEVICE_A_NAME}")"
UDID_B="$(maestro_fleet_ensure_iphone_sim "${DEVICE_B_NAME}")"
if [[ -z "${UDID_A}" || -z "${UDID_B}" ]]; then
  echo "Could not resolve or create the House pair (A='${DEVICE_A_NAME}' B='${DEVICE_B_NAME}')." >&2
  echo "Set E2E_AUTO_CREATE_SIM=1 (default) and check 'xcrun simctl list runtimes'." >&2
  exit 1
fi

# Refuse to run against another brand's generated files rather than rebuilding
# them: tokens/icons are shared checkout state, and regenerating mid-run would
# clobber whatever brand a concurrent session is building.
BRAND_LINE="$(head -1 "${ROOT}/src/brand/tokens.generated.ts" 2>/dev/null || true)"
if [[ "${BRAND_LINE}" != *"APP_BRAND=symply-house"* ]]; then
  echo "Generated brand files are not symply-house:" >&2
  echo "  ${BRAND_LINE}" >&2
  echo "Another session is mid-build. Wait for it, or run: APP_BRAND=symply-house npm run tokens:build && npm run icons:build" >&2
  exit 1
fi

echo "[hmm] other Metro instances (left alone):"
for _p in 8081 8082 8083 8084 8085 8092; do
  [[ "${_p}" == "${METRO_PORT}" ]] && continue
  curl -sf "http://localhost:${_p}/status" >/dev/null 2>&1 && echo "[hmm]   :${_p} in use by another session"
done
echo "[hmm] fleet registry: ${BRAND} device=${DEVICE_A_NAME} device_b=${DEVICE_B_NAME} scheme=${APP_SCHEME} (suite Metro :${METRO_PORT}, fleet :${FLEET_METRO_PORT})"
echo "[hmm] owner   A=${DEVICE_A_NAME} ${UDID_A}  <${E2E_EMAIL}>"
echo "[hmm] invitee B=${DEVICE_B_NAME} ${UDID_B}  <${E2E_EMAIL_SECONDARY}>"
echo "[hmm] parallel driving: ${MM_PARALLEL}"

xcrun simctl boot "${UDID_A}" 2>/dev/null || true
xcrun simctl boot "${UDID_B}" 2>/dev/null || true
xcrun simctl bootstatus "${UDID_A}" -b 2>/dev/null || sleep 5
xcrun simctl bootstatus "${UDID_B}" -b 2>/dev/null || sleep 5

for udid in "${UDID_A}" "${UDID_B}"; do
  # Password AutoFill hijacks inputText on secure fields — off on both devices.
  for _plist in \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
  do
    [[ -f "${_plist}" ]] && plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  done
  xcrun simctl spawn "${udid}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true
  # Notifications GRANTED, not denied. mm-32 asserts that the on-device
  # scheduler enqueues a reminder; a denied prompt is remembered for the life of
  # the simulator, so one stray "Don't Allow" would make that phase unfixable
  # without erasing the device.
  "${HOME}/.maestro/deps/applesimutils" --byId "${udid}" --bundle "${APP_ID}" \
    --setPermissions "notifications=YES, faceid=YES, photos=YES" >/dev/null 2>&1 || true
done

# Device B needs the same build as A. Install A's bundle if B has none.
if ! xcrun simctl listapps "${UDID_B}" 2>/dev/null | grep -q "${APP_ID}"; then
  APP_PATH="$(xcrun simctl listapps "${UDID_A}" 2>/dev/null \
    | grep -A4 "\"${APP_ID}\"" | grep -Eo '/[^"]*\.app' | head -1 || true)"
  if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
    echo "${APP_ID} is not installed on ${DEVICE_B_NAME} and no bundle was found on ${DEVICE_A_NAME}." >&2
    echo "Build House once (npm run prepare:xcode:house && APP_BRAND=symply-house npm run ios) and re-run." >&2
    exit 1
  fi
  echo "[hmm] installing ${APP_PATH} on ${DEVICE_B_NAME}"
  xcrun simctl install "${UDID_B}" "${APP_PATH}"
fi

# Photo fixtures for the H6 attachment phase — mm-31a picks the newest image out
# of the Photos library, so it has to be there before the run starts.
if [[ "${E2E_SEED_FIXTURES:-1}" == "1" ]]; then
  for udid in "${UDID_A}" "${UDID_B}"; do
    bash "$(dirname "$0")/seed-fixtures.sh" "${udid}" house >/dev/null 2>&1 || true
  done
fi

mkdir -p "${REPORT_OUT}" "${HOME}/.maestro/tests"
# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="${REPORT_OUT}"
[[ "$(dirname "${REPORT_OUT}")" == "${REPORTS_BASE}" ]] && LATEST_TARGET="$(basename "${REPORT_OUT}")"
ln -sfn "${LATEST_TARGET}" "${REPORTS_BASE}/latest"
AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "${AGG_DIR}"
BEFORE_RUNS="$(ls -1 "${HOME}/.maestro/tests" 2>/dev/null || true)"

# ---------------------------------------------------------------------------
# Metro: one dedicated instance serves BOTH of this suite's simulators.
# Started directly rather than through start-brand.sh: that regenerates tokens
# and icons and passes --clear, which would rewrite shared checkout state and
# wipe a transform cache another session's Metro is using.
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  echo "[hmm] starting dedicated Metro on :${METRO_PORT} (log ${METRO_LOG})"
  : > "${METRO_LOG}"
  (
    cd "${ROOT}" && APP_BRAND=symply-house EXPO_PUBLIC_APP_BRAND=symply-house \
      EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK=1 \
      npx @expo/cli start --port "${METRO_PORT}" --dev-client 2>&1 | tee -a "${METRO_LOG}"
  ) &
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 && break
    sleep 2
  done
fi
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  echo "[hmm] Metro did not come up on :${METRO_PORT}" >&2
  exit 1
fi
echo "[hmm] Metro ready on :${METRO_PORT}"

# Build the bundle ONCE before any device asks for it. A cold Metro only starts
# bundling when the first client connects, and the dev client sits on a black
# screen with a spinner for the whole download — which reads exactly like a hung
# app. Doing it here also means device B does not pay for it again.
echo "[hmm] pre-building the iOS bundle (cold Metro builds ~5k modules)"
BUNDLE_START="$(date +%s)"
curl -s -o /dev/null -w "" --max-time 900 \
  "http://localhost:${METRO_PORT}/node_modules/expo-router/entry.bundle?platform=ios&dev=true" || true
echo "[hmm] bundle ready in $(( $(date +%s) - BUNDLE_START ))s"

login_url() {
  node -e "
    const params = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('${APP_SCHEME}://e2e-login?' + params.toString());
  " "$1" "$2"
}

DEVCLIENT_URL="${APP_SCHEME}://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}"
LOGIN_URL_A="$(login_url "${E2E_EMAIL}" "${E2E_PASSWORD}")"
LOGIN_URL_B="$(login_url "${E2E_EMAIL_SECONDARY}" "${E2E_PASSWORD_SECONDARY}")"

FAILED=0
# Maestro invocations a full green run performs, for the report's progress bar:
# 2 sign-ins + 3 enrolment + 2x(create, modify, conflict, delete-a, delete-b)
# + 1 property bootstrap + 2 property switch + 2 attachment + 2 reminder
# + 1 widget + 2 property-photo + 2 cleanups.
MM_TOTAL_FLOWS=30
# Enrolment alone is 8: 2 sign-ins + pre-invite row + create + join + approve
# + member sync + backfill. Left at 28 the progress bar reads 29% on a complete
# run, which looks like a suite that died rather than one that was scoped.
[[ "${MM_ENROLMENT_ONLY}" == "1" ]] && MM_TOTAL_FLOWS=8
SUMMARY="${REPORT_OUT}/summary.log"
: > "${SUMMARY}"

note() {
  echo "$*" | tee -a "${SUMMARY}"
}

# LIVE report: regenerate every POLL seconds while the suite runs, and open it
# once. Waiting for the end means staring at nothing for a multi-hour run.
# NOTE commands.json lives at ~/.maestro/tests/<run>/<flow>/commands.json —
# depth 3; a shallower find silently links nothing.
start_live_report() {
  (
    local opened=0
    while :; do
      find "${HOME}/.maestro/tests" -maxdepth 3 -name commands.json -newer "${SUMMARY}" 2>/dev/null \
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

# run <A|B> <flow.yaml> [KEY=VALUE ...] — one Maestro invocation, own log file.
# Concurrency-safe: each device writes to its own log, never a shared one.
run() {
  local who="$1"; shift
  local flow="$1"; shift
  local udid email password login_url log
  local recovery
  if [[ "${who}" == "A" ]]; then
    udid="${UDID_A}"; email="${E2E_EMAIL}"; password="${E2E_PASSWORD}"; login_url="${LOGIN_URL_A}"
    # The OWNER answers "Your homes are not on this phone yet" by minting one.
    recovery="start-new"
  else
    udid="${UDID_B}"; email="${E2E_EMAIL_SECONDARY}"; password="${E2E_PASSWORD_SECONDARY}"; login_url="${LOGIN_URL_B}"
    # The JOINER must NOT: a home of its own is not a home shared with A.
    recovery="device-sync"
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
    -e "APP_ID=${APP_ID}"
    -e "E2E_APP_SCHEME=${APP_SCHEME}"
    -e "E2E_PLATFORM=ios"
    -e "E2E_METRO_DEVCLIENT_URL=${DEVCLIENT_URL}"
    -e "MM_METRO_PORT=${METRO_PORT}"
    -e "E2E_LOGIN_URL=${login_url}"
    -e "MM_RECOVERY=${recovery}"
    -e "E2E_EMAIL=${email}"
    -e "E2E_PASSWORD=${password}"
    # The selector contract, injected into every flow from the single table above.
    -e "LF_SCREEN=${LF_SCREEN}"
    -e "LF_SETTINGS_ROW=${LF_SETTINGS_ROW}"
    -e "LF_SYNC_CARD=${LF_SYNC_CARD}"
    -e "LF_SYNC_NOW=${LF_SYNC_NOW}"
    -e "LF_SYNC_STATUS=${LF_SYNC_STATUS}"
    -e "LF_SYNC_CONFLICTS=${LF_SYNC_CONFLICTS}"
    -e "LF_CREATE_INVITE=${LF_CREATE_INVITE}"
    -e "LF_JOIN_PANEL=${LF_JOIN_PANEL}"
    -e "LF_JOIN_LINK=${LF_JOIN_LINK}"
    -e "LF_JOIN_HOUSEHOLD=${LF_JOIN_HOUSEHOLD}"
    -e "LF_JOIN_CONFIRM_PANEL=${LF_JOIN_CONFIRM_PANEL}"
    -e "LF_JOIN_CONFIRM=${LF_JOIN_CONFIRM}"
    -e "LF_JOIN_STATUS=${LF_JOIN_STATUS}"
    -e "LF_JOIN_REQUESTS=${LF_JOIN_REQUESTS}"
    -e "LF_JOIN_REQUESTS_PANEL=${LF_JOIN_REQUESTS_PANEL}"
    -e "LF_INVITE_APPROVE=${LF_INVITE_APPROVE}"
    -e "LF_JOIN_SECRET=${LF_JOIN_SECRET}"
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
  # and contend for the device, and one dies mid-flow with "Device became
  # unreachable" / "Connection refused". That is infrastructure, not a defect,
  # so it is worth another attempt — whereas retrying a failed assertion would
  # launder a real regression into a pass. Same policy run-budget-suite.sh uses.
  # A WATCHDOG, because Maestro has no per-flow timeout of its own.
  #
  # When the XCUITest driver answers `Request for viewHierarchy failed, code:
  # 500`, maestro prints the exception and then never returns. Twice on
  # 2026-09-05 that left a flow pinned to House-A for 33 and 51 minutes with the
  # suite behind it going nowhere — and because the process was still alive, the
  # retry below could not run either. A hang is the one failure that costs
  # unbounded time, so it is the one that must be bounded.
  #
  # Killed, not abandoned: the SIGTERM makes rc 143, which the >128 branch
  # already treats as infrastructure and retries. So the watchdog turns a
  # permanent hang into an ordinary retry.
  local flow_timeout="${MM_FLOW_TIMEOUT_SECONDS:-600}"

  local attempt max_attempts=3 tail_out rc
  for attempt in $(seq 1 "${max_attempts}"); do
    maestro "${args[@]}" >>"${log}" 2>&1 &
    local maestro_pid=$!
    (
      sleep "${flow_timeout}"
      if kill -0 "${maestro_pid}" 2>/dev/null; then
        echo "    watchdog: no result after ${flow_timeout}s — killing this attempt" >>"${log}"
        kill "${maestro_pid}" 2>/dev/null
        sleep 5
        kill -9 "${maestro_pid}" 2>/dev/null
      fi
    ) & local watchdog_pid=$!
    wait "${maestro_pid}"
    rc=$?
    kill "${watchdog_pid}" 2>/dev/null
    if (( rc == 0 )); then
      (( attempt > 1 )) && echo "    (passed on attempt ${attempt})" >>"${log}"
      return 0
    fi
    tail_out="$(tail -80 "${log}")"

    # A SIGNAL is infrastructure, and it is invisible to the log grep below.
    #
    # `Killed: 9` was already in the pattern, but that string is printed by the
    # SHELL to its own stderr when it reaps a signalled child — it never reaches
    # ${log}, which only ever holds maestro's own output. So a jetsam kill fell
    # straight through to "genuine flow failure" with an EMPTY step log and no
    # retry. Seen on House-B 2026-09-05 (run 20260905-084844): swap was 26.0 GB
    # of 26.6 GB with two House suites and a Budget suite sharing the machine,
    # the JVM was killed at 137, and the suite reported `FAIL [B] mm-01-signin`
    # for a flow that had not run a single step.
    #
    # Read the exit STATUS instead: >128 means a signal, and no assertion failure
    # can produce one. `steps-*.log` staying empty is the tell to look for.
    if (( rc > 128 )); then
      echo "    maestro was signalled (exit ${rc}, likely SIGKILL under memory pressure) on attempt ${attempt}/${max_attempts}" >>"${log}"
    # `kAXError…` / "Detected app crash during snapshot" is the iOS-26
    # accessibility-server flake: the AX server fails to hand back the main
    # window and Maestro reports it as an app crash while the app is fine. A
    # REAL crash still fails the step — it just reproduces on all three attempts.
    elif ! grep -qE "DeviceUnreachableException|became unreachable|IOSDriverTimeoutException|iOS driver not ready|Failed to connect|Connection refused|Killed: 9|kAXError|Detected app crash during snapshot" <<<"${tail_out}"; then
      return 1  # genuine flow failure — stop here
    fi
    if (( attempt < max_attempts )); then
      echo "    driver dropped on attempt ${attempt}/${max_attempts} — restarting it" >>"${log}"
      pkill -f "maestro-driver-ios-config.xctestrun.*${udid}" 2>/dev/null || true
      pkill -f "destination id=${udid}" 2>/dev/null || true
      # Longer after a signal: the machine that killed it is still under the
      # pressure that made it do so, and retrying straight into that just buys
      # another kill.
      if (( rc > 128 )); then sleep 45; else sleep 12; fi
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
    # connect to 127.0.0.1:<port> / Connection refused", observed on the Budget
    # pair 2026-08-10). The flows rendezvous on data, not clock time, so a head
    # start costs nothing — the devices still overlap for the body of the flow.
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
    note "[hmm] FAIL FAST — stopping the run at '${label}'"
  fi
  (( rc_a == 0 && rc_b == 0 ))
}

# single <who> <label> <flow> [env...] — for the ordered steps.
single() {
  local who="$1" label="$2"; shift 2
  if run "${who}" "$@"; then
    note "    PASS [${who}] ${label}"
    return 0
  fi
  note "    FAIL [${who}] ${label}"
  FAILED=1
  if [[ "${MM_FAIL_FAST:-1}" == "1" ]]; then
    note "[hmm] FAIL FAST — stopping the run at '${label}'"
  fi
  return 1
}

# phase_guard <name> — stop the run cleanly when the disk floor is crossed, and
# trim the two logs that grow for the whole run (`tee` has no rotation).
phase_guard() {
  if [[ "${MM_ENROLMENT_ONLY}" == "1" ]]; then
    note "[hmm] MM_ENROLMENT_ONLY=1 — enrolment is green; skipping '$1' and everything after it"
    return 1
  fi
  disk_floor_trim_log "${METRO_LOG}" 400
  disk_floor_trim_log "${REPORT_OUT}/steps-A.log" 200
  disk_floor_trim_log "${REPORT_OUT}/steps-B.log" 200
  if ! disk_floor_check "$1"; then
    note "[hmm] ABORTING at '$1' — out of disk. Everything after this point would"
    note "[hmm] fail for lack of space, not because it is broken."
    FAILED=1
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Read the text of one element, BY TESTID, off a named device.
#
# RN maps `testID` to `accessibilityIdentifier` on iOS, which idb reports as
# `AXUniqueId`, so this addresses exactly the element the flows address.
#
# Why it exists: everything below used to come off ${METRO_LOG}, and that log is
# not this run's. Metro is shared — one bundler serves whichever House suites are
# up — so a second suite running concurrently (House-C/House-D on 2026-09-05,
# started 32 seconds after this one) writes its own `[E2E-INVITE]` and
# `[E2E-JOIN-SAS]` lines into the same file. `tail -1` then hands this run the
# OTHER run's invite, and device B joins a household it was never invited to.
# The failure surfaces three flows later as a mismatched SAS, which reads as a
# broken key exchange rather than as a crossed wire.
#
# A device cannot lie about what is on its own screen, so read it from there.
# device_label_matching <udid> <python-regex> — the first accessibility label on
# that device matching the pattern.
#
# BY PATTERN, not by testID, and that is forced rather than chosen. RN maps
# `testID` to `accessibilityIdentifier`, but only for elements iOS publishes as
# accessibility elements — buttons and inputs do, a plain `<Typography>` does
# not. Both values this suite needs to read (the invite and the SAS) are plain
# Typography, so `AXUniqueId` is null on exactly the two elements that matter and
# a testID lookup silently returns nothing. Confirmed against House-A on
# 2026-09-05: `lf-invite-copy-code` carries its id, the code beside it does not.
#
# Silent is the problem: `read_invite` fell through to the shared Metro log
# without saying so, which is the fallback this whole helper exists to avoid.
device_label_matching() {
  local udid="${1:?udid}" pattern="${2:?pattern}"
  idb ui describe-all --udid "${udid}" 2>/dev/null | python3 -c "
import sys, json, re
pat = re.compile(sys.argv[1])
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for e in els:
    for field in ('AXLabel', 'AXValue'):
        v = e.get(field)
        if v and pat.search(str(v)):
            print(v)
            sys.exit(0)
" "${pattern}"
}

# ---------------------------------------------------------------------------
# Scrape the invite the owner just created off the Metro log. This is the
# harness standing in for the person who reads the code out loud — the ONE thing
# faked in this suite. Everything else is a real touch on a real device.
#
# The H3 screen must log, dev-only, exactly as Budget's does
# (BudgetSettingsScreen.tsx:422) plus one House-only field:
#   [E2E-INVITE] code=<shortCode> secret=<secret> household=<name>
# `household=` is what makes the H5 property phase deterministic: the switcher
# is driven by the property's displayed NAME (PropertySwitcher has no testIDs),
# and only the app knows which property the invite was created in.
read_invite() {
  local line
  # DEVICE FIRST. The owner's screen renders the whole invite LINK it just minted
  # (`lf-invite-link`, HouseInviteCreateScreen.tsx:452), and that is THIS
  # device's invite by construction, whatever else is writing to the shared
  # Metro log. The link is the anchor rather than the code because it carries
  # BOTH halves and is unmistakable on a screen full of short strings.
  # Retried: the panel can still be laying out when this is called, and one
  # empty read would drop straight to the shared-log fallback.
  local link _try
  for _try in 1 2 3; do
    link="$(device_label_matching "${UDID_A}" "^${APP_SCHEME}://lf-invite\\?")"
    [[ -n "${link}" ]] && break
    sleep 3
  done
  MM_CODE="$(sed -n 's/.*[?&]code=\([^&]*\).*/\1/p' <<<"${link}")"
  MM_SECRET="$(sed -n 's/.*[?&]secret=\([^&]*\).*/\1/p' <<<"${link}")"
  if [[ -n "${MM_CODE}" && -n "${MM_SECRET}" ]]; then
    # The household name is not on this screen, so it still comes off the log —
    # and it is allowed to be wrong or missing, because only the H5 property
    # phase reads it and that phase skips cleanly without it.
    if [[ -z "${MM_PROPERTY_A}" ]]; then
      MM_PROPERTY_A="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
        | grep -a '\[E2E-INVITE\]' | tail -1 | sed -n 's/.*household=\(.*\)$/\1/p' || true)"
    fi
    note "[hmm] invite read off ${DEVICE_A_NAME}'s own screen (not the shared Metro log)"
    return 0
  fi

  # FALLBACK: the dev-only marker. Kept because the screen can have scrolled the
  # panel out of the hierarchy, and because it is the only source that carries
  # the household name. Announced, because this is the source a concurrently
  # running suite can poison — a silent fallback is how you end up trusting
  # another run's invite.
  note "[hmm] WARNING: could not read the invite off ${DEVICE_A_NAME} — falling back to ${METRO_LOG}, which is SHARED"
  # Only lines written after this run started — an earlier run's invite is
  # expired/claimed and would fail the join in a confusing way.
  line="$(tail -n "+$((INVITE_MARK + 1))" "${METRO_LOG}" 2>/dev/null \
    | grep -a '\[E2E-INVITE\]' | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[hmm] no [E2E-INVITE] line in ${METRO_LOG} — did Create invite succeed?" >&2
    echo "[hmm] the H3 §5.1 screen must emit it in __DEV__; see the contract above." >&2
    return 1
  fi
  MM_CODE="$(sed -n 's/.*code=\([^ ]*\).*/\1/p' <<<"${line}")"
  MM_SECRET="$(sed -n 's/.*secret=\([^ ]*\).*/\1/p' <<<"${line}")"
  # household=<name> may contain spaces, so it must be the LAST field.
  local scraped
  scraped="$(sed -n 's/.*household=\(.*\)$/\1/p' <<<"${line}")"
  if [[ -n "${scraped}" && -z "${MM_PROPERTY_A}" ]]; then
    MM_PROPERTY_A="${scraped}"
  fi
  [[ -n "${MM_CODE}" && -n "${MM_SECRET}" ]]
}

# The verification digits, carried invitee → owner. They cannot come from the
# invite line: they do not exist until the invitee's device has claimed, which is
# precisely what makes them a check on that device rather than on the message.
read_join_sas() {
  local line digits

  # DEVICE FIRST, and here it matters more than anywhere: the log grep below is
  # not even mark-scoped, so with a second suite up it reliably returns the wrong
  # six digits — and wrong digits do not fail loudly, they fail as "the owner and
  # the invitee disagree about the key", which is the exact alarm this check
  # exists to raise. `house-join-sas` (HouseJoinWaitingPanel.tsx:87) is rendered
  # by the claiming device out of its own session.
  # Matched on its SHAPE — `formatEnrolmentSas` renders "123 456" and nothing
  # else on this screen looks like that.
  digits="$(device_label_matching "${UDID_B}" '^[0-9]{3} [0-9]{3}$' | tr -cd '0-9')"
  if [[ "${digits}" =~ ^[0-9]{6}$ ]]; then
    MM_SAS="${digits:0:3} ${digits:3:3}"
    note "[hmm] SAS read off ${DEVICE_B_NAME}'s own screen: ${MM_SAS}"
    return 0
  fi

  # FALLBACK: the dev-only marker. Announced for the same reason as above, and
  # this grep is not even scoped to this run.
  note "[hmm] WARNING: could not read the SAS off ${DEVICE_B_NAME} — falling back to ${METRO_LOG}, which is SHARED"
  line="$(grep -a '\[E2E-JOIN-SAS\]' "${METRO_LOG}" 2>/dev/null | tail -1 || true)"
  if [[ -z "${line}" ]]; then
    echo "[hmm] no [E2E-JOIN-SAS] on ${DEVICE_B_NAME}'s screen and none in ${METRO_LOG} — did the join succeed?" >&2
    return 1
  fi
  digits="$(sed -n 's/.*sas=\([0-9]*\).*/\1/p' <<<"${line}")"
  [[ "${digits}" =~ ^[0-9]{6}$ ]] || return 1
  MM_SAS="${digits:0:3} ${digits:3:3}"
}

# The token rendered on the row whose label contains <anchor>, e.g. "A88".
#
# Scanning the whole screen for a token cannot answer "what does the contested
# row say" — the list holds rows from every earlier phase, so both candidates
# can be present at once and the comparison is meaningless (observed on the
# Budget pair for ten consecutive reads). Read the row itself.
device_row_token() {
  local udid="$1" anchor="$2"
  idb ui describe-all --udid "${udid}" 2>/dev/null | python3 -c "
import sys, json, re
anchor = sys.argv[1]
try:
    els = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for e in els:
    label = (e.get('AXLabel') or '')
    idx = label.find(anchor)
    if idx < 0:
        continue
    rest = label[idx + len(anchor):].strip()
    m = re.match(r'([A-Za-z0-9.]+)', rest)
    if m:
        print(m.group(1))
        break
" "${anchor}"
}

# Does this device render <text> anywhere in its hierarchy?
device_shows() {
  idb ui describe-all --udid "$1" 2>/dev/null | grep -Fq "$2"
}

# --- H6: did the encrypted BYTES reach the peer? --------------------------
# `houseBlobStore.ts` decrypts a downloaded blob into
# `cacheDirectory/lf-blobs/<blobId>` (:24-25, :154). A rendered <Image> proves a
# ledger row arrived; only a non-empty file here proves the ciphertext did — the
# exact gap H6 exists to close ("the row syncs; the bytes do not", plan §8).
device_blob_cache_files() {
  local udid="$1" container
  container="$(xcrun simctl get_app_container "${udid}" "${APP_ID}" data 2>/dev/null || true)"
  [[ -z "${container}" ]] && { echo 0; return 0; }
  find "${container}/Library/Caches/lf-blobs" -type f -size +0 2>/dev/null | wc -l | tr -d ' '
}

# --- H7: did the LOCAL scheduler enqueue a reminder for the peer's task? ---
# The relay cannot read the plaintext title, so a notification request carrying
# it can only have been created on this device by `houseLocalReminders.ts`.
# Requests are persisted by usernoted under the simulator's own notification
# stores; grep them for the title.
device_has_scheduled_reminder() {
  local udid="$1" needle="$2" root
  root="${HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data/Library"
  grep -rlas -- "${needle}" \
    "${root}/UserNotifications" "${root}/BulletinBoard" 2>/dev/null | head -1
}

# --- H7/N4: is the peer's task in the widget's App Group projection? -------
# `widgetSync.setTasks` writes the `widget_tasks` key into
# group.com.symply.house (WidgetSyncModule.swift:70). The widget extension has
# no DEK and cannot read the ledger, so this file is the only place the
# projection is observable.
device_widget_tasks_json() {
  local udid="$1" group_dir plist
  group_dir="$(xcrun simctl get_app_container "${udid}" "${APP_ID}" "group.${APP_ID}" 2>/dev/null || true)"
  [[ -z "${group_dir}" || ! -d "${group_dir}" ]] && return 1
  plist="${group_dir}/Library/Preferences/group.${APP_ID}.plist"
  [[ -f "${plist}" ]] || return 1
  # `widget_tasks` is stored as Data holding UTF-8 JSON; plutil prints it as a
  # hex blob, so decode it rather than grepping the plist directly.
  plutil -extract widget_tasks raw -o - "${plist}" 2>/dev/null | base64 --decode 2>/dev/null
}

INVITE_MARK="$(wc -l < "${METRO_LOG}" 2>/dev/null | tr -d ' ' || echo 0)"
INVITE_MARK="${INVITE_MARK:-0}"

start_live_report
note "[hmm] live report: ${REPORT_OUT}/index.html (opens shortly, self-refreshes)"

# =========================================================================
note "[hmm] === phase 1: enrolment (ordered) ==="
# Sign-in runs one device at a time ON PURPOSE, even though the two sign-ins are
# logically independent: this is each device's first Maestro invocation, so it
# is where the XCUITest driver cold-starts. Doing both at once killed run 3 of
# the Budget pair — the drivers raced and both died. Serial here leaves both
# drivers warm, and every later phase (the ones that test sync) runs concurrently.
single A "mm-01-signin" mm-01-signin.yaml || true
(( FAILED == 0 )) && single B "mm-01-signin" mm-01-signin.yaml || true

# BEFORE the invite, deliberately. This row is the only thing in the run that
# cannot reach device B as a live op — B does not exist in the home yet — so it
# is the one that proves a joiner is BACKFILLED rather than merely subscribed.
# Moving this below mm-02 would silently turn mm-12 into a duplicate of mm-20.
if (( FAILED == 0 )); then
  single A "mm-13-owner-pre-invite-task" mm-13-owner-pre-invite-task.yaml \
    "MM_TITLE=${BACKFILL_TITLE}" || true
fi
if (( FAILED == 0 )); then
  single A "mm-02-owner-create-invite" mm-02-owner-create-invite.yaml || true
fi
if (( FAILED == 0 )); then
  sleep 2
  if read_invite; then
    note "[hmm] invite code=${MM_CODE} household='${MM_PROPERTY_A:-<not logged>}'"
    single B "mm-03-member-join" mm-03-member-join.yaml \
      "MM_CODE=${MM_CODE}" "MM_SECRET=${MM_SECRET}" || true
    (( FAILED == 0 )) && read_join_sas || true
    (( FAILED == 0 )) && single A "mm-04-owner-approve" mm-04-owner-approve.yaml "MM_SAS=${MM_SAS}" || true
    (( FAILED == 0 )) && single B "mm-05-member-enrol-sync" mm-05-member-enrol-sync.yaml || true
    # …and then the history. mm-12 taps NO sync — it only waits — so a pass
    # means the device went and fetched the checkpoint by itself, which is the
    # whole claim. Run it here, while B's ledger is still empty of everything
    # phase 2 is about to add.
    (( FAILED == 0 )) && single B "mm-12-member-backfill" mm-12-member-backfill.yaml \
      "MM_TITLE=${BACKFILL_TITLE}" || true
  else
    FAILED=1
  fi
fi

# =========================================================================
if (( FAILED == 0 )) && phase_guard "phase 2 create"; then
  note "[hmm] === phase 2: both members create, each sees the other (PARALLEL) ==="
  pair "mm-20-add-and-await-peer" -- \
    mm-20-add-and-await-peer.yaml \
      "MM_TITLE=${OWNER_TITLE_1}" "MM_PEER_TITLE=${MEMBER_TITLE_1}" -- \
    mm-20-add-and-await-peer.yaml \
      "MM_TITLE=${MEMBER_TITLE_1}" "MM_PEER_TITLE=${OWNER_TITLE_1}" || true
fi

# =========================================================================
if (( FAILED == 0 )) && phase_guard "phase 3 modify"; then
  note "[hmm] === phase 3: both members modify, each sees the other's edit (PARALLEL) ==="
  pair "mm-21-modify-and-await-peer" -- \
    mm-21-modify-and-await-peer.yaml \
      "MM_TITLE=${OWNER_TITLE_1}" "MM_TITLE_2=${OWNER_TITLE_2}" "MM_PEER_TITLE_2=${MEMBER_TITLE_2}" -- \
    mm-21-modify-and-await-peer.yaml \
      "MM_TITLE=${MEMBER_TITLE_1}" "MM_TITLE_2=${MEMBER_TITLE_2}" "MM_PEER_TITLE_2=${OWNER_TITLE_2}" || true
fi

# =========================================================================
if (( FAILED == 0 )) && phase_guard "phase 4 conflict"; then
  note "[hmm] === phase 4: concurrent edit of the SAME row → conflict resolution (PARALLEL) ==="
  pair "mm-23-conflict-parallel" -- \
    mm-23-conflict-parallel.yaml \
      "MM_ANCHOR=${OWNER_ANCHOR}" "MM_TITLE_IN=${OWNER_TITLE_2}" "MM_TITLE_OUT=${OWNER_CONFLICT_TITLE}" -- \
    mm-23-conflict-parallel.yaml \
      "MM_ANCHOR=${OWNER_ANCHOR}" "MM_TITLE_IN=${OWNER_TITLE_2}" "MM_TITLE_OUT=${MEMBER_CONFLICT_TITLE}" || true

  if (( FAILED == 0 )); then
    # Winner-agnostic convergence: read the rendered token off BOTH devices and
    # require them to agree on exactly one of the two candidates. Asserting a
    # fixed winner would be asserting this machine's timing, not TRD §8.4.
    note "[hmm] --- convergence check (reading both devices) ---"
    CONVERGED=0
    A_VAL=""; B_VAL=""
    for _try in $(seq 1 10); do
      A_VAL="$(device_row_token "${UDID_A}" "${OWNER_ANCHOR}")"
      B_VAL="$(device_row_token "${UDID_B}" "${OWNER_ANCHOR}")"
      note "[hmm] attempt ${_try}: A row='${A_VAL:-?}'  B row='${B_VAL:-?}'"
      if [[ -n "${A_VAL}" && "${A_VAL}" == "${B_VAL}" ]]; then
        if [[ "${A_VAL}" == "${OWNER_CONFLICT_TOKEN}" ]]; then
          note "    PASS convergence — both devices show '${A_VAL}' (owner's edit won)"
        elif [[ "${A_VAL}" == "${MEMBER_CONFLICT_TOKEN}" ]]; then
          note "    PASS convergence — both devices show '${A_VAL}' (member's edit won)"
        else
          note "    FAIL convergence — both devices agree on '${A_VAL}', which is NEITHER candidate"
          FAILED=1
        fi
        CONVERGED=1
        break
      fi
      sleep 6
    done
    if (( CONVERGED == 0 )); then
      note "    FAIL convergence — contested row differs: A='${A_VAL:-?}' B='${B_VAL:-?}'"
      FAILED=1
    fi

    # BR-044: the replica that discarded an incoming write must say so.
    #
    # Only ONE side can detect this without causality tracking — the replica
    # that received an op older than its own value — so accept it on either.
    # Retried, because the count reaches the sync store on the NEXT sync after
    # the merge, i.e. slightly after the values themselves converge.
    #
    # Asserted on the ELEMENT, not on the prose. Budget's banner says
    # "5 merge conflicts" and this check used to grep that literal string, but
    # House deliberately refuses that vocabulary: `HouseSyncStatusCard.tsx:5-11`
    # calls "merge conflict" engine language that is "meaningless to a member",
    # and `houseConflictCopy.ts` renders "N changes were overwritten when two of
    # you edited the same thing" instead. Grepping for the Budget wording would
    # have forced House to degrade better copy to satisfy a test.
    #
    # `house-sync-conflicts` is rendered ONLY under `conflicts > 0`
    # (HouseDeviceSyncScreen.tsx:106-113), so the id's presence in the hierarchy
    # is exactly the proof BR-044 wants, and it survives a rewording.
    CONFLICT_SEEN=0
    for _try in $(seq 1 8); do
      for _u in "${UDID_A}" "${UDID_B}"; do
        if device_shows "${_u}" "${LF_SYNC_CONFLICTS}"; then
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
      note "    FAIL no conflict indicator ('${LF_SYNC_CONFLICTS}') on either device"
      FAILED=1
    fi
  fi
fi

# =========================================================================
# DELETE RUNS LAST, AFTER THE HOUSE ADDITIONS — deliberately, and not where
# Budget puts it.
#
# Budget's phase 5 is its final phase, so deleting both rows costs nothing.
# House's additions need live rows to work on: phase 7 attaches a photo to the
# OWNER's task, and a delete before that would leave it attaching to a row that
# no longer exists. Ordering the tombstone test after the additions keeps every
# phase on real data AND still ends the run on the guarantee a broken projection
# hides best — a removal that has to travel.
#
# HOUSE ADDITION 1 — H5 property switch mid-sync.
if (( FAILED == 0 )) && phase_guard "phase 6 property switch"; then
  if [[ -z "${MM_PROPERTY_A}" ]]; then
    note "[hmm] === phase 6: property switch — SKIPPED ==="
    note "[hmm] The shared household's NAME is unknown. PropertySwitcher.tsx has no"
    note "[hmm] testIDs at all, so the switch is driven by the property's displayed"
    note "[hmm] name. Either have the H3 invite marker append 'household=<name>', or"
    note "[hmm] run with MM_PROPERTY_A='<the property device A is in>'."
  else
    note "[hmm] === phase 6 (H5): property switch mid-sync ==="
    single A "mm-30a-ensure-second-property" mm-30a-ensure-second-property.yaml \
      "MM_PROPERTY_B=${MM_PROPERTY_B}" || true
    if (( FAILED == 0 )); then
      pair "mm-30-property-switch-mid-sync" -- \
        mm-30-property-switch-mid-sync.yaml \
          "MM_ROLE=switcher" "MM_PROPERTY_A=${MM_PROPERTY_A}" \
          "MM_PROPERTY_B=${MM_PROPERTY_B}" "MM_TITLE=${PROPERTY_ANCHOR}" -- \
        mm-30-property-switch-mid-sync.yaml \
          "MM_ROLE=writer" "MM_PROPERTY_A=${MM_PROPERTY_A}" \
          "MM_PROPERTY_B=${MM_PROPERTY_B}" "MM_TITLE=${PROPERTY_ANCHOR}" || true
    fi
  fi
fi

# =========================================================================
# HOUSE ADDITION 2 — H6 attachment round trip.
if (( FAILED == 0 )) && phase_guard "phase 7 attachment"; then
  note "[hmm] === phase 7 (H6): attachment round trip ==="
  # Baseline BEFORE the attach: the check below is "B's blob cache GREW", not
  # "B's blob cache is non-empty" — an earlier run's cached blob would make the
  # weaker form pass without a single byte moving today.
  BLOBS_B_BEFORE="$(device_blob_cache_files "${UDID_B}")"
  note "[hmm] device B blob cache before: ${BLOBS_B_BEFORE} file(s)"
  single A "mm-31a-attach-photo" mm-31a-attach-photo.yaml \
    "MM_TITLE=${OWNER_ANCHOR}" || true
  if (( FAILED == 0 )); then
    single B "mm-31b-attachment-peer" mm-31b-attachment-peer.yaml \
      "MM_PEER_TITLE=${OWNER_ANCHOR}" || true
  fi
  if (( FAILED == 0 )); then
    BLOB_OK=0
    for _try in $(seq 1 10); do
      BLOBS_B_AFTER="$(device_blob_cache_files "${UDID_B}")"
      if (( BLOBS_B_AFTER > BLOBS_B_BEFORE )); then
        note "    PASS attachment BYTES reached B (blob cache ${BLOBS_B_BEFORE} → ${BLOBS_B_AFTER})"
        BLOB_OK=1
        break
      fi
      sleep 6
    done
    if (( BLOB_OK == 0 )); then
      note "    FAIL no new decrypted blob on B (cache still ${BLOBS_B_BEFORE} files)"
      note "    This is the H6 gap exactly: the row can travel while the bytes do not."
      note "    Check whether TaskFormPhotos is wired to houseBlobStore at all — as of"
      note "    this suite being written, nothing in src/screens or src/components"
      note "    imports it."
      FAILED=1
    fi
  fi
fi

# =========================================================================
# HOUSE ADDITION 2b — the PROPERTY's own photo round trip.
#
# Not a duplicate of phase 7. That phase attaches to a TASK; this one puts a
# photo on the household row itself, which travels by a different path and had
# its own regression: `uploadPhoto` threw "Home photos sync in a later update"
# long after H6 shipped, so the one thing on a property that could not reach
# another member was the picture of it
# (src/features/house/local/__tests__/houseHomePhoto.test.ts). That unit test
# pins the ledger shape; nothing drove it across two real devices until here.
#
# Same two-sided proof as phase 7 — the peer must RENDER the decrypted image
# (`household-form-photo-blob-view`, not the bare prefix, which would also match
# an un-fetched `-download` placeholder) AND B's blob cache must have grown.
#
# Skipped, like H5, when the shared household's name was not scraped: the edit
# sheet is reached by swiping THAT property's card, and with the wrong card this
# would fail for a reason that has nothing to do with sync.
if (( FAILED == 0 )) && phase_guard "phase 7b property photo"; then
  if [[ -z "${MM_PROPERTY_A}" ]]; then
    note "[hmm] === phase 7b: property photo — SKIPPED ==="
    note "[hmm] The shared household's NAME is unknown, so the right card cannot be"
    note "[hmm] identified. Run with MM_PROPERTY_A='<the shared property>' to include it."
  else
    note "[hmm] === phase 7b (H6): property photo round trip ==="
    PHOTO_BLOBS_B_BEFORE="$(device_blob_cache_files "${UDID_B}")"
    note "[hmm] device B blob cache before: ${PHOTO_BLOBS_B_BEFORE} file(s)"
    single A "mm-34a-set-home-photo" mm-34a-set-home-photo.yaml \
      "MM_PHOTO_PROPERTY=${MM_PROPERTY_A}" || true
    if (( FAILED == 0 )); then
      single B "mm-34b-home-photo-peer" mm-34b-home-photo-peer.yaml \
        "MM_PHOTO_PROPERTY=${MM_PROPERTY_A}" || true
    fi
    if (( FAILED == 0 )); then
      PHOTO_BLOB_OK=0
      for _try in $(seq 1 10); do
        PHOTO_BLOBS_B_AFTER="$(device_blob_cache_files "${UDID_B}")"
        if (( PHOTO_BLOBS_B_AFTER > PHOTO_BLOBS_B_BEFORE )); then
          note "    PASS property photo BYTES reached B (blob cache ${PHOTO_BLOBS_B_BEFORE} → ${PHOTO_BLOBS_B_AFTER})"
          PHOTO_BLOB_OK=1
          break
        fi
        sleep 6
      done
      if (( PHOTO_BLOB_OK == 0 )); then
        note "    FAIL no new decrypted blob on B for the property photo"
        note "    (cache still ${PHOTO_BLOBS_B_BEFORE} files). The descriptor rides IN the"
        note "    households ledger row as photo_blob, with photo_key in the synthetic"
        note "    lf-blob/ form — a key without a descriptor is a receipt for bytes"
        note "    nothing can open. Check localHouseholdsApi's upload path."
        FAILED=1
      fi
    fi
  fi
fi

# =========================================================================
# HOUSE ADDITION 3 — H7 reminder scheduled by the on-device scheduler.
if (( FAILED == 0 )) && phase_guard "phase 8 reminder"; then
  note "[hmm] === phase 8 (H7): reminder scheduled from the local scheduler ==="
  pair "mm-32-reminder-local-schedule" -- \
    mm-32-reminder-local-schedule.yaml \
      "MM_ROLE=writer" "MM_TITLE=${REMINDER_ANCHOR}" "MM_DUE_PHRASE=${MM_DUE_PHRASE}" -- \
    mm-32-reminder-local-schedule.yaml \
      "MM_ROLE=reader" "MM_TITLE=${REMINDER_ANCHOR}" "MM_DUE_PHRASE=${MM_DUE_PHRASE}" || true
  if (( FAILED == 0 )); then
    REMINDER_OK=""
    for _try in $(seq 1 10); do
      REMINDER_OK="$(device_has_scheduled_reminder "${UDID_B}" "${REMINDER_ANCHOR}")"
      [[ -n "${REMINDER_OK}" ]] && break
      sleep 6
    done
    if [[ -n "${REMINDER_OK}" ]]; then
      note "    PASS local scheduler enqueued a reminder on B for the peer's task"
      note "    (found in $(basename "${REMINDER_OK}"))"
    else
      note "    FAIL no notification request on B carrying '${REMINDER_ANCHOR}'"
      note "    The relay cannot read the title, so only houseLocalReminders.ts could"
      note "    have scheduled it. Check that the task really carries next_due_date"
      note "    (buildTaskDueReminders skips rows without one) and that the smart"
      note "    capture parsed '${MM_DUE_PHRASE}'."
      FAILED=1
    fi
  fi
fi

# =========================================================================
# HOUSE ADDITION 4 — H7/N4 widget projection after a peer's write.
if (( FAILED == 0 )) && phase_guard "phase 9 widget"; then
  note "[hmm] === phase 9 (H7/N4): widget projection after a peer's write ==="
  single B "mm-33-widget-await-peer-write" mm-33-widget-await-peer-write.yaml \
    "MM_TITLE=${REMINDER_ANCHOR}" || true
  if (( FAILED == 0 )); then
    WIDGET_OK=0
    WIDGET_JSON=""
    for _try in $(seq 1 10); do
      WIDGET_JSON="$(device_widget_tasks_json "${UDID_B}")"
      if [[ -n "${WIDGET_JSON}" ]] && grep -Fq "${REMINDER_ANCHOR}" <<<"${WIDGET_JSON}"; then
        WIDGET_OK=1
        break
      fi
      sleep 6
    done
    if (( WIDGET_OK == 1 )); then
      note "    PASS widget projection on B contains the peer's task"
      # The projection is also a privacy boundary. HOUSE_WIDGET_TASK_FIELDS is an
      # 8-field allowlist over a 58-column row, and the fields it excludes are
      # exactly the ones a household would least like sitting in plaintext
      # outside the encrypted store (description, ai_rationale, blocker_reason,
      # clarification_question, assignee identity, photo keys). Anything beyond
      # the allowlist appearing here is a leak, not a cosmetic difference.
      LEAKED="$(python3 -c "
import json, sys
allowed = {'id','household_id','title','space_id','system_category',
           'next_due_date','priority_severity','is_active'}
try:
    rows = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
extra = set()
for r in rows if isinstance(rows, list) else []:
    if isinstance(r, dict):
        extra |= set(r.keys()) - allowed
print(','.join(sorted(extra)))
" <<<"${WIDGET_JSON}")"
      if [[ -n "${LEAKED}" ]]; then
        note "    FAIL widget projection carries fields outside the allowlist: ${LEAKED}"
        FAILED=1
      else
        note "    PASS widget projection stays inside HOUSE_WIDGET_TASK_FIELDS"
      fi
    else
      note "    FAIL widget_tasks on B does not contain '${REMINDER_ANCHOR}'"
      note "    Nothing else can populate it: the widget extension has no DEK and the"
      note "    /tasks/watch endpoint returns nothing for a local-first household."
      FAILED=1
    fi
  fi
fi

# =========================================================================
# HOUSE ADDITION 5 — a MAP-DRAWN yard plan crosses to the other device.
#
# The row shapes this phase carries are what make it worth its minutes: a JSON
# STRING every reader parses (`boundary_geojson`) and a NESTED ARRAY inside
# `metadata` (the zone ring). A projection that re-encoded either would still
# sync a plan — just one whose geometry had quietly moved or flattened, which is
# the failure no screen would report. The ledger half is proved in
# `localGardenPlansApi.test.ts`; this is the same claim over a real relay.
if (( FAILED == 0 )) && phase_guard "phase 10 garden map plan"; then
  note "[hmm] === phase 10 (garden): map-drawn plan, each device sees the other's (PARALLEL) ==="
  pair "mm-40-garden-map-plan-and-await-peer" -- \
    mm-40-garden-map-plan-and-await-peer.yaml \
      "MM_TITLE=${OWNER_GARDEN_TITLE}" "MM_PEER_TITLE=${MEMBER_GARDEN_TITLE}" -- \
    mm-40-garden-map-plan-and-await-peer.yaml \
      "MM_TITLE=${MEMBER_GARDEN_TITLE}" "MM_PEER_TITLE=${OWNER_GARDEN_TITLE}" || true
fi

# =========================================================================
if (( FAILED == 0 )) && phase_guard "phase 5 delete"; then
  note "[hmm] === phase 5: both members delete, each sees the removal (PARALLEL) ==="
  # Two Maestro steps, not Budget's three-with-idb. House tasks have no swipe
  # tray (NativeSwipeable is imported only by Budget views) and their delete
  # confirm IS visible to Maestro — the already-green
  # tasks/task-detail-mutations.yaml taps its Cancel. See mm-22a's header.
  #
  # Matched by ANCHOR: phases 3 and 4 renamed the owner's row, so its full title
  # now carries whichever token won the merge.
  pair "mm-22a-delete-open-confirm" -- \
    mm-22a-delete-open-confirm.yaml "MM_TITLE=${OWNER_ANCHOR}" -- \
    mm-22a-delete-open-confirm.yaml "MM_TITLE=${MEMBER_ANCHOR}" || true
fi

if (( FAILED == 0 )); then
  pair "mm-22b-delete-verify-peer" -- \
    mm-22b-delete-verify-peer.yaml \
      "MM_TITLE=${OWNER_ANCHOR}" "MM_PEER_TITLE=${MEMBER_ANCHOR}" -- \
    mm-22b-delete-verify-peer.yaml \
      "MM_TITLE=${MEMBER_ANCHOR}" "MM_PEER_TITLE=${OWNER_ANCHOR}" || true
fi

# =========================================================================
# Cleanup only after a GREEN run. On failure the run stops immediately
# (MM_FAIL_FAST=0 to disable) so the fix/re-run loop is not paying for more
# Maestro invocations that prove nothing. Rows are timestamped per run, so
# leftovers never collide with the next attempt.
if (( FAILED == 0 )) && [[ "${MM_ENROLMENT_ONLY}" != "1" ]]; then
  note "[hmm] === cleanup ==="
  pair "mm-11-cleanup" -- \
    mm-11-cleanup.yaml "MM_ANCHOR=${OWNER_ANCHOR}" -- \
    mm-11-cleanup.yaml "MM_ANCHOR=${MEMBER_ANCHOR}" || true
  pair "mm-11-cleanup-additions" -- \
    mm-11-cleanup.yaml "MM_ANCHOR=${REMINDER_ANCHOR}" -- \
    mm-11-cleanup.yaml "MM_ANCHOR=${PROPERTY_ANCHOR}" || true
elif (( FAILED == 0 )); then
  # Nothing to sweep: the anchors mm-11 deletes belong to phases 2-10, which an
  # enrolment-only run never reached. The backfill row is deliberately kept —
  # mm-12 needs a task that predates the invite, and re-minting one each run is
  # what would leave litter.
  note "[hmm] MM_ENROLMENT_ONLY=1 — no cleanup needed (phases 2-10 wrote nothing)"
else
  note "[hmm] stopping after first failure — skipping cleanup (fail fast)"
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
echo "[hmm] report:  ${REPORT_OUT}/index.html"
echo "[hmm] summary: ${SUMMARY}"
echo "[hmm] steps:   ${REPORT_OUT}/steps-A.log , steps-B.log"
if (( FAILED != 0 )); then
  echo "[hmm] RESULT: FAILED"
  exit 1
fi
echo "[hmm] RESULT: PASSED"
