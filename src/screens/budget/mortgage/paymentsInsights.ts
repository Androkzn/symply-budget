import type {
  MortgagePaymentFrequency,
  MortgageScheduleRow,
  MortgageStatement,
} from '@api/mortgage';
import type { AppBarStack } from '@components/ui/AppBarChart';
import type { AppLinePoint } from '@components/ui/AppLineChart';

import { paymentDateIso } from './scheduleDates';

/**
 * How often a payment is due, in two shapes: a trailing clause ("every 2
 * weeks", read after a dollar figure) and a leading adjective ("biweekly",
 * read before "payments"). A $ figure on its own reads as monthly by
 * default — every payment amount shown next to money needs one of these so
 * a biweekly/weekly mortgage never gets misread as its monthly cost.
 */
export const FREQUENCY_LABEL: Record<MortgagePaymentFrequency, string> = {
  monthly: 'every month',
  semi_monthly: 'twice a month',
  biweekly: 'every 2 weeks',
  weekly: 'every week',
  accel_biweekly: 'every 2 weeks (accelerated)',
  accel_weekly: 'every week (accelerated)',
};

export const FREQUENCY_ADJECTIVE: Record<MortgagePaymentFrequency, string> = {
  monthly: 'monthly',
  semi_monthly: 'semi-monthly',
  biweekly: 'biweekly',
  weekly: 'weekly',
  accel_biweekly: 'accelerated biweekly',
  accel_weekly: 'accelerated weekly',
};

/**
 * Pure aggregations behind the Mortgage **Payments** tab.
 *
 * Every input is the BE-computed amortization schedule (cents) — these helpers
 * only BUCKET and SUM those server figures (by calendar month/year, cumulative,
 * year-to-date), never re-derive money from a rate. That keeps the tab's totals
 * identical to the engine's while letting the UI answer the questions a borrower
 * actually asks: what do I pay this year, when does principal overtake interest,
 * how much of the interest have I already burned through.
 *
 * Payment NUMBERS ("#145") are meaningless to a member, so every bucket carries
 * the calendar date its payments land on and the charts label by month/year.
 */

/** A schedule row plus the calendar date its payment lands on (`null` if undateable). */
export interface DatedScheduleRow extends MortgageScheduleRow {
  iso: string | null;
}

/** One calendar bucket (a month or a year) of scheduled payments, in cents. */
export interface PeriodBucket {
  year: number;
  /** 0–11 for a month bucket; absent on a year bucket. */
  month?: number;
  interestCents: number;
  principalCents: number;
  /** Balance after the LAST payment in the bucket. */
  endBalanceCents: number;
  /** How many scheduled payments landed in the bucket (2 for a 26×/yr February). */
  payments: number;
}

/**
 * Attach the calendar date of each payment. `paymentDateIso` mirrors the backend
 * convention exactly (payment k lands k periods after the term start), so the
 * buckets line up with the statements a member uploads.
 */
export function attachDates(
  rows: MortgageScheduleRow[],
  termStartDate: string | null | undefined,
  frequency: MortgagePaymentFrequency | null | undefined
): DatedScheduleRow[] {
  if (!termStartDate || !frequency) return rows.map((r) => ({ ...r, iso: null }));
  return rows.map((r) => ({ ...r, iso: paymentDateIso(termStartDate, r.index, frequency) }));
}

/** Sum the dated rows into one bucket per calendar year, oldest first. */
export function groupByYear(rows: DatedScheduleRow[]): PeriodBucket[] {
  const out: PeriodBucket[] = [];
  let current: PeriodBucket | null = null;
  for (const r of rows) {
    if (!r.iso) continue;
    const year = parseInt(r.iso.slice(0, 4), 10);
    if (!current || current.year !== year) {
      current = { year, interestCents: 0, principalCents: 0, endBalanceCents: r.balance, payments: 0 };
      out.push(current);
    }
    current.interestCents += r.interest;
    current.principalCents += r.principal;
    current.endBalanceCents = r.balance;
    current.payments += 1;
  }
  return out;
}

/**
 * Sum one calendar year's dated rows into month buckets (only months that carry a
 * payment). Bucketing by MONTH — not per payment — keeps the chart at ≤12 bars for
 * every cadence, so a weekly mortgage reads as clearly as a monthly one.
 */
export function groupByMonth(rows: DatedScheduleRow[], year: number): PeriodBucket[] {
  const byMonth = new Map<number, PeriodBucket>();
  for (const r of rows) {
    if (!r.iso || parseInt(r.iso.slice(0, 4), 10) !== year) continue;
    const month = parseInt(r.iso.slice(5, 7), 10) - 1;
    const existing = byMonth.get(month);
    if (existing) {
      existing.interestCents += r.interest;
      existing.principalCents += r.principal;
      existing.endBalanceCents = r.balance;
      existing.payments += 1;
    } else {
      byMonth.set(month, {
        year,
        month,
        interestCents: r.interest,
        principalCents: r.principal,
        endBalanceCents: r.balance,
        payments: 1,
      });
    }
  }
  return [...byMonth.values()].sort((a, b) => (a.month ?? 0) - (b.month ?? 0));
}

/** Years that appear in the schedule, oldest first (drives the year stepper). */
export function scheduleYears(rows: DatedScheduleRow[]): number[] {
  const seen: number[] = [];
  for (const r of rows) {
    if (!r.iso) continue;
    const year = parseInt(r.iso.slice(0, 4), 10);
    if (seen[seen.length - 1] !== year) seen.push(year);
  }
  return seen;
}

/**
 * Thin a long list of year buckets down to `maxBars` readable bars. Each surviving
 * bar is still ONE real year's total (never a merged/averaged span), and the final
 * year is always kept so the payoff is visible. `everyNth > 1` tells the caller to
 * say so in the caption — a silently sampled axis reads as "all of it".
 */
export function sampleBuckets(
  buckets: PeriodBucket[],
  maxBars: number
): { buckets: PeriodBucket[]; everyNth: number } {
  if (buckets.length <= maxBars) return { buckets, everyNth: 1 };
  const everyNth = Math.ceil(buckets.length / maxBars);
  const kept: PeriodBucket[] = [];
  for (let idx = 0; idx < buckets.length; idx += everyNth) kept.push(buckets[idx]);
  const last = buckets[buckets.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return { buckets: kept, everyNth };
}

/** `2026` → `'26` — a compact year tick that fits under a bar. */
export function shortYearLabel(year: number): string {
  return `'${String(year).slice(2)}`;
}

// prettier-ignore
const MONTH_TICKS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/** Month tick for a bar ("J" for January) — 12 bars leave no room for "Jan". */
export function monthTickLabel(month: number): string {
  return MONTH_TICKS[month] ?? '';
}

/**
 * Stacked interest-over-principal bars for a set of buckets, in dollars. Principal
 * sits at the bottom (it's the part that stays with you), interest on top — the
 * same reading order as the rest of the mortgage charts.
 */
export function buildBucketStacks(
  buckets: PeriodBucket[],
  colors: { principal: string; interest: string }
): AppBarStack[] {
  return buckets.map((b) => ({
    label: b.month != null ? monthTickLabel(b.month) : shortYearLabel(b.year),
    segments: [
      { value: Math.max(0, b.principalCents / 100), color: colors.principal },
      { value: Math.max(0, b.interestCents / 100), color: colors.interest },
    ],
  }));
}

/**
 * Fallback bars for an UNDATEABLE schedule — no term anchor or cadence, which
 * happens only when the summary fetch failed. Samples by payment index and
 * labels "#k", because inventing calendar months from nothing would be worse
 * than an honest payment number. Never the member-facing default.
 */
export function buildIndexStacks(
  rows: MortgageScheduleRow[],
  colors: { principal: string; interest: string },
  maxBars = 10
): AppBarStack[] {
  if (rows.length === 0) return [];
  const step = Math.max(1, Math.ceil(rows.length / maxBars));
  const stacks: AppBarStack[] = [];
  for (let idx = 0; idx < rows.length; idx += step) {
    stacks.push({
      label: `#${rows[idx].index}`,
      segments: [
        { value: Math.max(0, rows[idx].principal / 100), color: colors.principal },
        { value: Math.max(0, rows[idx].interest / 100), color: colors.interest },
      ],
    });
  }
  return stacks;
}

export interface CumulativeSeries {
  /** Running total interest paid at each year end, in dollars. */
  interest: AppLinePoint[];
  /** Running total principal repaid at each year end, in dollars. */
  principal: AppLinePoint[];
  /** First year where total principal repaid overtakes total interest paid. */
  crossYear: number | null;
  totalInterestCents: number;
  totalPrincipalCents: number;
}

/**
 * Running totals of interest vs principal at each year end — the "what has this
 * loan actually cost me" curve. The point where the principal line crosses above
 * the interest line is the moment the loan stops being mostly a cost.
 */
export function buildCumulativeSeries(rows: DatedScheduleRow[], maxPoints = 10): CumulativeSeries {
  const years = groupByYear(rows);
  let interest = 0;
  let principal = 0;
  let crossYear: number | null = null;
  const running = years.map((y) => {
    interest += y.interestCents;
    principal += y.principalCents;
    if (crossYear == null && principal > interest) crossYear = y.year;
    return { year: y.year, interest, principal };
  });
  const { buckets: sampled } = sampleBuckets(
    running.map((r) => ({
      year: r.year,
      interestCents: r.interest,
      principalCents: r.principal,
      endBalanceCents: 0,
      payments: 0,
    })),
    maxPoints
  );
  return {
    interest: sampled.map((s) => ({ value: s.interestCents / 100, label: shortYearLabel(s.year) })),
    principal: sampled.map((s) => ({ value: s.principalCents / 100, label: shortYearLabel(s.year) })),
    crossYear,
    totalInterestCents: interest,
    totalPrincipalCents: principal,
  };
}

export interface CrossoverInsight {
  /** 1-based payment number where principal first exceeds interest. */
  index: number;
  iso: string | null;
  reached: boolean;
  /** Payments still to go before the tipping point (0 once reached). */
  paymentsAway: number;
  interestCents: number;
  principalCents: number;
  /** Principal's share of that payment, 0–1. */
  principalShare: number;
}

/**
 * The tipping point: the first payment that puts more into principal than into
 * interest. Read straight off the BE schedule (not re-derived), so it always
 * agrees with the bars above it.
 */
export function crossoverInsight(
  rows: DatedScheduleRow[],
  paymentsElapsed: number
): CrossoverInsight | null {
  const row = rows.find((r) => r.principal > r.interest);
  if (!row) return null;
  const total = row.principal + row.interest;
  return {
    index: row.index,
    iso: row.iso,
    reached: paymentsElapsed >= row.index,
    paymentsAway: Math.max(0, row.index - paymentsElapsed),
    interestCents: row.interest,
    principalCents: row.principal,
    principalShare: total > 0 ? row.principal / total : 0,
  };
}

export interface YearInsight {
  year: number;
  /** What the plan says this calendar year costs / builds. */
  scheduledInterestCents: number;
  scheduledPrincipalCents: number;
  paymentsPlanned: number;
  /** Summed from the year's statements — `null` until one carries the figure. */
  actualInterestCents: number | null;
  actualPrincipalCents: number | null;
  statementsCount: number;
}

/**
 * This calendar year at a glance: the plan's interest/principal for the year, plus
 * the bank's own actuals from any statements uploaded for it. Members ask "what
 * has this year cost me" (and need the interest figure at tax time) — nothing else
 * in the app answers it.
 */
export function yearInsight(
  rows: DatedScheduleRow[],
  statements: MortgageStatement[],
  year: number
): YearInsight {
  const planned = groupByYear(rows).find((y) => y.year === year);
  let actualInterest: number | null = null;
  let actualPrincipal: number | null = null;
  let statementsCount = 0;
  for (const s of statements) {
    if (parseInt(s.statement_date.slice(0, 4), 10) !== year) continue;
    statementsCount += 1;
    if (s.interest_paid_cents != null) actualInterest = (actualInterest ?? 0) + s.interest_paid_cents;
    if (s.principal_paid_cents != null)
      actualPrincipal = (actualPrincipal ?? 0) + s.principal_paid_cents;
  }
  return {
    year,
    scheduledInterestCents: planned?.interestCents ?? 0,
    scheduledPrincipalCents: planned?.principalCents ?? 0,
    paymentsPlanned: planned?.payments ?? 0,
    actualInterestCents: actualInterest,
    actualPrincipalCents: actualPrincipal,
    statementsCount,
  };
}

export interface FrontLoadingInsight {
  paymentsMade: number;
  paymentsTotal: number;
  /** Share of the payments already made, 0–1. */
  paymentsFraction: number;
  /** Share of this plan's total interest already paid, 0–1 (the front-loading). */
  interestFraction: number;
  interestPaidCents: number;
  interestRemainingCents: number;
  interestTotalCents: number;
  principalPaidCents: number;
}

/**
 * How front-loaded the interest is: the share of PAYMENTS made against the share
 * of INTEREST already burned. On a fresh mortgage the second number is far bigger
 * than the first, which is the single most useful thing a borrower can be shown —
 * it's why paying extra early is worth so much more than paying extra later.
 *
 * Both figures are measured on the SAME basis (this schedule, i.e. the current
 * term's plan) so the comparison is honest.
 */
export function frontLoadingInsight(
  rows: DatedScheduleRow[],
  paymentsElapsed: number
): FrontLoadingInsight {
  const made = Math.max(0, Math.min(paymentsElapsed, rows.length));
  let interestPaid = 0;
  let principalPaid = 0;
  let interestTotal = 0;
  rows.forEach((r, idx) => {
    interestTotal += r.interest;
    if (idx < made) {
      interestPaid += r.interest;
      principalPaid += r.principal;
    }
  });
  return {
    paymentsMade: made,
    paymentsTotal: rows.length,
    paymentsFraction: rows.length > 0 ? made / rows.length : 0,
    interestFraction: interestTotal > 0 ? interestPaid / interestTotal : 0,
    interestPaidCents: interestPaid,
    interestRemainingCents: Math.max(0, interestTotal - interestPaid),
    interestTotalCents: interestTotal,
    principalPaidCents: principalPaid,
  };
}

/** Interest/principal of one payment (or one average payment), in cents. */
export interface SplitFigures {
  interestCents: number;
  principalCents: number;
  totalCents: number;
  /** Interest's share of the total, 0–1. */
  interestShare: number;
}

export interface LastPaymentSplit extends SplitFigures {
  /** `'statement'` = the bank's own figures; `'schedule'` = the plan. */
  source: 'statement' | 'schedule';
  /** Calendar anchor of the payment / statement, `YYYY-MM-DD` (null if undateable). */
  iso: string | null;
  /** Scheduled payments the figures cover — >1 when a statement period packs several in. */
  payments: number;
  /** True when nothing has been paid yet, so these are the NEXT payment's figures. */
  upcoming: boolean;
}

/**
 * The split of the payment that just happened. Prefers the bank's own numbers off
 * the newest statement that carries them (that's what the member sees on their
 * statement); falls back to the last elapsed row of the plan, and to the first
 * payment when none has been made yet.
 *
 * A statement period isn't always one payment (a monthly statement on a biweekly
 * mortgage covers two), so `payments` reports how many the figures cover — the
 * caller must not call a two-payment total "one payment".
 */
export function lastPaymentSplit(
  rows: DatedScheduleRow[],
  statements: MortgageStatement[],
  paymentsElapsed: number
): LastPaymentSplit | null {
  const fromStatement = latestStatementSplit(rows, statements);
  if (fromStatement) return fromStatement;

  if (rows.length === 0) return null;
  const made = Math.max(0, Math.min(paymentsElapsed, rows.length));
  const row = made > 0 ? rows[made - 1] : rows[0];
  return {
    ...toSplit(row.interest, row.principal),
    source: 'schedule',
    iso: row.iso,
    payments: 1,
    upcoming: made === 0,
  };
}

export interface TermAverageSplit extends SplitFigures {
  /** How many payments the average is taken over. */
  payments: number;
  fromIso: string | null;
  toIso: string | null;
  /** The totals the average came from. */
  totalInterestCents: number;
  totalPrincipalCents: number;
}

/**
 * The AVERAGE payment of the current term — the yardstick the last payment is read
 * against. Every payment shifts a little more from interest to principal, so a
 * single payment says nothing on its own; the term average does.
 *
 * The schedule runs to payoff, so rows past maturity are dropped: "the term" means
 * the term the member is actually in. Shares are taken from the term TOTALS (not
 * from the rounded averages) so the bar and the dollar figures agree.
 */
export function termAverageSplit(
  rows: DatedScheduleRow[],
  maturityDate: string | null | undefined
): TermAverageSplit | null {
  if (rows.length === 0) return null;
  const use = rowsInTerm(rows, maturityDate);
  const totalInterest = use.reduce((sum, r) => sum + r.interest, 0);
  const totalPrincipal = use.reduce((sum, r) => sum + r.principal, 0);
  const total = totalInterest + totalPrincipal;
  const avgInterest = Math.round(totalInterest / use.length);
  const avgPrincipal = Math.round(totalPrincipal / use.length);
  return {
    interestCents: avgInterest,
    principalCents: avgPrincipal,
    totalCents: avgInterest + avgPrincipal,
    interestShare: total > 0 ? totalInterest / total : 0,
    payments: use.length,
    fromIso: use[0].iso,
    toIso: use[use.length - 1].iso,
    totalInterestCents: totalInterest,
    totalPrincipalCents: totalPrincipal,
  };
}

/**
 * Rows within the current term's window (up to `maturityDate`). An undateable
 * schedule (or a maturity before the first payment) leaves nothing in the
 * window — fall back to the whole plan rather than an empty chart, same as
 * `termAverageSplit`, so a distribution built from this always agrees with
 * the average it's drilling into.
 */
export function rowsInTerm(
  rows: DatedScheduleRow[],
  maturityDate: string | null | undefined
): DatedScheduleRow[] {
  const inTerm = maturityDate ? rows.filter((r) => r.iso != null && r.iso <= maturityDate) : [];
  return inTerm.length > 0 ? inTerm : rows;
}

function toSplit(interestCents: number, principalCents: number): SplitFigures {
  const totalCents = interestCents + principalCents;
  return {
    interestCents,
    principalCents,
    totalCents,
    interestShare: totalCents > 0 ? interestCents / totalCents : 0,
  };
}

/** Newest statement that carries a usable interest/principal split, if any. */
function latestStatementSplit(
  rows: DatedScheduleRow[],
  statements: MortgageStatement[]
): LastPaymentSplit | null {
  const newestFirst = statements
    .filter((s) => Boolean(s.statement_date))
    .sort((a, b) => b.statement_date.localeCompare(a.statement_date));
  for (let idx = 0; idx < newestFirst.length; idx += 1) {
    const split = statementSplit(newestFirst[idx]);
    if (!split) continue;
    // The period is measured against the statement immediately before it (usable or
    // not) — that's the window the bank actually billed.
    const previousIso = newestFirst[idx + 1]?.statement_date ?? null;
    return {
      ...toSplit(split.interest, split.principal),
      source: 'statement',
      iso: newestFirst[idx].statement_date,
      payments: paymentsInPeriod(rows, previousIso, newestFirst[idx].statement_date),
      upcoming: false,
    };
  }
  return null;
}

/**
 * Interest + principal off one statement. Principal is taken as the bank stated it,
 * then from the balance movement, then from the payment amount — a statement that
 * gives none of the three (or an impossible negative) is skipped rather than shown.
 */
function statementSplit(s: MortgageStatement): { interest: number; principal: number } | null {
  const interest = s.interest_paid_cents;
  if (interest == null || interest < 0) return null;
  const principal =
    s.principal_paid_cents ??
    (s.opening_balance_cents != null
      ? s.opening_balance_cents - s.closing_balance_cents
      : s.payment_amount_cents != null
        ? s.payment_amount_cents - interest
        : null);
  if (principal == null || principal < 0) return null;
  return { interest, principal };
}

/** Scheduled payments falling in `(from, to]` — 1 when there's no earlier statement to bound it. */
function paymentsInPeriod(
  rows: DatedScheduleRow[],
  fromExclusiveIso: string | null,
  toInclusiveIso: string
): number {
  if (!fromExclusiveIso) return 1;
  const n = rows.filter((r) => r.iso != null && r.iso > fromExclusiveIso && r.iso <= toInclusiveIso).length;
  return Math.max(1, n);
}

/**
 * What today's balance costs in interest per DAY (Actual/365, the way variable and
 * HELOC-style products actually accrue). A daily number makes an abstract rate
 * concrete: "$47 a day" lands where "4.09%" doesn't.
 */
export function interestPerDayCents(balanceCents: number, nominalPct: number): number {
  if (balanceCents <= 0 || nominalPct <= 0) return 0;
  return Math.round((balanceCents * (nominalPct / 100)) / 365);
}

/** Interest paid per dollar borrowed — "$1 borrowed costs you $0.72". */
export function interestPerDollar(totalInterestCents: number, principalCents: number): number {
  if (principalCents <= 0) return 0;
  return totalInterestCents / principalCents;
}
