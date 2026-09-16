/**
 * Symply Health stores — ordering guarantees and defensive fallbacks.
 *
 * The per-module suites seed at most one or two entries per store, so the
 * `.sort()` comparators inside the loaders never actually run — a comparator
 * inverted to ascending would ship green. Ordering is user-visible on every one
 * of these screens (the newest reading is the one the summary card reports), so
 * it is pinned here with multi-entry fixtures.
 *
 * Parity phase P1 gave each store TWO ordering paths that have to agree:
 *  - the FETCH path, which sorts the rows the Worker returned (the Worker makes
 *    no ordering promise the client can rely on), and
 *  - the CACHE path, which re-sorts the MMKV snapshot offline, and which is also
 *    where the optimistic list produced by a write is ordered.
 * Both are covered below.
 *
 * Also covers the arithmetic guards that only fire on corrupt or partial data:
 * a non-finite macro in `sumNutrition`, a malformed date key in
 * `formatAxisDate`, and a habit set where nobody has a streak.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  HEALTH_WORKOUTS_KEY,
  addWorkoutEntry,
  loadWorkouts,
  type WorkoutEntry,
} from '../healthActivityStorage';
import {
  HEALTH_BODY_KEY,
  addBodyEntry,
  loadBodyEntries,
  type BodyEntry,
} from '../healthBodyStorage';
import { HEALTH_CYCLE_PERIODS_KEY, loadPeriodEntries } from '../healthCycleStorage';
import { HEALTH_HABITS_KEY, loadHabits, toggleHabitToday, type Habit } from '../healthHabitsStorage';
import {
  HEALTH_MEALS_KEY,
  deleteMealEntry,
  groupBySlot,
  loadMeals,
  loadMealsForDate,
  sumNutrition,
  type MealEntry,
} from '../healthNutritionStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../healthRepository';
import { formatAxisDate, summarizeHabitTrend } from '../healthTrends';
import { loadVitalityEntries } from '../healthVitalityStorage';
import {
  installHealthApiDefaults,
  measurementRow,
  mensRow,
  nutritionRow,
  ok,
  periodRow,
  workoutRow,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

function workout(loggedAt: string, minutes: number): WorkoutEntry {
  return { distanceM: null, startedAt: null,
    id: `w-${loggedAt}`,
    date: loggedAt.slice(0, 10),
    type: 'run',
    minutes,
    calories: 0,
    intensity: 'steady',
    note: '',
    loggedAt,
  };
}

function body(loggedAt: string, value: number): BodyEntry {
  return {
    id: `b-${loggedAt}`,
    date: loggedAt.slice(0, 10),
    metric: 'waist',
    value,
    unit: 'cm',
    loggedAt,
  };
}

function meal(loggedAt: string, name: string, slot: MealEntry['slot'] = 'breakfast'): MealEntry {
  return {
    id: `m-${loggedAt}`,
    date: loggedAt.slice(0, 10),
    slot,
    name,
    calories: 100,
    protein: 0,
    carbs: 0,
    fat: 0,
    loggedAt,
  };
}

describe('healthActivityStorage — workout ordering', () => {
  it('HEALTH-ACT-060: returns cached workouts newest-first regardless of stored order', async () => {
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, [
      workout('2026-07-11T08:00:00.000Z', 20),
      workout('2026-07-13T08:00:00.000Z', 45),
      workout('2026-07-12T08:00:00.000Z', 30),
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadWorkouts()).map((w) => w.minutes)).toEqual([45, 30, 20]);
  });

  it('HEALTH-ACT-061: a newly added workout sorts into the list, not just onto the front', async () => {
    await storageHelpers.setObject(HEALTH_WORKOUTS_KEY, [
      workout('2099-01-01T08:00:00.000Z', 99),
      workout('2020-01-01T08:00:00.000Z', 11),
    ]);
    __setHealthOfflineForTests(true);

    // Offline is where the OPTIMISTIC list is what the screen renders, so this
    // is the path where a prepend-only insert would be visible.
    const next = await addWorkoutEntry({ type: 'walk', minutes: 25 });
    expect(next.map((w) => w.minutes)).toEqual([99, 25, 11]);
  });

  it('HEALTH-ACT-062: sorts the rows the Worker returned, whatever order they arrive in', async () => {
    api.listEntries.mockResolvedValue(
      ok({
        entries: [
          workoutRow({ workout_type: 'run', minutes: 20 }, { id: 'a', created_at: '2026-07-11T08:00:00.000Z' }),
          workoutRow({ workout_type: 'run', minutes: 45 }, { id: 'b', created_at: '2026-07-13T08:00:00.000Z' }),
          workoutRow({ workout_type: 'run', minutes: 30 }, { id: 'c', created_at: '2026-07-12T08:00:00.000Z' }),
        ],
      })
    );

    expect((await loadWorkouts()).map((w) => w.minutes)).toEqual([45, 30, 20]);
  });
});

describe('healthBodyStorage — measurement ordering', () => {
  it('HEALTH-BODY-060: returns cached readings newest-first regardless of stored order', async () => {
    await storageHelpers.setObject(HEALTH_BODY_KEY, [
      body('2026-07-11T08:00:00.000Z', 81),
      body('2026-07-13T08:00:00.000Z', 79),
      body('2026-07-12T08:00:00.000Z', 80),
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadBodyEntries()).map((e) => e.value)).toEqual([79, 80, 81]);
  });

  it('HEALTH-BODY-061: a new reading sorts by timestamp, so the summary reports the true latest', async () => {
    await storageHelpers.setObject(HEALTH_BODY_KEY, [
      body('2099-01-01T08:00:00.000Z', 70),
      body('2020-01-01T08:00:00.000Z', 90),
    ]);
    __setHealthOfflineForTests(true);

    const next = await addBodyEntry('waist', 80, 'cm');
    expect(next.map((e) => e.value)).toEqual([70, 80, 90]);
  });

  it('HEALTH-BODY-062: fan-out rows are ordered across measurement rows, not within one', async () => {
    api.listMeasurements.mockResolvedValue(
      ok({
        measurements: [
          measurementRow({ id: 'older', waist: 81, created_at: '2026-07-11T08:00:00.000Z' }),
          measurementRow({ id: 'newest', waist: 79, created_at: '2026-07-13T08:00:00.000Z' }),
          measurementRow({ id: 'middle', waist: 80, created_at: '2026-07-12T08:00:00.000Z' }),
        ],
      })
    );

    // `summarizeBody` takes `[latest, previous]` off the head of the list, so an
    // unsorted fan-out would report the wrong "latest" and invert every delta.
    expect((await loadBodyEntries()).map((e) => e.value)).toEqual([79, 80, 81]);
  });
});

describe('healthNutritionStorage — meal ordering within a day', () => {
  it('HEALTH-NUTR-060: a cached day reads oldest-first, in the order the food was eaten', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [
      meal('2026-07-13T19:00:00.000Z', 'dinner-ish'),
      meal('2026-07-13T08:00:00.000Z', 'first'),
      meal('2026-07-13T13:00:00.000Z', 'second'),
      meal('2026-07-12T08:00:00.000Z', 'other day'),
    ]);
    __setHealthOfflineForTests(true);

    const day = await loadMealsForDate('2026-07-13');
    expect(day.map((m) => m.name)).toEqual(['first', 'second', 'dinner-ish']);
  });

  it('HEALTH-NUTR-061: deleting keeps the remaining day oldest-first', async () => {
    await storageHelpers.setObject(HEALTH_MEALS_KEY, [
      meal('2026-07-13T19:00:00.000Z', 'third'),
      meal('2026-07-13T08:00:00.000Z', 'first'),
      meal('2026-07-13T13:00:00.000Z', 'second'),
    ]);
    __setHealthOfflineForTests(true);

    const remaining = await deleteMealEntry('m-2026-07-13T13:00:00.000Z', '2026-07-13');
    expect(remaining.map((m) => m.name)).toEqual(['first', 'third']);
  });

  it('HEALTH-NUTR-065: the wire diary sorts newest-first, while a single day reads oldest-first', async () => {
    api.listNutrition.mockResolvedValue(
      ok({
        entries: [
          nutritionRow({ id: 'a', food_name: 'first', created_at: '2026-07-13T08:00:00.000Z' }),
          nutritionRow({ id: 'b', food_name: 'third', created_at: '2026-07-13T19:00:00.000Z' }),
          nutritionRow({ id: 'c', food_name: 'second', created_at: '2026-07-13T13:00:00.000Z' }),
        ],
      })
    );

    // The two orders are deliberate and opposite: the full diary is a feed
    // (newest first), a single day is a timeline (in the order it was eaten).
    expect((await loadMeals()).map((m) => m.name)).toEqual(['third', 'second', 'first']);
    expect((await loadMealsForDate('2026-07-13')).map((m) => m.name)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('healthNutritionStorage — totals with corrupt macros', () => {
  it('HEALTH-NUTR-062: a non-finite macro counts as zero rather than poisoning the total', () => {
    // A NaN reaching the reducer would make every downstream total NaN, and the
    // goal bars would render `NaN / 140`.
    const corrupt = [
      { ...meal('2026-07-13T08:00:00.000Z', 'ok'), calories: 500, protein: 30, carbs: 40, fat: 10 },
      {
        ...meal('2026-07-13T09:00:00.000Z', 'corrupt'),
        calories: Number.NaN,
        protein: Number.POSITIVE_INFINITY,
        carbs: Number.NaN,
        fat: Number.NaN,
      },
    ];
    expect(sumNutrition(corrupt)).toEqual({ calories: 500, protein: 30, carbs: 40, fat: 10 });
  });

  it('HEALTH-NUTR-063: an empty day totals to zero, not NaN', () => {
    expect(sumNutrition([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('HEALTH-NUTR-064: groupBySlot always returns every slot, empty ones included', () => {
    const grouped = groupBySlot([meal('2026-07-13T08:00:00.000Z', 'toast', 'breakfast')]);
    // The diary renders a header per slot, so a missing slot would drop a section.
    expect(grouped.map((g) => g.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snacks']);
    expect(grouped.find((g) => g.slot === 'breakfast')?.entries).toHaveLength(1);
    expect(grouped.find((g) => g.slot === 'lunch')?.entries).toHaveLength(0);
  });
});

describe('healthCycleStorage / healthVitalityStorage — per-date ordering', () => {
  it('HEALTH-CYCLE-060: period entries come back newest-first whatever the Worker sent', async () => {
    api.listPeriods.mockResolvedValue(
      ok({
        periods: [
          periodRow({ date: '2026-07-11', flow_level: 2 }),
          periodRow({ date: '2026-07-13', flow_level: 4 }),
          periodRow({ date: '2026-07-12', flow_level: 3 }),
        ],
      })
    );

    // The calendar reads `[0]` as "the most recent bleeding day" when deciding
    // whether a period is in progress.
    expect((await loadPeriodEntries()).map((e) => e.date)).toEqual([
      '2026-07-13',
      '2026-07-12',
      '2026-07-11',
    ]);
  });

  it('HEALTH-VITAL-060: vitality entries come back newest-first whatever the Worker sent', async () => {
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({ id: 'a', date: '2026-07-11', libido: 4 }),
          mensRow({ id: 'b', date: '2026-07-13', libido: 8 }),
          mensRow({ id: 'c', date: '2026-07-12', libido: 6 }),
        ],
      })
    );

    expect((await loadVitalityEntries()).map((e) => e.libido)).toEqual([8, 6, 4]);
  });

  it('HEALTH-CYCLE-061: a cached period log is re-sorted offline', async () => {
    await storageHelpers.setObject(HEALTH_CYCLE_PERIODS_KEY, [
      { id: 'period-2026-07-11', date: '2026-07-11', flow: 'light', notes: '', loggedAt: 'x' },
      { id: 'period-2026-07-13', date: '2026-07-13', flow: 'heavy', notes: '', loggedAt: 'x' },
      { id: 'period-2026-07-12', date: '2026-07-12', flow: 'medium', notes: '', loggedAt: 'x' },
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadPeriodEntries()).map((e) => e.date)).toEqual([
      '2026-07-13',
      '2026-07-12',
      '2026-07-11',
    ]);
  });
});

describe('healthHabitsStorage — tick ordering', () => {
  const habit = (days: string[]): Habit => ({ category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0,
    id: 'h1',
    name: 'Stretch',
    icon: 'goals',
    days,
    createdAt: '2026-07-01T08:00:00.000Z',
  });

  it('HEALTH-HABIT-060: a newly ticked day sorts into the history newest-first', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit(['2026-07-14', '2026-07-10'])]);
    __setHealthOfflineForTests(true);

    // Ticking 12th must land BETWEEN the two, not simply at the front —
    // `streakOf` walks the list in order.
    const next = await toggleHabitToday('h1', '2026-07-12');
    expect(next[0].days).toEqual(['2026-07-14', '2026-07-12', '2026-07-10']);
  });

  it('HEALTH-HABIT-061: ticking an already-done day unticks it', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit(['2026-07-13', '2026-07-12'])]);
    __setHealthOfflineForTests(true);

    const next = await toggleHabitToday('h1', '2026-07-13');
    expect(next[0].days).toEqual(['2026-07-12']);
  });

  it('HEALTH-HABIT-062: toggling an unknown id leaves every habit untouched', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit(['2026-07-12'])]);
    __setHealthOfflineForTests(true);

    const next = await toggleHabitToday('does-not-exist', '2026-07-13');
    expect(next[0].days).toEqual(['2026-07-12']);
    expect((await loadHabits())[0].days).toEqual(['2026-07-12']);
  });
});

describe('healthTrends — defensive formatting & empty ranks', () => {
  it('HEALTH-TREND-060: formats a well-formed key as "12 Mar"', () => {
    expect(formatAxisDate('2026-03-12')).toBe('12 Mar');
  });

  it('HEALTH-TREND-061: a truncated date key falls back to 1 Jan rather than "NaN NaN"', () => {
    // Axis labels are member-facing; a malformed key must not print NaN.
    expect(formatAxisDate('2026')).toBe('1 Jan');
    expect(formatAxisDate('2026-05')).toBe('1 May');
  });

  it('HEALTH-TREND-062: no habit with a streak reports no best habit', () => {
    const noStreaks: Habit[] = [
      { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0, id: 'a', name: 'A', icon: 'goals', days: [], createdAt: '2026-07-01T00:00:00.000Z' },
      { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0, id: 'b', name: 'B', icon: 'goals', days: [], createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    const trend = summarizeHabitTrend(noStreaks, ['2026-07-12', '2026-07-13'], () => 0);
    // bestHabit must be null, not the arbitrary first habit — the card would
    // otherwise crown a habit the user has never ticked.
    expect(trend.bestHabit).toBeNull();
    expect(trend.bestStreak).toBe(0);
    expect(trend.completionRate).toBe(0);
    expect(trend.habits).toBe(2);
  });

  it('HEALTH-TREND-063: the habit with the longest streak is crowned', () => {
    const habits: Habit[] = [
      { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0,
        id: 'a',
        name: 'Short',
        icon: 'goals',
        days: ['2026-07-13'],
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0,
        id: 'b',
        name: 'Long',
        icon: 'goals',
        days: ['2026-07-13', '2026-07-12'],
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ];
    const trend = summarizeHabitTrend(habits, ['2026-07-12', '2026-07-13'], (days) => days.length);
    expect(trend.bestHabit).toBe('Long');
    expect(trend.bestStreak).toBe(2);
    // 3 ticks across 2 habits × 2 days.
    expect(trend.completionRate).toBeCloseTo(3 / 4);
  });

  it('HEALTH-TREND-064: an empty habit set or empty range short-circuits to zeros', () => {
    expect(summarizeHabitTrend([], ['2026-07-13'], () => 5)).toEqual({
      habits: 0,
      bestStreak: 0,
      bestHabit: null,
      completionRate: 0,
    });
    const one: Habit[] = [
      { category: 'custom', templateId: null, timeOfDay: 'anytime', frequency: 'daily', customDays: null, reminderTime: null, reminderEnabled: false, targetDuration: null, notes: null, archived: false, sortOrder: 0, id: 'a', name: 'A', icon: 'goals', days: ['2026-07-13'], createdAt: '2026-07-01T00:00:00.000Z' },
    ];
    expect(summarizeHabitTrend(one, [], () => 5).habits).toBe(0);
  });
});
