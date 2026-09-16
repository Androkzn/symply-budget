/**
 * The He10 Exit gate — the plan's normative fail table, expressed as code that
 * FAILS rather than as prose that gets quoted.
 *
 * Plan §4 (stage He10):
 *
 *   | Metric                          | Fail above          |
 *   |---------------------------------|---------------------|
 *   | Cold open → first Home paint    | 3.0 s p50 / 5.0 s p95 |
 *   | Single meal `mutate`            | 250 ms p95          |
 *   | `applyLedgerDelta`, one deposit | 500 ms p95          |
 *   | 17-loader `health-homehydrate`  | 1.5 s p95           |
 *   | Ledger + LWW on disk            | 250 MB              |
 *
 * "Any one breached after N5-style mitigations descopes Wave C — do not
 * silently ship." A number printed in a table is silent; a failing test is not.
 * Hence `assertExitChecks`.
 *
 * WHICH NUMBER IS GATED, AND WHY IT IS NOT THE NODE NUMBER
 * --------------------------------------------------------
 * The plan gates "on the Hermes-ESTIMATED 10-year corpus". Everything this
 * harness can measure is V8, and the audit's Hermes penalty is a BAND (3-15x),
 * not a constant — so there are three defensible readings and only one of them
 * is honest about both directions of error:
 *
 *   - gate the raw Node number   → far too lenient; a device is never as fast
 *   - gate node x 15 (worst)     → far too harsh; descopes Wave C on the worst
 *                                  case of a band whose upper end applies to
 *                                  string building and pure-JS crypto, not to
 *                                  every operation
 *   - gate node x 3  (best case) → a breach here is UNAMBIGUOUS: it fails even
 *                                  if Hermes turns out to be at its friendliest
 *
 * The gate therefore runs at the OPTIMISTIC end of the band, and every report
 * carries the pessimistic end beside it. A PASS at 3x is explicitly NOT a pass
 * at 15x, and the baseline document says so in those words. Override with
 * `SCALE_HERMES_MULTIPLIER` when an on-device anchor eventually replaces the
 * band with a measurement — which is the one thing this stage still owes.
 */
import { expect } from 'vitest';

import type { Recorder } from './record';

/** The audit's Hermes penalty band. Not a measurement — see the header. */
export const HERMES_BAND = { optimistic: 3, pessimistic: 15 } as const;

export function hermesGateMultiplier(): number {
  const raw = process.env.SCALE_HERMES_MULTIPLIER;
  if (!raw) return HERMES_BAND.optimistic;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`SCALE_HERMES_MULTIPLIER: not a positive number (${raw})`);
  }
  return value;
}

/**
 * The corpus the gate is normative on. Smaller scales are measured and
 * reported, but a 1-year corpus passing says nothing about the Exit criteria.
 */
export const EXIT_GATE_YEARS = 10;

export const MIB = 1024 * 1024;

export const HEALTH_EXIT_THRESHOLDS = {
  coldOpenToFirstPaintP50Ms: 3000,
  coldOpenToFirstPaintP95Ms: 5000,
  mealMutateP95Ms: 250,
  applyDepositP95Ms: 500,
  homeHydrateP95Ms: 1500,
  /** "250 MB" — decimal MB as the plan writes it, not MiB. */
  ledgerAndLwwOnDiskBytes: 250_000_000,
} as const;

export type ExitCheck = {
  /** Stable id — also the `exit.<id>` metric prefix. */
  id: string;
  /** The plan's own wording for this row of the table. */
  label: string;
  unit: 'ms' | 'bytes';
  /** What the harness measured on V8. */
  measured: number;
  /** Node value scaled by the gate multiplier; equals `measured` for bytes. */
  gated: number;
  /** The pessimistic end of the band, for the report only. */
  worstCase: number;
  threshold: number;
  pass: boolean;
  notes: string;
};

/** A latency row of the Exit table: the Hermes band applies. */
export function timeCheck(input: {
  id: string;
  label: string;
  measuredMs: number;
  thresholdMs: number;
  notes: string;
}): ExitCheck {
  const multiplier = hermesGateMultiplier();
  const gated = input.measuredMs * multiplier;
  return {
    id: input.id,
    label: input.label,
    unit: 'ms',
    measured: input.measuredMs,
    gated,
    worstCase: input.measuredMs * HERMES_BAND.pessimistic,
    threshold: input.thresholdMs,
    pass: gated <= input.thresholdMs,
    notes: input.notes,
  };
}

/** A size row of the Exit table: bytes on disk are bytes, whatever the engine. */
export function sizeCheck(input: {
  id: string;
  label: string;
  measuredBytes: number;
  thresholdBytes: number;
  notes: string;
}): ExitCheck {
  return {
    id: input.id,
    label: input.label,
    unit: 'bytes',
    measured: input.measuredBytes,
    gated: input.measuredBytes,
    worstCase: input.measuredBytes,
    threshold: input.thresholdBytes,
    pass: input.measuredBytes <= input.thresholdBytes,
    notes: input.notes,
  };
}

/**
 * Put every check on the record BEFORE anything can throw.
 *
 * Order matters: the driver treats a phase that never wrote its terminal `end`
 * record as CRASHED, and a crashed column is a gap rather than a red cell. A
 * breached threshold must read as a measured failure, so the sequence is
 * always record → `recorder.end()` → assert.
 */
export function recordExitChecks(recorder: Recorder, checks: readonly ExitCheck[]): void {
  const multiplier = hermesGateMultiplier();
  for (const check of checks) {
    if (check.unit === 'ms') {
      recorder.ratio(`exit.${check.id}.node`, check.measured, 'lower', `${check.label} — V8`);
      recorder.ratio(
        `exit.${check.id}.hermes`,
        check.gated,
        'lower',
        `${check.label} — node x${multiplier} (gate). Threshold ${check.threshold} ms. ${check.notes}`,
      );
      recorder.ratio(
        `exit.${check.id}.hermesWorst`,
        check.worstCase,
        'lower',
        `${check.label} — node x${HERMES_BAND.pessimistic} (worst case, NOT the gate)`,
      );
    } else {
      recorder.size(`exit.${check.id}.bytes`, check.measured, 'bytes', `${check.label}. ${check.notes}`);
    }
    recorder.count(
      `exit.${check.id}.pass`,
      check.pass ? 1 : 0,
      'count',
      'higher',
      `1 = within the He10 Exit threshold (${check.threshold}${check.unit === 'ms' ? ' ms' : ' bytes'})`,
    );
  }
}

const fmt = (check: ExitCheck): string =>
  check.unit === 'ms'
    ? `${check.gated.toFixed(1)} ms (node ${check.measured.toFixed(1)} ms x${hermesGateMultiplier()})`
    : `${(check.measured / MIB).toFixed(1)} MiB`;

/**
 * Fail the phase on a breach. Called AFTER `recorder.end()` so the numbers are
 * on disk either way — a red baseline is a result, not a lost run.
 */
export function assertExitChecks(years: number, checks: readonly ExitCheck[]): void {
  if (years < EXIT_GATE_YEARS) return;
  const breached = checks.filter((c) => !c.pass);
  const report = breached
    .map(
      (c) =>
        `  - ${c.label}: ${fmt(c)} > threshold ${
          c.unit === 'ms' ? `${c.threshold} ms` : `${(c.threshold / MIB).toFixed(0)} MiB`
        }`,
    )
    .join('\n');
  expect(
    breached.length,
    breached.length === 0
      ? ''
      : `He10 Exit threshold breached on the ${years}-year corpus (plan §4). ` +
          'Per the plan this DESCOPES Wave C unless N5-style mitigations close it — ' +
          `do not silently ship.\n${report}`,
  ).toBe(0);
}
