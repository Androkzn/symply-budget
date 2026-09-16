/**
 * kaizenLocalStorage.test.ts — Symply Kaizen (brand `symply-kaizen`) daily-core,
 * streak, and reflection-log persistence logic.
 *
 * `@services/storage` is replaced with an isolated in-memory store that
 * deep-clones on read/write (mirroring the real JSON round-trip), so every
 * function is exercised against its true contract with zero native/MMKV
 * dependency. Date-sensitive paths (day rollover, streak math, `loggedAt`
 * stamps) are pinned with fake timers set in *local* time so assertions hold
 * in any timezone.
 */

import * as storageModule from '@services/storage';

import {
  KAIZEN_DAILY_CORE_KEY,
  KAIZEN_STREAK_KEY,
  KAIZEN_GUIDE_REFLECTIONS_KEY,
  DAILY_HABIT_IDS,
  type DailyHabitId,
  type KaizenDailyCore,
  type KaizenReflectionLog,
  type KaizenStreak,
  allHabitsComplete,
  appendReflectionLog,
  createEmptyDailyCore,
  loadDailyCore,
  loadReflectionLogs,
  loadStreak,
  saveDailyCore,
  saveStreak,
  todayDateKey,
  updateStreakOnHabitChange,
  yesterdayDateKey,
} from '../kaizenLocalStorage';

// In-memory @services/storage — deep-clones like the real JSON-backed impl so a
// caller mutating an object after save cannot alter what was persisted.
jest.mock('@services/storage', () => {
  const store = new Map<string, unknown>();
  const clone = <T>(v: T): T => (v == null ? v : (JSON.parse(JSON.stringify(v)) as T));
  return {
    __store: store,
    storageHelpers: {
      getObject: jest.fn(async (key: string) => (store.has(key) ? clone(store.get(key)) : null)),
      setObject: jest.fn(async (key: string, value: unknown) => {
        store.set(key, clone(value));
      }),
    },
  };
});

const store = (storageModule as unknown as { __store: Map<string, unknown> }).__store;
const helpers = storageModule.storageHelpers as unknown as {
  getObject: jest.Mock;
  setObject: jest.Mock;
};

/** Seed a value exactly as if a prior session had persisted it. */
function seed(key: string, value: unknown): void {
  store.set(key, JSON.parse(JSON.stringify(value)));
}

/** Pin "now" in LOCAL time (month is 0-indexed) so date keys are TZ-stable. */
function freezeLocal(year: number, monthIndex: number, day: number): void {
  jest.setSystemTime(new Date(year, monthIndex, day, 12, 0, 0, 0));
}

const ALL_DONE: Record<DailyHabitId, boolean> = { reflect: true, move: true, review: true };

beforeEach(() => {
  store.clear();
  helpers.getObject.mockClear();
  helpers.setObject.mockClear();
  jest.useFakeTimers();
  freezeLocal(2026, 6, 13); // 2026-07-13
});

afterEach(() => {
  jest.useRealTimers();
});

describe('kaizenLocalStorage — constants', () => {
  it('exposes stable, versioned storage keys', () => {
    expect(KAIZEN_DAILY_CORE_KEY).toBe('kaizen.dailyCore.v1');
    expect(KAIZEN_STREAK_KEY).toBe('kaizen.streak.v1');
    expect(KAIZEN_GUIDE_REFLECTIONS_KEY).toBe('kaizen.guide.reflections.v1');
  });

  it('defines exactly the three daily habits', () => {
    expect(DAILY_HABIT_IDS).toEqual(['reflect', 'move', 'review']);
  });
});

describe('kaizenLocalStorage — date keys', () => {
  it('todayDateKey zero-pads month and day', () => {
    freezeLocal(2026, 2, 5); // 2026-03-05
    expect(todayDateKey()).toBe('2026-03-05');
    freezeLocal(2026, 10, 20); // 2026-11-20
    expect(todayDateKey()).toBe('2026-11-20');
  });

  it('yesterdayDateKey handles the ordinary case', () => {
    freezeLocal(2026, 6, 13);
    expect(yesterdayDateKey()).toBe('2026-07-12');
  });

  it('yesterdayDateKey rolls back across a month boundary', () => {
    freezeLocal(2026, 2, 1); // 2026-03-01 -> 2026-02-28
    expect(yesterdayDateKey()).toBe('2026-02-28');
  });

  it('yesterdayDateKey rolls back across a year boundary', () => {
    freezeLocal(2026, 0, 1); // 2026-01-01 -> 2025-12-31
    expect(yesterdayDateKey()).toBe('2025-12-31');
  });

  it('yesterdayDateKey respects leap years', () => {
    freezeLocal(2024, 2, 1); // 2024-03-01 -> 2024-02-29
    expect(yesterdayDateKey()).toBe('2024-02-29');
  });
});

describe('kaizenLocalStorage — createEmptyDailyCore', () => {
  it('defaults to today with all habits off and empty focus', () => {
    expect(createEmptyDailyCore()).toEqual({
      date: '2026-07-13',
      habits: { reflect: false, move: false, review: false },
      focus: '',
    });
  });

  it('honours an explicit date', () => {
    expect(createEmptyDailyCore('2025-01-09').date).toBe('2025-01-09');
  });
});

describe('kaizenLocalStorage — allHabitsComplete', () => {
  it('is true only when every habit is checked', () => {
    expect(allHabitsComplete({ reflect: true, move: true, review: true })).toBe(true);
  });

  it('is false when any habit is unchecked', () => {
    expect(allHabitsComplete({ reflect: true, move: false, review: true })).toBe(false);
    expect(allHabitsComplete({ reflect: false, move: false, review: false })).toBe(false);
  });
});

describe('kaizenLocalStorage — loadDailyCore', () => {
  it('returns a fresh empty core when nothing is stored', async () => {
    const core = await loadDailyCore();
    expect(core).toEqual({
      date: '2026-07-13',
      habits: { reflect: false, move: false, review: false },
      focus: '',
    });
    expect(helpers.getObject).toHaveBeenCalledWith(KAIZEN_DAILY_CORE_KEY);
  });

  it('returns the stored core when it is for today', async () => {
    const stored: KaizenDailyCore = {
      date: '2026-07-13',
      habits: { reflect: true, move: false, review: true },
      focus: 'Ship the port',
    };
    seed(KAIZEN_DAILY_CORE_KEY, stored);
    expect(await loadDailyCore()).toEqual(stored);
  });

  it('discards a stored core from a previous day (daily reset)', async () => {
    seed(KAIZEN_DAILY_CORE_KEY, {
      date: '2026-07-12',
      habits: { reflect: true, move: true, review: true },
      focus: 'Yesterday',
    });
    const core = await loadDailyCore();
    expect(core.date).toBe('2026-07-13');
    expect(core.habits).toEqual({ reflect: false, move: false, review: false });
    expect(core.focus).toBe('');
  });

  it('backfills missing habit ids and a missing focus from a partial today record', async () => {
    seed(KAIZEN_DAILY_CORE_KEY, {
      date: '2026-07-13',
      habits: { reflect: true } as Record<DailyHabitId, boolean>,
    });
    const core = await loadDailyCore();
    expect(core.habits).toEqual({ reflect: true, move: false, review: false });
    expect(core.focus).toBe('');
  });
});

describe('kaizenLocalStorage — saveDailyCore', () => {
  it('persists the core so a subsequent load reads it back', async () => {
    const core: KaizenDailyCore = {
      date: '2026-07-13',
      habits: { reflect: true, move: true, review: false },
      focus: 'Deep work',
    };
    await saveDailyCore(core);
    expect(helpers.setObject).toHaveBeenCalledWith(KAIZEN_DAILY_CORE_KEY, core);
    expect(await loadDailyCore()).toEqual(core);
  });
});

describe('kaizenLocalStorage — loadStreak / saveStreak', () => {
  it('defaults to a zero streak when nothing is stored', async () => {
    expect(await loadStreak()).toEqual({ count: 0, lastCompletedDate: null });
  });

  it('round-trips a stored streak', async () => {
    const streak: KaizenStreak = { count: 4, lastCompletedDate: '2026-07-12' };
    await saveStreak(streak);
    expect(helpers.setObject).toHaveBeenCalledWith(KAIZEN_STREAK_KEY, streak);
    expect(await loadStreak()).toEqual(streak);
  });
});

describe('kaizenLocalStorage — updateStreakOnHabitChange', () => {
  it('leaves the streak untouched (no write) when habits are incomplete', async () => {
    seed(KAIZEN_STREAK_KEY, { count: 3, lastCompletedDate: '2026-07-12' });
    const result = await updateStreakOnHabitChange({ reflect: true, move: false, review: true });
    expect(result).toEqual({ count: 3, lastCompletedDate: '2026-07-12' });
    expect(helpers.setObject).not.toHaveBeenCalled();
  });

  it('starts a streak at 1 on the first-ever completion', async () => {
    const result = await updateStreakOnHabitChange(ALL_DONE);
    expect(result).toEqual({ count: 1, lastCompletedDate: '2026-07-13' });
    expect(helpers.setObject).toHaveBeenCalledWith(KAIZEN_STREAK_KEY, result);
  });

  it('increments when yesterday was the last completed day', async () => {
    seed(KAIZEN_STREAK_KEY, { count: 5, lastCompletedDate: '2026-07-12' });
    const result = await updateStreakOnHabitChange(ALL_DONE);
    expect(result).toEqual({ count: 6, lastCompletedDate: '2026-07-13' });
  });

  it('is idempotent within the same day (no double count, no write)', async () => {
    seed(KAIZEN_STREAK_KEY, { count: 6, lastCompletedDate: '2026-07-13' });
    const result = await updateStreakOnHabitChange(ALL_DONE);
    expect(result).toEqual({ count: 6, lastCompletedDate: '2026-07-13' });
    expect(helpers.setObject).not.toHaveBeenCalled();
  });

  it('resets to 1 after a missed day breaks the streak', async () => {
    seed(KAIZEN_STREAK_KEY, { count: 9, lastCompletedDate: '2026-07-10' }); // gap: 11th, 12th
    const result = await updateStreakOnHabitChange(ALL_DONE);
    expect(result).toEqual({ count: 1, lastCompletedDate: '2026-07-13' });
  });
});

describe('kaizenLocalStorage — reflection logs', () => {
  it('returns an empty list when nothing is stored', async () => {
    expect(await loadReflectionLogs()).toEqual([]);
  });

  it('prepends a new entry newest-first with an ISO timestamp', async () => {
    const logs = await appendReflectionLog('What went well today?');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual<KaizenReflectionLog>({
      prompt: 'What went well today?',
      loggedAt: new Date(2026, 6, 13, 12, 0, 0, 0).toISOString(),
    });

    freezeLocal(2026, 6, 14);
    const next = await appendReflectionLog('And tomorrow?');
    expect(next.map((l) => l.prompt)).toEqual(['And tomorrow?', 'What went well today?']);
  });

  it('persists appended logs across loads', async () => {
    await appendReflectionLog('Persisted prompt');
    expect(await loadReflectionLogs()).toHaveLength(1);
    expect(helpers.setObject).toHaveBeenCalledWith(
      KAIZEN_GUIDE_REFLECTIONS_KEY,
      expect.arrayContaining([expect.objectContaining({ prompt: 'Persisted prompt' })]),
    );
  });

  it('caps history at 30, dropping the oldest', async () => {
    const existing: KaizenReflectionLog[] = Array.from({ length: 30 }, (_, i) => ({
      prompt: `old-${i}`,
      loggedAt: `2026-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    seed(KAIZEN_GUIDE_REFLECTIONS_KEY, existing);

    const logs = await appendReflectionLog('newest');
    expect(logs).toHaveLength(30);
    expect(logs[0].prompt).toBe('newest');
    expect(logs.some((l) => l.prompt === 'old-29')).toBe(false); // oldest evicted
    expect(logs[29].prompt).toBe('old-28');
  });
});
