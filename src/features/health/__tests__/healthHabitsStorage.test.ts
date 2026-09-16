/**
 * Symply Health — Habits (donor "Habits" tab).
 *
 * The streak rules carry the weight here: a habit stores the DAYS it was
 * completed on, so a streak survives an untick, a gap, and "not ticked yet
 * today" (which is not a broken streak until the day is over). That stays pure
 * device-side maths even though the days now come from `/health/habits`.
 *
 * The one genuinely new behaviour is first-run seeding: an account with no
 * habits is seeded SERVER-side (one POST per starter habit) so every device
 * sees the same list rather than each minting its own copy.
 */

import { healthApi, type HealthHabit } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  addHabit,
  completionRate,
  DEFAULT_HABITS,
  deleteHabit,
  HEALTH_HABITS_KEY,
  isDoneOn,
  lastDaysStatus,
  loadHabits,
  streakOf,
  toggleHabitToday,
  type Habit,
} from '../healthHabitsStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  habitRow,
  installHealthApiDefaults,
  NETWORK_ERROR,
  ok,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

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
    // Spread LAST: the habit shape grew a schedule + reminder + archive block
    // when the donor port landed, and a hand-picked default list would silently
    // drop the next field rather than fail here.
    ...over,
  };
}

/** The starter set as the server would hold it once seeding has run. */
function seededRows(): HealthHabit[] {
  return DEFAULT_HABITS.map((h, i) =>
    habitRow({ id: h.id, name: h.name, icon: h.icon, sort_order: i })
  );
}

/**
 * Stand-in for `/health/habits`. `toggle` is modelled server-side because
 * UNIQUE(habit, date) is what makes a double-tap idempotent — a client-only
 * fake would hide a regression in the toggle round trip.
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

describe('healthHabitsStorage — streaks', () => {
  it('HEALTH-HABIT-001: counts consecutive days ending today', () => {
    expect(streakOf(['2026-07-13', '2026-07-12', '2026-07-11'], TODAY)).toBe(3);
  });

  it('HEALTH-HABIT-002: keeps a live streak when today is not ticked YET', () => {
    // Yesterday's tick still counts — the day is not over.
    expect(streakOf(['2026-07-12', '2026-07-11'], TODAY)).toBe(2);
  });

  it('HEALTH-HABIT-003: a gap breaks the streak', () => {
    expect(streakOf(['2026-07-13', '2026-07-11'], TODAY)).toBe(1);
  });

  it('HEALTH-HABIT-004: no days, or nothing recent, is a zero streak', () => {
    expect(streakOf([], TODAY)).toBe(0);
    expect(streakOf(['2026-07-01'], TODAY)).toBe(0);
  });

  it('HEALTH-HABIT-005: isDoneOn checks a specific day, defaulting to today', () => {
    const h = habit({ days: [TODAY] });
    expect(isDoneOn(h)).toBe(true);
    expect(isDoneOn(h, '2026-07-12')).toBe(false);
  });

  it('HEALTH-HABIT-006: lastDaysStatus returns a fixed-length strip, oldest-first', () => {
    const strip = lastDaysStatus(habit({ days: [TODAY, '2026-07-11'] }), 3, TODAY);
    expect(strip).toEqual([true, false, true]); // 11th, 12th, 13th
  });

  it('HEALTH-HABIT-007: completion rate is done ÷ total, and 0 with no habits', () => {
    expect(completionRate([habit({ days: [TODAY] }), habit({ id: 'move' })], TODAY)).toBe(0.5);
    expect(completionRate([], TODAY)).toBe(0);
  });
});

describe('healthHabitsStorage — wire contract', () => {
  it('HEALTH-HABIT-008: a fresh account seeds the starter habits SERVER-side', async () => {
    fakeHabitServer([]); // brand-new account: no habits yet

    const habits = await loadHabits();

    // Seeding on the server (rather than locally) is what stops a second device
    // from creating its own duplicate copy of the same five starter habits.
    expect(api.createHabit).toHaveBeenCalledTimes(DEFAULT_HABITS.length);
    for (const seed of DEFAULT_HABITS) {
      expect(api.createHabit).toHaveBeenCalledWith({ name: seed.name, icon: seed.icon });
    }
    expect(habits.map((h) => h.name)).toEqual(DEFAULT_HABITS.map((h) => h.name));
    expect(habits.every((h) => h.days.length === 0)).toBe(true);
  });

  it('HEALTH-HABIT-018: a seeded account is not re-seeded on the next read', async () => {
    fakeHabitServer(seededRows());

    await loadHabits();

    // The seeding branch keys off an EMPTY list, so a returning user must never
    // trigger it — five extra POSTs would double their habit list.
    expect(api.createHabit).not.toHaveBeenCalled();
  });

  it('HEALTH-HABIT-019: maps a server row onto the screen habit shape', async () => {
    api.listHabits.mockResolvedValue(
      ok({
        habits: [
          habitRow({
            id: 'srv-1',
            name: 'Stretch',
            icon: 'stretch',
            days: ['2026-07-13', '2026-07-12'],
            streak: 2,
            created_at: '2026-07-01T00:00:00.000Z',
          }),
        ],
      })
    );

    // The whole shape, not a subset: the donor port added the schedule,
    // reminder and archive block, and `fromWire` is the only place a missing
    // column turns into a usable default. `toEqual` on the full object is what
    // makes a dropped mapping fail here rather than as `undefined` on a screen.
    expect(await loadHabits()).toEqual<Habit[]>([
      {
        id: 'srv-1',
        name: 'Stretch',
        icon: 'stretch',
        category: 'wellness', // habitRow's default; `custom` only when absent
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
        days: ['2026-07-13', '2026-07-12'],
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    expect(healthSyncStateFor(HEALTH_HABITS_KEY)).toBe('synced');
  });

  it('HEALTH-HABIT-029: the server-computed streak is dropped — days are the source', async () => {
    api.listHabits.mockResolvedValue(
      ok({ habits: [habitRow({ id: 'srv-1', days: ['2026-07-13', '2026-07-12'], streak: 99 })] })
    );

    const [loaded] = await loadHabits();

    // The `streak` column is a server convenience for the widget/watch; the
    // screen derives it from `days` so an offline tick updates the number
    // immediately instead of waiting for a round trip.
    expect(loaded).not.toHaveProperty('streak');
    expect(streakOf(loaded.days, TODAY)).toBe(2);
  });

  it('HEALTH-HABIT-030: a payload with no habits list seeds, rather than crashing', async () => {
    // A truncated answer looks exactly like a fresh account, which is the safe
    // reading: `res.habits` is indexed straight after, so an absent key would
    // otherwise throw on the very first read of the Habits tab.
    api.listHabits.mockResolvedValue(ok({} as { habits: HealthHabit[] }));
    api.createHabit.mockImplementation((body) =>
      Promise.resolve(ok({ habit: habitRow({ id: `srv-${body.name}`, name: body.name }) }))
    );

    expect((await loadHabits()).map((h) => h.name)).toEqual(DEFAULT_HABITS.map((h) => h.name));
  });

  it('HEALTH-HABIT-031: a seed POST that comes back without a row is skipped, not blank', async () => {
    // The one starter habit the server failed to echo back is simply absent —
    // pushing an undefined row would put a nameless, untappable line in the
    // list on the member's very first open.
    api.listHabits.mockResolvedValue(ok({ habits: [] }));
    let call = 0;
    api.createHabit.mockImplementation((body) => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? (ok({}) as { habit: HealthHabit })
          : ok({ habit: habitRow({ id: `srv-${call}`, name: body.name }) })
      );
    });

    const habits = await loadHabits();

    expect(habits).toHaveLength(DEFAULT_HABITS.length - 1);
    expect(habits.every((h) => typeof h.name === 'string' && h.name.length > 0)).toBe(true);
    expect(habits.map((h) => h.name)).not.toContain(DEFAULT_HABITS[0].name);
  });

  it('HEALTH-HABIT-032: a row with no day list reads as never ticked', async () => {
    api.listHabits.mockResolvedValue(
      ok({
        habits: [habitRow({ id: 'srv-1', days: undefined as unknown as string[] })],
      })
    );

    const [loaded] = await loadHabits();

    // The dot strip and the streak walk both iterate `days`; an absent column
    // has to read as an untouched habit, not as a crash on the strip.
    expect(loaded.days).toEqual([]);
    expect(streakOf(loaded.days, TODAY)).toBe(0);
  });

  it('HEALTH-HABIT-228: a row with no sort_order column reads as first, not undefined', async () => {
    api.listHabits.mockResolvedValue(
      ok({ habits: [habitRow({ id: 'srv-1', sort_order: undefined as unknown as number })] })
    );

    const [loaded] = await loadHabits();

    // The list sorts by `sortOrder`; `undefined` sorted alongside numbers is a
    // silently unstable order, not a visible bug, so this has to default to a
    // real number rather than passing the column through as-is.
    expect(loaded.sortOrder).toBe(0);
  });

  it('HEALTH-HABIT-028: caps the list at 40 habits and each history at 400 days', async () => {
    api.listHabits.mockResolvedValue(
      ok({
        habits: Array.from({ length: 45 }, (_, i) =>
          habitRow({
            id: `h${i}`,
            name: `Habit ${i}`,
            days: Array.from({ length: 500 }, (_unused, d) => `day-${d}`),
          })
        ),
      })
    );

    const habits = await loadHabits();

    // The dot strip and the streak walk are O(days); an unbounded history from a
    // long-running account would make every render walk thousands of strings.
    // The list cap moved 20 → 40 with the preset library: 19 presets plus the
    // five starters is already 24, so a 20-cap would have hidden rows the
    // member had just added from the browser.
    expect(habits).toHaveLength(40);
    expect(habits[0].days).toHaveLength(400);
  });

  it('HEALTH-HABIT-011: toggling marks today, toggling again unmarks it', async () => {
    fakeHabitServer(seededRows());

    let habits = await toggleHabitToday('sleep');
    expect(habits.find((h) => h.id === 'sleep')?.days).toEqual([TODAY]);

    habits = await toggleHabitToday('sleep');
    expect(habits.find((h) => h.id === 'sleep')?.days).toEqual([]);
  });

  it('HEALTH-HABIT-020: toggleHabitToday posts the habit id and the day key', async () => {
    fakeHabitServer(seededRows());

    await toggleHabitToday('sleep', '2026-07-12');

    // The date is explicit on the wire so a tick made just before midnight
    // cannot land on the server's day instead of the user's.
    expect(api.toggleHabit).toHaveBeenCalledWith('sleep', '2026-07-12');
  });

  it('HEALTH-HABIT-012: toggling one habit leaves the others untouched', async () => {
    fakeHabitServer(seededRows());

    const habits = await toggleHabitToday('move');
    expect(habits.find((h) => h.id === 'move')?.days).toEqual([TODAY]);
    expect(habits.find((h) => h.id === 'sleep')?.days).toEqual([]);
  });

  it('HEALTH-HABIT-013: an unknown id is a no-op rather than an error', async () => {
    fakeHabitServer(seededRows());

    const habits = await toggleHabitToday('does-not-exist');
    expect(habits.every((h) => h.days.length === 0)).toBe(true);
  });

  it('HEALTH-HABIT-014: a tick survives a reload — the day list is what persists', async () => {
    fakeHabitServer(seededRows());

    await toggleHabitToday('sleep');
    const reloaded = await loadHabits();

    expect(reloaded.find((h) => h.id === 'sleep')?.days).toEqual([TODAY]);
    expect(streakOf(reloaded.find((h) => h.id === 'sleep')!.days, TODAY)).toBe(1);
  });

  it('HEALTH-HABIT-015: adds a custom habit and trims its name', async () => {
    fakeHabitServer(seededRows());

    const habits = await addHabit('  Walk after lunch  ');
    expect(habits[habits.length - 1].name).toBe('Walk after lunch');
    expect(habits.length).toBe(DEFAULT_HABITS.length + 1);
  });

  it('HEALTH-HABIT-021: addHabit posts the trimmed name and the default kit icon', async () => {
    fakeHabitServer(seededRows());

    await addHabit('  Walk after lunch  ');

    expect(api.createHabit).toHaveBeenCalledWith({ name: 'Walk after lunch', icon: 'goals' });
  });

  it('HEALTH-HABIT-016: refuses a blank name instead of adding an unnamed row', async () => {
    fakeHabitServer(seededRows());

    const habits = await addHabit('   ');
    expect(habits.length).toBe(DEFAULT_HABITS.length);
    expect(api.createHabit).not.toHaveBeenCalled(); // no wasted round trip
  });

  it('HEALTH-HABIT-022: refuses to add past the 40-habit cap', async () => {
    fakeHabitServer(
      Array.from({ length: 40 }, (_, i) => habitRow({ id: `h${i}`, name: `Habit ${i}` }))
    );

    // The cap is enforced BEFORE the request, so a full list cannot create a
    // 41st row server-side that the reader would then silently hide.
    expect(await addHabit('One too many')).toHaveLength(40);
    expect(api.createHabit).not.toHaveBeenCalled();
  });

  it('HEALTH-HABIT-017: deletes a habit and its history', async () => {
    fakeHabitServer(seededRows());

    await toggleHabitToday('sleep');
    const habits = await deleteHabit('sleep');

    expect(habits.map((h) => h.id)).not.toContain('sleep');
    expect(api.deleteHabit).toHaveBeenCalledWith('sleep');
    expect((await loadHabits()).map((h) => h.id)).not.toContain('sleep');
  });
});

describe('healthHabitsStorage — offline contract', () => {
  it('HEALTH-HABIT-024: a failed read falls back to the cached habits', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit({ id: 'cached', days: [TODAY] })]);
    api.listHabits.mockRejectedValue(NETWORK_ERROR);

    expect((await loadHabits()).map((h) => h.id)).toEqual(['cached']);
    expect(healthSyncStateFor(HEALTH_HABITS_KEY)).toBe('offline');
  });

  it('HEALTH-HABIT-025: a first run with no signal still shows the starter set', async () => {
    __setHealthOfflineForTests(true);

    const habits = await loadHabits();

    // The offline fallback is the same starter set a first online run would be
    // seeded with, so the screen never opens on a blank list.
    expect(habits.map((h) => h.id)).toEqual(DEFAULT_HABITS.map((h) => h.id));
    expect(api.createHabit).not.toHaveBeenCalled();
  });

  it('HEALTH-HABIT-026: an offline toggle returns the optimistic day list', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit({ id: 'sleep', days: ['2026-07-12'] })]);
    __setHealthOfflineForTests(true);

    const habits = await toggleHabitToday('sleep');

    // Ticking has to feel instant in a gym with no signal; the day sorts into
    // the history newest-first so `streakOf` still walks it correctly.
    expect(habits[0].days).toEqual([TODAY, '2026-07-12']);
    expect(streakOf(habits[0].days, TODAY)).toBe(2);
    expect(api.toggleHabit).not.toHaveBeenCalled();
  });

  it('HEALTH-HABIT-009: an explicitly emptied cached list stays empty', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, []);
    __setHealthOfflineForTests(true);

    // A user who deleted every habit must not have the starter set resurrected
    // by the offline fallback — an empty cache is a real answer, not a miss.
    expect(await loadHabits()).toEqual([]);
  });

  it('HEALTH-HABIT-010: corrupt rows inside a cached array are dropped', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, [habit({ id: 'ok' }), null, { id: 'x' }]);
    __setHealthOfflineForTests(true);

    expect((await loadHabits()).map((h) => h.id)).toEqual(['ok']);
  });

  it('HEALTH-HABIT-027: a non-array cached snapshot degrades to the starter set, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_HABITS_KEY, 'nope');
    __setHealthOfflineForTests(true);

    // Fixed 2026-07-25: `readThrough` now rejects a cached snapshot whose shape
    // does not match the caller's fallback, so a corrupt or schema-drifted blob
    // degrades gracefully instead of throwing a TypeError into the screen — on
    // exactly the offline path the cache exists to protect.
    //
    // Habits fall back to the SEEDED starter set rather than []: that is what a
    // first run shows, and an empty habits screen offline would look like the
    // user's habits had been deleted.
    const habits = await loadHabits();
    expect(habits.map((h) => h.id)).toEqual(DEFAULT_HABITS.map((h) => h.id));
    expect(habits.every((h) => h.days.length === 0)).toBe(true);
  });
});
