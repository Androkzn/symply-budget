/**
 * `logic/billAnalytics.ts` — the on-device port of the Worker's bill analytics.
 *
 * This module had NO dedicated test file: it was only ever exercised indirectly
 * through two `getAnalytics` cases in localUtilitiesApi.test.ts, which left the
 * proration maths, the provider-key precedence, the whole-bill-vs-prorated
 * divergence and every insight rule unpinned.
 *
 * Several cases below pin behaviour that is arguably WRONG but is a faithful
 * mirror of `backend/src/utils/bill-analytics.ts`. Those are marked MIRRORED —
 * changing them here alone would silently desync device and server, so they must
 * be fixed on both sides in one go.
 */
import {
  buildBillAnalytics,
  generateBillInsights,
  normalizeProviderKey,
  prorateBillToMonths,
} from '../logic/billAnalytics';
import type { LocalUtilityBill } from '../types';

function bill(overrides: Partial<LocalUtilityBill> = {}): LocalUtilityBill {
  return {
    id: 'ubl_1',
    household_id: 'hh',
    account_id: null,
    bill_type: 'electricity',
    provider: 'BC Hydro',
    account_number: null,
    billing_period_start: '2026-01-01',
    billing_period_end: '2026-01-31',
    amount: 6000,
    due_date: '2026-02-15',
    paid_date: null,
    paid_amount: null,
    usage_quantity: null,
    usage_unit: null,
    document_url: null,
    ai_extracted_data: null,
    confidence_score: null,
    task_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as LocalUtilityBill;
}

describe('normalizeProviderKey', () => {
  it.each([
    ['BC Hydro', 'electricity', 'bc_hydro'],
    ['bchydro', 'electricity', 'bc_hydro'],
    ['FortisBC', 'gas', 'fortisbc'],
    ['City of Surrey', 'water', 'city_of_surrey'],
  ])('maps provider %s to %s', (provider, type, expected) => {
    expect(normalizeProviderKey(provider, type)).toBe(expected);
  });

  it.each([
    ['electricity', 'bc_hydro'],
    ['gas', 'fortisbc'],
    ['water', 'city_of_surrey'],
    ['sewer', 'city_of_surrey'],
    ['garbage', 'other'],
  ])('falls back to bill type %s → %s when provider is null', (type, expected) => {
    expect(normalizeProviderKey(null, type)).toBe(expected);
  });

  it('prefers the provider NAME over the bill type', () => {
    // Load-bearing precedence: reversing it would file every electricity bill
    // under bc_hydro regardless of who actually issued it.
    expect(normalizeProviderKey('FortisBC', 'electricity')).toBe('fortisbc');
    expect(normalizeProviderKey('City of Surrey', 'electricity')).toBe('city_of_surrey');
  });

  it('returns other for an unrecognised provider and bill type', () => {
    expect(normalizeProviderKey('Hydro One', 'internet')).toBe('other');
  });
});

describe('prorateBillToMonths', () => {
  it('keeps a single-month bill whole', () => {
    const slices = prorateBillToMonths(bill());
    expect(slices).toHaveLength(1);
    expect(slices[0]!.monthKey).toBe('2026-01');
    expect(slices[0]!.amount).toBe(6000);
    expect(slices[0]!.daysInSlice).toBe(31);
    expect(slices[0]!.totalPeriodDays).toBe(31);
  });

  it('splits a two-month bill by day count', () => {
    const slices = prorateBillToMonths(
      bill({ billing_period_start: '2026-01-01', billing_period_end: '2026-02-28' })
    );
    expect(slices.map(s => s.monthKey)).toEqual(['2026-01', '2026-02']);
    expect(slices[0]!.daysInSlice).toBe(31);
    expect(slices[1]!.daysInSlice).toBe(28);
  });

  it('always makes the slices sum back to the bill exactly', () => {
    // Drift from rounding is pushed into the LAST slice on purpose.
    const slices = prorateBillToMonths(
      bill({ amount: 10_000, billing_period_start: '2026-01-15', billing_period_end: '2026-04-14' })
    );
    expect(slices.reduce((sum, s) => sum + s.amount, 0)).toBe(10_000);
    expect(slices.length).toBeGreaterThan(1);
  });

  it('spans a year boundary', () => {
    const slices = prorateBillToMonths(
      bill({ billing_period_start: '2025-12-15', billing_period_end: '2026-01-14' })
    );
    expect(slices.map(s => s.monthKey)).toEqual(['2025-12', '2026-01']);
  });

  it('prorates usage to two decimals and passes null through', () => {
    const [jan, feb] = prorateBillToMonths(
      bill({
        usage_quantity: 100,
        billing_period_start: '2026-01-01',
        billing_period_end: '2026-02-28',
      })
    );
    expect(jan!.usageQuantity).toBeCloseTo(52.54, 2);
    expect(feb!.usageQuantity).toBeCloseTo(47.46, 2);
    expect(prorateBillToMonths(bill())[0]!.usageQuantity).toBeNull();
  });

  it('handles a zero-amount bill', () => {
    expect(prorateBillToMonths(bill({ amount: 0 }))[0]!.amount).toBe(0);
  });

  it('MIRRORED BUG: a reversed period silently produces no slices', () => {
    // `Math.max(1, ...)` clamps totalDays and the while-loop never runs, so the
    // bill vanishes from every chart while still counting toward totalAmount.
    // Nothing validates start <= end on create. Same on the Worker.
    const slices = prorateBillToMonths(
      bill({ billing_period_start: '2026-03-01', billing_period_end: '2026-01-01' })
    );
    expect(slices).toEqual([]);
  });
});

describe('buildBillAnalytics', () => {
  const inRange = { startYear: 2026, endYear: 2026 };

  it('reports an empty result for no bills', () => {
    const result = buildBillAnalytics([], inRange);
    expect(result.totalBills).toBe(0);
    expect(result.totalAmount).toBe(0);
    expect(result.monthlyData).toEqual([]);
  });

  it('aggregates a single bill into its month', () => {
    const result = buildBillAnalytics([bill()], inRange);
    expect(result.totalBills).toBe(1);
    expect(result.totalAmount).toBe(6000);
    expect(result.proratedTotalAmount).toBe(6000);
    expect(result.monthlyData).toHaveLength(1);
    expect(result.monthlyData[0]!.month).toBe('2026-01');
  });

  it('sorts monthlyData ascending by month', () => {
    const result = buildBillAnalytics(
      [
        bill({ id: 'b2', billing_period_start: '2026-03-01', billing_period_end: '2026-03-31' }),
        bill({ id: 'b1', billing_period_start: '2026-01-01', billing_period_end: '2026-01-31' }),
      ],
      inRange
    );
    expect(result.monthlyData.map(m => m.month)).toEqual(['2026-01', '2026-03']);
  });

  it('filters by utilityType', () => {
    const bills = [bill({ id: 'e' }), bill({ id: 'g', bill_type: 'gas', provider: 'FortisBC' })];
    expect(buildBillAnalytics(bills, { ...inRange, utilityType: 'gas' }).totalBills).toBe(1);
  });

  it('treats providerKey overview as no filter at all', () => {
    const bills = [bill({ id: 'e' }), bill({ id: 'g', bill_type: 'gas', provider: 'FortisBC' })];
    expect(buildBillAnalytics(bills, { ...inRange, providerKey: 'overview' }).totalBills).toBe(2);
    expect(buildBillAnalytics(bills, { ...inRange, providerKey: 'fortisbc' }).totalBills).toBe(1);
  });

  it('computes byType from WHOLE bills, not prorated slices', () => {
    // This is why totalAmount and proratedTotalAmount can legitimately disagree
    // on the same screen — byType never gets clipped to the year window.
    const result = buildBillAnalytics([bill({ amount: 6000 })], inRange);
    expect(result.byType.electricity!.total).toBe(6000);
    expect(result.byType.electricity!.count).toBe(1);
    expect(result.byType.electricity!.average).toBe(6000);
  });

  it('MIRRORED BUG: admits a bill starting in endYear+1 that then contributes nothing', () => {
    // The filter keeps bills whose start year is <= endYear + 1, but slices are
    // only counted when their own year is within [startYear, endYear]. So this
    // bill inflates totalAmount and byType while contributing zero to the charts.
    const result = buildBillAnalytics(
      [bill({ billing_period_start: '2027-01-01', billing_period_end: '2027-01-31', amount: 5000 })],
      inRange
    );
    expect(result.totalBills).toBe(1);
    expect(result.totalAmount).toBe(5000);
    expect(result.byType.electricity!.total).toBe(5000);
    expect(result.monthlyData).toEqual([]);
    expect(result.proratedTotalAmount).toBe(0);
  });

  it('MIRRORED BUG: drops a straddling bill entirely at the lower bound', () => {
    // A Dec→Jan bill starts in startYear-1, so it is filtered out completely —
    // including the January days that genuinely belong inside the window.
    const result = buildBillAnalytics(
      [bill({ billing_period_start: '2025-12-15', billing_period_end: '2026-01-14', amount: 10_000 })],
      inRange
    );
    expect(result.totalBills).toBe(0);
    expect(result.monthlyData).toEqual([]);
  });
});

describe('generateBillInsights', () => {
  function monthly(rows: Array<[string, number]>) {
    return rows.map(([month, total]) => ({
      month,
      total,
      count: 1,
      usage: 0,
      byType: {},
      byProvider: {},
    }));
  }

  it('returns a single no-bills insight for an empty set', () => {
    const insights = generateBillInsights([], [], []);
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe('no-bills');
  });

  it('flags a month-over-month rise at or above 10%', () => {
    const insights = generateBillInsights(
      [bill()],
      monthly([
        ['2026-01', 10_000],
        ['2026-02', 11_000],
      ]),
      []
    );
    const mom = insights.find(i => i.id === 'mom-trend');
    expect(mom).toBeDefined();
    expect(mom!.severity).toBe('warning');
  });

  it('treats a fall as positive rather than a warning', () => {
    const insights = generateBillInsights(
      [bill()],
      monthly([
        ['2026-01', 10_000],
        ['2026-02', 9_000],
      ]),
      []
    );
    expect(insights.find(i => i.id === 'mom-trend')!.severity).toBe('positive');
  });

  it('suppresses a move smaller than 10%', () => {
    const insights = generateBillInsights(
      [bill()],
      monthly([
        ['2026-01', 10_000],
        ['2026-02', 10_500],
      ]),
      []
    );
    expect(insights.find(i => i.id === 'mom-trend')).toBeUndefined();
  });

  it('guards against dividing by a zero previous month', () => {
    expect(() =>
      generateBillInsights(
        [bill()],
        monthly([
          ['2026-01', 0],
          ['2026-02', 5_000],
        ]),
        []
      )
    ).not.toThrow();
  });

  it('adds a proration note when any bill spans more than one month', () => {
    const insights = generateBillInsights(
      [bill({ billing_period_start: '2026-01-01', billing_period_end: '2026-02-28' })],
      monthly([['2026-01', 6_000]]),
      []
    );
    expect(insights.some(i => i.id === 'proration-note')).toBe(true);
  });

  it('never returns more than six insights', () => {
    const insights = generateBillInsights(
      [bill({ billing_period_start: '2026-01-01', billing_period_end: '2026-03-31' })],
      monthly([
        ['2026-01', 10_000],
        ['2026-02', 20_000],
      ]),
      []
    );
    expect(insights.length).toBeLessThanOrEqual(6);
  });
});
