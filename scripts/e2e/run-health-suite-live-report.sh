#!/usr/bin/env bash
# Run the Health Maestro suite on its dedicated simulator, parallel-safe with
# any other fleet brand's suite already running, regenerating the visual +
# backend HTML report every POLL_INTERVAL seconds while it runs — so progress
# is visible near-real-time instead of only after the whole suite finishes.
#
# Usage:
#   ./scripts/e2e/run-health-suite-live-report.sh                    # whole suite
#   ./scripts/e2e/run-health-suite-live-report.sh e2e/maestro/health/weight-tab-log-and-edit.yaml
#
# Report: /tmp/e2e-report/health-live/index.html (refresh in your browser any time)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

METRO_LOG="/tmp/metro-health.log"
REPORT_OUT="/tmp/e2e-report/health-live"
POLL_INTERVAL="${POLL_INTERVAL:-30}"

# Same report header as every other app — see scripts/e2e/report-meta.sh, which
# owns platform/env/build-number/app-name/logo so the four runners cannot drift
# into different headers again (Health's had none at all).
REPORT_PLATFORM="${E2E_REPORT_PLATFORM:-iOS}"
# Resolved from the fleet registry, never hardcoded — this suite runs on the
# dedicated Health simulator (see maestro-fleet-brand.sh).
REPORT_DEVICE="${E2E_DEVICE:-${E2E_DEVICE_A:-Health-A}}"
# shellcheck source=scripts/e2e/report-meta.sh
source "$(dirname "$0")/report-meta.sh"
report_meta_args symply-health

mkdir -p "$REPORT_OUT"

echo "[live-report] starting Metro (logged, cache cleared) on :8085"
( cd "$ROOT" && METRO_LOG="$METRO_LOG" ./scripts/e2e/start-metro-logged.sh health --port 8085 ) &

echo "[live-report] waiting for Metro..."
for _ in $(seq 1 60); do
  curl -sf http://localhost:8085/status >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -sf http://localhost:8085/status >/dev/null 2>&1; then
  echo "[live-report] Metro did not come up in time" >&2
  exit 1
fi
echo "[live-report] Metro ready"

BEFORE_RUNS="$(ls -1 "$HOME/.maestro/tests" 2>/dev/null || true)"

echo "[live-report] launching Health suite (E2E_PARALLEL_FLEET=1 — dedicated Health-A sim, port 8085, no lock wait, other fleet sims untouched)"
( cd "$ROOT" && E2E_PARALLEL_FLEET=1 ./scripts/e2e/run-health-suite.sh "$@" ) &
SUITE_PID=$!

RUN_DIR=""
for _ in $(seq 1 30); do
  NEW="$(comm -13 <(printf '%s\n' "$BEFORE_RUNS" | sort) <(ls -1 "$HOME/.maestro/tests" 2>/dev/null | sort) | tail -1)"
  if [[ -n "$NEW" ]]; then
    RUN_DIR="$HOME/.maestro/tests/$NEW"
    break
  fi
  sleep 2
done

if [[ -z "$RUN_DIR" ]]; then
  echo "[live-report] could not detect the Maestro run directory in time — will generate once at the end instead of live"
  wait "$SUITE_PID"
  SUITE_EXIT=$?
  LATEST="$(ls -t "$HOME/.maestro/tests" 2>/dev/null | head -1)"
  RUN_DIR="$HOME/.maestro/tests/$LATEST"
else
  echo "[live-report] watching ${RUN_DIR}"
  echo "[live-report] report: ${REPORT_OUT}/index.html (updates every ${POLL_INTERVAL}s)"
  while kill -0 "$SUITE_PID" 2>/dev/null; do
    node "$ROOT/scripts/e2e/generate-report.mjs" \
      --maestro-dir "$RUN_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
      --flows-config "$ROOT/e2e/maestro/health/config.yaml" \
      "${REPORT_META_ARGS[@]}" \
      >/tmp/e2e-report-health-live-gen.log 2>&1
    sleep "$POLL_INTERVAL"
  done
  wait "$SUITE_PID"
  SUITE_EXIT=$?
fi

echo "[live-report] suite finished (exit=${SUITE_EXIT}) — final report regeneration"
node "$ROOT/scripts/e2e/generate-report.mjs" \
  --maestro-dir "$RUN_DIR" --metro-log "$METRO_LOG" --out "$REPORT_OUT" \
  --flows-config "$ROOT/e2e/maestro/health/config.yaml" \
  "${REPORT_META_ARGS[@]}"

echo "[live-report] done. Report: ${REPORT_OUT}/index.html"
exit "$SUITE_EXIT"
