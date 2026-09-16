import { describe, it, expect } from 'vitest';

import { levelPayment, periodicRate } from '../../mortgage/amortization';
import {
  computeInstallmentLoanSummary,
  buildInstallmentLoanSchedule,
  elapsedMonths,
  addMonthsClamped,
} from '../loan-amortization';

describe('elapsedMonths', () => {
  it('is 0 the day the loan starts', () => {
    expect(elapsedMonths('2026-01-15', new Date(Date.UTC(2026, 0, 15)))).toBe(0);
  });

  it('counts whole months, flooring a partial month', () => {
    // 2026-01-15 → 2026-07-10 is 5 full months + 26 days (day-of-month hasn't hit yet).
    expect(elapsedMonths('2026-01-15', new Date(Date.UTC(2026, 6, 10)))).toBe(5);
    // 2026-01-15 → 2026-07-15 is exactly 6 months.
    expect(elapsedMonths('2026-01-15', new Date(Date.UTC(2026, 6, 15)))).toBe(6);
  });

  it('never goes negative for a future start date', () => {
    expect(elapsedMonths('2099-01-01', new Date(Date.UTC(2026, 0, 1)))).toBe(0);
  });
});

describe('addMonthsClamped', () => {
  it('clamps to the target month-end (Jan 31 + 1mo → Feb 28)', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('adds a full term in months', () => {
    expect(addMonthsClamped('2026-01-15', 36)).toBe('2029-01-15');
  });
});

describe('computeInstallmentLoanSummary — 0% BNPL plan', () => {
  // $1,200 IKEA-style plan, 12 equal payments of $100, no interest.
  const base = {
    principalCents: 120_000,
    rateType: 'zero' as const,
    rateBps: 0,
    termMonths: 12,
    startDate: '2026-01-15',
    paymentCents: 10_000,
  };

  it('charges zero interest regardless of elapsed time', () => {
    const halfway = computeInstallmentLoanSummary({ ...base, asOf: new Date(Date.UTC(2026, 6, 15)) });
    expect(halfway.elapsedMonths).toBe(6);
    expect(halfway.paymentsRemaining).toBe(6);
    expect(halfway.currentBalanceCents).toBe(60_000);
    expect(halfway.interestPaidToDateCents).toBe(0);
    expect(halfway.totalInterestCents).toBe(0);
    expect(halfway.totalCostCents).toBe(120_000);
  });

  it('reaches 0 payments remaining and 0 balance at term', () => {
    const done = computeInstallmentLoanSummary({ ...base, asOf: new Date(Date.UTC(2027, 0, 15)) });
    expect(done.paymentsRemaining).toBe(0);
    expect(done.currentBalanceCents).toBe(0);
  });

  it('never reports more elapsed months than the term, even long after payoff', () => {
    const wayLater = computeInstallmentLoanSummary({ ...base, asOf: new Date(Date.UTC(2030, 0, 15)) });
    expect(wayLater.elapsedMonths).toBe(12);
    expect(wayLater.paymentsRemaining).toBe(0);
  });
});

describe('computeInstallmentLoanSummary — fixed-rate car loan', () => {
  it('total interest matches the closed-form level-payment formula', () => {
    const principalCents = 1_800_000; // $18,000
    const termMonths = 60;
    const rateBps = 649; // 6.49% APR
    const i = periodicRate(rateBps / 10_000, 12, 'monthly');
    const pmt = Math.round(levelPayment(principalCents, i, termMonths));

    const summary = computeInstallmentLoanSummary({
      principalCents,
      rateType: 'fixed',
      rateBps,
      termMonths,
      startDate: '2024-01-15',
      paymentCents: pmt,
      asOf: new Date(Date.UTC(2029, 0, 15)), // full term elapsed
    });

    expect(summary.paymentsRemaining).toBe(0);
    // pmt*N − P is the textbook total interest for a level-payment loan;
    // rounding pmt to whole cents introduces at most a few cents of drift.
    expect(summary.totalInterestCents).toBeCloseTo(pmt * termMonths - principalCents, -1);
    expect(summary.totalCostCents).toBe(principalCents + summary.totalInterestCents);
  });

  it('interest paid to date grows and balance shrinks partway through', () => {
    const principalCents = 1_800_000;
    const termMonths = 60;
    const rateBps = 649;
    const i = periodicRate(rateBps / 10_000, 12, 'monthly');
    const pmt = Math.round(levelPayment(principalCents, i, termMonths));

    const partway = computeInstallmentLoanSummary({
      principalCents,
      rateType: 'fixed',
      rateBps,
      termMonths,
      startDate: '2024-01-15',
      paymentCents: pmt,
      asOf: new Date(Date.UTC(2026, 0, 15)), // 24 months elapsed
    });

    expect(partway.elapsedMonths).toBe(24);
    expect(partway.paymentsRemaining).toBe(36);
    expect(partway.interestPaidToDateCents).toBeGreaterThan(0);
    expect(partway.interestPaidToDateCents).toBeLessThan(partway.totalInterestCents);
    expect(partway.currentBalanceCents).toBeGreaterThan(0);
    expect(partway.currentBalanceCents).toBeLessThan(principalCents);
  });
});

describe('buildInstallmentLoanSchedule', () => {
  it('produces exactly termMonths rows, ending at a 0 balance', () => {
    const principalCents = 1_800_000;
    const termMonths = 60;
    const rateBps = 649;
    const i = periodicRate(rateBps / 10_000, 12, 'monthly');
    const pmt = Math.round(levelPayment(principalCents, i, termMonths));

    const rows = buildInstallmentLoanSchedule({
      principalCents,
      rateType: 'fixed',
      rateBps,
      termMonths,
      startDate: '2024-01-15',
      paymentCents: pmt,
    });

    expect(rows).toHaveLength(termMonths);
    expect(rows[rows.length - 1].balance).toBe(0);
    // Balances are non-increasing throughout the schedule.
    for (let k = 1; k < rows.length; k++) {
      expect(rows[k].balance).toBeLessThanOrEqual(rows[k - 1].balance);
    }
  });

  it('sums principal across all rows to ~principalCents, within a few cents rounding tolerance', () => {
    const principalCents = 1_800_000;
    const termMonths = 60;
    const rateBps = 649;
    const i = periodicRate(rateBps / 10_000, 12, 'monthly');
    const pmt = Math.round(levelPayment(principalCents, i, termMonths));

    const rows = buildInstallmentLoanSchedule({
      principalCents,
      rateType: 'fixed',
      rateBps,
      termMonths,
      startDate: '2024-01-15',
      paymentCents: pmt,
    });

    const totalPrincipal = rows.reduce((sum, r) => sum + r.principal, 0);
    // Each row's interest/principal split rounds independently to the nearest
    // cent, so the sum can drift by a few cents over a long term — bounded by
    // termMonths (worst case ~0.5c bias per row).
    expect(Math.abs(totalPrincipal - principalCents)).toBeLessThanOrEqual(termMonths);
  });

  it('a zero-rate loan has zero interest on every row', () => {
    const rows = buildInstallmentLoanSchedule({
      principalCents: 120_000,
      rateType: 'zero',
      rateBps: 0,
      termMonths: 12,
      startDate: '2026-01-15',
      paymentCents: 10_000,
    });

    expect(rows).toHaveLength(12);
    for (const r of rows) expect(r.interest).toBe(0);
    expect(rows[rows.length - 1].balance).toBe(0);
  });

  it('cross-checks total interest/principal against computeInstallmentLoanSummary for the same input', () => {
    const principalCents = 1_800_000;
    const termMonths = 60;
    const rateBps = 649;
    const i = periodicRate(rateBps / 10_000, 12, 'monthly');
    const pmt = Math.round(levelPayment(principalCents, i, termMonths));

    const input = {
      principalCents,
      rateType: 'fixed' as const,
      rateBps,
      termMonths,
      startDate: '2024-01-15',
      paymentCents: pmt,
      asOf: new Date(Date.UTC(2029, 0, 15)), // full term elapsed
    };

    const rows = buildInstallmentLoanSchedule(input);
    const summary = computeInstallmentLoanSummary(input);

    const totalInterest = rows.reduce((sum, r) => sum + r.interest, 0);
    const totalPrincipal = rows.reduce((sum, r) => sum + r.principal, 0);

    // Both derivations round independently (per-row vs. closed-form), so allow
    // a small cent-level tolerance rather than requiring bit-for-bit equality.
    expect(Math.abs(totalInterest - summary.totalInterestCents)).toBeLessThanOrEqual(termMonths);
    expect(Math.abs(totalPrincipal - principalCents)).toBeLessThanOrEqual(termMonths);
  });

  it('cross-checks a 0% loan too — both must agree on zero interest', () => {
    const input = {
      principalCents: 120_000,
      rateType: 'zero' as const,
      rateBps: 0,
      termMonths: 12,
      startDate: '2026-01-15',
      paymentCents: 10_000,
      asOf: new Date(Date.UTC(2027, 0, 15)),
    };

    const rows = buildInstallmentLoanSchedule(input);
    const summary = computeInstallmentLoanSummary(input);

    const totalInterest = rows.reduce((sum, r) => sum + r.interest, 0);
    expect(totalInterest).toBe(0);
    expect(summary.totalInterestCents).toBe(0);
  });
});
