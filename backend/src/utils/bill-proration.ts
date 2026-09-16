/**
 * Day-based bill proration across calendar months.
 * A 2-month BC Hydro bill is split proportionally so each month gets its fair share.
 */

export interface BillSliceInput {
  billType: string;
  provider: string | null;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  amount: number;
  usageQuantity?: number | null;
  usageUnit?: string | null;
  billId?: string;
}

export interface ProratedMonthSlice {
  monthKey: string;
  billType: string;
  provider: string | null;
  providerKey: string;
  amount: number;
  usageQuantity: number | null;
  daysInSlice: number;
  totalPeriodDays: number;
  billId?: string;
}

export type ProviderKey = 'overview' | 'bc_hydro' | 'fortisbc' | 'city_of_surrey' | 'other';

export const PROVIDER_LABELS: Record<ProviderKey, string> = {
  overview: 'All utilities',
  bc_hydro: 'BC Hydro',
  fortisbc: 'FortisBC',
  city_of_surrey: 'City of Surrey',
  other: 'Other',
};

function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function countPeriodDays(start: string, end: string): number {
  const s = parseDateUTC(start);
  const e = parseDateUTC(end);
  const diff = Math.round((e.getTime() - s.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

/** Map provider name + bill type to a stable dashboard key. */
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
 * Split a bill's amount and usage across every calendar month it touches,
 * weighted by the number of days in each month.
 */
export function prorateBillToMonths(bill: BillSliceInput): ProratedMonthSlice[] {
  const totalDays = countPeriodDays(bill.billingPeriodStart, bill.billingPeriodEnd);
  const providerKey = normalizeProviderKey(bill.provider, bill.billType);

  const start = parseDateUTC(bill.billingPeriodStart);
  const end = parseDateUTC(bill.billingPeriodEnd);

  const slices: ProratedMonthSlice[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));

    const sliceStart = start > monthStart ? start : monthStart;
    const sliceEnd = end < monthEnd ? end : monthEnd;

    if (sliceStart <= sliceEnd) {
      const daysInSlice =
        Math.round((sliceEnd.getTime() - sliceStart.getTime()) / 86_400_000) + 1;
      const ratio = daysInSlice / totalDays;

      slices.push({
        monthKey: formatMonthKey(year, month + 1),
        billType: bill.billType,
        provider: bill.provider,
        providerKey,
        amount: Math.round(bill.amount * ratio),
        usageQuantity:
          bill.usageQuantity != null ? Math.round(bill.usageQuantity * ratio * 100) / 100 : null,
        daysInSlice,
        totalPeriodDays: totalDays,
        billId: bill.billId,
      });
    }

    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  // Fix rounding drift — remainder goes to the last slice.
  if (slices.length > 0) {
    const allocated = slices.reduce((sum, s) => sum + s.amount, 0);
    const drift = bill.amount - allocated;
    if (drift !== 0) {
      slices[slices.length - 1].amount += drift;
    }
  }

  return slices;
}

/** Aggregate prorated slices into monthly totals keyed by YYYY-MM. */
export function aggregateMonthlySlices(
  slices: ProratedMonthSlice[],
  filters?: { billTypes?: string[]; providerKeys?: ProviderKey[] }
): Map<string, { amount: number; usage: number; billCount: number }> {
  const result = new Map<string, { amount: number; usage: number; billCount: number }>();

  for (const slice of slices) {
    if (filters?.billTypes?.length && !filters.billTypes.includes(slice.billType)) continue;
    if (
      filters?.providerKeys?.length &&
      !filters.providerKeys.includes(slice.providerKey as ProviderKey)
    ) {
      continue;
    }

    const existing = result.get(slice.monthKey) ?? { amount: 0, usage: 0, billCount: 0 };
    existing.amount += slice.amount;
    existing.usage += slice.usageQuantity ?? 0;
    existing.billCount += 1;
    result.set(slice.monthKey, existing);
  }

  return result;
}
