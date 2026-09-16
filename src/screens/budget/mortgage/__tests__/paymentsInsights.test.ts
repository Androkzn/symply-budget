/**
 * Payments-tab aggregations (MORT-262..270). These helpers only BUCKET the
 * BE-computed schedule — so the assertions here are about calendar bucketing,
 * sampling honesty and the insight thresholds, never about re-deriving money.
 *
 * Fixtures: a real 25-year monthly schedule from the client engine mirror (the
 * same formulas the server uses), converted to cents the way the route does.
 */
import type { MortgagePaymentFrequency, MortgageScheduleRow, MortgageStatement } from '@api/mortgage';
import { buildSchedule } from '@features/mortgage/amortization';

import {
  attachDates,
  buildBucketStacks,
  buildCumulativeSeries,
  buildIndexStacks,
  crossoverInsight,
  FREQUENCY_ADJECTIVE,
  FREQUENCY_LABEL,
  frontLoadingInsight,
  groupByMonth,
  groupByYear,
  interestPerDayCents,
  interestPerDollar,
  lastPaymentSplit,
  monthTickLabel,
  rowsInTerm,
  sampleBuckets,
  scheduleYears,
  shortYearLabel,
  termAverageSplit,
  yearInsight,
  type PeriodBucket,
} from '../paymentsInsights';

const TERM_START = '2026-07-01';

/** The engine's dollars → the route's cents (what the FE actually receives). */
function toCentsRows(rows: ReturnType<typeof buildSchedule>): MortgageScheduleRow[] {
  return rows.map((r) => ({
    index: r.index,
    interest: Math.round(r.interest * 100),
    principal: Math.round(r.principal * 100),
    balance: Math.round(r.balance * 100),
    estimated: true,
  }));
}

/** $500k at 5% over 25 years, monthly — 300 rows. */
const REAL_ROWS = toCentsRows(
  buildSchedule({
    principal: 500_000,
    nominalAnnual: 0.05,
    frequency: 'monthly',
    compounding: 'semi_annual',
    amortizationMonths: 300,
  })
);

/** Hand-built rows so a bucketing assertion has round, obvious numbers. */
function simpleRows(count: number): MortgageScheduleRow[] {
  return Array.from({ length: count }, (_, idx) => ({
    index: idx + 1,
    interest: 100_00,
    principal: 50_00,
    balance: 1_000_000_00 - (idx + 1) * 50_00,
    estimated: true,
  }));
}

describe('attachDates', () => {
  it('dates payment k one period after the term start (backend convention)', () => {
    const rows = attachDates(simpleRows(3), TERM_START, 'monthly');
    expect(rows.map((r) => r.iso?.slice(0, 7))).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('leaves rows undated when the term anchor or cadence is unknown', () => {
    expect(attachDates(simpleRows(2), null, 'monthly').every((r) => r.iso === null)).toBe(true);
    expect(attachDates(simpleRows(2), TERM_START, null).every((r) => r.iso === null)).toBe(true);
    // …and an undated schedule yields no calendar buckets at all.
    expect(groupByYear(attachDates(simpleRows(2), null, null))).toEqual([]);
    expect(scheduleYears(attachDates(simpleRows(2), null, null))).toEqual([]);
  });
});

describe('groupByYear', () => {
  it('sums each calendar year and carries the year-end balance', () => {
    // 14 monthly payments from Aug 2026 → 5 in 2026, 9 in 2027.
    const rows = attachDates(simpleRows(14), TERM_START, 'monthly');
    const years = groupByYear(rows);
    expect(years.map((y) => [y.year, y.payments])).toEqual([
      [2026, 5],
      [2027, 9],
    ]);
    expect(years[0].interestCents).toBe(5 * 100_00);
    expect(years[0].principalCents).toBe(5 * 50_00);
    // Year-end balance is the LAST payment's balance, not the first.
    expect(years[0].endBalanceCents).toBe(rows[4].balance);
    expect(years[1].endBalanceCents).toBe(rows[13].balance);
  });

  it('lists the schedule years in order for the year stepper', () => {
    // 30 monthly payments from Aug 2026 spill into Jan 2029.
    expect(scheduleYears(attachDates(simpleRows(30), TERM_START, 'monthly'))).toEqual([
      2026, 2027, 2028, 2029,
    ]);
  });
});

describe('groupByMonth', () => {
  it('keeps one bucket per month for the chosen year', () => {
    const rows = attachDates(simpleRows(14), TERM_START, 'monthly');
    const buckets = groupByMonth(rows, 2026);
    expect(buckets.map((b) => b.month)).toEqual([7, 8, 9, 10, 11]); // Aug–Dec
    expect(buckets.every((b) => b.payments === 1)).toBe(true);
  });

  it('folds a 26×/yr cadence into ≤12 month bars (2–3 payments per bucket)', () => {
    const rows = attachDates(simpleRows(40), TERM_START, 'biweekly');
    const buckets = groupByMonth(rows, 2027);
    expect(buckets.length).toBeLessThanOrEqual(12);
    expect(buckets.some((b) => b.payments >= 2)).toBe(true);
    // A folded bucket sums its payments rather than showing just one of them.
    const multi = buckets.find((b) => b.payments >= 2)!;
    expect(multi.interestCents).toBe(multi.payments * 100_00);
  });

  it('returns nothing for a year with no scheduled payment', () => {
    expect(groupByMonth(attachDates(simpleRows(3), TERM_START, 'monthly'), 2035)).toEqual([]);
  });
});

describe('sampleBuckets', () => {
  const many: PeriodBucket[] = Array.from({ length: 25 }, (_, i) => ({
    year: 2026 + i,
    interestCents: 1,
    principalCents: 1,
    endBalanceCents: 0,
    payments: 12,
  }));

  it('passes short lists through untouched', () => {
    const short = many.slice(0, 8);
    expect(sampleBuckets(short, 12)).toEqual({ buckets: short, everyNth: 1 });
  });

  it('thins a long list but always keeps the first and the payoff year', () => {
    const { buckets, everyNth } = sampleBuckets(many, 12);
    expect(everyNth).toBe(3);
    expect(buckets.length).toBeLessThanOrEqual(12);
    expect(buckets[0].year).toBe(2026);
    expect(buckets[buckets.length - 1].year).toBe(2050);
    // Every surviving bar is still ONE real year (never a merged span).
    expect(buckets.every((b) => many.some((m) => m.year === b.year))).toBe(true);
  });
});

describe('buildBucketStacks', () => {
  it('stacks principal under interest, in dollars, with calendar labels', () => {
    const rows = attachDates(simpleRows(14), TERM_START, 'monthly');
    const yearly = buildBucketStacks(groupByYear(rows), { principal: 'teal', interest: 'orange' });
    expect(yearly[0].label).toBe("'26");
    expect(yearly[0].segments).toEqual([
      { value: 250, color: 'teal' }, // 5 × $50
      { value: 500, color: 'orange' }, // 5 × $100
    ]);

    const monthly = buildBucketStacks(groupByMonth(rows, 2026), { principal: 'teal', interest: 'orange' });
    expect(monthly.map((s) => s.label)).toEqual(['A', 'S', 'O', 'N', 'D']);
  });

  it('falls back to payment-indexed bars only when the rows cannot be dated', () => {
    const undated = attachDates(simpleRows(30), null, null);
    const stacks = buildIndexStacks(undated, { principal: 'teal', interest: 'orange' }, 10);
    expect(stacks.length).toBeLessThanOrEqual(10);
    expect(stacks[0].label).toBe('#1');
    expect(stacks[0].segments[0]).toEqual({ value: 50, color: 'teal' });
    expect(buildIndexStacks([], { principal: 'teal', interest: 'orange' })).toEqual([]);
  });

  it('labels years and months compactly', () => {
    expect(shortYearLabel(2031)).toBe("'31");
    expect(monthTickLabel(0)).toBe('J');
    expect(monthTickLabel(11)).toBe('D');
    expect(monthTickLabel(99)).toBe('');
  });
});

describe('buildCumulativeSeries', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  it('runs both totals to payoff and finds where principal overtakes interest', () => {
    const cum = buildCumulativeSeries(rows, 10);
    expect(cum.interest.length).toBe(cum.principal.length);
    expect(cum.interest.length).toBeLessThanOrEqual(11); // sampled + payoff year
    // Both series are monotonic running totals.
    expect(cum.interest.every((p, i, a) => i === 0 || p.value >= a[i - 1].value)).toBe(true);
    expect(cum.principal.every((p, i, a) => i === 0 || p.value >= a[i - 1].value)).toBe(true);
    // Total principal repaid over the plan == the loan (the engine rounds each
    // row to the cent, so a few cents of rounding across 300 rows is expected).
    expect(cum.totalPrincipalCents).toBeGreaterThanOrEqual(500_000_00 - 100);
    expect(cum.totalPrincipalCents).toBeLessThanOrEqual(500_000_00 + 100);
    expect(cum.totalInterestCents).toBeGreaterThan(300_000_00);
    // On a 25y/5% loan the totals cross in the back half, not the first years.
    expect(cum.crossYear).not.toBeNull();
    expect(cum.crossYear!).toBeGreaterThan(2035);
  });

  it('reports no crossing when interest always outruns principal', () => {
    // Every payment is 2/3 interest, so the running totals never cross.
    const cum = buildCumulativeSeries(attachDates(simpleRows(24), TERM_START, 'monthly'), 10);
    expect(cum.crossYear).toBeNull();
  });
});

describe('crossoverInsight', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  it('reads the tipping payment off the schedule and dates it', () => {
    const c = crossoverInsight(rows, 0)!;
    expect(c.principalCents).toBeGreaterThan(c.interestCents);
    // The payment BEFORE it must still be interest-heavy (it is the first flip).
    expect(REAL_ROWS[c.index - 2].principal).toBeLessThanOrEqual(REAL_ROWS[c.index - 2].interest);
    expect(c.reached).toBe(false);
    expect(c.paymentsAway).toBe(c.index);
    expect(c.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.principalShare).toBeGreaterThan(0.5);
  });

  it('flips to reached once enough payments have been made', () => {
    const c = crossoverInsight(rows, 300)!;
    expect(c.reached).toBe(true);
    expect(c.paymentsAway).toBe(0);
  });

  it('returns null when no payment ever puts principal ahead', () => {
    expect(crossoverInsight(attachDates(simpleRows(5), TERM_START, 'monthly'), 0)).toBeNull();
  });
});

describe('yearInsight', () => {
  const rows = attachDates(simpleRows(14), TERM_START, 'monthly');

  function stmt(date: string, interest: number | null, principal: number | null): MortgageStatement {
    return {
      id: `s-${date}`,
      mortgage_id: 'm-1',
      statement_date: date,
      closing_balance_cents: 1_000_000_00,
      opening_balance_cents: null,
      interest_paid_cents: interest,
      principal_paid_cents: principal,
      payment_amount_cents: null,
      interest_rate_bps: null,
      prime_rate_bps: null,
      variance_bps: null,
      source: 'manual',
      created_at: date,
    };
  }

  it('reports the plan for the year when no statement carries figures', () => {
    const y = yearInsight(rows, [], 2026);
    expect(y.paymentsPlanned).toBe(5);
    expect(y.scheduledInterestCents).toBe(5 * 100_00);
    expect(y.actualInterestCents).toBeNull();
    expect(y.actualPrincipalCents).toBeNull();
  });

  it("sums the bank's own figures for that year only", () => {
    const y = yearInsight(
      rows,
      [stmt('2026-09-01', 98_00, 52_00), stmt('2026-10-01', 97_00, 53_00), stmt('2027-02-01', 90_00, 60_00)],
      2026
    );
    expect(y.statementsCount).toBe(2);
    expect(y.actualInterestCents).toBe(195_00);
    expect(y.actualPrincipalCents).toBe(105_00);
    // The plan stays alongside the actuals for comparison.
    expect(y.scheduledInterestCents).toBe(500_00);
  });

  it('counts a statement with no interest figure but keeps the actual null', () => {
    const y = yearInsight(rows, [stmt('2026-09-01', null, null)], 2026);
    expect(y.statementsCount).toBe(1);
    expect(y.actualInterestCents).toBeNull();
  });
});

describe('frontLoadingInsight', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  it('shows interest burning down faster than the payment count', () => {
    const f = frontLoadingInsight(rows, 60); // 5 of 25 years in
    expect(f.paymentsMade).toBe(60);
    expect(f.paymentsFraction).toBeCloseTo(0.2, 5);
    // The whole point: 20% of the payments have burned MUCH more than 20% of
    // the interest.
    expect(f.interestFraction).toBeGreaterThan(0.3);
    expect(f.interestPaidCents + f.interestRemainingCents).toBe(f.interestTotalCents);
    expect(f.principalPaidCents).toBeGreaterThan(0);
  });

  it('is all-zero on a brand-new mortgage and clamps an over-long elapsed count', () => {
    expect(frontLoadingInsight(rows, 0).interestFraction).toBe(0);
    expect(frontLoadingInsight(rows, 0).paymentsMade).toBe(0);
    const done = frontLoadingInsight(rows, 9999);
    expect(done.paymentsMade).toBe(rows.length);
    expect(done.interestFraction).toBe(1);
    expect(done.interestRemainingCents).toBe(0);
  });

  it('degrades safely on an empty schedule', () => {
    const f = frontLoadingInsight([], 12);
    expect(f).toMatchObject({ paymentsMade: 0, paymentsFraction: 0, interestFraction: 0 });
  });
});

describe('cost-per-unit helpers', () => {
  it('turns a balance + rate into a daily interest cost', () => {
    // $472,000 at 4.09% → $52.89/day (Actual/365).
    expect(interestPerDayCents(472_000_00, 4.09)).toBe(5289);
    expect(interestPerDayCents(0, 4.09)).toBe(0);
    expect(interestPerDayCents(472_000_00, 0)).toBe(0);
  });

  it('expresses lifetime interest per dollar borrowed', () => {
    expect(interestPerDollar(360_000_00, 500_000_00)).toBeCloseTo(0.72, 5);
    expect(interestPerDollar(1, 0)).toBe(0);
  });
});

describe('lastPaymentSplit', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  /** A statement carrying whatever figures the case under test needs. */
  function statement(over: Partial<MortgageStatement> & { statement_date: string }): MortgageStatement {
    return {
      id: `s-${over.statement_date}`,
      mortgage_id: 'm-1',
      closing_balance_cents: 499_150_00,
      opening_balance_cents: null,
      interest_paid_cents: null,
      principal_paid_cents: null,
      payment_amount_cents: null,
      interest_rate_bps: null,
      prime_rate_bps: null,
      variance_bps: null,
      source: 'manual',
      created_at: over.statement_date,
      ...over,
    };
  }

  it("prefers the bank's own figures from the newest statement", () => {
    const last = lastPaymentSplit(
      rows,
      [
        statement({ statement_date: '2026-09-01', interest_paid_cents: 190_00, principal_paid_cents: 110_00 }),
        statement({ statement_date: '2026-11-01', interest_paid_cents: 180_00, principal_paid_cents: 120_00 }),
      ],
      4
    )!;
    expect(last.source).toBe('statement');
    expect(last.iso).toBe('2026-11-01');
    expect(last.interestCents).toBe(180_00);
    expect(last.principalCents).toBe(120_00);
    expect(last.totalCents).toBe(300_00);
    expect(last.interestShare).toBeCloseTo(0.6, 5);
    expect(last.upcoming).toBe(false);
  });

  it('derives principal from the balance movement when the bank only states interest', () => {
    const last = lastPaymentSplit(
      rows,
      [
        statement({
          statement_date: '2026-09-01',
          interest_paid_cents: 200_00,
          opening_balance_cents: 500_000_00,
          closing_balance_cents: 499_150_00,
        }),
      ],
      2
    )!;
    expect(last.source).toBe('statement');
    expect(last.principalCents).toBe(850_00);
  });

  it('falls back to the payment amount, then skips a statement it cannot split', () => {
    const fromPayment = lastPaymentSplit(
      rows,
      [statement({ statement_date: '2026-09-01', interest_paid_cents: 200_00, payment_amount_cents: 290_00 })],
      2
    )!;
    expect(fromPayment.principalCents).toBe(90_00);

    // Newest carries nothing usable → the older statement wins, not the plan.
    const skipped = lastPaymentSplit(
      rows,
      [
        statement({ statement_date: '2026-10-01' }),
        statement({ statement_date: '2026-09-01', interest_paid_cents: 200_00, principal_paid_cents: 90_00 }),
      ],
      3
    )!;
    expect(skipped.source).toBe('statement');
    expect(skipped.iso).toBe('2026-09-01');
  });

  it('reports how many payments a statement period covered', () => {
    // Biweekly payments, monthly statements → the period holds two payments, so
    // its total must not be read as one payment.
    const biweekly = attachDates(simpleRows(30), TERM_START, 'biweekly');
    const last = lastPaymentSplit(
      biweekly,
      [
        statement({ statement_date: '2026-08-01', interest_paid_cents: 200_00, principal_paid_cents: 100_00 }),
        statement({ statement_date: '2026-09-01', interest_paid_cents: 200_00, principal_paid_cents: 100_00 }),
      ],
      6
    )!;
    expect(last.payments).toBe(2);
  });

  it('falls back to the last elapsed row of the plan when no statement can be split', () => {
    const last = lastPaymentSplit(rows, [statement({ statement_date: '2026-09-01' })], 12)!;
    expect(last.source).toBe('schedule');
    expect(last.interestCents).toBe(rows[11].interest);
    expect(last.principalCents).toBe(rows[11].principal);
    expect(last.iso).toBe(rows[11].iso);
    expect(last.payments).toBe(1);
    expect(last.upcoming).toBe(false);
  });

  it('shows the upcoming first payment on a brand-new mortgage', () => {
    const last = lastPaymentSplit(rows, [], 0)!;
    expect(last.upcoming).toBe(true);
    expect(last.interestCents).toBe(rows[0].interest);
  });

  it('clamps an over-long elapsed count and returns null with nothing to show', () => {
    expect(lastPaymentSplit(rows, [], 9999)!.iso).toBe(rows[rows.length - 1].iso);
    expect(lastPaymentSplit([], [], 4)).toBeNull();
  });
});

describe('termAverageSplit', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  it('averages only the payments inside the term, not the whole 25-year plan', () => {
    // Term start 2026-07-01 → payments land Aug 2026 … Jul 2031 = 60 payments.
    const avg = termAverageSplit(rows, '2031-07-01')!;
    expect(avg.payments).toBe(60);
    expect(avg.fromIso).toBe('2026-08-01');
    expect(avg.toIso).toBe('2031-07-01');
    expect(avg.interestCents).toBe(Math.round(avg.totalInterestCents / 60));
    expect(avg.principalCents).toBe(Math.round(avg.totalPrincipalCents / 60));

    // The average sits between the first and last payment of the term — every
    // payment moves a little more of the money from interest into equity.
    const firstShare = rows[0].interest / (rows[0].interest + rows[0].principal);
    const lastShare = rows[59].interest / (rows[59].interest + rows[59].principal);
    expect(avg.interestShare).toBeLessThan(firstShare);
    expect(avg.interestShare).toBeGreaterThan(lastShare);
  });

  it('averages the whole plan when the rows carry no dates', () => {
    const undated = attachDates(simpleRows(10), null, null);
    const avg = termAverageSplit(undated, '2031-07-01')!;
    expect(avg.payments).toBe(10);
    expect(avg.interestCents).toBe(100_00);
    expect(avg.principalCents).toBe(50_00);
    expect(avg.fromIso).toBeNull();
  });

  it('degrades safely on an empty schedule', () => {
    expect(termAverageSplit([], '2031-07-01')).toBeNull();
  });
});

describe('rowsInTerm', () => {
  const rows = attachDates(REAL_ROWS, TERM_START, 'monthly');

  it('keeps only the rows up to the term maturity date', () => {
    const inTerm = rowsInTerm(rows, '2031-07-01');
    expect(inTerm.length).toBe(60);
    expect(inTerm[0].iso).toBe('2026-08-01');
    expect(inTerm[inTerm.length - 1].iso).toBe('2031-07-01');
  });

  it('falls back to the whole plan when nothing falls inside the window', () => {
    const undated = attachDates(simpleRows(10), null, null);
    expect(rowsInTerm(undated, '2031-07-01')).toBe(undated);
  });

  it('falls back to the whole plan when there is no maturity date', () => {
    expect(rowsInTerm(rows, null)).toBe(rows);
  });
});

describe('FREQUENCY_LABEL / FREQUENCY_ADJECTIVE', () => {
  const frequencies: MortgagePaymentFrequency[] = [
    'monthly',
    'semi_monthly',
    'biweekly',
    'weekly',
    'accel_biweekly',
    'accel_weekly',
  ];

  it('names every cadence in both a trailing-clause and a leading-adjective form', () => {
    frequencies.forEach((frequency) => {
      expect(FREQUENCY_LABEL[frequency]).toBeTruthy();
      expect(FREQUENCY_ADJECTIVE[frequency]).toBeTruthy();
    });
  });

  it('never lets a biweekly/weekly cadence read as monthly', () => {
    expect(FREQUENCY_LABEL.biweekly).not.toContain('month');
    expect(FREQUENCY_ADJECTIVE.biweekly).toBe('biweekly');
    expect(FREQUENCY_LABEL.weekly).not.toContain('month');
    expect(FREQUENCY_ADJECTIVE.weekly).toBe('weekly');
  });
});
