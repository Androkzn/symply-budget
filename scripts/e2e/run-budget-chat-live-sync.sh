#!/usr/bin/env bash
#
# Budget household chat — LIVE SYNC, two members, two simulators, IN PARALLEL.
#
# This is the companion to run-budget-chat-two-members.sh, and it tests the one
# thing that runner deliberately cannot.
#
# The serial runner hands off between devices: A sends, then B's app is launched
# and asserts the message is there. That proves the message was stored and is
# visible to the other member — but B fetched the thread on open, so it says
# NOTHING about real-time delivery. A completely broken WebSocket would still
# pass it.
#
# Here both simulators are driven AT THE SAME TIME:
#
#   device B  enters the room, hard-asserts the message is NOT there yet,
#             then sits still and waits for it to appear on its own
#   device A  enters the same room, waits for B to settle, and sends
#
# Anything B sees from that point arrived over the live ChatRoomDO socket
# (useChatSocket) while its screen was open — no navigation, no refresh, no
# relaunch. B's "not there yet" assertion is what keeps it honest: if A gets
# ahead of B, the run fails loudly instead of passing on a message that was
# already in the thread.
#
# Prereq: the two accounts must ALREADY be paired in one V2 household — run
# ./scripts/e2e/run-budget-chat-two-members.sh first if they are not.
#
# Usage:
#   ./scripts/e2e/run-budget-chat-live-sync.sh
#   PAIR_LIVE_SEND_DELAY_MS=90000 ./scripts/e2e/run-budget-chat-live-sync.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

DEVICE_A="${PAIR_DEVICE_A:-Budget-A}"
DEVICE_B="${PAIR_DEVICE_B:-Budget-B}"
APP_ID="com.symply.budget"
METRO_PORT="${BUDGET_METRO_PORT:-8082}"
METRO_LOG="/tmp/metro-budget.log"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget-chat-live"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"
# How long the sender waits, after reaching the room, before sending. Covers the
# skew between the two devices' launch+navigate; the watcher's absence assertion
# is what actually guards correctness, this only reduces false failures.
export PAIR_LIVE_SEND_DELAY_MS="${PAIR_LIVE_SEND_DELAY_MS:-60000}"

if [[ -f "${ROOT}/e2e/credentials.local" ]]; then
  set -a; source "${ROOT}/e2e/credentials.local"; set +a
fi
: "${E2E_EMAIL:?set E2E_EMAIL in e2e/credentials.local}"
: "${E2E_PASSWORD:?set E2E_PASSWORD in e2e/credentials.local}"
: "${E2E_EMAIL_SECONDARY:?set E2E_EMAIL_SECONDARY in e2e/credentials.local}"
E2E_PASSWORD_SECONDARY="${E2E_PASSWORD_SECONDARY:-$E2E_PASSWORD}"

export PATH="${HOME}/.maestro/bin:${PATH}"
command -v maestro >/dev/null 2>&1 || { echo "[live] Maestro not found on PATH" >&2; exit 1; }

find_udid() { xcrun simctl list devices available | grep " ${1} (" | grep -oE '[0-9A-F-]{36}' | head -1 || true; }
UDID_A="$(find_udid "${DEVICE_A}")"
UDID_B="$(find_udid "${DEVICE_B}")"
[[ -n "$UDID_A" && -n "$UDID_B" ]] || { echo "[live] need both ${DEVICE_A} and ${DEVICE_B}" >&2; exit 1; }

# ~/.maestro/tests is unbounded and two concurrent drivers fill it roughly twice
# as fast; a full disk mid-run kills the flows AND the report (hit 2026-08-10 at
# 35GB). Check up front rather than discovering it at the end.
AVAIL_GB="$(df -g /System/Volumes/Data 2>/dev/null | tail -1 | awk '{print $4}')"
if [[ -n "$AVAIL_GB" && "$AVAIL_GB" -lt 10 ]]; then
  echo "[live] only ${AVAIL_GB}GB free — prune ~/.maestro/tests before running two concurrent drivers" >&2
  exit 1
fi

for u in "${UDID_A}" "${UDID_B}"; do
  xcrun simctl boot "${u}" 2>/dev/null || true
  xcrun simctl bootstatus "${u}" -b >/dev/null 2>&1 || true
done
echo "[live] device A ${DEVICE_A} ${UDID_A}  (${E2E_EMAIL})"
echo "[live] device B ${DEVICE_B} ${UDID_B}  (${E2E_EMAIL_SECONDARY})"

CRASH_ARCHIVE="${ROOT}/.tmp/e2e-crashes/${RUN_TS}"
_stale=(~/Library/Logs/DiagnosticReports/SymplyEcosystem*.ips)
if [[ -e "${_stale[0]}" ]]; then
  mkdir -p "$CRASH_ARCHIVE"; mv "${_stale[@]}" "$CRASH_ARCHIVE"/ 2>/dev/null || true
fi

# ── fixture: the shared room both devices will sit in ───────────────────────
RUN_TOKEN="${RUN_TS#*-}"
ROOM_NAME="Live Sync ${RUN_TOKEN}"
echo "[live] ensuring shared room '${ROOM_NAME}'"
PAIR_ENV="$(node "${ROOT}/scripts/e2e/setup-budget-chat-pair.mjs" --emit-env --ensure-room "${ROOM_NAME}")" || {
  echo "[live] fixture failed — are the two accounts paired yet?" >&2; exit 1; }
eval "${PAIR_ENV}"
export PAIR_LIVE_MSG="Live ping ${RUN_TOKEN}"
echo "[live] room='${PAIR_ROOM_NAME}'  message='${PAIR_LIVE_MSG}'  send-delay=${PAIR_LIVE_SEND_DELAY_MS}ms"

# ── Metro ───────────────────────────────────────────────────────────────────
metro_serves_bundle() {
  curl -sf --max-time 180 \
    "http://localhost:${METRO_PORT}/index.bundle?platform=ios&dev=true&minify=false" -o /dev/null 2>/dev/null
}
if ! curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 || [[ ! -f "$METRO_LOG" ]] || ! metro_serves_bundle; then
  echo "[live] starting a clean Metro for brand=budget on :${METRO_PORT}"
  lsof -nP -iTCP:"${METRO_PORT}" -sTCP:LISTEN -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  sleep 2
  ( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh budget --port "${METRO_PORT}" ) &
  for _ in $(seq 1 90); do curl -sf "http://localhost:${METRO_PORT}/status" >/dev/null 2>&1 && break; sleep 2; done
  metro_serves_bundle || { echo "[live] Metro cannot serve a bundle" >&2; exit 1; }
fi
echo "[live] Metro ready"

# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="$REPORT_OUT"
[[ "$(dirname "$REPORT_OUT")" == "$REPORTS_BASE" ]] && LATEST_TARGET="$(basename "$REPORT_OUT")"
mkdir -p "$REPORT_OUT"; ln -sfn "$LATEST_TARGET" "${REPORTS_BASE}/latest"

login_url_for() {
  node -e "
    const p = new URLSearchParams({ submit: '1', email: process.argv[1], password: process.argv[2] });
    process.stdout.write('simplebudget://e2e-login?' + p.toString());
  " "$1" "$2"
}

run_side() {
  local label="$1" flow="$2" udid="$3" email="$4" password="$5" logfile="$6"
  local login_url; login_url="$(login_url_for "$email" "$password")"
  MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}" \
  maestro test \
    -e "E2E_LOGIN_URL=${login_url}" \
    -e "E2E_EMAIL=${email}" \
    -e "E2E_PASSWORD=${password}" \
    -e "APP_ID=${APP_ID}" \
    -e "E2E_APP_SCHEME=simplebudget" \
    -e "E2E_METRO_DEVCLIENT_URL=simplebudget://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A${METRO_PORT}" \
    -e "PAIR_ROOM_NAME=${PAIR_ROOM_NAME}" \
    -e "PAIR_LIVE_MSG=${PAIR_LIVE_MSG}" \
    -e "PAIR_LIVE_SEND_DELAY_MS=${PAIR_LIVE_SEND_DELAY_MS}" \
    -e "PAIR_A_NAME=${PAIR_A_NAME}" \
    -e "PAIR_B_NAME=${PAIR_B_NAME}" \
    -e "PAIR_PEER_NAME=${PAIR_PEER_NAME}" \
    "${ROOT}/e2e/maestro/budget/${flow}.yaml" \
    --device "$udid" --format NOOP --no-reinstall-driver \
    >"$logfile" 2>&1
  echo "$?" >"${logfile}.rc"
}

# PAIR_LIVE_SENDER=api runs ONE driver (the watcher) and posts A's message over
# the API instead of driving a second simulator. The property under test is
# unchanged — the message still has to reach B's already-open room over the live
# socket — but two concurrent XCUITest drivers starve this machine (load >50,
# both sides die before reaching the room). Use `ui` on a box that can take it.
LIVE_SENDER="${PAIR_LIVE_SENDER:-ui}"

# Direction. a-to-b: B watches, A sends (the default). b-to-a: the mirror image,
# which is the only way to prove the REVERSE path — a reply travelling back to
# the original sender — without depending on the enrolment UI.
LIVE_DIR="${PAIR_LIVE_DIRECTION:-a-to-b}"
if [[ "$LIVE_DIR" == "b-to-a" ]]; then
  WATCH_UDID="$UDID_A"; WATCH_EMAIL="$E2E_EMAIL";           WATCH_PW="$E2E_PASSWORD"
  SEND_AS="b";          SEND_LABEL="B"; export PAIR_PEER_NAME="${PAIR_B_NAME}"
  WATCH_LABEL="A(watch)"
else
  WATCH_UDID="$UDID_B"; WATCH_EMAIL="$E2E_EMAIL_SECONDARY"; WATCH_PW="$E2E_PASSWORD_SECONDARY"
  SEND_AS="a";          SEND_LABEL="A"; export PAIR_PEER_NAME="${PAIR_A_NAME}"
  WATCH_LABEL="B(watch)"
fi
# NB: no `${VAR^^}` anywhere here — macOS ships bash 3.2, where that is a
# "bad substitution" that kills the run right after Metro comes up.
RC_A=1
RC_B=1

if [[ "$LIVE_SENDER" == "api" ]]; then
  echo ""
  echo "══ single-driver mode (${LIVE_DIR}): ${WATCH_LABEL} watches, member ${SEND_LABEL} sends over the API ══"
  run_side "$WATCH_LABEL" budget-chat-pair-live-b-watch "$WATCH_UDID" "$WATCH_EMAIL" "$WATCH_PW" "${REPORT_OUT}/b-watch.log" &
  PID_B=$!

  # REAL rendezvous, not a timer. A fixed delay cannot work here: the watcher's
  # launch+navigate takes anywhere from ~2 to ~5 minutes depending on machine
  # load, and if the send lands first the watcher's "not here yet" assertion
  # fails and the whole run is wasted (hit at 180s).
  #
  # Maestro streams each step as it finishes, so the watcher's own progress log
  # tells us exactly when it is ready: the one `assertNotVisible` in that flow is
  # the absence reading taken immediately after the room opens. Once that line
  # says COMPLETED, the watcher is parked in the room with a clean baseline —
  # which is precisely the moment to send.
  echo "[live] waiting for device B to reach the room and take its baseline…"
  RENDEZVOUS_MAX="${PAIR_LIVE_RENDEZVOUS_MAX_SEC:-600}"
  waited=0
  ready=0
  while (( waited < RENDEZVOUS_MAX )); do
    # Must be THE baseline assertion, not any of the several other "is not
    # visible" waits the launch subflow performs (matching one of those fired
    # the send at 125s while the watcher was still navigating). Maestro echoes
    # the step with the placeholder un-interpolated, so key off PAIR_LIVE_MSG.
    if grep -a "is not visible\.\.\. COMPLETED" "${REPORT_OUT}/b-watch.log" 2>/dev/null | grep -qa 'PAIR_LIVE_MSG'; then
      echo "[live] device B is watching the room (after ${waited}s)"
      ready=1
      break
    fi
    # If the watcher died there is nothing left to rendezvous with.
    kill -0 "$PID_B" 2>/dev/null || { echo "[live] watcher exited before reaching the room"; break; }
    sleep 5
    waited=$((waited + 5))
  done
  (( ready == 1 )) || echo "[live] no baseline signal — sending anyway (the watcher's own assertion still guards correctness)"
  echo "[live] sending as member ${SEND_LABEL}…"
  node "${ROOT}/scripts/e2e/setup-budget-chat-pair.mjs" \
    --send-as "${SEND_AS}" --send-room "${PAIR_ROOM_NAME}" --send-body "${PAIR_LIVE_MSG}" >/dev/null 2>&1 \
    && RC_A=0 || RC_A=1
  wait "$PID_B"
  RC_B="$(cat "${REPORT_OUT}/b-watch.log.rc" 2>/dev/null || echo 1)"
else
  echo ""
  echo "══ launching BOTH devices concurrently ══"
  # Watcher first by a hair so it is never the one that arrives late.
  run_side "B(watch)" budget-chat-pair-live-b-watch "$UDID_B" "$E2E_EMAIL_SECONDARY" "$E2E_PASSWORD_SECONDARY" "${REPORT_OUT}/b-watch.log" &
  PID_B=$!
  sleep 3
  run_side "A(send)" budget-chat-pair-live-a-send "$UDID_A" "$E2E_EMAIL" "$E2E_PASSWORD" "${REPORT_OUT}/a-send.log" &
  PID_A=$!

  wait "$PID_B"; wait "$PID_A"
  RC_B="$(cat "${REPORT_OUT}/b-watch.log.rc" 2>/dev/null || echo 1)"
  RC_A="$(cat "${REPORT_OUT}/a-send.log.rc" 2>/dev/null || echo 1)"
fi

echo ""
echo "══ A (sender)  exit=${RC_A}   log: ${REPORT_OUT}/a-send.log"
echo "══ B (watcher) exit=${RC_B}   log: ${REPORT_OUT}/b-watch.log"
if [[ "$RC_A" == "0" && "$RC_B" == "0" ]]; then
  echo ""
  echo "[live] LIVE SYNC VERIFIED (${LIVE_DIR}) — ${WATCH_LABEL} received member ${SEND_LABEL}'s message in real time, in an already-open room"
  exit 0
fi
echo ""
echo "[live] live-sync run FAILED (A=${RC_A} B=${RC_B})"
# The watcher failing on its absence assertion means the rendezvous slipped, not
# that sync is broken — call that out so it is not misread as a product bug.
if grep -qa "assertNotVisible\|Assertion is false: .*${PAIR_LIVE_MSG}" "${REPORT_OUT}/b-watch.log" 2>/dev/null; then
  echo "[live] NOTE: watcher saw the message already present on arrival — sender got ahead."
  echo "[live] Re-run with a larger PAIR_LIVE_SEND_DELAY_MS (currently ${PAIR_LIVE_SEND_DELAY_MS})."
fi
exit 1
