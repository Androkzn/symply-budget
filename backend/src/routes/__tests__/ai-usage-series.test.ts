/**
 * Per-day series for the AI-usage report.
 *
 * `GROUP BY day` only returns days that had traffic, so a period with four
 * scattered calls came back as four rows and the client plotted them as four
 * adjacent bars — three weeks of silence rendered as steady daily spend.
 * `fillDailySeries` is what makes the chart's x-axis a calendar.
 */
import { describe, it, expect } from 'vitest';

import { fillDailySeries } from '../ai-usage';

const row = (date: string, costUsd: number) => ({ date, requests: 1, tokens: 100, costUsd });

describe('fillDailySeries', () => {
  it('emits one bucket per calendar day, zero-filling the gaps', () => {
    const out = fillDailySeries([row('2026-09-01', 0.02)], '2026-08-30', '2026-09-02');

    expect(out.map((d) => d.date)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
    expect(out.map((d) => d.costUsd)).toEqual([0, 0, 0.02, 0]);
    expect(out.filter((d) => d.requests === 0)).toHaveLength(3);
  });

  it('keeps the real buckets intact and in order', () => {
    const out = fillDailySeries(
      [row('2026-09-03', 0.5), row('2026-09-01', 0.25)],
      '2026-09-01',
      '2026-09-03'
    );

    expect(out).toEqual([
      { date: '2026-09-01', requests: 1, tokens: 100, costUsd: 0.25 },
      { date: '2026-09-02', requests: 0, tokens: 0, costUsd: 0 },
      { date: '2026-09-03', requests: 1, tokens: 100, costUsd: 0.5 },
    ]);
  });

  it('spans a month boundary and a leap day without drifting', () => {
    const out = fillDailySeries([], '2028-02-27', '2028-03-01');

    expect(out.map((d) => d.date)).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
  });

  it('covers a full 90-day period', () => {
    const out = fillDailySeries([row('2026-09-03', 1)], '2026-06-06', '2026-09-03');

    expect(out).toHaveLength(90);
    expect(out[0].date).toBe('2026-06-06');
    expect(out[89]).toEqual({ date: '2026-09-03', requests: 1, tokens: 100, costUsd: 1 });
  });

  it('never drops a row that falls outside the bounds', () => {
    // Shouldn't happen once the window is whole days, but a bucket counted in
    // `totals` and missing from `byDay` would read as a reporting bug.
    const out = fillDailySeries([row('2026-08-01', 0.1)], '2026-09-01', '2026-09-02');

    expect(out.map((d) => d.date)).toEqual(['2026-08-01', '2026-09-01', '2026-09-02']);
  });

  it('returns the rows unpadded when the bounds are missing', () => {
    // Defensive: a failed bounds query must not hang the request in `nextDay`.
    expect(fillDailySeries([row('2026-09-01', 0.1)], '', '')).toEqual([
      { date: '2026-09-01', requests: 1, tokens: 100, costUsd: 0.1 },
    ]);
  });

  it('stops at the cap instead of iterating an inverted range forever', () => {
    expect(fillDailySeries([], '2026-09-02', '2026-09-01')).toEqual([]);
    expect(fillDailySeries([], '2026-01-01', '2030-01-01', 5)).toHaveLength(5);
  });
});
