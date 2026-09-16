/**
 * `estimateStartDateFromProgress` — backs a "Fill with AI" loan draft's
 * `startDate` into how many payments the statement's "Amount Paid" implies,
 * so an already-running loan (an IKEA-style BNPL plan scanned mid-plan)
 * doesn't read as 0 payments made just because the form otherwise defaults
 * `startDate` to today. See `LoanDraftSection`/`LoanInfoSection`'s `runExtract`.
 */
import { estimateStartDateFromProgress } from '../loanShared';

const TODAY = new Date('2026-08-03T12:00:00Z');

describe('estimateStartDateFromProgress', () => {
  it('backs into a startDate N whole months ago when amount paid divides evenly by the monthly payment', () => {
    // 6 payments of $379.21 = $2275.26.
    const result = estimateStartDateFromProgress(227_526, 37_921, 24, TODAY);
    expect(result).toBe('2026-02-03');
  });

  it('rounds to the nearest whole payment rather than flooring', () => {
    // 250_279 / 37_921 ≈ 6.6 payments — rounds UP to 7, not floored to 6.
    const result = estimateStartDateFromProgress(250_279, 37_921, 60, TODAY);
    expect(result).toBe('2026-01-03');
  });

  it('clamps the estimate so it never reaches or passes the final payment', () => {
    // amountPaid implies ~24 payments on a 24-month term — clamp to 23.
    const result = estimateStartDateFromProgress(910_089, 37_921, 24, TODAY);
    expect(result).toBe('2024-09-03');
  });

  it('returns null when nothing has been paid yet — today stays correct', () => {
    expect(estimateStartDateFromProgress(0, 37_921, 24, TODAY)).toBeNull();
    expect(estimateStartDateFromProgress(null, 37_921, 24, TODAY)).toBeNull();
  });

  it('returns null when there is no monthly payment to divide by', () => {
    expect(estimateStartDateFromProgress(240_000, null, 24, TODAY)).toBeNull();
    expect(estimateStartDateFromProgress(240_000, 0, 24, TODAY)).toBeNull();
  });

  it('still estimates without a term (just skips the final-payment clamp)', () => {
    const result = estimateStartDateFromProgress(227_526, 37_921, null, TODAY);
    expect(result).toBe('2026-02-03');
  });
});
