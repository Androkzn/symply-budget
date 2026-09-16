import type { MortgageStatement, MortgageTerm, StoredRatePeriod } from '@api/mortgage';

import { buildRateChangeHistory } from '../mortgageRateHistory';

/** Minimal statement fixture — only the fields the detector reads matter. */
function stmt(
  date: string,
  opts: { rateBps?: number | null; periods?: StoredRatePeriod[] } = {}
): MortgageStatement {
  return {
    id: `s-${date}`,
    mortgage_id: 'm-1',
    statement_date: date,
    closing_balance_cents: 0,
    opening_balance_cents: null,
    interest_paid_cents: null,
    principal_paid_cents: null,
    payment_amount_cents: null,
    interest_rate_bps: opts.rateBps ?? null,
    prime_rate_bps: null,
    variance_bps: null,
    raw_extraction_json: opts.periods ? JSON.stringify({ ratePeriods: opts.periods }) : null,
    source: 'file',
    created_at: date,
  };
}

const p = (effectiveDate: string, rateBps: number): StoredRatePeriod => ({
  effectiveDate,
  rateBps,
  primeRateBps: null,
  varianceBps: null,
});

const term = (nominalBps: number, startDate = '2023-07-13'): MortgageTerm =>
  ({
    id: 't-1',
    mortgage_id: 'm-1',
    household_id: 'hh-1',
    sequence: 1,
    rate_type: 'variable_arm',
    compounding: 'monthly',
    nominal_rate_bps: nominalBps,
    prime_rate_bps: null,
    spread_bps: null,
    term_months: 60,
    term_start_date: startDate,
    maturity_date: '2028-07-13',
    payment_frequency: 'biweekly',
    amortization_months_at_start: 300,
    scheduled_payment_cents: null,
    is_current: true,
  }) as MortgageTerm;

describe('buildRateChangeHistory — automatic rate-change detection', () => {
  it('detects the two exact-dated changes across the real TD statements', () => {
    // Baseline 4.09% (signed rate). Aug flat 4.09; Sep steps to 3.84 on the 18th;
    // Oct steps to 3.59 on the 30th; Nov/Dec/Jan hold at 3.59.
    const statements = [
      stmt('2025-08-31', { periods: [p('2025-08-01', 409)] }),
      stmt('2025-09-30', { periods: [p('2025-09-01', 409), p('2025-09-18', 384)] }),
      stmt('2025-10-31', { periods: [p('2025-10-01', 384), p('2025-10-30', 359)] }),
      stmt('2025-11-30', { periods: [p('2025-11-01', 359)] }),
      stmt('2025-12-31', { periods: [p('2025-12-01', 359)] }),
      stmt('2026-01-31', { periods: [p('2026-01-01', 359)] }),
    ];
    const { changes } = buildRateChangeHistory(statements, [term(409)]);

    // Exactly two changes, NEWEST first, on the exact effective dates.
    expect(changes.map((c) => ({ date: c.date, from: c.fromBps, to: c.toBps }))).toEqual([
      { date: '2025-10-30', from: 384, to: 359 },
      { date: '2025-09-18', from: 409, to: 384 },
    ]);
    expect(changes[0].deltaBps).toBe(-25); // a 0.25% cut
  });

  it('surfaces a mid-period change from a SINGLE uploaded statement', () => {
    // Only the October statement — its own breakdown reveals the Oct 30 cut.
    const { changes } = buildRateChangeHistory(
      [stmt('2025-10-31', { periods: [p('2025-10-01', 384), p('2025-10-30', 359)] })],
      [term(384)] // signed at 3.84 → only the Oct 30 step is a change
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ date: '2025-10-30', fromBps: 384, toBps: 359 });
  });

  it('seeds the step-line series with the origination rate + each change', () => {
    const statements = [
      stmt('2025-09-30', { periods: [p('2025-09-01', 409), p('2025-09-18', 384)] }),
      stmt('2025-10-31', { periods: [p('2025-10-30', 359)] }),
    ];
    const { series } = buildRateChangeHistory(statements, [term(409)]);
    // Origination 4.09 → 3.84 → 3.59 (three step points).
    expect(series.map((s) => s.value)).toEqual([4.09, 3.84, 3.59]);
  });

  it('falls back to the single statement rate when no breakdown was captured', () => {
    const statements = [
      stmt('2025-08-31', { rateBps: 409 }),
      stmt('2025-09-30', { rateBps: 384 }),
      stmt('2025-10-31', { rateBps: 359 }),
    ];
    const { changes } = buildRateChangeHistory(statements, [term(409)]);
    expect(changes.map((c) => c.toBps)).toEqual([359, 384]); // newest first
    // Fallback dates at the statement date (no mid-month precision available).
    expect(changes.map((c) => c.date)).toEqual(['2025-10-31', '2025-09-30']);
  });

  it('emits no change when the rate holds flat', () => {
    const statements = [
      stmt('2025-11-30', { periods: [p('2025-11-01', 359)] }),
      stmt('2025-12-31', { periods: [p('2025-12-01', 359)] }),
    ];
    const { changes } = buildRateChangeHistory(statements, [term(359)]);
    expect(changes).toHaveLength(0);
  });

  it('does not treat the first observed rate as a change when the baseline is unknown', () => {
    // No usable term baseline (payment-only setup, nominal 0).
    const { changes, series } = buildRateChangeHistory(
      [stmt('2025-10-31', { periods: [p('2025-10-01', 359)] })],
      [term(0)]
    );
    expect(changes).toHaveLength(0);
    expect(series.map((s) => s.value)).toEqual([3.59]);
  });
});
