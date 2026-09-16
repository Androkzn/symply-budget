import { computeDailyCoreStreak } from '../streak';

import { getFakeDb, resetFakeDb } from './helpers/fakeSqlite';


jest.mock('../database', () => ({
  getKaizenDatabase: async () => require('./helpers/fakeSqlite').getFakeDb(),
}));

/** UTC YYYY-MM-DD offset from today. */
function isoDaysAgo(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

function log(date: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `log-${date}-${Math.random()}`,
    user_id: 'u1',
    action_id: 'a1',
    date,
    completed_at: `${date}T09:00:00.000Z`,
    skipped: 0,
    deleted_at: null,
    ...extra,
  };
}

describe('computeDailyCoreStreak', () => {
  beforeEach(() => resetFakeDb());

  it('returns 0 when there are no logs', async () => {
    expect(await computeDailyCoreStreak('u1')).toBe(0);
  });

  it('counts consecutive completed days ending today', async () => {
    getFakeDb().seed('kaizen_action_logs', [
      log(isoDaysAgo(0)),
      log(isoDaysAgo(1)),
      log(isoDaysAgo(2)),
    ]);
    expect(await computeDailyCoreStreak('u1')).toBe(3);
  });

  it('applies a one-day grace when nothing is logged yet today', async () => {
    getFakeDb().seed('kaizen_action_logs', [log(isoDaysAgo(1)), log(isoDaysAgo(2))]);
    expect(await computeDailyCoreStreak('u1')).toBe(2);
  });

  it('breaks the streak on a gap day', async () => {
    getFakeDb().seed('kaizen_action_logs', [
      log(isoDaysAgo(0)),
      log(isoDaysAgo(1)),
      // gap at day 2
      log(isoDaysAgo(3)),
    ]);
    expect(await computeDailyCoreStreak('u1')).toBe(2);
  });

  it('ignores skipped-only and soft-deleted days', async () => {
    getFakeDb().seed('kaizen_action_logs', [
      log(isoDaysAgo(0)),
      log(isoDaysAgo(1), { skipped: 1, completed_at: null }),
      log(isoDaysAgo(2), { deleted_at: '2026-01-01T00:00:00.000Z' }),
    ]);
    // Only today counts; day-1 skipped and day-2 deleted break the chain.
    expect(await computeDailyCoreStreak('u1')).toBe(1);
  });

  it('returns 0 when the most recent hit is older than the grace window', async () => {
    getFakeDb().seed('kaizen_action_logs', [log(isoDaysAgo(3)), log(isoDaysAgo(4))]);
    expect(await computeDailyCoreStreak('u1')).toBe(0);
  });

  it('degrades to 0 if the database throws', async () => {
    const db = getFakeDb();
    const spy = jest.spyOn(db, 'getAllAsync').mockRejectedValueOnce(new Error('boom'));
    expect(await computeDailyCoreStreak('u1')).toBe(0);
    spy.mockRestore();
  });
});
