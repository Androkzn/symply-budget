import type { UtilityBill } from '../db/schema-utilities';

import {
  normalizeProviderKey,
  prorateBillToMonths,
  type BillSliceInput,
  type ProratedMonthSlice,
  type ProviderKey,
  PROVIDER_LABELS,
} from './bill-proration';

export interface BillInsight {
  id: string;
  severity: 'info' | 'warning' | 'positive';
  title: string;
  body: string;
  providerKey?: ProviderKey;
  billType?: string;
}

export interface MonthlyAnalyticsRow {
  month: string;
  total: number;
  count: number;
  usage: number;
  byType: Record<string, number>;
  byProvider: Record<string, number>;
}

export interface ProviderSummary {
  providerKey: ProviderKey;
  label: string;
  totalAmount: number;
  billCount: number;
  latestBillDate: string | null;
  avgMonthlyAmount: number;
  primaryBillType: string;
  usageUnit: string | null;
  totalUsage: number;
}

export interface BillAnalyticsResult {
  monthlyData: MonthlyAnalyticsRow[];
  byType: Record<string, { total: number; count: number; average: number }>;
  byProvider: ProviderSummary[];
  insights: BillInsight[];
  totalBills: number;
  totalAmount: number;
  proratedTotalAmount: number;
}

function billToSliceInput(bill: UtilityBill): BillSliceInput {
  return {
    billId: bill.id,
    billType: bill.bill_type,
    provider: bill.provider,
    billingPeriodStart: bill.billing_period_start,
    billingPeriodEnd: bill.billing_period_end,
    amount: bill.amount,
    usageQuantity: bill.usage_quantity,
    usageUnit: bill.usage_unit,
  };
}

function parseExtractedComparison(bill: UtilityBill): {
  lastBillUsage: number | null;
  lastYearUsage: number | null;
  unit: string | null;
} | null {
  if (!bill.ai_extracted_data) return null;
  try {
    const data = JSON.parse(bill.ai_extracted_data);
    return data.comparison ?? null;
  } catch {
    return null;
  }
}

/** Build full analytics from bills using day-based monthly proration. */
export function buildBillAnalytics(
  bills: UtilityBill[],
  filters?: {
    startYear?: number;
    endYear?: number;
    utilityType?: string;
    providerKey?: ProviderKey;
  }
): BillAnalyticsResult {
  const startYear = filters?.startYear ?? new Date().getFullYear() - 1;
  const endYear = filters?.endYear ?? new Date().getFullYear();

  let filtered = bills.filter((b) => {
    const year = parseInt(b.billing_period_start.substring(0, 4), 10);
    return year >= startYear && year <= endYear + 1;
  });

  if (filters?.utilityType) {
    filtered = filtered.filter((b) => b.bill_type === filters.utilityType);
  }

  if (filters?.providerKey && filters.providerKey !== 'overview') {
    filtered = filtered.filter(
      (b) => normalizeProviderKey(b.provider, b.bill_type) === filters.providerKey
    );
  }

  const allSlices: ProratedMonthSlice[] = filtered.flatMap((b) =>
    prorateBillToMonths(billToSliceInput(b))
  );

  const monthMap = new Map<string, MonthlyAnalyticsRow>();

  for (const slice of allSlices) {
    const year = parseInt(slice.monthKey.substring(0, 4), 10);
    if (year < startYear || year > endYear) continue;

    const row = monthMap.get(slice.monthKey) ?? {
      month: slice.monthKey,
      total: 0,
      count: 0,
      usage: 0,
      byType: {},
      byProvider: {},
    };

    row.total += slice.amount;
    row.count += 1;
    row.usage += slice.usageQuantity ?? 0;
    row.byType[slice.billType] = (row.byType[slice.billType] ?? 0) + slice.amount;
    row.byProvider[slice.providerKey] = (row.byProvider[slice.providerKey] ?? 0) + slice.amount;
    monthMap.set(slice.monthKey, row);
  }

  const monthlyData = Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  const byType: Record<string, { total: number; count: number; average: number }> = {};
  for (const bill of filtered) {
    if (!byType[bill.bill_type]) {
      byType[bill.bill_type] = { total: 0, count: 0, average: 0 };
    }
    byType[bill.bill_type].total += bill.amount;
    byType[bill.bill_type].count += 1;
  }
  for (const type of Object.keys(byType)) {
    byType[type].average = byType[type].count > 0 ? byType[type].total / byType[type].count : 0;
  }

  const providerMap = new Map<ProviderKey, ProviderSummary>();
  for (const bill of filtered) {
    const key = normalizeProviderKey(bill.provider, bill.bill_type);
    const existing = providerMap.get(key) ?? {
      providerKey: key,
      label: PROVIDER_LABELS[key],
      totalAmount: 0,
      billCount: 0,
      latestBillDate: null,
      avgMonthlyAmount: 0,
      primaryBillType: bill.bill_type,
      usageUnit: bill.usage_unit,
      totalUsage: 0,
    };
    existing.totalAmount += bill.amount;
    existing.billCount += 1;
    existing.totalUsage += bill.usage_quantity ?? 0;
    if (!existing.latestBillDate || bill.billing_period_end > existing.latestBillDate) {
      existing.latestBillDate = bill.billing_period_end;
    }
    providerMap.set(key, existing);
  }

  for (const summary of providerMap.values()) {
    const key = summary.providerKey;
    const providerSlices = allSlices.filter((s) => s.providerKey === key);
    const providerMonths = new Set(providerSlices.map((s) => s.monthKey));
    const proratedTotal = providerSlices.reduce((sum, s) => sum + s.amount, 0);
    summary.avgMonthlyAmount =
      providerMonths.size > 0 ? Math.round(proratedTotal / providerMonths.size) : 0;
  }

  const insights = generateBillInsights(filtered, monthlyData, Array.from(providerMap.values()));

  const proratedTotalAmount = monthlyData.reduce((sum, m) => sum + m.total, 0);

  return {
    monthlyData,
    byType,
    byProvider: Array.from(providerMap.values()).sort((a, b) => b.totalAmount - a.totalAmount),
    insights,
    totalBills: filtered.length,
    totalAmount: filtered.reduce((sum, b) => sum + b.amount, 0),
    proratedTotalAmount,
  };
}

/** Rule-based insights from bill history and AI-extracted comparison fields. */
export function generateBillInsights(
  bills: UtilityBill[],
  monthlyData: MonthlyAnalyticsRow[],
  providers: ProviderSummary[]
): BillInsight[] {
  const insights: BillInsight[] = [];

  if (bills.length === 0) {
    return [
      {
        id: 'no-bills',
        severity: 'info',
        title: 'Upload your first bill',
        body: 'Scan a BC Hydro, FortisBC, or City of Surrey bill to unlock monthly trends and usage insights.',
      },
    ];
  }

  if (monthlyData.length >= 2) {
    const last = monthlyData[monthlyData.length - 1];
    const prev = monthlyData[monthlyData.length - 2];
    if (prev.total > 0) {
      const changePct = ((last.total - prev.total) / prev.total) * 100;
      if (Math.abs(changePct) >= 10) {
        insights.push({
          id: 'mom-trend',
          severity: changePct > 0 ? 'warning' : 'positive',
          title: changePct > 0 ? 'Spending increased' : 'Spending decreased',
          body: `Your prorated utility spend ${changePct > 0 ? 'rose' : 'fell'} ${Math.abs(changePct).toFixed(0)}% from ${prev.month} to ${last.month}. Multi-month bills are split across the months they cover.`,
        });
      }
    }
  }

  const topProvider = providers[0];
  if (topProvider && providers.length > 1) {
    const total = providers.reduce((s, p) => s + p.totalAmount, 0);
    const share = total > 0 ? (topProvider.totalAmount / total) * 100 : 0;
    if (share >= 40) {
      insights.push({
        id: 'top-provider',
        severity: 'info',
        title: `${topProvider.label} is your largest cost`,
        body: `${topProvider.label} accounts for ${share.toFixed(0)}% of recorded utility spend. Track usage trends in its dedicated dashboard.`,
        providerKey: topProvider.providerKey,
      });
    }
  }

  for (const bill of bills.slice(0, 5)) {
    const comparison = parseExtractedComparison(bill);
    if (!comparison?.lastYearUsage || !bill.usage_quantity) continue;
    const yoyChange =
      ((bill.usage_quantity - comparison.lastYearUsage) / comparison.lastYearUsage) * 100;
    if (Math.abs(yoyChange) >= 15) {
      const providerKey = normalizeProviderKey(bill.provider, bill.bill_type);
      insights.push({
        id: `yoy-${bill.id}`,
        severity: yoyChange > 0 ? 'warning' : 'positive',
        title: yoyChange > 0 ? 'Usage up vs last year' : 'Usage down vs last year',
        body: `${PROVIDER_LABELS[providerKey]} usage is ${Math.abs(yoyChange).toFixed(0)}% ${yoyChange > 0 ? 'higher' : 'lower'} than the same period last year.`,
        providerKey,
        billType: bill.bill_type,
      });
      break;
    }
  }

  const multiMonthBills = bills.filter(
    (b) => countBillMonths(b.billing_period_start, b.billing_period_end) > 1
  );
  if (multiMonthBills.length > 0) {
    insights.push({
      id: 'proration-note',
      severity: 'info',
      title: 'Multi-month bills prorated',
      body: `${multiMonthBills.length} bill${multiMonthBills.length > 1 ? 's' : ''} span multiple months — amounts are divided by day so each month shows a fair share.`,
    });
  }

  return insights.slice(0, 6);
}

function countBillMonths(start: string, end: string): number {
  const slices = prorateBillToMonths({
    billType: 'other',
    provider: null,
    billingPeriodStart: start,
    billingPeriodEnd: end,
    amount: 100,
  });
  return slices.length;
}

/** Sum prorated amount for a specific calendar month (YYYY-MM). */
export function getProratedMonthTotal(
  bills: UtilityBill[],
  monthKey: string,
  billType?: string
): number {
  const slices = bills.flatMap((b) => {
    if (billType && b.bill_type !== billType) return [];
    return prorateBillToMonths(billToSliceInput(b));
  });
  return slices
    .filter((s) => s.monthKey === monthKey)
    .reduce((sum, s) => sum + s.amount, 0);
}
