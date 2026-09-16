/**
 * Covers the local-first daily-practice + streak logic that powers the Learn
 * home when offline / AI-off. Storage is mocked with an in-memory map.
 */
jest.mock('@services/storage', () => {
  const memory = new Map<string, unknown>();
  return {
    __memory: memory,
    storageHelpers: {
      getObject: async (k: string) => (memory.has(k) ? memory.get(k) : null),
      setObject: async (k: string, v: unknown) => {
        memory.set(k, v);
      },
    },
  };
});

const { __memory: mockMemory } = jest.requireMock('@services/storage') as {
  __memory: Map<string, unknown>;
};

import {
  allGoalsComplete,
  completedGoalCount,
  createEmptyDaily,
  createEmptyProfile,
  isProfileReady,
  loadDaily,
  loadProfile,
  loadStreak,
  saveDaily,
  saveProfile,
  updateStreakOnGoalChange,
  saveStreak,
  todayDateKey,
  yesterdayDateKey,
  DAILY_GOAL_IDS,
  LANGUAGE_DAILY_KEY,
  LANGUAGE_PROFILE_KEY,
} from '../languageLocalStorage';

beforeEach(() => mockMemory.clear());

describe('date keys', () => {
  it('todayDateKey is a zero-padded ISO date and yesterday is exactly one day before', () => {
    expect(todayDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(yesterdayDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Date(`${todayDateKey()}T00:00:00Z`).getTime();
    const yesterday = new Date(`${yesterdayDateKey()}T00:00:00Z`).getTime();
    expect(today - yesterday).toBe(24 * 60 * 60 * 1000);
  });
});

describe('profile persistence', () => {
  it('loadProfile returns an empty profile when nothing is stored', async () => {
    expect(await loadProfile()).toEqual(createEmptyProfile());
  });

  it('saveProfile then loadProfile round-trips and back-fills missing keys', async () => {
    // Persist a partial object (older shell version) — load must merge defaults.
    mockMemory.set(LANGUAGE_PROFILE_KEY, { targetLanguage: 'Spanish' });
    const loaded = await loadProfile();
    expect(loaded).toEqual({ targetLanguage: 'Spanish', nativeLanguage: null, level: null });
  });

  it('saveProfile writes under the profile key', async () => {
    const profile = { targetLanguage: 'French', nativeLanguage: 'English', level: 'beginner' as const };
    await saveProfile(profile);
    expect(mockMemory.get(LANGUAGE_PROFILE_KEY)).toEqual(profile);
    expect(await loadProfile()).toEqual(profile);
  });
});

describe('daily persistence', () => {
  it('createEmptyDaily uses today and all goals false', () => {
    const daily = createEmptyDaily();
    expect(daily.date).toBe(todayDateKey());
    expect(DAILY_GOAL_IDS.every((id) => daily.goals[id] === false)).toBe(true);
  });

  it('loadDaily returns a fresh empty day when nothing is stored', async () => {
    const daily = await loadDaily();
    expect(daily.date).toBe(todayDateKey());
    expect(completedGoalCount(daily.goals)).toBe(0);
  });

  it('loadDaily resets to a fresh day when the stored date is stale', async () => {
    mockMemory.set(LANGUAGE_DAILY_KEY, {
      date: '2000-01-01',
      goals: { review: true, speak: true, learn: true },
    });
    const daily = await loadDaily();
    expect(daily.date).toBe(todayDateKey());
    expect(completedGoalCount(daily.goals)).toBe(0);
  });

  it('loadDaily keeps and back-fills goals for the current day', async () => {
    await saveDaily({ date: todayDateKey(), goals: { review: true } as never });
    const daily = await loadDaily();
    expect(daily.date).toBe(todayDateKey());
    expect(daily.goals).toEqual({ review: true, speak: false, learn: false });
  });
});

describe('goal helpers', () => {
  it('counts and detects completion', () => {
    expect(completedGoalCount({ review: true, speak: false, learn: true })).toBe(2);
    expect(allGoalsComplete({ review: true, speak: true, learn: true })).toBe(true);
    expect(allGoalsComplete({ review: true, speak: false, learn: true })).toBe(false);
  });
});

describe('isProfileReady', () => {
  it('is ready only once a target language is set', () => {
    expect(isProfileReady(null)).toBe(false);
    expect(isProfileReady({ targetLanguage: null, nativeLanguage: null, level: null })).toBe(false);
    expect(isProfileReady({ targetLanguage: 'Spanish', nativeLanguage: null, level: null })).toBe(true);
  });
});

describe('updateStreakOnGoalChange', () => {
  it('does not advance until all goals are complete', async () => {
    const streak = await updateStreakOnGoalChange({ review: true, speak: false, learn: true });
    expect(streak.count).toBe(0);
  });

  it('starts a streak at 1 when all goals complete today', async () => {
    const streak = await updateStreakOnGoalChange({ review: true, speak: true, learn: true });
    expect(streak.count).toBe(1);
    expect(streak.lastCompletedDate).toBe(todayDateKey());
  });

  it('increments when yesterday was completed', async () => {
    await saveStreak({ count: 4, lastCompletedDate: yesterdayDateKey() });
    const streak = await updateStreakOnGoalChange({ review: true, speak: true, learn: true });
    expect(streak.count).toBe(5);
  });

  it('is idempotent for the same day', async () => {
    await updateStreakOnGoalChange({ review: true, speak: true, learn: true });
    const again = await updateStreakOnGoalChange({ review: true, speak: true, learn: true });
    expect(again.count).toBe(1);
    expect((await loadStreak()).count).toBe(1);
  });

  it('resets to 1 when the last completed day was not yesterday (gap in streak)', async () => {
    await saveStreak({ count: 9, lastCompletedDate: '2000-01-01' });
    const streak = await updateStreakOnGoalChange({ review: true, speak: true, learn: true });
    expect(streak.count).toBe(1);
    expect(streak.lastCompletedDate).toBe(todayDateKey());
  });

  it('does not persist a change while goals are incomplete', async () => {
    const before = await updateStreakOnGoalChange({ review: true, speak: false, learn: false });
    expect(before).toEqual({ count: 0, lastCompletedDate: null });
    // Nothing written to storage.
    expect(mockMemory.has('language.streak.v1')).toBe(false);
  });
});
