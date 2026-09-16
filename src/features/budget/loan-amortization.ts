import {
  buildSchedule,
  interestOverPeriods,
  periodicRate,
  type ScheduleRow,
} from '@features/mortgage/amortization';

/**
 * Installment-loan math for Monthly Payments (car loans, BNPL plans like
 * IKEA's payment plan, personal loans) — deliberately reuses the mortgage
 * amortization engine (`@features/mortgage/amortization`) rather than
 * re-deriving level-payment / balance / interest formulas, at MONTHLY
 * compounding (`i = APR/12`, the consumer-loan convention) instead of the
 * mortgage engine's Canadian semi-annual convention. Its `i === 0` branches
 * already give exact straight-line math for a 0% BNPL plan with no special
 * casing here.
 *
 * The term (months) is a direct user input — not solved for — because a
 * household adding an existing loan knows it from the loan agreement/
 * statement ("60-month car loan"). The recurring payment's own
 * `amount_cents` is treated as the real, authoritative payment (it may not
 * exactly match a textbook `principal/rate/term` computation once rounding
 * or a mid-term adjustment is involved), so every derived figure is anchored
 * to `principal_cents` + `paymentCents`, with `term_months` fixing the
 * schedule length — "payments remaining" is a plain subtraction, never a
 * solved root, and can't return null/never-amortizes like the mortgage
 * engine's `remainingPeriods` can for a VRM past its trigger rate.
 */

export interface LoanSummaryInput {
  principalCents: number;
  rateType: 'zero' | 'fixed';
  /** Nominal annual rate in basis points (599 = 5.99%). Ignored when rateType is 'zero'. */
  rateBps: number;
  termMonths: number;
  /** YYYY-MM-DD — the loan's first payment date. */
  startDate: string;
  /** The recurring payment's current `amount_cents` — the real, authoritative payment. */
  paymentCents: number;
  /** Defaults to now; injectable for tests. */
  asOf?: Date;
}

export interface LoanSummary {
  termMonths: number;
  elapsedMonths: number;
  paymentsRemaining: number;
  currentBalanceCents: number;
  interestPaidToDateCents: number;
  totalInterestCents: number;
  /** principal + totalInterestCents — the all-in cost of the loan. */
  totalCostCents: number;
  /** YYYY-MM-DD — start_date + term_months, month-end clamped. */
  payoffDate: string;
}

function parseDateUtc(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month1 = Number(match[2]);
  const day = Number(match[3]);
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month1 - 1, day));
}

/** Whole months elapsed from `startDate` to `asOf`, floored, never negative. */
export function elapsedMonths(startDate: string, asOf: Date): number {
  const start = parseDateUtc(startDate);
  if (!start) return 0;
  let months =
    (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - start.getUTCMonth());
  if (asOf.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Add `months` to a `YYYY-MM-DD` date, clamping to the target month's last
 * day (Jan 31 + 1mo → Feb 28, not Mar 3) — same rule used by
 * `mortgage/statement-reminder.ts` and `budget-renewal-service.ts`.
 */
export function addMonthsClamped(dateStr: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month0 = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonth0 = month0 + months;
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth0 + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDayOfTarget);
  return new Date(Date.UTC(year, targetMonth0, targetDay)).toISOString().slice(0, 10);
}

/** Every derived number the app shows for one installment loan. */
export function computeInstallmentLoanSummary(input: LoanSummaryInput): LoanSummary {
  const { principalCents, rateType, rateBps, termMonths, startDate, paymentCents } = input;
  const asOf = input.asOf ?? new Date();
  const i = rateType === 'zero' ? 0 : periodicRate(rateBps / 10_000, 12, 'monthly');

  const elapsed = Math.min(termMonths, elapsedMonths(startDate, asOf));
  const paymentsRemaining = Math.max(0, termMonths - elapsed);

  const toDate = interestOverPeriods(principalCents, i, paymentCents, elapsed);
  const fullLife = interestOverPeriods(principalCents, i, paymentCents, termMonths);
  const totalInterestCents = rateType === 'zero' ? 0 : Math.round(fullLife.interest);
  const interestPaidToDateCents = rateType === 'zero' ? 0 : Math.round(toDate.interest);

  return {
    termMonths,
    elapsedMonths: elapsed,
    paymentsRemaining,
    currentBalanceCents: Math.round(toDate.endBalance),
    interestPaidToDateCents,
    totalInterestCents,
    totalCostCents: principalCents + totalInterestCents,
    payoffDate: addMonthsClamped(startDate, termMonths) ?? startDate,
  };
}

/**
 * Full payment-by-payment schedule for one installment loan, at MONTHLY
 * compounding (same convention as `computeInstallmentLoanSummary` above) —
 * backs the Savings → Monthly payment detail sheet's loan payoff charts.
 * `termMonths` directly fixes the row count (never solved for), consistent
 * with how `computeInstallmentLoanSummary` treats term as a fixed input.
 */
export function buildInstallmentLoanSchedule(input: LoanSummaryInput): ScheduleRow[] {
  const { principalCents, rateType, rateBps, termMonths, paymentCents } = input;
  const toDollars = (cents: number) => cents / 100;
  const toCents = (dollars: number) => Math.round(dollars * 100);
  const rows = buildSchedule({
    principal: toDollars(principalCents),
    nominalAnnual: rateType === 'zero' ? 0 : rateBps / 10_000,
    frequency: 'monthly',
    compounding: 'monthly',
    amortizationMonths: termMonths,
    paymentOverride: toDollars(paymentCents),
  });
  return rows.map((r) => ({
    ...r,
    interest: toCents(r.interest),
    principal: toCents(r.principal),
    balance: toCents(r.balance),
  }));
}
