import { describe, it, expect } from 'vitest';

import type { ExtractedUtilityBill } from '../../ai/prompts/extract-utility-bill';
import type { UtilityBill } from '../../db/schema-utilities';
import { BillExtractionService } from '../../services/bill-extraction-service';
import {
  buildBillAnalytics,
  generateBillInsights,
  getProratedMonthTotal,
  type MonthlyAnalyticsRow,
  type ProviderSummary,
} from '../bill-analytics';
import type { ProviderKey } from '../bill-proration';

import bcHydroFixture from './fixtures/bc-hydro-bill.json';
import fortisFixture from './fixtures/fortisbc-bill.json';
import surreyFixture from './fixtures/surrey-water-bill.json';

function billFromFixture(
  id: string,
  extracted: ExtractedUtilityBill,
  householdId = 'hh_test'
): UtilityBill {
  return {
    id,
    household_id: householdId,
    account_id: null,
    bill_type: extracted.provider.type,
    provider: extracted.provider.name,
    account_number: extracted.account.number,
    billing_period_start: extracted.billing.periodStart!,
    billing_period_end: extracted.billing.periodEnd!,
    amount: Math.round((extracted.financial.amountDue ?? 0) * 100),
    due_date: extracted.billing.dueDate!,
    paid_date: null,
    paid_amount: null,
    usage_quantity: extracted.usage.quantity,
    usage_unit: extracted.usage.unit,
    document_url: null,
    ai_extracted_data: JSON.stringify(extracted),
    confidence_score: extracted.confidence.overall,
    task_id: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  };
}

describe('bill-analytics', () => {
  const bills = [
    billFromFixture('bill-hydro', bcHydroFixture as ExtractedUtilityBill),
    billFromFixture('bill-fortis', fortisFixture as ExtractedUtilityBill),
    billFromFixture('bill-surrey', surreyFixture as ExtractedUtilityBill),
  ];

  it('builds prorated monthly rows for all three providers', () => {
    const result = buildBillAnalytics(bills, { startYear: 2026, endYear: 2026 });

    expect(result.byProvider).toHaveLength(3);
    expect(result.byProvider.map((p) => p.providerKey).sort()).toEqual([
      'bc_hydro',
      'city_of_surrey',
      'fortisbc',
    ]);

    const may = result.monthlyData.find((m) => m.month === '2026-05');
    expect(may).toBeDefined();
    expect(may!.byType.electricity).toBeGreaterThan(0);
    expect(may!.byType.gas).toBeGreaterThan(0);
  });

  it('filters analytics by provider key', () => {
    const hydroOnly = buildBillAnalytics(bills, {
      startYear: 2026,
      endYear: 2026,
      providerKey: 'bc_hydro',
    });

    expect(hydroOnly.totalBills).toBe(1);
    expect(hydroOnly.byProvider).toHaveLength(1);
    expect(hydroOnly.byProvider[0].providerKey).toBe('bc_hydro');
  });

  it('generates insights including proration note and provider share', () => {
    const result = buildBillAnalytics(bills, { startYear: 2026, endYear: 2026 });
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.insights.some((i) => i.id === 'proration-note')).toBe(true);
  });
});

// ── Synthetic-bill helpers for precise boundary math ───────────────────────
function mkBill(over: Partial<UtilityBill> & { id: string }): UtilityBill {
  return {
    household_id: 'hh_test',
    account_id: null,
    bill_type: 'electricity',
    provider: 'BC Hydro',
    account_number: null,
    billing_period_start: '2026-05-01',
    billing_period_end: '2026-05-31',
    amount: 10000,
    due_date: '2026-06-15',
    paid_date: null,
    paid_amount: null,
    usage_quantity: null,
    usage_unit: null,
    document_url: null,
    ai_extracted_data: null,
    confidence_score: 0.9,
    task_id: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...over,
  } as UtilityBill;
}

function mkMonth(month: string, total: number): MonthlyAnalyticsRow {
  return { month, total, count: 1, usage: 0, byType: {}, byProvider: {} };
}

function mkProvider(providerKey: ProviderKey, totalAmount: number): ProviderSummary {
  return {
    providerKey,
    label: providerKey,
    totalAmount,
    billCount: 1,
    latestBillDate: '2026-05-31',
    avgMonthlyAmount: totalAmount,
    primaryBillType: 'electricity',
    usageUnit: null,
    totalUsage: 0,
  };
}

describe('buildBillAnalytics — byType.average and avgMonthlyAmount', () => {
  it('byType.average = total / count', () => {
    const result = buildBillAnalytics(
      [
        mkBill({ id: 'e1', bill_type: 'electricity', amount: 10000 }),
        mkBill({ id: 'e2', bill_type: 'electricity', amount: 20000 }),
      ],
      { startYear: 2026, endYear: 2026 }
    );
    expect(result.byType.electricity.total).toBe(30000);
    expect(result.byType.electricity.count).toBe(2);
    expect(result.byType.electricity.average).toBe(15000);
  });

  it('avgMonthlyAmount for a single-month provider equals its prorated total', () => {
    const result = buildBillAnalytics([mkBill({ id: 'h', amount: 12000 })], {
      startYear: 2026,
      endYear: 2026,
    });
    const hydro = result.byProvider.find((p) => p.providerKey === 'bc_hydro');
    expect(hydro?.avgMonthlyAmount).toBe(12000);
  });

  it('avgMonthlyAmount = round(proratedTotal / distinctMonths) for a multi-month bill', () => {
    // Apr 9 – Jun 8 touches 3 months; 17972 / 3 → 5991 (rounded)
    const result = buildBillAnalytics(
      [
        mkBill({
          id: 'h',
          amount: 17972,
          billing_period_start: '2026-04-09',
          billing_period_end: '2026-06-08',
        }),
      ],
      { startYear: 2026, endYear: 2026 }
    );
    const hydro = result.byProvider.find((p) => p.providerKey === 'bc_hydro');
    expect(hydro?.avgMonthlyAmount).toBe(Math.round(17972 / 3));
  });

  it('includes bills up to endYear+1 in totals but excludes their months from monthlyData', () => {
    const result = buildBillAnalytics(
      [
        mkBill({ id: 'a', amount: 10000 }), // 2026-05
        mkBill({
          id: 'b',
          amount: 20000,
          billing_period_start: '2027-01-01',
          billing_period_end: '2027-01-31',
        }), // 2027 — inside endYear+1 window
        mkBill({
          id: 'c',
          amount: 30000,
          billing_period_start: '2028-01-01',
          billing_period_end: '2028-01-31',
        }), // 2028 — outside the window
      ],
      { startYear: 2026, endYear: 2026 }
    );
    expect(result.totalBills).toBe(2); // a + b kept, c filtered out
    expect(result.monthlyData.every((m) => m.month.startsWith('2026'))).toBe(true);
  });
});

describe('generateBillInsights — percentage thresholds and division guards', () => {
  const oneMultiMonthBill = [
    mkBill({ id: 'm', billing_period_start: '2026-04-09', billing_period_end: '2026-06-08' }),
  ];

  it('empty bills → single "no-bills" prompt', () => {
    const insights = generateBillInsights([], [], []);
    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe('no-bills');
  });

  it('MoM change at exactly +10% emits an increase warning', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [mkMonth('2026-04', 1000), mkMonth('2026-05', 1100)],
      []
    );
    const mom = insights.find((i) => i.id === 'mom-trend');
    expect(mom?.severity).toBe('warning');
    expect(mom?.body).toContain('10%');
  });

  it('MoM change below 10% is suppressed', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [mkMonth('2026-04', 1000), mkMonth('2026-05', 1090)],
      []
    );
    expect(insights.some((i) => i.id === 'mom-trend')).toBe(false);
  });

  it('a 10% DROP is a positive insight', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [mkMonth('2026-04', 1000), mkMonth('2026-05', 900)],
      []
    );
    expect(insights.find((i) => i.id === 'mom-trend')?.severity).toBe('positive');
  });

  it('guards division by zero when the previous month total is 0', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [mkMonth('2026-04', 0), mkMonth('2026-05', 500)],
      []
    );
    expect(insights.some((i) => i.id === 'mom-trend')).toBe(false); // no NaN, no crash
  });

  it('top provider ≥40% share emits an insight (needs >1 provider)', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [],
      [mkProvider('bc_hydro', 40), mkProvider('fortisbc', 60)]
    );
    const top = insights.find((i) => i.id === 'top-provider');
    expect(top?.providerKey).toBe('bc_hydro');
    expect(top?.body).toContain('40%');
  });

  it('top provider below 40% share is suppressed', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [],
      [mkProvider('bc_hydro', 39), mkProvider('fortisbc', 61)]
    );
    expect(insights.some((i) => i.id === 'top-provider')).toBe(false);
  });

  it('a single provider never triggers the top-provider insight', () => {
    const insights = generateBillInsights(oneMultiMonthBill, [], [mkProvider('bc_hydro', 100)]);
    expect(insights.some((i) => i.id === 'top-provider')).toBe(false);
  });

  it('YoY usage ≥15% emits a usage insight; <15% and null comparison are ignored', () => {
    const up = mkBill({
      id: 'yoy-up',
      usage_quantity: 115,
      ai_extracted_data: JSON.stringify({ comparison: { lastYearUsage: 100 } }),
    });
    const flat = mkBill({
      id: 'yoy-flat',
      usage_quantity: 114,
      ai_extracted_data: JSON.stringify({ comparison: { lastYearUsage: 100 } }),
    });
    const noComparison = mkBill({ id: 'yoy-null', usage_quantity: 200, ai_extracted_data: null });

    expect(generateBillInsights([up], [], []).some((i) => i.id === 'yoy-yoy-up')).toBe(true);
    expect(generateBillInsights([flat], [], []).some((i) => i.id.startsWith('yoy-'))).toBe(false);
    expect(generateBillInsights([noComparison], [], []).some((i) => i.id.startsWith('yoy-'))).toBe(
      false
    );
  });

  it('never returns more than 6 insights', () => {
    const insights = generateBillInsights(
      oneMultiMonthBill,
      [mkMonth('2026-04', 1000), mkMonth('2026-05', 2000)],
      [mkProvider('bc_hydro', 90), mkProvider('fortisbc', 10)]
    );
    expect(insights.length).toBeLessThanOrEqual(6);
  });
});

describe('getProratedMonthTotal', () => {
  const bills = [
    mkBill({
      id: 'hydro',
      bill_type: 'electricity',
      amount: 17972,
      billing_period_start: '2026-04-09',
      billing_period_end: '2026-06-08',
    }),
    mkBill({
      id: 'gas',
      provider: 'FortisBC',
      bill_type: 'gas',
      amount: 6845,
      billing_period_start: '2026-05-12',
      billing_period_end: '2026-06-10',
    }),
  ];

  it('sums all providers for a month by default', () => {
    const may = getProratedMonthTotal(bills, '2026-05');
    const mayElectric = getProratedMonthTotal(bills, '2026-05', 'electricity');
    const mayGas = getProratedMonthTotal(bills, '2026-05', 'gas');
    expect(may).toBe(mayElectric + mayGas);
    expect(mayElectric).toBeGreaterThan(0);
    expect(mayGas).toBeGreaterThan(0);
  });

  it('filters by bill type', () => {
    // April is electricity-only; a gas filter yields nothing that month
    expect(getProratedMonthTotal(bills, '2026-04', 'gas')).toBe(0);
    expect(getProratedMonthTotal(bills, '2026-04', 'electricity')).toBeGreaterThan(0);
  });

  it('returns 0 for a month outside every bill period', () => {
    expect(getProratedMonthTotal(bills, '2020-01')).toBe(0);
  });
});

describe('BillExtractionService.toCreateBillInput', () => {
  it('maps BC Hydro fixture to create-bill input', () => {
    const service = new BillExtractionService({ ANTHROPIC_API_KEY: 'test' } as any);
    const input = service.toCreateBillInput(bcHydroFixture as ExtractedUtilityBill);

    expect(input.billType).toBe('electricity');
    expect(input.provider).toBe('BC Hydro');
    expect(input.amount).toBe(17972);
    expect(input.billingPeriodStart).toBe('2026-04-09');
    expect(input.billingPeriodEnd).toBe('2026-06-08');
    expect(input.usageQuantity).toBe(1270);
    expect(input.usageUnit).toBe('kWh');
    expect(input.confidenceScore).toBeGreaterThan(0.8);
  });

  it('maps FortisBC fixture to gas bill input', () => {
    const service = new BillExtractionService({ ANTHROPIC_API_KEY: 'test' } as any);
    const input = service.toCreateBillInput(fortisFixture as ExtractedUtilityBill);

    expect(input.billType).toBe('gas');
    expect(input.provider).toBe('FortisBC');
    expect(input.usageUnit).toBe('GJ');
  });

  it('maps City of Surrey fixture to water bill input', () => {
    const service = new BillExtractionService({ ANTHROPIC_API_KEY: 'test' } as any);
    const input = service.toCreateBillInput(surreyFixture as ExtractedUtilityBill);

    expect(input.billType).toBe('water');
    expect(input.provider).toBe('City of Surrey');
    expect(input.usageUnit).toBe('m³');
  });
});
