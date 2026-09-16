#!/usr/bin/env bash
# Run the Budget Maestro suite on its dedicated simulator, parallel-safe with
# any other fleet brand's suite already running, regenerating the visual +
# backend HTML report every POLL_INTERVAL seconds while it runs — so progress
# is visible near-real-time instead of only after the whole suite finishes.
#
# Usage:
#   ./scripts/e2e/run-budget-suite-live-report.sh                    # whole suite
#   ./scripts/e2e/run-budget-suite-live-report.sh e2e/maestro/budget/budget-chat-message.yaml
#
# Report: each run gets its own timestamped directory under
# documents/engineering/testing/reports/budget/ (tracked by git — a history of
# what ran/passed/failed over time). The HTML/text is meant to be committed;
# each run's assets/ subfolder (screenshots, 60-600MB for a full suite) is
# gitignored — local-only, not worth the permanent git bloat. A
# .../reports/budget/latest symlink always points at the most recent run.
# Override with REPORT_OUT=... for a one-off custom path instead.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# NOTE ON THE SIM DISK GUARD: a booted Budget-A carrying a fresh Debug install
# measures ~2.3 GB, well over sim-disk-guard's 800 MB default cap — so the guard
# erased the device at the start of every run, taking the installed app with it,
# and the first flow then failed 2s in with nothing installed to drive (observed
# 2026-08-14). House's live-report runner already defaults the cap high for the
# same reason; Budget's did not. Override with E2E_SIM_MAX_MB.
#
# 2026-09-05: 3000 was still too low and reopened the exact same trap. A booted
# Budget-A with a current Debug install measures 3340-3625 MB, so the cap sat
# INSIDE the range a HEALTHY device occupies — the guard was not catching an
# oversized device, it was catching a correctly-installed one and erasing the
# app during setup. Two full runs died that way ("[sim-guard] Budget-A is 3340
# MB (cap 3000 MB) — erasing", then every flow driving a device with no app).
# 3000 was also BELOW sim-disk-guard.sh's own 5000 default, so Budget was opting
# into a stricter cap than the shared guard and paying for it while House, at
# 5000, never saw the symptom. 8000 leaves headroom above a fresh install.
export E2E_SIM_MAX_MB="${E2E_SIM_MAX_MB:-8000}"

METRO_LOG="/tmp/metro-budget.log"
RUN_TS="$(date +%Y%m%d-%H%M%S)"
REPORTS_BASE="${ROOT}/documents/engineering/testing/reports/budget"
REPORT_OUT="${REPORT_OUT:-${REPORTS_BASE}/${RUN_TS}}"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# Report header metadata. Build number comes from brands/symply-budget/brand.cjs
# (per-brand source of truth — root app.json/app.config.ts reflect whichever
# brand was LAST resolved into native config, see mobile-icon-kit-brand-tension)
# not the app running here, so read it from the brand pack directly.
REPORT_PLATFORM="iOS"
REPORT_DEVICE="${E2E_DEVICE:-Budget-A}"
# shellcheck source=scripts/e2e/report-meta.sh
source "$(dirname "$0")/report-meta.sh"
report_meta_args symply-budget

mkdir -p "$REPORT_OUT"
# Link relatively — `latest` is committed, and an absolute target would resolve
# into whichever checkout last ran the suite.
LATEST_TARGET="$REPORT_OUT"
[[ "$(dirname "$REPORT_OUT")" == "$REPORTS_BASE" ]] && LATEST_TARGET="$(basename "$REPORT_OUT")"
ln -sfn "$LATEST_TARGET" "${REPORTS_BASE}/latest"
echo "[live-report] report dir: ${REPORT_OUT}  (also: ${REPORTS_BASE}/latest)"

echo "[live-report] starting Metro (logged, cache cleared) on :8082"
( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh budget --port 8082 ) &

echo "[live-report] waiting for Metro..."
for _ in $(seq 1 60); do
  curl -sf http://localhost:8082/status >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf http://localhost:8082/status >/dev/null 2>&1; then
  echo "[live-report] Metro did not come up in time" >&2
  exit 1
fi
echo "[live-report] Metro ready"

BEFORE_RUNS="$(ls -1 "$HOME/.maestro/tests" 2>/dev/null || true)"

# Unlike Health's suite runner (one `maestro test <dir>` call for the whole
# suite → one run directory), run-budget-suite.sh invokes Maestro SEPARATELY
# per flow, and each flow's actual commands.json lives one level deeper than
# the timestamp dir itself: ~/.maestro/tests/<timestamp>/<flow-name>/commands.json
# (not directly under <timestamp>/). Aggregate every new FLOW-level dir
# (symlinked, not copied, disambiguated by timestamp prefix since the same
# flow — e.g. a session-recovery check — can recur) into a stable directory
# so generate-report.mjs — which accepts a "run root" of flow subdirs — sees
# the whole suite's progress, not just whichever flow finished first.
AGG_DIR="${REPORT_OUT}/.run-dirs"
mkdir -p "$AGG_DIR"
rm -f "$AGG_DIR"/*

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

echo "[live-report] launching Budget suite (E2E_PARALLEL_FLEET=1 — dedicated Budget-A sim, port 8082, no lock wait, other fleet sims untouched)"
( cd "$ROOT" && E2E_PARALLEL_FLEET=1 ./scripts/e2e/run-budget-suite.sh "$@" ) &
SUITE_PID=$!

# Poll for the whole life of the suite. This used to be gated behind a 10-minute
# "did the first run dir appear?" probe that fell back to generate-once-at-the-end
# — but Maestro only writes <ts>/<flow>/commands.json when a flow FINISHES, so a
# slow or hung first flow (cold driver install + budget-prime-session) blew the
# window and silently disabled live reporting for the entire multi-hour run
# (observed 2026-08-10). Nothing about live polling needs an early sighting:
# generate when there is something to generate, keep waiting otherwise.
echo "[live-report] watching ${AGG_DIR} (aggregates every new flow's run dir)"
echo "[live-report] report: ${REPORT_OUT}/index.html (updates every ${POLL_INTERVAL}s)"
# Denominator for the progress bar.
#
# `--flows-config` sizes it from the WHOLE workspace (91 flows). That is right
# for a full-suite run and wrong for every subset: a 38-flow stage reads
# "1 / 91 flows (1%)" and never leaves "In progress", because the generator
# infers "finished?" from completed === total. E2E_PROGRESS_TOTAL lets the
# caller state how many flows this particular run actually contains.
# Expanded below as ${PROGRESS_ARGS[@]+"${PROGRESS_ARGS[@]}"}, not the bare
# "${PROGRESS_ARGS[@]}": macOS ships bash 3.2, where an EMPTY array counts as
# unset, so under this script's `set -u` the bare form aborts with
# "PROGRESS_ARGS[@]: unbound variable". That killed the final report
# regeneration on every run that did not set E2E_PROGRESS_TOTAL — i.e. any
# direct single-flow invocation — so a PASSING flow exited 1 and never wrote
# its report (observed 2026-08-18 verifying budget-auth). Staged runs always
# set the variable, which is why the array was never empty there.
PROGRESS_ARGS=()
[[ -n "${E2E_PROGRESS_TOTAL:-}" ]] && PROGRESS_ARGS=(--progress-total "${E2E_PROGRESS_TOTAL}")

REPORT_OPENED=0
while kill -0 "$SUITE_PID" 2>/dev/null; do
  link_new_run_dirs
  if [[ -n "$(ls -A "$AGG_DIR" 2>/dev/null)" ]]; then
    node "$ROOT/scripts/e2e/generate-report.mjs" \
      --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
      --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
      ${PROGRESS_ARGS[@]+"${PROGRESS_ARGS[@]}"} ${REPORT_META_ARGS[@]+"${REPORT_META_ARGS[@]}"} \
      >/tmp/e2e-report-budget-live-gen.log 2>&1
    # Open once, on the first generation — the page auto-reloads every 15s
    # (see generate-report.mjs), so it keeps showing progress on its own.
    if [[ "$REPORT_OPENED" == "0" && -f "${REPORT_OUT}/index.html" ]]; then
      open "${REPORT_OUT}/index.html" 2>/dev/null || true
      REPORT_OPENED=1
    fi
  fi
  sleep "$POLL_INTERVAL"
done
wait "$SUITE_PID"
SUITE_EXIT=$?

link_new_run_dirs
echo "[live-report] suite finished (exit=${SUITE_EXIT}) — final report regeneration"
node "$ROOT/scripts/e2e/generate-report.mjs" \
  --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
  --flows-config "$ROOT/e2e/maestro/budget/config.yaml" \
  ${PROGRESS_ARGS[@]+"${PROGRESS_ARGS[@]}"} ${REPORT_META_ARGS[@]+"${REPORT_META_ARGS[@]}"}

echo "[live-report] done. Report: ${REPORT_OUT}/index.html"
exit "$SUITE_EXIT"
