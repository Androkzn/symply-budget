#!/usr/bin/env bash
# Run the House Maestro suite on its dedicated simulator (House-A, per
# maestro-fleet-brand.sh), on House's own Metro port, regenerating the visual +
# backend HTML report every POLL_INTERVAL seconds while it runs — so progress is
# visible near-real-time instead of only after the whole suite finishes.
#
# House was the one fleet brand without this wrapper: Budget and Health had
# `run-<brand>-suite-live-report.sh`, House only had the bare runner.
#
# WHY THIS IS NOT A COPY OF THE HEALTH WRAPPER. Health's suite is one batched
# `maestro test`, so it produces ONE ~/.maestro/tests/<timestamp> dir and the
# report can just watch it. House defaults to SEQUENTIAL mode
# (`run-house-suite-sequential.sh`, which exists because batching 80+ flows kills
# the iOS driver) and that invokes `maestro test` once PER FLOW — so every flow
# gets its own run dir. Watching the first one, as Health's wrapper does, would
# report flow #1 and silently ignore the other ~80.
#
# So this builds an AGGREGATOR dir of symlinks named `<timestamp>__<flow>` —
# the layout generate-report.mjs already understands (`findFlowDirs`) — and
# re-links new runs on every poll. The aggregator lives under /tmp on purpose:
# these symlinks carry absolute, clone-bound targets and must never be committed.
#
# Usage:
#   ./scripts/e2e/run-house-suite-live-report.sh                      # whole suite
#   ./scripts/e2e/run-house-suite-live-report.sh e2e/maestro/tasks    # one dir/flow
#
# Requires: e2e/credentials.local (E2E_EMAIL / E2E_PASSWORD) for logged-in flows,
# and com.symply.house installed on House-A.
#
# NOTE ON THE SIM DISK GUARD: a fresh House Debug install is ~970 MB, already over
# sim-disk-guard's 800 MB default cap, so the guard would erase the device on
# every run and the suite would then abort with "com.symply.house is not
# installed". Default the cap high enough that a normal run does not trip it;
# override with E2E_SIM_MAX_MB.
#
# Report: /tmp/e2e-report/house-live/index.html (refresh in your browser any time)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Port and device both come from the fleet registry rather than being hardcoded —
# a name pinned in a runner is how the registry silently goes stale.
# shellcheck source=scripts/e2e/maestro-fleet-brand.sh
source "$(dirname "$0")/maestro-fleet-brand.sh"
HOUSE_PORT="${HOUSE_METRO_PORT:-$(maestro_fleet_brand_field house metro_port)}"
HOUSE_DEVICE="${E2E_DEVICE:-$(maestro_fleet_brand_field house device)}"

export E2E_SIM_MAX_MB="${E2E_SIM_MAX_MB:-5000}"

# Fail fast before Metro and the simulator are started, rather than 50 flows in.
# shellcheck source=scripts/e2e/disk-floor-guard.sh
source "$(dirname "$0")/disk-floor-guard.sh"
disk_floor_preflight || exit 1

METRO_LOG="/tmp/metro-house.log"
# Slug, not a hardcoded path: the registry hands out House-C precisely so a
# House suite can run while A/B are committed to a long one — and until this was
# a variable, the second run wiped the first's aggregator (see the `rm -rf`
# below) and overwrote its report. Default is unchanged, so every existing
# invocation and every open browser tab keeps working.
REPORT_SLUG="${E2E_REPORT_SLUG:-house-live}"
REPORT_OUT="/tmp/e2e-report/${REPORT_SLUG}"
AGG_DIR="/tmp/e2e-report/${REPORT_SLUG}-runs"
POLL_INTERVAL="${POLL_INTERVAL:-30}"
MAESTRO_TESTS="${HOME}/.maestro/tests"

mkdir -p "$REPORT_OUT" "$AGG_DIR"
# Start from a clean aggregator so a previous run's flows are not reported as
# part of this one.
find "$AGG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true

# The set of flow names this brand owns, from the House flow dirs on disk.
#
# `~/.maestro/tests` is a SHARED namespace: every clone and every brand writes
# run dirs into it, and the fleet is explicitly designed to run different apps
# concurrently. A timestamp window alone therefore captures whatever Budget or
# Health happened to be running at the same moment and reports their flows as
# House's. Filtering on the flow name is what makes the report actually House's.
#
# KEEP IN STEP with `HOUSE_FLOW_DIR_NAMES` in run-house-suite.sh and
# run-house-suite-sequential.sh. This is the third copy of the same list, and
# the copies drift: `house-v2` was in none of them, so the eighteen `lf-*` flows
# were both unscheduled AND — had they been run by path — filtered out of the
# report by `is_house_flow`, which renders as an empty suite rather than an
# error.
# One list, from the registry — see maestro_house_flow_dirs().
HOUSE_FLOW_DIRS=()
while IFS= read -r _house_flow_dir; do
  [[ -n "$_house_flow_dir" ]] && HOUSE_FLOW_DIRS+=("$_house_flow_dir")
done < <(maestro_house_flow_dirs)
house_flow_names() {
  local d
  for d in "${HOUSE_FLOW_DIRS[@]}"; do
    [[ -d "$ROOT/e2e/maestro/$d" ]] || continue
    find "$ROOT/e2e/maestro/$d" -maxdepth 1 -name '*.yaml' ! -name 'config.yaml' \
      -exec basename {} .yaml \;
  done
}
HOUSE_FLOWS=" $(house_flow_names | sort -u | tr '\n' ' ') "

is_house_flow() { [[ "$HOUSE_FLOWS" == *" $1 "* ]]; }

# Link every ~/.maestro/tests run created since we started that belongs to a
# House flow. Named `<runTimestamp>__<flow>` so generate-report.mjs sorts them
# chronologically and labels each row with the flow it came from.
relink_runs() {
  local run flow target name
  for run in "$MAESTRO_TESTS"/*; do
    [[ -d "$run" ]] || continue
    [[ "$(basename "$run")" > "$START_STAMP" ]] || continue
    # A run dir holds one flow subdir (sequential mode) or many (batch mode).
    if [[ -f "$run/commands.json" ]]; then
      name="$(basename "$run")"
      is_house_flow "$name" || continue
      target="$AGG_DIR/$name"
      [[ -e "$target" ]] || ln -s "$run" "$target" 2>/dev/null || true
      continue
    fi
    for flow in "$run"/*; do
      [[ -d "$flow" && -f "$flow/commands.json" ]] || continue
      name="$(basename "$flow")"
      is_house_flow "$name" || continue
      target="$AGG_DIR/$(basename "$run")__${name}"
      [[ -e "$target" ]] || ln -s "$flow" "$target" 2>/dev/null || true
    done
  done
}

regenerate() {
  relink_runs
  # No flows linked yet → nothing to render; the generator exits 1 on an empty
  # dir, which must not look like a suite failure.
  if [[ -z "$(ls -A "$AGG_DIR" 2>/dev/null)" ]]; then
    return 0
  fi
  node "$ROOT/scripts/e2e/generate-report.mjs" \
    --maestro-dir "$AGG_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
    --flows-config "$ROOT/e2e/maestro/house/config.yaml" \
    --platform iOS --environment staging --device "$HOUSE_DEVICE" \
    "$@"
}

echo "[live-report] device=${HOUSE_DEVICE} metro=:${HOUSE_PORT} sim-cap=${E2E_SIM_MAX_MB}MB"
echo "[live-report] report=${REPORT_OUT}/index.html"

echo "[live-report] starting Metro (logged, cache cleared) on :${HOUSE_PORT}"
( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh house --port "${HOUSE_PORT}" ) &
METRO_PID=$!

echo "[live-report] waiting for Metro..."
for _ in $(seq 1 120); do
  curl -sf "http://localhost:${HOUSE_PORT}/status" >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf "http://localhost:${HOUSE_PORT}/status" >/dev/null 2>&1; then
  echo "[live-report] Metro did not come up in time" >&2
  kill "$METRO_PID" 2>/dev/null || true
  exit 1
fi
echo "[live-report] Metro ready"

# Everything strictly newer than this belongs to this run.
#
# LOCAL time, not UTC: Maestro names its run dirs `%Y-%m-%d_%H%M%S` in local
# time (`run-house-suite.sh` pre-creates one the same way). Computing this
# marker with `date -u` on a machine west of UTC makes every real run dir sort
# BELOW it, so the `>` test never fires, nothing is ever linked, and the report
# renders empty while the suite runs happily — a silent no-op, not an error.
START_STAMP="$(date +%Y-%m-%d_%H%M%S)"

echo "[live-report] launching House suite (E2E_PARALLEL_FLEET=1 — dedicated ${HOUSE_DEVICE}, no global-lock wait)"
# E2E_DEVICE is passed EXPLICITLY, not left to be re-resolved.
#
# `$HOUSE_DEVICE` is what this wrapper prints and what it stamps on the report
# header via `generate-report.mjs --device`. That flag is a LABEL — it selects
# nothing. The suite underneath resolves its own device (`E2E_DEVICE:-House-A`),
# so whenever HOUSE_DEVICE came from the fleet registry rather than an inherited
# E2E_DEVICE, the two could disagree and the report would confidently name a
# device the run never touched. Binding them here makes the label and the target
# the same value by construction.
( cd "$ROOT" && E2E_PARALLEL_FLEET=1 E2E_DEVICE="${HOUSE_DEVICE}" HOUSE_METRO_PORT="${HOUSE_PORT}" ./scripts/e2e/run-house-suite.sh "$@" ) &
SUITE_PID=$!

echo "[live-report] report updates every ${POLL_INTERVAL}s while the suite runs"
while kill -0 "$SUITE_PID" 2>/dev/null; do
  regenerate >"/tmp/e2e-report-${REPORT_SLUG}-gen.log" 2>&1
  sleep "$POLL_INTERVAL"
done
wait "$SUITE_PID"
SUITE_EXIT=$?

echo "[live-report] suite finished (exit=${SUITE_EXIT}) — final report regeneration"
regenerate

LINKED="$(ls -1 "$AGG_DIR" 2>/dev/null | wc -l | tr -d ' ')"
echo "[live-report] done. ${LINKED} flow run(s) reported."
echo "[live-report] report: ${REPORT_OUT}/index.html"

kill "$METRO_PID" 2>/dev/null || true
if [[ "${E2E_OPEN_REPORT:-1}" == "1" ]] && command -v open >/dev/null 2>&1; then
  open "${REPORT_OUT}/index.html" 2>/dev/null || true
fi
exit "$SUITE_EXIT"
