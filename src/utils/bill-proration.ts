/**
 * Client-side day-based bill proration — mirrors the backend
 * `prorateBillToMonths` in backend/src/utils/bill-proration.ts so the Add/Edit
 * Bill form can show a live preview of which calendar months a bill will land
 * in (and how much of its amount each gets) before it's saved. A bill whose
 * billing period spans month boundaries is split proportionally by day count,
 * with rounding drift folded into the last slice — exactly what the dashboard
 * later shows once the bill is persisted.
 */

export interface MonthSlice {
  /** YYYY-MM */
  monthKey: string;
  /** "Apr 2026" */
  monthLabel: string;
  /** Prorated amount in cents. */
  amount: number;
  daysInSlice: number;
}

function parseDateUTC(dateStr: string): Date | null {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatMonthLabel(year: number, month: number): string {
  // month is 0-indexed here; day 1 avoids any timezone month-rollover.
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Split a bill's amount (in cents) across every calendar month its billing
 * period touches, weighted by days in each month.
 *
 * @returns one slice per month, or `[]` when the inputs aren't a positive
 *   amount over a start ≤ end date range.
 */
export function prorateBillToMonths(
  billingPeriodStart: string,
  billingPeriodEnd: string,
  amountCents: number
): MonthSlice[] {
  const start = parseDateUTC(billingPeriodStart);
  const end = parseDateUTC(billingPeriodEnd);
  if (!start || !end || end < start) return [];
  if (!Number.isFinite(amountCents) || amountCents <= 0) return [];

  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  );

  const slices: MonthSlice[] = [];
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
      slices.push({
        monthKey: formatMonthKey(year, month + 1),
        monthLabel: formatMonthLabel(year, month),
        amount: Math.round(amountCents * (daysInSlice / totalDays)),
        daysInSlice,
      });
    }

    cursor = new Date(Date.UTC(year, month + 1, 1));
  }

  // Fold rounding drift into the last slice so the parts sum to the total.
  if (slices.length > 0) {
    const allocated = slices.reduce((sum, s) => sum + s.amount, 0);
    slices[slices.length - 1].amount += amountCents - allocated;
  }

  return slices;
}
