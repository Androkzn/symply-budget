import type { MortgageStatement } from '@api/mortgage';

import {
  buildActualSplitPoints,
  buildActualSplitStacks,
  buildAlignedRateSeries,
  buildInterestShareSeries,
  buildRateImpactSummary,
} from '../mortgageRateImpact';

/**
 * Rate-impact builders — "what did the rate changes actually do to my mortgage",
 * computed from the ACTUAL statement splits rather than the projected schedule.
 *
 * The fixture is a real TD Home Equity FlexLine term portion (Jul–Dec 2025), where
 * TD Prime fell 4.950 → 4.700 → 4.450 at a −0.860 variance. Statement amounts are
 * NEGATIVE on these statements (money out), which is exactly the sign trap the
 * builders have to absorb.
 */
function stmt(
  date: string,
  principal: number,
  interest: number,
  rateBps: number | null
): MortgageStatement {
  return {
    id: `s-${date}`,
    mortgage_id: 'm-1',
    statement_date: date,
    closing_balance_cents: 0,
    opening_balance_cents: null,
    interest_paid_cents: interest,
    principal_paid_cents: principal,
    payment_amount_cents: principal + interest,
    interest_rate_bps: rateBps,
    prime_rate_bps: null,
    variance_bps: null,
    source: 'file',
    created_at: `${date}T00:00:00Z`,
  };
}

// Jul is a PARTIAL period — one payment, not two — the case a raw dollar
// comparison would misread as "principal collapsed".
const JUL = stmt('2025-07-31', -63896, -153112, 409);
const AUG = stmt('2025-08-31', -128094, -305922, 409);
const SEP = stmt('2025-09-30', -133163, -300853, 384);
const OCT = stmt('2025-10-31', -147577, -286439, 359);
const NOV = stmt('2025-11-30', -161982, -272034, 359);
const DEC = stmt('2025-12-31', -167091, -266925, 359);

const FULL_MONTHS = [AUG, SEP, OCT, NOV, DEC];

describe('buildActualSplitPoints', () => {
  it('normalizes negative statement amounts and sorts oldest first', () => {
    const points = buildActualSplitPoints([DEC, AUG, OCT]); // deliberately unordered
    expect(points.map((p) => p.date)).toEqual(['2025-08-31', '2025-10-31', '2025-12-31']);
    expect(points[0].principalCents).toBe(128094); // sign stripped
    expect(points[0].interestCents).toBe(305922);
    expect(points[0].totalCents).toBe(434016);
  });

  it('drops statements missing either half of the split', () => {
    const noSplit = { ...AUG, principal_paid_cents: null };
    expect(buildActualSplitPoints([noSplit, DEC])).toHaveLength(1);
  });

  it('drops a zero-total statement rather than dividing by zero', () => {
    const zero = stmt('2025-05-31', 0, 0, 409);
    expect(buildActualSplitPoints([zero])).toHaveLength(0);
  });

  it('computes interest share as a fraction of the payment', () => {
    const [p] = buildActualSplitPoints([AUG]);
    expect(p.interestShare).toBeCloseTo(305922 / 434016, 5); // ≈ 0.7048
  });
});

describe('buildRateImpactSummary', () => {
  it('reports the improvement a falling rate produced, per $100 paid', () => {
    const s = buildRateImpactSummary(FULL_MONTHS);
    expect(s.hasComparison).toBe(true);
    // Aug at 4.09%: 29.5% of the payment reached the principal.
    expect(s.principalPer100First).toBe(29.5);
    // Dec at 3.59%: 38.5% did — the rate cut's real, compounding effect.
    expect(s.principalPer100Latest).toBe(38.5);
    // Interest share fell, so the delta is negative (the good direction).
    expect(s.interestShareDeltaPp).toBeCloseTo(-9, 1);
    expect(s.rateDeltaBps).toBe(-50); // 4.09% → 3.59%
  });

  it('is immune to a partial first period (the share, not the dollars, decides)', () => {
    // Jul has ONE payment (~$2,170) vs Aug's two (~$4,340). A dollar-delta
    // comparison would claim principal doubled; the share tells the truth — the
    // RATE had not moved yet, so the split is materially unchanged. (Not bit
    // identical: July accrues from the Jul 17 origination, so it isn't exactly
    // half of August — hence a ~0.1pp wobble, not the ~9pp a real cut produces.)
    const withPartial = buildRateImpactSummary([JUL, AUG]);
    expect(withPartial.rateDeltaBps).toBe(0);
    expect(Math.abs(withPartial.interestShareDeltaPp)).toBeLessThan(0.5);

    // The dollars, meanwhile, nearly doubled — which is why the summary is
    // share-based and never quotes a raw principal delta.
    const [jul, aug] = withPartial.points;
    expect(aug.principalCents / jul.principalCents).toBeGreaterThan(1.9);
  });

  it('has no comparison from a single statement', () => {
    const s = buildRateImpactSummary([AUG]);
    expect(s.hasComparison).toBe(false);
    expect(s.latest).toBeNull();
    expect(s.interestShareDeltaPp).toBe(0);
  });

  it('has no comparison from no statements at all', () => {
    const s = buildRateImpactSummary([]);
    expect(s.hasComparison).toBe(false);
    expect(s.first).toBeNull();
    expect(s.points).toEqual([]);
  });

  it('leaves rateDeltaBps null when a statement reported no rate', () => {
    const s = buildRateImpactSummary([stmt('2025-08-31', -128094, -305922, null), DEC]);
    expect(s.hasComparison).toBe(true);
    expect(s.rateDeltaBps).toBeNull();
    expect(s.principalPer100Latest).toBe(38.5); // the split still compares fine
  });

  it('reports a rising interest share when the rate goes UP', () => {
    const s = buildRateImpactSummary([DEC, { ...AUG, statement_date: '2026-01-31' }]);
    expect(s.interestShareDeltaPp).toBeGreaterThan(0);
    expect(s.rateDeltaBps).toBe(50);
  });
});

describe('chart series', () => {
  it('stacks principal then interest, in dollars, oldest first', () => {
    const stacks = buildActualSplitStacks(buildActualSplitPoints(FULL_MONTHS), '#cool', '#warm');
    expect(stacks).toHaveLength(5);
    expect(stacks[0].label).toBe('2025-08');
    expect(stacks[0].segments[0]).toEqual({ value: 1280.94, color: '#cool' });
    expect(stacks[0].segments[1]).toEqual({ value: 3059.22, color: '#warm' });
  });

  it('keeps only the newest maxBars — the recent trend is the story', () => {
    const stacks = buildActualSplitStacks(buildActualSplitPoints(FULL_MONTHS), '#c', '#w', 2);
    expect(stacks.map((s) => s.label)).toEqual(['2025-11', '2025-12']);
  });

  it('plots the interest share as a falling percent line', () => {
    const series = buildInterestShareSeries(buildActualSplitPoints(FULL_MONTHS));
    expect(series[0]).toEqual({ value: 70.5, label: '2025-08' });
    expect(series[series.length - 1]).toEqual({ value: 61.5, label: '2025-12' });
    // Monotonically falling across the term, matching the rate cuts.
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].value).toBeLessThan(series[i - 1].value);
    }
  });

  it('aligns the rate line to the same x labels, skipping rate-less statements', () => {
    const points = buildActualSplitPoints([stmt('2025-08-31', -1, -1, null), DEC]);
    const series = buildAlignedRateSeries(points);
    expect(series).toEqual([{ value: 3.59, label: '2025-12' }]);
  });
});
