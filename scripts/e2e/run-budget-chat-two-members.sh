#!/usr/bin/env bash
#
# Budget household chat — TWO REAL MEMBERS, TWO REAL SIMULATORS.
#
# Every other Budget chat flow drives one account talking to itself (or to the AI
# assistant), which cannot distinguish "the message was delivered to the other
# member" from "the sender's own optimistic echo rendered". This runner puts the
# PRIMARY account on one simulator and the SECONDARY account on a second one and
# walks both through the real product path:
#
#   A1  (device A)  A opens Members in the shared household, mints an invite link
#   B1  (device B)  B opens the invite deep link and requests to join
#   A2  (device A)  A approves the request → the household now has two members
#   A3  (device A)  A creates this run's room and sends the first message
#   B2  (device B)  B sees the room + unread badge + A's INCOMING bubble, replies
#   A4  (device A)  A sees B's reply as an INCOMING bubble → bidirectional
#
# The stages are SERIAL, never concurrent: only one simulator is under Maestro at
# a time. That is deliberate — iOS 26 drivers drop out under load (see the
# maestro-ios26-reduced-load notes), and a serial hand-off models the real timing
# anyway (one person sends, the other answers later). Both sims stay booted
# throughout so neither has to cold-start mid-run.
#
# Usage:
#   ./scripts/e2e/run-budget-chat-two-members.sh              # all six stages
#   PAIR_STAGES="a3 b2 a4" ./scripts/e2e/run-budget-chat-two-members.sh   # subset
#
# Prereqs: Maestro; com.symply.budget installed on device A (this script clones
# the bundle onto device B); e2e/credentials.local with BOTH accounts.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

DEVICE_A="${PAIR_DEVICE_A:-Budget-A}"
DEVICE_B="${PAIR_DEVICE_B:-Budget-B}"
APP_ID="com.symply.budget"
METRO_PORT="${BUDGET_METRO_PORT:-8082}"
METRO_LOG="/tmp/metro-budget.log"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget-chat-pair"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"
STAGES="${PAIR_STAGES:-a1 b1 a2 a3 b2 a4}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a; source "${ROOT}/e2e/credentials.local"; set +a
fi
: "${E2E_EMAIL:?set E2E_EMAIL in e2e/credentials.local}"
: "${E2E_PASSWORD:?set E2E_PASSWORD in e2e/credentials.local}"
: "${E2E_EMAIL_SECONDARY:?set E2E_EMAIL_SECONDARY in e2e/credentials.local}"
E2E_PASSWORD_SECONDARY="${E2E_PASSWORD_SECONDARY:-$E2E_PASSWORD}"

export PATH="${HOME}/.maestro/bin:${PATH}"

# ── simulators ──────────────────────────────────────────────────────────────
find_udid() { xcrun simctl list devices available | grep " ${1} (" | grep -oE '[0-9A-F-]{36}' | head -1 || true; }

UDID_A="$(find_udid "${DEVICE_A}")"
if [[ -z "${UDID_A}" ]]; then
  echo "[pair] no simulator named '${DEVICE_A}' — build/install Budget on it first" >&2
  exit 1
fi

UDID_B="$(find_udid "${DEVICE_B}")"
if [[ -z "${UDID_B}" ]]; then
  echo "[pair] creating ${DEVICE_B}"
  DTYPE="$(xcrun simctl list devices -j | python3 -c "
import json,sys
d=json.load(sys.stdin)
for rt,devs in d['devices'].items():
    for x in devs:
        if x['udid']=='${UDID_A}': print(x['deviceTypeIdentifier'], rt)
" )"
  # shellcheck disable=SC2086
  UDID_B="$(xcrun simctl create "${DEVICE_B}" ${DTYPE})"
fi

for u in "${UDID_A}" "${UDID_B}"; do
  xcrun simctl boot "${u}" 2>/dev/null || true
  xcrun simctl bootstatus "${u}" -b >/dev/null 2>&1 || true
  # iOS Password AutoFill hijacks inputText on secure fields and corrupts email
  # clears, so both members' sims need it off before any login or the invite
  # secret gets typed. (run-budget-suite.sh does this too; we no longer go
  # through it, so do it here.)
  for _plist in \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${u}/data/Containers/Shared/SystemGroup/systemgroup.com.apple.configurationprofiles/Library/ConfigurationProfiles/UserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${u}/data/Library/UserConfigurationProfiles/EffectiveUserSettings.plist" \
    "${HOME}/Library/Developer/CoreSimulator/Devices/${u}/data/Library/UserConfigurationProfiles/PublicInfo/PublicEffectiveUserSettings.plist"
  do
    [[ -f "${_plist}" ]] && plutil -replace restrictedBool.allowPasswordAutoFill.value -bool NO "${_plist}" 2>/dev/null || true
  done
  xcrun simctl spawn "${u}" defaults write com.apple.WebUI AutoFillPasswords -bool false 2>/dev/null || true
done
export PATH="${HOME}/.maestro/bin:${PATH}"
command -v maestro >/dev/null 2>&1 || { echo "[pair] Maestro not found on PATH" >&2; exit 1; }
echo "[pair] device A ${DEVICE_A} ${UDID_A}  (${E2E_EMAIL})"
echo "[pair] device B ${DEVICE_B} ${UDID_B}  (${E2E_EMAIL_SECONDARY})"

# Maestro fails a flow when it finds ANY crash report for the bundle — including
# ones left by earlier runs. A single stale .ips therefore fails every future
# flow no matter how clean the run is (observed 2026-08-10: a1 completed every
# command, then failed on a crash file written 13 minutes before the stage even
# started). Archive them so crash detection reports THIS run's crashes only.
CRASH_ARCHIVE="${ROOT}/.tmp/e2e-crashes/${RUN_TS}"
_stale_crashes=(~/Library/Logs/DiagnosticReports/SymplyEcosystem*.ips)
if [[ -e "${_stale_crashes[0]}" ]]; then
  mkdir -p "$CRASH_ARCHIVE"
  mv "${_stale_crashes[@]}" "$CRASH_ARCHIVE"/ 2>/dev/null || true
  echo "[pair] archived $(ls -1 "$CRASH_ARCHIVE" | wc -l | tr -d ' ') stale crash report(s) → ${CRASH_ARCHIVE}"
fi

# Device B gets the exact same build as device A — a two-member run comparing two
# different builds would be meaningless.
if ! xcrun simctl get_app_container "${UDID_B}" "${APP_ID}" >/dev/null 2>&1; then
  echo "[pair] installing ${APP_ID} on ${DEVICE_B} (cloned from ${DEVICE_A})"
  SRC_APP="$(xcrun simctl get_app_container "${UDID_A}" "${APP_ID}")"
  STAGE_DIR="$(mktemp -d)"
  cp -R "${SRC_APP}" "${STAGE_DIR}/" && xcrun simctl install "${UDID_B}" "${STAGE_DIR}"/*.app
  rm -rf "${STAGE_DIR}"
fi

# ── fixture check (V2 creates nothing server-side; pairing is in-app) ───────
echo "[pair] checking accounts + existing V2 pairing"
PAIR_ENV="$(node "${ROOT}/scripts/e2e/setup-budget-chat-pair.mjs" --emit-env)" || {
  echo "[pair] fixture check failed" >&2; exit 1; }
eval "${PAIR_ENV}"

# Skipping enrolment when the two ACCOUNTS share a household looked like a sound
# optimisation. It is not, and it silently invalidated several runs.
#
# `ensureBudgetLocalSession` mints a BRAND NEW `hh_local_…` whenever a device
# cannot reopen its existing ledger, registers it with the control plane, and
# leaves the old one orphaned. So an account accumulates households (8 on the
# primary here, 5 on the secondary) and — critically — a DEVICE can drift off the
# household its account was paired in. Observed 2026-08-11: A on
# hh_local_40addac4…, B on hh_local_b0a8b20c…, while the paired household
# hh_local_fac1ebb3… had neither. The account-level check still said "paired", so
# the run skipped enrolment and went straight to chat stages that could not
# possibly see each other's rooms.
#
# The devices' current households are the only thing that matters, and only the
# app knows those. Rather than guess, re-enrol every run: it costs three stages
# and is always correct. Pass PAIR_STAGES explicitly to override.
if [[ "${PAIR_ALREADY_PAIRED}" == "1" ]]; then
  echo "[pair] accounts share ${PAIR_SHARED_HOUSEHOLD_ID}, but that does NOT mean these two"
  echo "[pair] DEVICES are on it — re-running enrolment so the pairing is real."
fi

# Per-run tokens so no assertion can ever match a room/message left by an earlier
# run on the shared staging account.
RUN_TOKEN="${RUN_TS#*-}"
export PAIR_ROOM_NAME="Pair Chat ${RUN_TOKEN}"
export PAIR_MSG_A="Hi from A ${RUN_TOKEN}"
export PAIR_MSG_B="Reply from B ${RUN_TOKEN}"
echo "[pair] members: A='${PAIR_A_NAME}'  B='${PAIR_B_NAME}'"
echo "[pair] room='${PAIR_ROOM_NAME}'  A->'${PAIR_MSG_A}'  B->'${PAIR_MSG_B}'"

# ── Metro (one instance, both sims dial 127.0.0.1 on the host) ──────────────
# `/status` answering 'packager-status:running' is NOT proof Metro can serve this
# brand: a long-lived Metro left over from an earlier session keeps answering
# /status while its transform cache is stale or it was started for a DIFFERENT
# brand, and every launch then dies on "Failed to load app from 127.0.0.1:8082"
# (observed 2026-08-10 against a 3h-old leftover). Probe an actual bundle build,
# and if that fails, take the port back and start a clean Metro for `budget`.
metro_serves_bundle() {
  curl -sf --max-time 180 \
    "http://localhost:${METRO_PORT}/index.bundle?platform=ios&dev=true&minify=false" \
    -o /dev/null 2>/dev/null
}

start_metro() {
  echo "[pair] starting a clean Metro for brand=budget on :${METRO_PORT}"
  lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  sleep 2
  ( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh budget --port "${METRO_PORT}" ) &
  for _ in $(seq 1 90); do
    curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 && break
    sleep 2
  done
}

if curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1; then
  if [[ ! -f "$METRO_LOG" ]]; then
    # Metro is up but its log file is gone (deleted while it held the handle, so
    # output goes to an unlinked inode). The invite hand-off between the two
    # devices reads that log, so a Metro we cannot read from is useless here.
    echo "[pair] Metro is up but ${METRO_LOG} is missing — restarting so its log is readable"
    start_metro
  else
    echo "[pair] Metro already on :${METRO_PORT} — probing that it can actually bundle"
    metro_serves_bundle || { echo "[pair] existing Metro cannot serve a bundle — replacing it"; start_metro; }
  fi
else
  start_metro
fi
metro_serves_bundle || { echo "[pair] Metro cannot serve an iOS bundle on :${METRO_PORT}" >&2; exit 1; }
echo "[pair] Metro ready (bundle probe OK)"

# ── report plumbing (same aggregation shape as run-budget-suite-live-report) ─
# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="$REPORT_OUT"
[[ "$(dirname "$REPORT_OUT")" == "$REPORTS_BASE" ]] && LATEST_TARGET="$(basename "$REPORT_OUT")"
mkdir -p "$REPORT_OUT"; ln -sfn "$LATEST_TARGET" "${REPORTS_BASE}/latest"
AGG_DIR="${REPORT_OUT}/.run-dirs"; mkdir -p "$AGG_DIR"; rm -f "$AGG_DIR"/*
BEFORE_RUNS="$(ls -1 "$HOME/.maestro/tests" 2>/dev/null || true)"
REPORT_OPENED=0

link_new_run_dirs() {
  comm -13 <(printf '%s\n' "$BEFORE_RUNS" | sort) <(ls -1 "$HOME/.maestro/tests" 2>/dev/null | sort) \
    | while IFS= read -r tname; do
        [[ -n "$tname" ]] || continue
        for flow in "$HOME/.maestro/tests/$tname"/*/; do
          flow="${flow%/}"
          [[ -f "$flow/commands.json" ]] || continue
          ln -sfn "$flow" "$AGG_DIR/${tname}__$(basename "$flow")"
        done
      done
}

BUILD_NO="$(node -e "console.log(require('${ROOT}/brands/symply-budget/brand.cjs').iosBuildNumber)" 2>/dev/null || true)"
regen_report() {
  link_new_run_dirs
  [[ -n "$(ls -A "$AGG_DIR" 2>/dev/null)" ]] || return 0
  local meta=(--platform iOS --environment "${EXPO_PUBLIC_API_ENV:-staging}" --device "${DEVICE_A} + ${DEVICE_B}")
  [[ -n "$BUILD_NO" ]] && meta+=(--build-number "$BUILD_NO")
  node "$ROOT/scripts/e2e/generate-report.mjs" \
    --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
    --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
    "${meta[@]}" >/tmp/e2e-report-budget-pair-gen.log 2>&1 || true
  if [[ "$REPORT_OPENED" == "0" && -f "${REPORT_OUT}/index.html" ]]; then
    open "${REPORT_OUT}/index.html" 2>/dev/null || true
    REPORT_OPENED=1
  fi
}

# ── stages ──────────────────────────────────────────────────────────────────
# Stage id → flow file + which member/device runs it.
flow_for() {
  case "$1" in
    a1) echo "budget-chat-pair-a1-invite" ;;
    b1) echo "budget-chat-pair-b1-join" ;;
    a2) echo "budget-chat-pair-a2-approve" ;;
    a3) echo "budget-chat-pair-a3-send" ;;
    b2) echo "budget-chat-pair-b2-receive-reply" ;;
    a4) echo "budget-chat-pair-a4-verify-reply" ;;
    *)  echo "" ;;
  esac
}

# The invite code / secret exist only on device A's screen and in the native
# share/clipboard — neither of which a driver on device B can read.
# BudgetInviteScreen logs them once (dev builds only) as `[E2E-INVITE] …`; this
# plays the human messenger who reads the code out over the phone, so the UI path
# under test stays the real one on both devices.
scrape_invite() {
  local line
  line="$(grep -a '\[E2E-INVITE\]' "$METRO_LOG" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "[pair] could not find an [E2E-INVITE] line in ${METRO_LOG}" >&2
    echo "[pair] (needs a DEV build — the log is __DEV__-only)" >&2
    return 1
  fi
  PAIR_INVITE_CODE="$(sed -E 's/.*code=([^ ]+).*/\1/' <<<"$line")"
  PAIR_INVITE_SECRET="$(sed -E 's/.*secret=([^ ]+).*/\1/' <<<"$line")"
  export PAIR_INVITE_CODE PAIR_INVITE_SECRET
  if [[ -z "$PAIR_INVITE_CODE" || -z "$PAIR_INVITE_SECRET" ]]; then
    echo "[pair] malformed [E2E-INVITE] line: ${line}" >&2
    return 1
  fi
  # Secret is a one-shot enrolment token for a throwaway staging household; the
  # code is what a real user reads aloud. Print only the non-secret part.
  echo "[pair] invite carried to device B: code=${PAIR_INVITE_CODE}"
}

# The verification digits, carried the OTHER way — B → A.
#
# This is the direction that matters. B derives the digits from ITS OWN device
# keys; A derives them from what the control plane says B holds. Carrying B's
# number to A and asserting A's screen shows it is the end-to-end statement that
# the control plane relayed the real key — the one thing the old three-word
# ceremony could never check, because only A ever knew its answer.
scrape_join_sas() {
  local line
  line="$(grep -a '\[E2E-JOIN-SAS\]' "$METRO_LOG" 2>/dev/null | tail -1 || true)"
  if [[ -z "$line" ]]; then
    echo "[pair] could not find an [E2E-JOIN-SAS] line in ${METRO_LOG}" >&2
    echo "[pair] (stage b1 must have joined; the log is __DEV__-only)" >&2
    return 1
  fi
  local digits
  digits="$(sed -E 's/.*sas=([0-9]+).*/\1/' <<<"$line" | tr -d '\r')"
  if [[ ! "$digits" =~ ^[0-9]{6}$ ]]; then
    echo "[pair] malformed [E2E-JOIN-SAS] line: ${line}" >&2
    return 1
  fi
  # GROUPED, because that is how the screen renders it and Maestro matches a
  # regex against an element's whole text — asserting the ungrouped digits
  # against "006 366" never matches, and the failure looks like a mismatch
  # rather than a formatting bug.
  PAIR_SAS="${digits:0:3} ${digits:3:3}"
  export PAIR_SAS
  # Not a secret: it is derived from public keys and is meant to be read aloud.
  echo "[pair] device B is showing ${PAIR_SAS} — device A must show the same"
}

PAIR_INVITE_CODE="${PAIR_INVITE_CODE:-}"
PAIR_INVITE_SECRET="${PAIR_INVITE_SECRET:-}"
PAIR_SAS="${PAIR_SAS:-}"

FAILED=()
run_stage() {
  local stage="$1" flow device udid email password
  flow="$(flow_for "$stage")"
  if [[ -z "$flow" ]]; then echo "[pair] unknown stage '${stage}'" >&2; return 1; fi
  if [[ "$stage" == a* ]]; then
    device="$DEVICE_A"; udid="$UDID_A"; email="$E2E_EMAIL"; password="$E2E_PASSWORD"
  else
    device="$DEVICE_B"; udid="$UDID_B"; email="$E2E_EMAIL_SECONDARY"; password="$E2E_PASSWORD_SECONDARY"
  fi
  echo ""
  echo "══ stage ${stage} → ${flow} on ${device} as ${email}"

  # Only pass variables that actually have a value. `maestro test -e KEY=` with an
  # EMPTY value makes the run exit non-zero with no summary and no failed command
  # — every step reports COMPLETED and the flow still scores as failed (chased
  # 2026-08-10: a1 passed standalone and failed here purely because the invite
  # vars are still empty until stage A1 has produced them).
  local -a env_args=()
  local var
  for var in PAIR_INVITE_CODE PAIR_INVITE_SECRET PAIR_SAS \
             PAIR_A_NAME PAIR_B_NAME PAIR_ROOM_NAME PAIR_MSG_A PAIR_MSG_B; do
    [[ -n "${!var:-}" ]] && env_args+=(-e "${var}=${!var}")
  done

  # Drive maestro DIRECTLY rather than through run-budget-suite.sh.
  #
  # That runner wraps maestro in maestro-flow-run.sh, which decides pass/fail by
  # grepping the output for a "1/1 Flow Passed" banner. Maestro does not always
  # print one (it did not for any of these stages), so a flow whose every command
  # COMPLETED was still scored as a failure — while the same flow invoked
  # directly exits 0. Maestro's own exit code is the authority here.
  #
  # Everything the runner would have set up for us is done above, once per
  # simulator: booting, the Password-AutoFill defaults, and the login URL.
  local login_url
  login_url="$(node -e "
    const p = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplebudget://e2e-login?' + p.toString());
  " "$email" "$password")"

  MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}" \
  maestro test \
    -e "E2E_LOGIN_URL=${login_url}" \
    -e "E2E_EMAIL=${email}" \
    -e "E2E_PASSWORD=${password}" \
    -e "APP_ID=${APP_ID}" \
    -e "E2E_APP_SCHEME=simplebudget" \
    -e "E2E_METRO_DEVCLIENT_URL=simplebudget://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}" \
    "${env_args[@]}" \
    "${ROOT}/e2e/maestro/budget/${flow}.yaml" \
    --device "$udid" \
    --format NOOP \
    --no-reinstall-driver
  local rc=$?
  regen_report
  if (( rc != 0 )); then
    echo "══ stage ${stage} FAILED (exit ${rc})"
    FAILED+=("$stage")
  else
    echo "══ stage ${stage} passed"
  fi
  return $rc
}

echo "[pair] report dir: ${REPORT_OUT}  (also ${REPORTS_BASE}/latest)"
for stage in $STAGES; do
  run_stage "$stage"
  rc=$?
  # Hand the freshly minted invite over to device B before its stage runs.
  if [[ "$stage" == "a1" && $rc -eq 0 ]]; then
    scrape_invite || { echo "[pair] cannot continue without the invite"; FAILED+=("a1-scrape"); break; }
  fi
  # …and carry B's verification digits back to A, which is what A2 compares
  # against. Without them A2 has nothing to check and must not run.
  if [[ "$stage" == "b1" && $rc -eq 0 ]]; then
    scrape_join_sas || { echo "[pair] cannot approve without B's number"; FAILED+=("b1-scrape"); break; }
  fi
  # The stages are a chain: A cannot approve a request B never made, and B cannot
  # receive a message A never sent. Stopping at the first failure keeps the report
  # honest instead of burying the real cause under a cascade of dependent failures.
  if (( rc != 0 )) && [[ "${PAIR_CONTINUE_ON_FAIL:-0}" != "1" ]]; then
    echo "[pair] stopping — later stages depend on this one (PAIR_CONTINUE_ON_FAIL=1 to override)"
    break
  fi
done

regen_report
echo ""
if (( ${#FAILED[@]} == 0 )); then
  echo "[pair] ALL STAGES PASSED — two-member Budget chat verified end to end"
else
  echo "[pair] FAILED stages: ${FAILED[*]}"
fi
echo "[pair] report: ${REPORT_OUT}/index.html"
(( ${#FAILED[@]} == 0 ))
