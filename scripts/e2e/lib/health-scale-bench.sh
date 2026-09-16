#!/usr/bin/env bash
#
# Driver for the Symply Health V2 local-first scale harness (plan stage He10).
#
# Same shape and the same guarantees as budget-scale-bench.sh and
# house-scale-bench.sh — one process per phase × scale, a status:"crashed" row
# written on a dead child's behalf, a load gate, and a `compare` whose exit code
# is the point. Two differences:
#
#   1. FOUR phases, not four-of-the-same: `homehydrate` is Health's own (plan
#      §4 — "measure the read path, not just the write path"), and `coldopen`
#      carries the disk-size row as well as first paint.
#   2. `baseline` writes TWO artefacts: the He10 markdown (its own renderer,
#      because the Exit table is an absolute gate the shared regression report
#      cannot express) and the machine-readable baseline JSON via the shared
#      script, so `compare` works exactly as it does for the other two brands.
#
# `--adults` is deliberately absent: a Health household has exactly one user
# (plan §1.2) and the generator pins it. The multi-device property lives in the
# op factory, not in a member count.
#
#   health-scale-bench.sh run       [--scales 1,3,5,10]
#                                   [--phases coldopen,homehydrate,edit,apply]
#                                   [--seed N] [--heap 8192] [--out FILE] [--allow-load]
#   health-scale-bench.sh baseline  [--scales …] [--heap …] [--allow-load]
#   health-scale-bench.sh compare   <run.jsonl> [--against FILE]
#                                   [--time-tolerance 0.10] [--bytes-tolerance 0.01]
#   health-scale-bench.sh guard     # the cheap *.test.ts under the package's own vitest
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/local-first"
SCALE_DIR="$PKG_DIR/__tests__/scale"
CONFIG="$SCALE_DIR/vitest.scale.config.ts"
SHARED_REPORT="$SCRIPT_DIR/budget-scale-report.mjs"
HEALTH_REPORT="$SCRIPT_DIR/health-scale-report.mjs"
DOC_DIR="$REPO_ROOT/documents/engineering/testing"
BASELINE_MD="$DOC_DIR/health-local-first-scale-baseline.md"
BASELINE_JSON="$DOC_DIR/health-local-first-scale-baseline.json"
LABEL="Symply Health V2 local-first"
DRIVER="health-scale-bench.sh"

SCALES="1,5,10"
ADULTS=1
PHASES="coldopen,homehydrate,edit,apply"

# Settle-before-measure (see the loop in cmd_run). Target is under the harness's
# own 3.00 refusal with margin, so a phase does not start while the previous
# phase's processes are still winding down.
SETTLE_TARGET="${SCALE_SETTLE_TARGET:-2.4}"
SETTLE_INTERVAL="${SCALE_SETTLE_INTERVAL:-20}"
SETTLE_MAX_CHECKS="${SCALE_SETTLE_MAX_CHECKS:-30}"
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
  run_id="health-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  out_file="${OUT:-/tmp/symply-scale/$run_id.jsonl}"
  mkdir -p "$(dirname "$out_file")"
  : > "$out_file"

  printf 'run %s\n  scales   %s (one user, two devices)\n  phases   %s\n  heap     %s MB\n  out      %s\n\n' \
    "$run_id" "$SCALES" "$PHASES" "$HEAP" "$out_file"

  local phase years
  for phase in ${PHASES//,/ }; do
    for years in ${SCALES//,/ }; do
      printf -- '--- %s @ %sy ' "$phase" "$years"

      # SETTLE BEFORE MEASURING — the bench trips its own load gate otherwise.
      #
      # Paid for once: a baseline taken on a genuinely quiet machine (loadavg
      # 1.93 at start) still lost `apply` at ALL THREE scales, because the
      # coldopen/homehydrate/edit phases that ran first had driven loadavg to
      # 3.10 by the time `apply` started — just over the harness's own 3.00
      # refusal. The report honestly rendered the metric as NOT MEASURED, so
      # nothing was falsified; but a gated Exit metric silently went missing
      # from a run that otherwise looked complete.
      #
      # Waiting is strictly better than raising the gate: the gate is what makes
      # every recorded number trustworthy. Bounded so a permanently busy machine
      # still finishes and reports the refusal rather than hanging.
      if [ "$ALLOW_LOAD" -eq 0 ]; then
        local settle=0
        while [ "$settle" -lt "$SETTLE_MAX_CHECKS" ]; do
          local load
          load="$(uptime | sed 's/.*load averages*: *//' | awk '{print $1}' | tr -d ',')"
          if awk -v l="$load" -v m="$SETTLE_TARGET" 'BEGIN{exit !(l < m)}'; then break; fi
          [ "$settle" -eq 0 ] && printf '(settling from %s) ' "$load"
          sleep "$SETTLE_INTERVAL"
          settle=$((settle + 1))
        done
      fi

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
        npx vitest run --config "$CONFIG" "phases/health-$phase.scale.ts"
      ) > "/tmp/symply-scale-$run_id-$phase-$years.log" 2>&1
      status=$?
      set -e

      after="$(wc -l < "$out_file" | tr -d ' ')"

      # A phase is complete only if it wrote its terminal `end` record. The
      # Exit assertions fire AFTER `recorder.end()` on purpose, so a THRESHOLD
      # BREACH is a non-zero exit with a complete record set — reported as a red
      # baseline, not as a crash. Anything else — OOM, a killed child — is a gap.
      if tail -n 1 "$out_file" | grep -q '"phase":"end"'; then
        if [ "$status" -eq 0 ]; then
          printf 'ok (%s records)\n' "$((after - before))"
        else
          printf 'THRESHOLD BREACHED (exit %s, %s records) — see /tmp/symply-scale-%s-%s-%s.log\n' \
            "$status" "$((after - before))" "$run_id" "$phase" "$years"
        fi
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
  printf '%s\n' "$out_file" > /tmp/symply-health-scale-last-run
}

cmd_baseline() {
  parse_flags "$@"
  local args=(--scales "$SCALES" --heap "$HEAP" --phases "$PHASES")
  [ -n "$SEED" ] && args+=(--seed "$SEED")
  [ "$ALLOW_LOAD" -eq 1 ] && args+=(--allow-load)
  cmd_run "${args[@]}"

  local out_file
  out_file="$(cat /tmp/symply-health-scale-last-run)"

  # REFUSE TO PUBLISH A RUN THAT MEASURED NOTHING.
  #
  # Paid for once: a `baseline` invoked on a busy machine has every phase
  # refused by the load gate (which is the gate working correctly), records
  # zero measurements — and then still overwrote a good baseline with a stub
  # full of `undefined`, before the shared renderer crashed on
  # `measurements[0].env`. The previous baseline is untracked, so there was
  # nothing to `git checkout`.
  #
  # A failed run must leave the last good baseline exactly where it was. Note
  # the corpus-scale rows are written even when phases fail, so "the file is
  # non-empty" is NOT the test — count records whose `status` is `ok`.
  local usable
  usable="$(grep -c '"status":"ok"' "$out_file" 2>/dev/null || true)"
  usable="${usable:-0}"
  if [ "$usable" -eq 0 ]; then
    printf '\nREFUSING to overwrite the baseline: 0 usable records in %s\n' "$out_file" >&2
    printf 'Every phase failed or was refused (load gate?). %s is unchanged.\n' "$BASELINE_MD" >&2
    printf 'Quiesce the machine and re-run, or pass --allow-load to record anyway.\n' >&2
    return 1
  fi

  mkdir -p "$DOC_DIR"
  node "$HEALTH_REPORT" "$out_file" --markdown "$BASELINE_MD"
  # The regression artefact, from the shared renderer, so `compare` behaves
  # identically across the three brands. `--allow-unclean-baseline` is passed
  # only when the load gate was overridden, and it stamps `gate.usable: false`.
  local emit=(--emit-baseline "$BASELINE_JSON" --label "$LABEL" --driver "$DRIVER")
  [ "$ALLOW_LOAD" -eq 1 ] && emit+=(--allow-unclean-baseline)
  node "$SHARED_REPORT" "$out_file" "${emit[@]}"
}

cmd_compare() {
  [ $# -ge 1 ] || die 'compare needs a run.jsonl'
  local run_file="$1"; shift
  parse_flags "$@"
  node "$SHARED_REPORT" "$run_file" --compare "$AGAINST" \
    --time-tolerance "$TIME_TOL" --bytes-tolerance "$BYTES_TOL" \
    --label "$LABEL" --driver "$DRIVER"
}

cmd_guard() {
  # The scale phases are named *.scale.ts, which the package's default vitest
  # include never matches, so this really does run only the cheap guards.
  (cd "$PKG_DIR" && npx vitest run __tests__/scale)
}

# ---------------------------------------------------------------------------

[ $# -ge 1 ] || die 'usage: health-scale-bench.sh run|baseline|compare|guard [flags]'
SUB="$1"; shift
case "$SUB" in
  run) cmd_run "$@" ;;
  baseline) cmd_baseline "$@" ;;
  compare) cmd_compare "$@" ;;
  guard) cmd_guard "$@" ;;
  *) die "unknown subcommand $SUB" ;;
esac
