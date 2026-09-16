#!/usr/bin/env bash
#
# Driver for the Budget V2 local-first scale harness.
#
# ONE PROCESS PER PHASE x SCALE. Not a nicety: the scale audit recorded an OOM
# at a 4 GB heap for the 4-member case, and the existing hot-path bench had to
# learn the same lesson. When a child dies without writing its terminal `end`
# record, THIS script appends a status:"crashed" row on its behalf — which is
# what makes "it OOMs at 10 years" a reportable result instead of a lost
# afternoon.
#
#   budget-scale-bench.sh run       [--scales 1,3,5,10] [--adults 2]
#                                   [--phases edit,apply,coldopen,batchcap]
#                                   [--seed N] [--heap 8192] [--out FILE] [--allow-load]
#   budget-scale-bench.sh baseline  [--scales …] [--heap …] [--allow-load]
#   budget-scale-bench.sh compare   <run.jsonl> [--against FILE]
#                                   [--time-tolerance 0.10] [--bytes-tolerance 0.01]
#   budget-scale-bench.sh guard     # the cheap *.test.ts under the package's own vitest
#   budget-scale-bench.sh typecheck # package tsc; fails only on __tests__/scale/ errors
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/local-first"
SCALE_DIR="$PKG_DIR/__tests__/scale"
CONFIG="$SCALE_DIR/vitest.scale.config.ts"
REPORT="$SCRIPT_DIR/budget-scale-report.mjs"
DOC_DIR="$REPO_ROOT/documents/engineering/testing"
BASELINE_MD="$DOC_DIR/budget-local-first-scale-baseline.md"
BASELINE_JSON="$DOC_DIR/budget-local-first-scale-baseline.json"

# Pre-existing `tsc --noEmit` errors in this package on a clean tree. NONE are
# in the harness; every one comes from an app-tree module the harness imports,
# whose aliases (@api/*, @services/storage, @features/mortgage/*) do not resolve
# outside the mobile tsconfig — plus 2 in src/sync/peer-session.ts.
#
#   18 Budget (src/features/budget/local/**)   — projection.ts's type import of engine.ts
#   18 House  (src/features/house/local/**)    — added by the H10 phases, same cause
#    2 src/sync/peer-session.ts
#
# Asserted so drift is visible without anyone being tempted to "fix" errors that
# are not fixable from here. `cmd_typecheck` fails only on __tests__/scale/ ones.
EXPECTED_PREEXISTING_TSC_ERRORS=38

SCALES="1,3,5,10"
ADULTS=2
PHASES="edit,apply,coldopen,batchcap"
SEED=""
HEAP=8192
OUT=""
ALLOW_LOAD=0
AGAINST="$BASELINE_JSON"
TIME_TOL="0.10"
BYTES_TOL="0.01"

die() { printf 'error: %s\n' "$*" >&2; exit 2; }

parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --scales) SCALES="$2"; shift 2 ;;
      --adults) ADULTS="$2"; shift 2 ;;
      --phases) PHASES="$2"; shift 2 ;;
      --seed) SEED="$2"; shift 2 ;;
      --heap) HEAP="$2"; shift 2 ;;
      --out) OUT="$2"; shift 2 ;;
      --against) AGAINST="$2"; shift 2 ;;
      --time-tolerance) TIME_TOL="$2"; shift 2 ;;
      --bytes-tolerance) BYTES_TOL="$2"; shift 2 ;;
      --allow-load) ALLOW_LOAD=1; shift ;;
      *) die "unknown flag $1" ;;
    esac
  done
}

# ---------------------------------------------------------------------------

cmd_run() {
  parse_flags "$@"

  local run_id out_file
  run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  out_file="${OUT:-/tmp/symply-scale/$run_id.jsonl}"
  mkdir -p "$(dirname "$out_file")"
  : > "$out_file"

  printf 'run %s\n  scales   %s (adults %s)\n  phases   %s\n  heap     %s MB\n  out      %s\n\n' \
    "$run_id" "$SCALES" "$ADULTS" "$PHASES" "$HEAP" "$out_file"

  local phase years
  for phase in ${PHASES//,/ }; do
    for years in ${SCALES//,/ }; do
      printf -- '--- %s @ %sy/%sa ' "$phase" "$years" "$ADULTS"

      local before after
      before="$(wc -l < "$out_file" | tr -d ' ')"

      local status
      set +e
      (
        cd "$PKG_DIR"
        export SCALE_YEARS="$years"
        export SCALE_ADULTS="$ADULTS"
        export SCALE_OUT="$out_file"
        export SCALE_RUN_ID="$run_id"
        export NODE_OPTIONS="--max-old-space-size=$HEAP"
        [ -n "$SEED" ] && export SCALE_SEED="$SEED"
        [ "$ALLOW_LOAD" -eq 1 ] && export SCALE_ALLOW_LOAD=1
        npx vitest run --config "$CONFIG" "phases/$phase.scale.ts"
      ) > "/tmp/symply-scale-$run_id-$phase-$years.log" 2>&1
      status=$?
      set -e

      after="$(wc -l < "$out_file" | tr -d ' ')"

      # A phase is complete only if it wrote its terminal `end` record. Anything
      # else — non-zero exit, OOM, a killed child — is recorded as a crash so
      # the column reads as a GAP rather than silently vanishing.
      if [ "$status" -eq 0 ] && tail -n 1 "$out_file" | grep -q '"phase":"end"'; then
        printf 'ok (%s records)\n' "$((after - before))"
      else
        printf 'CRASHED (exit %s, %s partial records) — see /tmp/symply-scale-%s-%s-%s.log\n' \
          "$status" "$((after - before))" "$run_id" "$phase" "$years"
        node -e '
          const [out, runId, phase, years, adults, status] = process.argv.slice(1);
          require("fs").appendFileSync(out, JSON.stringify({
            schema: 1, runId, ts: new Date().toISOString(), phase: "end",
            metric: phase, scale: { years: Number(years), adults: Number(adults), rows: 0, ops: 0 },
            unit: "count", n: 1, min: 0, p50: 0, p95: 0, mean: 0,
            notes: `child exited ${status} without an end record`,
            env: { node: process.version, v8: process.versions.v8, arch: process.arch,
                   platform: process.platform, cpu: "unknown", cores: 0, loadavg1: 0,
                   heapLimitMb: 0, gcAvailable: false },
            status: "crashed",
          }) + "\n");
        ' "$out_file" "$run_id" "$phase" "$years" "$ADULTS" "$status"
      fi
    done
  done

  printf '\nrecords: %s\n%s\n' "$(wc -l < "$out_file" | tr -d ' ')" "$out_file"
  printf '%s\n' "$out_file" > /tmp/symply-scale-last-run
}

cmd_baseline() {
  parse_flags "$@"
  local args=(--scales "$SCALES" --adults "$ADULTS" --heap "$HEAP")
  [ -n "$SEED" ] && args+=(--seed "$SEED")
  [ "$ALLOW_LOAD" -eq 1 ] && args+=(--allow-load)
  cmd_run "${args[@]}"

  local out_file
  out_file="$(cat /tmp/symply-scale-last-run)"
  mkdir -p "$DOC_DIR"
  node "$REPORT" "$out_file" --markdown "$BASELINE_MD" --emit-baseline "$BASELINE_JSON"
}

cmd_compare() {
  [ $# -ge 1 ] || die 'compare needs a run.jsonl'
  local run_file="$1"; shift
  parse_flags "$@"
  node "$REPORT" "$run_file" --compare "$AGAINST" \
    --time-tolerance "$TIME_TOL" --bytes-tolerance "$BYTES_TOL"
}

cmd_guard() {
  # The scale phases are named *.scale.ts, which the package's default vitest
  # include never matches, so this really does run only the cheap guards.
  (cd "$PKG_DIR" && npx vitest run __tests__/scale)
}

cmd_typecheck() {
  local log
  log="$(mktemp)"
  (cd "$PKG_DIR" && npx tsc --noEmit -p tsconfig.json) > "$log" 2>&1 || true

  local mine total
  mine="$(grep -c '__tests__/scale/' "$log" || true)"
  total="$(grep -c 'error TS' "$log" || true)"

  printf 'tsc errors: %s total, %s referencing __tests__/scale/\n' "$total" "$mine"

  if [ "$mine" -ne 0 ]; then
    grep '__tests__/scale/' "$log" >&2
    rm -f "$log"
    die "$mine typecheck error(s) in the scale harness"
  fi
  if [ "$total" -ne "$EXPECTED_PREEXISTING_TSC_ERRORS" ]; then
    printf 'note: pre-existing package error count moved (%s -> %s). Not a harness failure, but the pin in this script is stale.\n' \
      "$EXPECTED_PREEXISTING_TSC_ERRORS" "$total" >&2
  fi
  rm -f "$log"
}

# ---------------------------------------------------------------------------

[ $# -ge 1 ] || die 'usage: budget-scale-bench.sh run|baseline|compare|guard|typecheck [flags]'
SUB="$1"; shift
case "$SUB" in
  run) cmd_run "$@" ;;
  baseline) cmd_baseline "$@" ;;
  compare) cmd_compare "$@" ;;
  guard) cmd_guard "$@" ;;
  typecheck) cmd_typecheck "$@" ;;
  *) die "unknown subcommand $SUB" ;;
esac
