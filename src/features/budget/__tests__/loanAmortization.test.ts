import {
  addMonthsClamped,
  buildInstallmentLoanSchedule,
  computeInstallmentLoanSummary,
  elapsedMonths,
  type LoanSummaryInput,
} from '../loan-amortization';

const baseLoan = (over: Partial<LoanSummaryInput> = {}): LoanSummaryInput => ({
  principalCents: 1_200_000, // $12,000
  rateType: 'zero',
  rateBps: 0,
  termMonths: 12,
  startDate: '2026-01-15',
  paymentCents: 100_000, // $1,000
  asOf: new Date(Date.UTC(2026, 0, 15)),
  ...over,
});

describe('elapsedMonths', () => {
  it('counts whole months only — the day of month must be reached', () => {
    expect(elapsedMonths('2026-01-15', new Date(Date.UTC(2026, 2, 14)))).toBe(1);
    expect(elapsedMonths('2026-01-15', new Date(Date.UTC(2026, 2, 15)))).toBe(2);
  });

  it('never goes negative for a loan that has not started', () => {
    expect(elapsedMonths('2026-06-01', new Date(Date.UTC(2026, 0, 1)))).toBe(0);
  });

  it('spans year boundaries', () => {
    expect(elapsedMonths('2025-11-10', new Date(Date.UTC(2026, 1, 10)))).toBe(3);
  });

  it('returns 0 for an unparseable date rather than throwing', () => {
    expect(elapsedMonths('not-a-date', new Date(Date.UTC(2026, 0, 1)))).toBe(0);
    expect(elapsedMonths('2026-13-01', new Date(Date.UTC(2026, 5, 1)))).toBe(0);
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the last day of a shorter target month', () => {
    // The documented rule: Jan 31 + 1mo is Feb 28, never Mar 3.
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('lands on Feb 29 in a leap year', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('rolls across a year boundary', () => {
    expect(addMonthsClamped('2026-08-18', 12)).toBe('2027-08-18');
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('returns null for a malformed date', () => {
    expect(addMonthsClamped('18-08-2026', 1)).toBeNull();
  });
});

describe('computeInstallmentLoanSummary — 0% BNPL plan', () => {
  it('charges no interest and pays straight-line', () => {
    const s = computeInstallmentLoanSummary(baseLoan());
    expect(s.totalInterestCents).toBe(0);
    expect(s.interestPaidToDateCents).toBe(0);
    expect(s.totalCostCents).toBe(1_200_000);
  });

  it('counts payments remaining as a plain subtraction', () => {
    const s = computeInstallmentLoanSummary(
      baseLoan({ asOf: new Date(Date.UTC(2026, 4, 15)) }) // 4 months in
    );
    expect(s.elapsedMonths).toBe(4);
    expect(s.paymentsRemaining).toBe(8);
    expect(s.currentBalanceCents).toBe(800_000);
  });

  it('never reports more elapsed months or fewer than zero payments than the term', () => {
    const s = computeInstallmentLoanSummary(
      baseLoan({ asOf: new Date(Date.UTC(2030, 0, 15)) }) // long past payoff
    );
    expect(s.elapsedMonths).toBe(12);
    expect(s.paymentsRemaining).toBe(0);
    expect(s.currentBalanceCents).toBe(0);
  });

  it('derives the payoff date from start + term, month-end clamped', () => {
    const s = computeInstallmentLoanSummary(baseLoan({ startDate: '2026-01-31', termMonths: 13 }));
    expect(s.payoffDate).toBe('2027-02-28');
  });
});

describe('computeInstallmentLoanSummary — fixed-rate loan', () => {
  const fixed = baseLoan({
    rateType: 'fixed',
    rateBps: 599, // 5.99% nominal, monthly compounding
    principalCents: 3_000_000,
    termMonths: 60,
    paymentCents: 58_000,
    asOf: new Date(Date.UTC(2026, 0, 15)),
  });

  it('accrues interest over the life of the loan', () => {
    const s = computeInstallmentLoanSummary(fixed);
    expect(s.totalInterestCents).toBeGreaterThan(0);
    expect(s.totalCostCents).toBe(3_000_000 + s.totalInterestCents);
  });

  it('reports no interest paid before the first month elapses', () => {
    const s = computeInstallmentLoanSummary(fixed);
    expect(s.elapsedMonths).toBe(0);
    expect(s.interestPaidToDateCents).toBe(0);
    expect(s.currentBalanceCents).toBe(3_000_000);
  });

  it('pays down the balance as months elapse', () => {
    const early = computeInstallmentLoanSummary({ ...fixed, asOf: new Date(Date.UTC(2026, 11, 15)) });
    const later = computeInstallmentLoanSummary({ ...fixed, asOf: new Date(Date.UTC(2028, 11, 15)) });
    expect(later.currentBalanceCents).toBeLessThan(early.currentBalanceCents);
    expect(later.interestPaidToDateCents).toBeGreaterThan(early.interestPaidToDateCents);
  });
});

describe('buildInstallmentLoanSchedule', () => {
  it('returns one row per payment in the term', () => {
    expect(buildInstallmentLoanSchedule(baseLoan())).toHaveLength(12);
  });

  it('splits a 0% plan into principal only and ends at a zero balance', () => {
    const rows = buildInstallmentLoanSchedule(baseLoan());
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    expect(rows[0].principal).toBe(100_000);
    expect(rows[rows.length - 1].balance).toBe(0);
  });

  it('reports a fixed-rate schedule in cents, with interest falling over time', () => {
    const rows = buildInstallmentLoanSchedule(
      baseLoan({
        rateType: 'fixed',
        rateBps: 599,
        principalCents: 3_000_000,
        termMonths: 60,
        paymentCents: 58_000,
      })
    );
    expect(rows).toHaveLength(60);
    expect(rows[0].interest).toBeGreaterThan(0);
    // Level payment: interest shrinks and principal grows as the balance falls.
    expect(rows[59].interest).toBeLessThan(rows[0].interest);
    expect(rows[59].principal).toBeGreaterThan(rows[0].principal);
  });
});
