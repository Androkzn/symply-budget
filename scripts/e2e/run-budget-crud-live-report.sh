#!/usr/bin/env bash
# Budget CRUD slice — create / scan-import / delete for spendings + planned
# items — run on ONE single-user device with the project's live HTML report.
#
# Why a slice runner and not run-budget-suite-live-report.sh: that script's
# subset mode takes a single flow path (run-budget-suite.sh only accepts one
# TARGET), and its full-suite mode marches all ~100 flows. This runs an
# explicit ORDERED LIST while feeding the same generate-report.mjs reporter, so
# the report keeps the standard header/pill/per-flow format and the run is
# watchable while it happens.
#
# Usage:
#   E2E_DEVICE=Budget-C ./scripts/e2e/run-budget-crud-live-report.sh
#   E2E_DEVICE=Budget-C ./scripts/e2e/run-budget-crud-live-report.sh budget-plan-delete budget-spend-mutations
#
# Env:
#   E2E_DEVICE          simulator name (default: Budget-C — the fleet registry's
#                       third single-user device, free while a multi-member
#                       suite holds the Budget-A/-B pair)
#   BUDGET_METRO_PORT   Metro to point the dev client at (default 8082)
#   POLL_INTERVAL       report regeneration cadence in seconds (default 30)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

export E2E_DEVICE="${E2E_DEVICE:-Budget-C}"
# Same reason as the Budget suite runner: a booted device carrying a fresh Debug
# install measures ~2 GB, well over sim-disk-guard's 800 MB default, so the
# default cap would erase the device (and the app) at the start of every run.
export E2E_SIM_MAX_MB="${E2E_SIM_MAX_MB:-8000}"  # 3000 sat inside the size range of a HEALTHY installed device (3340-3625 MB) and erased the app mid-setup — see run-budget-suite-live-report.sh
# Never wait on the global Maestro lock: the A/B pair may be mid-suite, and this
# slice runs on its own device.
export E2E_PARALLEL_FLEET=1
export E2E_MAESTRO_LOCK=0
# Photos/documents are already seeded on this device; re-seeding would push more
# assets into the library and move whichever cell the receipt picker lands on.
export E2E_SEED_FIXTURES="${E2E_SEED_FIXTURES:-0}"

# maestro-flow-run's silence watchdog defaults to 420s, and Maestro prints
# NOTHING while it grinds through a `repeat` block. budget-spend-mutations runs
# up to 100 `when: visible` drain iterations over the shared test account, which
# is comfortably longer than that — it was killed twice at exactly 420s on
# 2026-08-22 with the app working fine (3 expense writes, 0 save failures).
#
# Those drain loops used to be free: before the frozen-household fix landed,
# Budget could not write a row at all, so there was never anything to drain.
# Making saves work made this flow do real work for the first time, and each
# run killed mid-cleanup leaves rows behind for the next one to delete — the
# stall gets worse every round until the timeout is raised.
export MAESTRO_FLOW_MAX_STALL_SEC="${MAESTRO_FLOW_MAX_STALL_SEC:-1200}"

BUDGET_METRO_PORT="${BUDGET_METRO_PORT:-8082}"
export BUDGET_METRO_PORT
METRO_LOG="${METRO_LOG:-/tmp/metro-budget.log}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# The CRUD slice, in dependency order: session first, then create paths, then
# the delete paths, then receipt import (slowest — live AI extraction).
FLOWS=(
  budget-prime-session
  budget-item-form
  budget-quick-add
  budget-spent-form
  budget-spend-mutations
  budget-plan-delete
  budget-planned-select
  budget-spent-select
  budget-receipt-scan
  budget-receipt-scan-save
  budget-receipt-category
  budget-local-first-offline-crud
)
if (( $# > 0 )); then
  FLOWS=("$@")
fi

RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget-crud"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"
SUMMARY="${REPORT_OUT}/summary.log"
LOG="${REPORT_OUT}/run.log"

REPORT_PLATFORM="iOS"
REPORT_DEVICE="${E2E_DEVICE}"
# shellcheck source=scripts/e2e/report-meta.sh
source "$(dirname "$0")/report-meta.sh"
report_meta_args symply-budget

mkdir -p "$REPORT_OUT"
LATEST_TARGET="$REPORT_OUT"
[[ "$(dirname "$REPORT_OUT")" == "$REPORTS_BASE" ]] && LATEST_TARGET="$(basename "$REPORT_OUT")"
ln -sfn "$LATEST_TARGET" "${REPORTS_BASE}/latest"
: > "$SUMMARY"
: > "$LOG"
echo "[crud] report dir: ${REPORT_OUT}  (also: ${REPORTS_BASE}/latest)"
echo "[crud] device: ${E2E_DEVICE}   metro: ${BUDGET_METRO_PORT}   flows: ${#FLOWS[@]}"

# Reuse a Metro already serving this checkout rather than stacking another one
# (stacked start-metro-logged shells are how port 8082 ends up with orphans).
if curl -sf "http://localhost:${BUDGET_METRO_PORT}/status" >/dev/null 2>&1; then
  echo "[crud] Metro already up on :${BUDGET_METRO_PORT} — reusing"
else
  echo "[crud] starting Metro on :${BUDGET_METRO_PORT}"
  ( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh budget --port "${BUDGET_METRO_PORT}" ) &
  for _ in $(seq 1 60); do
    curl -sf "http://localhost:${BUDGET_METRO_PORT}/status" >/dev/null 2>&1 && break
    sleep 2
  done
  curl -sf "http://localhost:${BUDGET_METRO_PORT}/status" >/dev/null 2>&1 || {
    echo "[crud] Metro did not come up in time" >&2; exit 1; }
fi

AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "$AGG_DIR"
BEFORE_RUNS="$(ls -1 "$HOME/.maestro/tests" 2>/dev/null || true)"

# Maestro writes <ts>/<flow>/commands.json only when a flow FINISHES; aggregate
# every new flow-level dir into one stable root the reporter can read.
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

regen_report() {
  link_new_run_dirs
  [[ -n "$(ls -A "$AGG_DIR" 2>/dev/null)" ]] || return 0
  node "$ROOT/scripts/e2e/generate-report.mjs" \
    --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
    --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
    --progress-total "${#FLOWS[@]}" --verdicts "$SUMMARY" \
    ${REPORT_META_ARGS[@]+"${REPORT_META_ARGS[@]}"} \
    >/tmp/e2e-report-budget-crud-gen.log 2>&1
}

# Background poller so the report updates while a flow is still running.
(
  while [[ ! -f "${REPORT_OUT}/.done" ]]; do
    regen_report
    if [[ ! -f "${REPORT_OUT}/.opened" && -f "${REPORT_OUT}/index.html" ]]; then
      open "${REPORT_OUT}/index.html" 2>/dev/null || true
      : > "${REPORT_OUT}/.opened"
    fi
    sleep "$POLL_INTERVAL"
  done
) &
POLLER_PID=$!

run_one() {
  local flow="$1"
  E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 E2E_MAESTRO_LOCK=0 \
    bash "${ROOT}/scripts/e2e/run-budget-suite.sh" \
    "${ROOT}/e2e/maestro/budget/${flow}.yaml" >>"$LOG" 2>&1
}

pass=0
fail=0
failed=()
for flow in "${FLOWS[@]}"; do
  echo "" >>"$LOG"
  echo "=== ${flow} ===" >>"$LOG"
  echo "[crud] running ${flow}"
  ok=0
  for attempt in 1 2; do
    if run_one "$flow"; then ok=1; break; fi
    tail_out="$(tail -120 "$LOG")"
    # Maestro sometimes fails to finalize its own log dir on a flow that
    # actually passed — the suite runner treats that as a pass, so do the same.
    if grep -q "NoSuchFileException.*Library/Logs/maestro\|FileNotFoundException.*\.maestro/tests" <<<"$tail_out" \
      && grep -q "COMPLETED\|Flow Passed\|1/1 Flow Passed" <<<"$tail_out"; then
      ok=1; break
    fi
    if grep -qE "IOSDriverTimeoutException|iOS driver not ready|Failed to connect|Connection refused|Killed: 9" <<<"$tail_out"; then
      echo "[crud] driver wobble on ${flow} (attempt ${attempt}) — cooling down 45s"
      sleep 45
      continue
    fi
    break
  done
  # `PASS [<device>] <flow>` is the shape generate-report.mjs's parseVerdicts
  # expects — anything else is silently ignored and the report falls back to
  # Maestro's own (over-optimistic) commands.json status.
  if (( ok )); then
    echo "PASS [${E2E_DEVICE}] ${flow}" | tee -a "$SUMMARY"
    pass=$((pass + 1))
  else
    echo "FAIL [${E2E_DEVICE}] ${flow}" | tee -a "$SUMMARY"
    fail=$((fail + 1))
    failed+=("$flow")
  fi
  # Same session-repair step the serial suite runner does between flows.
  if [[ "$flow" != "budget-prime-session" ]]; then
    E2E_BUDGET_SINGLE=1 E2E_SEED_FIXTURES=0 E2E_MAESTRO_LOCK=0 \
      bash "${ROOT}/scripts/e2e/run-budget-suite.sh" \
      "${ROOT}/e2e/maestro/budget/budget-recover-session.yaml" >>"$LOG" 2>&1 || true
  fi
  sleep 2
done

: > "${REPORT_OUT}/.done"
kill "$POLLER_PID" 2>/dev/null || true
wait "$POLLER_PID" 2>/dev/null || true
regen_report

echo ""
echo "[crud] complete: ${pass} pass / ${fail} fail"
((${#failed[@]})) && printf '[crud] failed: %s\n' "${failed[*]}"
echo "[crud] report: ${REPORT_OUT}/index.html"
exit $(( fail > 0 ? 1 : 0 ))
