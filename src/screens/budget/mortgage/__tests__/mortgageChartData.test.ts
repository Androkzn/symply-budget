import type { MortgageScheduleRow, MortgageStatement, MortgageTerm } from '@api/mortgage';

import {
  buildInterestSeries,
  buildRateHistory,
  buildStatementRateHistory,
  buildEquitySegments,
} from '../mortgageChartData';

const row = (index: number, interest: number, principal: number): MortgageScheduleRow => ({
  index,
  interest,
  principal,
  balance: 0,
  estimated: true,
});

describe('buildInterestSeries', () => {
  it('maps interest cents to dollar points', () => {
    const pts = buildInterestSeries([row(1, 206196, 84606)], 12);
    expect(pts[0].value).toBeCloseTo(2061.96, 2);
  });
  it('returns [] for empty', () => {
    expect(buildInterestSeries([])).toEqual([]);
  });
});

describe('buildRateHistory', () => {
  it('one % point per term, ordered by sequence, labelled by year', () => {
    const terms = [
      { sequence: 2, nominal_rate_bps: 600, term_start_date: '2028-07-01' },
      { sequence: 1, nominal_rate_bps: 409, term_start_date: '2025-07-01' },
    ] as MortgageTerm[];
    const pts = buildRateHistory(terms);
    expect(pts.map((p) => p.value)).toEqual([4.09, 6]);
    expect(pts.map((p) => p.label)).toEqual(['2025', '2028']);
  });
});

describe('buildStatementRateHistory', () => {
  const stmt = (date: string, bps: number | null): MortgageStatement =>
    ({ statement_date: date, interest_rate_bps: bps } as MortgageStatement);

  it('plots the actual rate per statement, oldest first, YYYY-MM labels', () => {
    const pts = buildStatementRateHistory([
      stmt('2025-09-30', 460),
      stmt('2025-07-31', 409),
      stmt('2025-08-31', 435),
    ]);
    expect(pts.map((p) => p.value)).toEqual([4.09, 4.35, 4.6]);
    expect(pts.map((p) => p.label)).toEqual(['2025-07', '2025-08', '2025-09']);
  });

  it('drops statements with no (or zero) rate', () => {
    const pts = buildStatementRateHistory([stmt('2025-07-31', 409), stmt('2025-08-31', null), stmt('2025-09-30', 0)]);
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBe(4.09);
  });
});

describe('buildEquitySegments', () => {
  const colors = { down: '#d', paydown: '#p', appreciation: '#a' };
  it('includes the appreciation slice only when available', () => {
    const withApp = buildEquitySegments(
      { downPaymentCents: 10_000_000, paydownEquityCents: 2_000_000, appreciationEquityCents: 5_000_000, hasAppreciation: true },
      colors
    );
    expect(withApp.map((s) => s.label)).toEqual(['Down payment', 'Paydown', 'Appreciation']);
    expect(withApp[2].value).toBe(50_000);

    const noApp = buildEquitySegments(
      { downPaymentCents: 10_000_000, paydownEquityCents: 2_000_000, appreciationEquityCents: 0, hasAppreciation: false },
      colors
    );
    expect(noApp.map((s) => s.label)).toEqual(['Down payment', 'Paydown']);
  });
});
