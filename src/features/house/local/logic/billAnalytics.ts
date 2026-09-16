/**
 * Utility-bill analytics — the arithmetic House must run on device (H11 C1).
 *
 * Ported from `backend/src/utils/bill-analytics.ts` (`buildBillAnalytics`,
 * `generateBillInsights`) and the half of `backend/src/utils/bill-proration.ts`
 * those two depend on (`prorateBillToMonths`, `normalizeProviderKey`,
 * `PROVIDER_LABELS`) — keep in sync.
 *
 * WHY THE CLIENT NEEDS THIS AT ALL (plan §6)
 * ------------------------------------------
 * `getDashboard` and `getAnalytics` look like server features and are not. They
 * are *pure functions of `utility_bills`*, computed per request out of rows that
 * a local-first household keeps on its own devices — nothing is stored, nothing
 * is looked up, and no model runs. Leaving them remote would send them to a
 * Worker whose `utility_bills` table holds nothing for this household, and the
 * dashboard would render "$0.00 this month" and "No bills yet" with a 200. That
 * is the exact silence the coverage rule exists to prevent, and it is worse here
 * than in most places because the screen looks *correct*: a member who has just
 * imported a year of BC Hydro bills would conclude the import failed.
 *
 * `utility_trends` is the table that DOES pre-compute this on the server, and it
 * is Tier D — never ledgered, re-derived on device, which is precisely what this
 * file is. Do not add it to the registry to avoid porting this.
 *
 * WHY PRORATION IS LOAD-BEARING RATHER THAN A DETAIL
 * -------------------------------------------------
 * BC Hydro bills bi-monthly and FortisBC's periods drift, so a bill routinely
 * spans two calendar months. Every monthly figure on the dashboard and the
 * charts is built from day-weighted SLICES of each bill rather than from the
 * bill's own month, which is why a "$210 April" can exist with no April bill.
 * Reproducing that split exactly is what keeps a household's numbers identical
 * before and after it goes local-first; rounding it differently would redraw the
 * chart on the day the flag flips.
 *
 * TWO ROUNDING RULES THAT MUST NOT BE "TIDIED"
 * --------------------------------------------
 *  - **Drift goes to the last slice.** Each slice is rounded independently, so
 *    the parts do not sum to the whole; the remainder is added to the final
 *    slice so a bill's slices always total the bill. Distributing it evenly
 *    instead would make the last month differ from the server's by a cent.
 *  - **Usage is rounded to two decimals, amounts to whole cents.** `amount` is
 *    an integer-cent column and `usage_quantity` is a `real`. They are not the
 *    same kind of number and are deliberately not rounded the same way.
 *
 * The client already has a `src/utils/bill-proration.ts`, and it is NOT this:
 * that one splits a single amount for the Add-Bill form's live preview and
 * carries a `monthLabel` but no usage, provider key or bill type. It cannot feed
 * analytics, and widening it would change a form that is not part of this
 * sub-wave.
 */
import type { ProviderKey } from '@features/utilities/api/utilities';

import type { LocalUtilityBill } from '../types';

export type ProratedMonthSlice = {
  /** `YYYY-MM`. */
  monthKey: string;
  billType: string;
  provider: string | null;
  providerKey: ProviderKey;
  /** Integer cents. */
  amount: number;
  usageQuantity: number | null;
  daysInSlice: number;
  totalPeriodDays: number;
  billId: string;
};

export type MonthlyAnalyticsRow = {
  month: string;
  total: number;
  count: number;
  usage: number;
  byType: Record<string, number>;
  byProvider: Record<string, number>;
};

export type ProviderSummary = {
  providerKey: ProviderKey;
  label: string;
  totalAmount: number;
  billCount: number;
  latestBillDate: string | null;
  avgMonthlyAmount: number;
  primaryBillType: string;
  usageUnit: string | null;
  totalUsage: number;
};

export type BillInsight = {
  id: string;
  severity: 'info' | 'warning' | 'positive';
  title: string;
  body: string;
  providerKey?: ProviderKey;
  billType?: string;
};

export type BillAnalyticsResult = {
  monthlyData: MonthlyAnalyticsRow[];
  byType: Record<string, { total: number; count: number; average: number }>;
  byProvider: ProviderSummary[];
  insights: BillInsight[];
  totalBills: number;
  totalAmount: number;
  proratedTotalAmount: number;
};

export type BillAnalyticsFilters = {
  startYear?: number;
  endYear?: number;
  utilityType?: string;
  providerKey?: ProviderKey;
};

/** `bill-proration.ts:31`. The labels the provider cards render. */
export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  overview: 'All utilities',
  bc_hydro: 'BC Hydro',
  fortisbc: 'FortisBC',
  city_of_surrey: 'City of Surrey',
  other: 'Other',
};

function parseDateUtc(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * `bill-proration.ts:57` verbatim, including the fall-through by BILL TYPE.
 *
 * The name check runs first and the type check is the fallback, so a bill with
 * no provider still lands on a real card rather than in "Other". That ordering
 * is what makes the dashboard's provider totals agree with its by-type totals;
 * reversing it would file every electricity bill under BC Hydro even when the
 * member typed a different supplier.
 */
export function normalizeProviderKey(provider: string | null, billType: string): ProviderKey {
  const name = (provider ?? '').toLowerCase();
  if (name.includes('bc hydro') || name.includes('bchydro')) return 'bc_hydro';
  if (name.includes('fortis')) return 'fortisbc';
  if (name.includes('surrey')) return 'city_of_surrey';
  if (billType === 'electricity') return 'bc_hydro';
  if (billType === 'gas') return 'fortisbc';
  if (billType === 'water' || billType === 'sewer') return 'city_of_surrey';
  return 'other';
}

/**
 * Split one bill across every calendar month its period touches, weighted by
 * days — `bill-proration.ts:72`.
 */
export function prorateBillToMonths(bill: LocalUtilityBill): ProratedMonthSlice[] {
  const start = parseDateUtc(bill.billing_period_start);
  const end = parseDateUtc(bill.billing_period_end);
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  );
  const providerKey = normalizeProviderKey(bill.provider, bill.bill_type);

  const slices: ProratedMonthSlice[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    // Day 0 of the next month is the last day of this one.
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));

    const sliceStart = start > monthStart ? start : monthStart;
    const sliceEnd = end < monthEnd ? end : monthEnd;

    if (sliceStart <= sliceEnd) {
      const daysInSlice =
        Math.round((sliceEnd.getTime() - sliceStart.getTime()) / 86_400_000) + 1;
      const ratio = daysInSlice / totalDays;
      slices.push({
        monthKey: monthKeyOf(year, month + 1),
        billType: bill.bill_type,
        provider: bill.provider,
        providerKey,
        amount: Math.round(bill.amount * ratio),
        usageQuantity:
          bill.usage_quantity != null
            ? Math.round(bill.usage_quantity * ratio * 100) / 100
            : null,
        daysInSlice,
        totalPeriodDays: totalDays,
        billId: bill.id,
      });
    }

    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  // Rounding drift goes to the LAST slice, so the parts sum to the bill.
  if (slices.length > 0) {
    const allocated = slices.reduce((sum, slice) => sum + slice.amount, 0);
    const drift = bill.amount - allocated;
    if (drift !== 0) slices[slices.length - 1]!.amount += drift;
  }

  return slices;
}

/**
 * The `comparison` block an AI extraction left on the bill.
 *
 * Read, never written, on device: `ai_extracted_data` is a plain text column
 * that arrives filled in on bills the server extracted before the household went
 * local-first, and one insight below is derived from it. Running the extraction
 * is the throw site (`localUtilitiesApi.uploadAndExtractBill`); reading a column
 * that is already there is not.
 */
function extractedComparison(
  bill: LocalUtilityBill,
): { lastBillUsage: number | null; lastYearUsage: number | null; unit: string | null } | null {
  if (!bill.ai_extracted_data) return null;
  try {
    const parsed = JSON.parse(bill.ai_extracted_data) as {
      comparison?: { lastBillUsage: number | null; lastYearUsage: number | null; unit: string | null };
    };
    return parsed.comparison ?? null;
  } catch {
    // A half-written or hand-edited blob must not take the dashboard down.
    return null;
  }
}

function billMonthSpan(bill: LocalUtilityBill): number {
  return prorateBillToMonths(bill).length;
}

/** `bill-analytics.ts:195` — rule-based, deterministic, capped at six. */
export function generateBillInsights(
  bills: readonly LocalUtilityBill[],
  monthlyData: readonly MonthlyAnalyticsRow[],
  providers: readonly ProviderSummary[],
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
    const last = monthlyData[monthlyData.length - 1]!;
    const previous = monthlyData[monthlyData.length - 2]!;
    if (previous.total > 0) {
      const changePct = ((last.total - previous.total) / previous.total) * 100;
      if (Math.abs(changePct) >= 10) {
        insights.push({
          id: 'mom-trend',
          severity: changePct > 0 ? 'warning' : 'positive',
          title: changePct > 0 ? 'Spending increased' : 'Spending decreased',
          body: `Your prorated utility spend ${changePct > 0 ? 'rose' : 'fell'} ${Math.abs(changePct).toFixed(0)}% from ${previous.month} to ${last.month}. Multi-month bills are split across the months they cover.`,
        });
      }
    }
  }

  const topProvider = providers[0];
  if (topProvider && providers.length > 1) {
    const total = providers.reduce((sum, row) => sum + row.totalAmount, 0);
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

  // First five bills only, and it stops at the first hit — the Worker's loop.
  for (const bill of bills.slice(0, 5)) {
    const comparison = extractedComparison(bill);
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

  const multiMonth = bills.filter((bill) => billMonthSpan(bill) > 1);
  if (multiMonth.length > 0) {
    insights.push({
      id: 'proration-note',
      severity: 'info',
      title: 'Multi-month bills prorated',
      body: `${multiMonth.length} bill${multiMonth.length > 1 ? 's' : ''} span multiple months — amounts are divided by day so each month shows a fair share.`,
    });
  }

  return insights.slice(0, 6);
}

/**
 * `bill-analytics.ts:79` — the whole dashboard and charts payload, from rows.
 *
 * Note the deliberately asymmetric year filter: bills are kept when their period
 * STARTS in `[startYear, endYear + 1]` but a slice is only counted when it lands
 * in `[startYear, endYear]`. That is not a typo in the original — it is what
 * lets a December-to-January bill contribute its December half to the last month
 * of the range. Narrowing either bound would drop that half silently.
 */
export function buildBillAnalytics(
  bills: readonly LocalUtilityBill[],
  filters?: BillAnalyticsFilters,
): BillAnalyticsResult {
  const startYear = filters?.startYear ?? new Date().getFullYear() - 1;
  const endYear = filters?.endYear ?? new Date().getFullYear();

  let filtered = bills.filter((bill) => {
    const year = parseInt(bill.billing_period_start.substring(0, 4), 10);
    return year >= startYear && year <= endYear + 1;
  });

  if (filters?.utilityType) {
    filtered = filtered.filter((bill) => bill.bill_type === filters.utilityType);
  }

  // `overview` is the "no filter" member of the union, not a provider.
  if (filters?.providerKey && filters.providerKey !== 'overview') {
    filtered = filtered.filter(
      (bill) => normalizeProviderKey(bill.provider, bill.bill_type) === filters.providerKey,
    );
  }

  const allSlices = filtered.flatMap((bill) => prorateBillToMonths(bill));

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
  const monthlyData = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  // `byType` sums WHOLE bills, not slices — the Worker's own choice, and it is
  // why `totalAmount` and `proratedTotalAmount` can differ on the same screen.
  const byType: Record<string, { total: number; count: number; average: number }> = {};
  for (const bill of filtered) {
    const bucket = byType[bill.bill_type] ?? { total: 0, count: 0, average: 0 };
    bucket.total += bill.amount;
    bucket.count += 1;
    byType[bill.bill_type] = bucket;
  }
  for (const bucket of Object.values(byType)) {
    bucket.average = bucket.count > 0 ? bucket.total / bucket.count : 0;
  }

  const providerMap = new Map<ProviderKey, ProviderSummary>();
  for (const bill of filtered) {
    const key = normalizeProviderKey(bill.provider, bill.bill_type);
    const summary = providerMap.get(key) ?? {
      providerKey: key,
      label: PROVIDER_LABELS[key],
      totalAmount: 0,
      billCount: 0,
      latestBillDate: null,
      avgMonthlyAmount: 0,
      // First bill wins for both — the Worker seeds the summary from whichever
      // bill created it and never revisits either field.
      primaryBillType: bill.bill_type,
      usageUnit: bill.usage_unit,
      totalUsage: 0,
    };
    summary.totalAmount += bill.amount;
    summary.billCount += 1;
    summary.totalUsage += bill.usage_quantity ?? 0;
    if (!summary.latestBillDate || bill.billing_period_end > summary.latestBillDate) {
      summary.latestBillDate = bill.billing_period_end;
    }
    providerMap.set(key, summary);
  }

  // The per-month average divides PRORATED spend by the number of months the
  // provider actually appears in — not by the length of the range, which would
  // read as a discount for a provider that only started billing in June.
  for (const summary of providerMap.values()) {
    const providerSlices = allSlices.filter((slice) => slice.providerKey === summary.providerKey);
    const months = new Set(providerSlices.map((slice) => slice.monthKey));
    const prorated = providerSlices.reduce((sum, slice) => sum + slice.amount, 0);
    summary.avgMonthlyAmount = months.size > 0 ? Math.round(prorated / months.size) : 0;
  }

  const byProvider = [...providerMap.values()].sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    monthlyData,
    byType,
    byProvider,
    insights: generateBillInsights(filtered, monthlyData, byProvider),
    totalBills: filtered.length,
    totalAmount: filtered.reduce((sum, bill) => sum + bill.amount, 0),
    proratedTotalAmount: monthlyData.reduce((sum, row) => sum + row.total, 0),
  };
}
