#!/usr/bin/env bash
#
# Driver for the Symply House V2 local-first scale harness (plan stage H10).
#
# Same shape and the same guarantees as budget-scale-bench.sh — one process per
# phase × scale, a status:"crashed" row written on a dead child's behalf, a load
# gate, and a `compare` whose exit code is the point. The differences are the
# phase files it runs (`phases/house-*.scale.ts`) and the baseline it publishes.
#
# NOTE ON COMPARABILITY: House's cold-open phase measures the per-row AEAD path,
# not Budget's legacy snapshot path, and the corpora are different by
# construction. House numbers are never comparable with Budget's — only with an
# earlier House run carrying the same corpus fingerprint, which is exactly what
# `compare` enforces.
#
#   house-scale-bench.sh run       [--scales 1,3,5,10] [--adults 2]
#                                  [--phases edit,apply,coldopen,batchcap]
#                                  [--seed N] [--heap 8192] [--out FILE] [--allow-load]
#   house-scale-bench.sh baseline  [--scales …] [--heap …] [--allow-load]
#   house-scale-bench.sh compare   <run.jsonl> [--against FILE]
#                                  [--time-tolerance 0.10] [--bytes-tolerance 0.01]
#   house-scale-bench.sh guard     # the cheap *.test.ts under the package's own vitest
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/local-first"
SCALE_DIR="$PKG_DIR/__tests__/scale"
CONFIG="$SCALE_DIR/vitest.scale.config.ts"
REPORT="$SCRIPT_DIR/budget-scale-report.mjs"
DOC_DIR="$REPO_ROOT/documents/engineering/testing"
BASELINE_MD="$DOC_DIR/house-local-first-scale-baseline.md"
BASELINE_JSON="$DOC_DIR/house-local-first-scale-baseline.json"
LABEL="Symply House V2 local-first"
DRIVER="house-scale-bench.sh"

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
  run_id="house-$(date -u +%Y%m%dT%H%M%SZ)-$$"
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
        npx vitest run --config "$CONFIG" "phases/house-$phase.scale.ts"
      ) > "/tmp/symply-scale-$run_id-$phase-$years.log" 2>&1
      status=$?
      set -e

      after="$(wc -l < "$out_file" | tr -d ' ')"

      # A phase is complete only if it wrote its terminal `end` record. Anything
      # else — non-zero exit, OOM, a killed child — is recorded as a crash so the
      # column reads as a GAP rather than silently vanishing.
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
  printf '%s\n' "$out_file" > /tmp/symply-house-scale-last-run
}

cmd_baseline() {
  parse_flags "$@"
  local args=(--scales "$SCALES" --adults "$ADULTS" --heap "$HEAP")
  [ -n "$SEED" ] && args+=(--seed "$SEED")
  [ "$ALLOW_LOAD" -eq 1 ] && args+=(--allow-load)
  cmd_run "${args[@]}"

  local out_file
  out_file="$(cat /tmp/symply-house-scale-last-run)"
  mkdir -p "$DOC_DIR"
  node "$REPORT" "$out_file" --markdown "$BASELINE_MD" --emit-baseline "$BASELINE_JSON" \
    --label "$LABEL" --driver "$DRIVER"
}

cmd_compare() {
  [ $# -ge 1 ] || die 'compare needs a run.jsonl'
  local run_file="$1"; shift
  parse_flags "$@"
  node "$REPORT" "$run_file" --compare "$AGAINST" \
    --time-tolerance "$TIME_TOL" --bytes-tolerance "$BYTES_TOL" \
    --label "$LABEL" --driver "$DRIVER"
}

cmd_guard() {
  # The scale phases are named *.scale.ts, which the package's default vitest
  # include never matches, so this really does run only the cheap guards.
  (cd "$PKG_DIR" && npx vitest run __tests__/scale)
}

# ---------------------------------------------------------------------------

[ $# -ge 1 ] || die 'usage: house-scale-bench.sh run|baseline|compare|guard [flags]'
SUB="$1"; shift
case "$SUB" in
  run) cmd_run "$@" ;;
  baseline) cmd_baseline "$@" ;;
  compare) cmd_compare "$@" ;;
  guard) cmd_guard "$@" ;;
  *) die "unknown subcommand $SUB" ;;
esac
