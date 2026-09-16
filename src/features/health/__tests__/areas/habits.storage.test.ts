/**
 * Symply Health — Habits store, the corners `healthHabitsStorage.test.ts` does
 * not reach.
 *
 * That suite owns the primary path (seed → tick → add → delete) and the wire
 * contract. This one owns the ARITHMETIC and the INPUT BOUNDARIES, which is
 * where a habits tracker actually breaks for a member:
 *
 *  - A streak is a walk backwards through `shiftDateKey`, one day at a time.
 *    Every off-by-one this walk can have is a calendar edge — the 1st of a
 *    month, New Year's Day, 29 February — and none of them were covered.
 *  - `completionRate` divides by `habits.length`. Zero habits is a real state
 *    (delete them all) and the screen renders `Math.round(rate * 100)` straight
 *    into a tile, so an unguarded divide would put `NaN%` in front of a member.
 *  - `addHabit` trims AND truncates (`MAX_HABIT_NAME`). The truncation had no
 *    test at all, so a 200-character paste would have reached the server.
 *
 * Everything here is asserted against the shipped implementation. There is no
 * preset library, no icon/frequency picker and no reminder on this screen, so
 * none is tested — see the matrix delta for those product gaps.
 */

import { healthApi, type HealthHabit } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addHabit,
  completionRate,
  DEFAULT_HABITS,
  deleteHabit,
  isDoneOn,
  lastDaysStatus,
  loadHabits,
  streakOf,
  toggleHabitToday,
  type Habit,
} from '../../healthHabitsStorage';
import { __setHealthOfflineForTests, clearHealthCache } from '../../healthRepository';
import {
  habitRow,
  installHealthApiDefaults,
  ok,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

/** A whole habit — spread LAST so a newly added column fails here, not silently. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'sleep',
    name: 'Sleep 7+ hours',
    icon: 'sleep-habit',
    category: 'custom',
    templateId: null,
    timeOfDay: 'anytime',
    frequency: 'daily',
    customDays: null,
    reminderTime: null,
    reminderEnabled: false,
    targetDuration: null,
    notes: null,
    archived: false,
    sortOrder: 0,
    days: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function seededRows(): HealthHabit[] {
  return DEFAULT_HABITS.map((h, i) =>
    habitRow({ id: h.id, name: h.name, icon: h.icon, sort_order: i })
  );
}

/**
 * Stand-in for `/health/habits`, modelled server-side.
 *
 * Same shape as the one in `healthHabitsStorage.test.ts` and deliberately a
 * second copy rather than a shared export: a fake that both suites mutate is a
 * fixture two owners can silently break for each other, and `UNIQUE(habit, date)`
 * — the thing that makes a double-tap idempotent — has to be modelled here for
 * the tick/untick arithmetic below to mean anything.
 */
function fakeHabitServer(seed: HealthHabit[] = []): { habits: HealthHabit[] } {
  const state = { habits: [...seed] };
  api.listHabits.mockImplementation(() => Promise.resolve(ok({ habits: [...state.habits] })));
  api.createHabit.mockImplementation((body) => {
    const created = habitRow({
      id: `srv-${state.habits.length + 1}`,
      name: body.name,
      icon: body.icon ?? 'goals',
      sort_order: state.habits.length,
    });
    state.habits.push(created);
    return Promise.resolve(ok({ habit: created }));
  });
  api.deleteHabit.mockImplementation((id) => {
    state.habits = state.habits.filter((h) => h.id !== id);
    return Promise.resolve(ok({ deleted: true }));
  });
  api.toggleHabit.mockImplementation((id, date) => {
    let done = false;
    state.habits = state.habits.map((h) => {
      if (h.id !== id) return h;
      done = !h.days.includes(date);
      const days = done
        ? [date, ...h.days].sort((a, b) => b.localeCompare(a))
        : h.days.filter((d) => d !== date);
      return { ...h, days };
    });
    return Promise.resolve(ok({ done, habits: [...state.habits] }));
  });
  return state;
}

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

/* ------------------------------------------------------------------ */
/* Calendar edges — the streak walk                                    */
/* ------------------------------------------------------------------ */

describe('healthHabitsStorage — streaks across calendar edges', () => {
  it('HEALTH-HABIT-033: a streak crosses a MONTH boundary', () => {
    // The walk is `shiftDateKey(cursor, -1)` on a YYYY-MM-DD string. Naive
    // string maths would step 2026-07-01 → 2026-07-00 and end the streak at the
    // 1st of every month, silently resetting every member on the 1st.
    expect(streakOf(['2026-07-01', '2026-06-30', '2026-06-29'], '2026-07-01')).toBe(3);

    // …and the "not ticked yet today" anchor has to cross it too: on the 1st,
    // yesterday is in the previous month.
    expect(streakOf(['2026-06-30', '2026-06-29'], '2026-07-01')).toBe(2);
  });

  it('HEALTH-HABIT-034: a streak crosses a YEAR boundary', () => {
    expect(streakOf(['2026-01-01', '2025-12-31', '2025-12-30'], '2026-01-01')).toBe(3);
    expect(streakOf(['2025-12-31', '2025-12-30'], '2026-01-01')).toBe(2);
  });

  it('HEALTH-HABIT-035: a streak crosses 29 February in a leap year', () => {
    // 2028 is a leap year. A month-length table that forgot it would step
    // 2028-03-01 → 2028-02-28 and drop the 29th out of the streak.
    expect(streakOf(['2028-03-01', '2028-02-29', '2028-02-28'], '2028-03-01')).toBe(3);
  });

  it('HEALTH-HABIT-036: ticking then unticking the same day restores the earlier streak', async () => {
    fakeHabitServer([habitRow({ id: 'sleep', days: ['2026-07-12', '2026-07-11'] })]);

    // A live 2-day streak that has not been ticked TODAY yet.
    expect(streakOf((await loadHabits())[0].days, TODAY)).toBe(2);

    const ticked = await toggleHabitToday('sleep');
    expect(streakOf(ticked[0].days, TODAY)).toBe(3);

    // Unticking must return the member to 2, not to 0. This is the whole
    // reason days are stored rather than a counter: a decrement-on-untick
    // counter cannot know whether the run before today survived.
    const unticked = await toggleHabitToday('sleep');
    expect(unticked[0].days).toEqual(['2026-07-12', '2026-07-11']);
    expect(streakOf(unticked[0].days, TODAY)).toBe(2);
  });

  it('HEALTH-HABIT-037: only the run adjacent to today counts, however long the earlier one', () => {
    // Today + yesterday, then a one-day hole, then a four-day run. The answer is
    // 2 — a "longest run anywhere" implementation would say 4 and tell the
    // member they are on a streak they broke last week.
    const days = ['2026-07-13', '2026-07-12', '2026-07-10', '2026-07-09', '2026-07-08', '2026-07-07'];
    expect(streakOf(days, TODAY)).toBe(2);
  });

  it('HEALTH-HABIT-038: neither today nor yesterday ticked is zero, whatever came before', () => {
    // The anchor is today-or-yesterday only. A ten-day run that ended on the
    // 11th is over, and the tile must say so rather than keep a dead streak
    // alive until the member notices.
    const days = Array.from({ length: 10 }, (_unused, i) => `2026-07-${String(11 - i).padStart(2, '0')}`);
    expect(streakOf(days, TODAY)).toBe(0);
  });

  it('HEALTH-HABIT-039: duplicate and unsorted day keys do not distort the walk', () => {
    // `days` arrives from the server sorted, but a merged offline optimistic
    // list is only as sorted as the writer left it, and a re-sync can repeat a
    // day. The Set is what makes both harmless — assert it, so a future
    // "optimisation" to an array walk cannot regress it silently.
    expect(streakOf(['2026-07-11', '2026-07-13', '2026-07-12', '2026-07-13'], TODAY)).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* Completion rate + the dot strip                                     */
/* ------------------------------------------------------------------ */

describe('healthHabitsStorage — completion rate and the 7-day strip', () => {
  it('HEALTH-HABIT-040: the rate counts every habit in the denominator, new ones included', () => {
    // A habit added today has no history, and it still counts against the day's
    // completion — the tile answers "how much of TODAY's list is done", not
    // "how much of the list that existed a week ago".
    const habits = [
      habit({ id: 'sleep', days: [TODAY] }),
      habit({ id: 'move', days: [] }),
      habit({ id: 'brand-new', createdAt: '2026-07-13T11:59:00.000Z', days: [] }),
    ];

    expect(completionRate(habits, TODAY)).toBeCloseTo(1 / 3, 10);
    // What the tile actually renders — `Math.round(rate * 100)` in the screen.
    expect(Math.round(completionRate(habits, TODAY) * 100)).toBe(33);

    // And on a past day it re-reads the same list against that day's ticks.
    expect(completionRate(habits, '2026-07-12')).toBe(0);
  });

  it('HEALTH-HABIT-041: an empty list is 0, never NaN — the tile renders the number raw', () => {
    const rate = completionRate([], TODAY);

    // `done / habits.length` with no habits is 0/0 = NaN, and the screen prints
    // `${Math.round(rate * 100)}%` with no further guard, so an unguarded
    // divide would show a member "NaN%" on the very first open after they
    // deleted their last habit.
    expect(rate).toBe(0);
    expect(Number.isNaN(rate)).toBe(false);
    expect(`${Math.round(rate * 100)}%`).toBe('0%');
  });

  it('HEALTH-HABIT-042: the strip is exactly `count` long — including 0 and 1', () => {
    const h = habit({ days: [TODAY] });

    expect(lastDaysStatus(h, 0, TODAY)).toEqual([]);
    expect(lastDaysStatus(h, 1, TODAY)).toEqual([true]);
    // The screen asks for STRIP_DAYS = 7, so that length is the contract the
    // dot row is laid out against.
    expect(lastDaysStatus(h, 7, TODAY)).toHaveLength(7);
    expect(lastDaysStatus(h, 7, TODAY)).toEqual([false, false, false, false, false, false, true]);
  });

  it('HEALTH-HABIT-043: the strip walks back across a month boundary', () => {
    // Seven days ending 2026-07-02 reaches back into June. The dots are drawn
    // oldest-first, so the June days are on the LEFT.
    const h = habit({ days: ['2026-07-02', '2026-06-30', '2026-06-26'] });

    expect(lastDaysStatus(h, 7, '2026-07-02')).toEqual([
      true, // 06-26
      false, // 06-27
      false, // 06-28
      false, // 06-29
      true, // 06-30
      false, // 07-01
      true, // 07-02
    ]);
  });

  it('HEALTH-HABIT-044: isDoneOn is a day lookup, not a "has any history" check', () => {
    expect(isDoneOn(habit({ days: [] }), TODAY)).toBe(false);
    expect(isDoneOn(habit({ days: ['2026-07-12'] }), TODAY)).toBe(false);
    expect(isDoneOn(habit({ days: ['2026-07-12'] }), '2026-07-12')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Add / delete input boundaries                                       */
/* ------------------------------------------------------------------ */

describe('healthHabitsStorage — add and delete boundaries', () => {
  it('HEALTH-HABIT-045: a long name is truncated to 60 characters BEFORE it is sent', async () => {
    fakeHabitServer(seededRows());
    const long = `E2E trim ${'x'.repeat(61)}`; // 70 characters
    expect(long).toHaveLength(70);

    const habits = await addHabit(long);

    // The client cap and the route's `z.string().max(60)` are the SAME number
    // on purpose: the truncated string is what reaches the server, so a paste
    // of a whole paragraph cannot come back as a 400 the member cannot read.
    expect(api.createHabit).toHaveBeenCalledWith({ name: long.slice(0, 60), icon: 'goals' });
    expect(habits[habits.length - 1].name).toHaveLength(60);
    expect(habits[habits.length - 1].name).toBe(`E2E trim ${'x'.repeat(51)}`);
  });

  it('HEALTH-HABIT-046: the name is trimmed BEFORE it is measured', async () => {
    fakeHabitServer(seededRows());
    // 58 real characters wrapped in whitespace. Truncating first would spend 6
    // of the 60 on spaces and clip the last two letters off a legal name.
    const padded = `   ${'a'.repeat(58)}   `;

    await addHabit(padded);

    expect(api.createHabit).toHaveBeenCalledWith({ name: 'a'.repeat(58), icon: 'goals' });
  });

  it('HEALTH-HABIT-047: a caller-supplied icon reaches the wire instead of the default', async () => {
    fakeHabitServer(seededRows());

    await addHabit('Evening walk', 'movement');

    // The screen has no icon picker yet, so `goals` is what every add sends
    // today — but the parameter is real, and a future picker has to keep
    // working through this exact path.
    expect(api.createHabit).toHaveBeenCalledWith({ name: 'Evening walk', icon: 'movement' });
  });

  it('HEALTH-HABIT-048: two habits may share a name — they are distinct rows', async () => {
    fakeHabitServer(seededRows());

    const habits = await addHabit('Stretch'); // 'Stretch' is already a starter habit

    // There is deliberately no de-duplication: "Stretch" in the morning and
    // "Stretch" at night are two habits with two streaks. What must hold is
    // that they are addressable separately — the row testID, the toggle and the
    // delete are all keyed by id.
    const stretches = habits.filter((h) => h.name === 'Stretch');
    expect(stretches).toHaveLength(2);
    expect(new Set(stretches.map((h) => h.id)).size).toBe(2);
  });

  it('HEALTH-HABIT-049: deleting an id that is not in the list leaves it intact', async () => {
    fakeHabitServer(seededRows());

    const habits = await deleteHabit('never-existed');

    // A stale id from another device is the realistic case. The list must come
    // back whole rather than empty, and the request still goes out so the
    // server can answer 404 rather than the client guessing.
    expect(api.deleteHabit).toHaveBeenCalledWith('never-existed');
    expect(habits.map((h) => h.id)).toEqual(DEFAULT_HABITS.map((h) => h.id));
  });
});

/* ------------------------------------------------------------------ */
/* First-open seeding                                                  */
/* ------------------------------------------------------------------ */

// IDs 057/058 rather than 052+: 050–056 are already spent on the screen rows in
// `screens/__tests__/HealthSectionScreens.test.tsx`, so the store family
// continues above them rather than colliding.
describe('healthHabitsStorage — first-open seeding runs once', () => {
  it('HEALTH-HABIT-057: the starter set is seeded on the first read and never again', async () => {
    const server = fakeHabitServer([]);

    const first = await loadHabits();
    const second = await loadHabits();
    const third = await loadHabits();

    // The seed branch keys off an EMPTY server list, so it is self-closing —
    // but only if the POSTs actually land before the next read. Re-seeding
    // would give a member 10, then 15 starter habits, one round per app open.
    expect(api.createHabit).toHaveBeenCalledTimes(DEFAULT_HABITS.length);
    expect(server.habits).toHaveLength(DEFAULT_HABITS.length);
    expect(first.map((h) => h.name)).toEqual(DEFAULT_HABITS.map((h) => h.name));
    expect(second.map((h) => h.name)).toEqual(first.map((h) => h.name));
    expect(third).toHaveLength(DEFAULT_HABITS.length);
  });

  it('HEALTH-HABIT-058: an account holding ONE habit is not topped up to five', async () => {
    // The boundary either side of `rows.length === 0`. A member who deleted
    // four of the five starters must keep the one they chose, not have the
    // other four pushed back at them.
    fakeHabitServer([habitRow({ id: 'only-one', name: 'Stretch' })]);

    const habits = await loadHabits();

    expect(api.createHabit).not.toHaveBeenCalled();
    expect(habits.map((h) => h.id)).toEqual(['only-one']);
  });
});
