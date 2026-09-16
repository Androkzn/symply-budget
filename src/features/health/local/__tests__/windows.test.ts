/**
 * **He3b Exit — "read-window test per loader" (plan §12.1).**
 *
 * The sentence this file enforces, quoted from the plan and repeated at the top
 * of `windows.ts`:
 *
 * > *"A local method that returns the full table where the remote returned a
 * > window is a He3 blocker, not a perf nit."*
 *
 * ## Why it iterates the registry instead of listing loaders
 *
 * There is **no hand-maintained list of loaders in this file**. Every `describe`
 * below is generated from `HEALTH_READ_WINDOWS`, and `LOADER_PROBES` is typed
 * `Record<HealthLoaderName, …>` — so a loader added to the registry without a
 * probe is a **compile error**, and a loader added to Home without a registry
 * entry fails the `HEALTH_HOME_LOADER_COUNT` assertion. A list maintained by
 * hand is a list that goes stale exactly when it matters: the 18th Home loader,
 * added a year from now, reading the whole nutrition table on every focus.
 *
 * ## What "no more rows than the window" means per kind
 *
 * The corpus is seeded ONE ROW PER DAY over more days than any window covers,
 * plus a burst of extra rows dated today (six glasses of water in one day is the
 * real shape of `water_entries`). That makes every window kind expressible as a
 * row ceiling:
 *
 *  - `rows` → `maxRows`, directly.
 *  - `days: N` → the N+1 days it spans (inclusive at both ends), times one row
 *    per day, plus today's burst.
 *  - `singleDay` → one day, plus today's burst — or `maxRows` when it carries
 *    one (`loadWaterDay`'s 60).
 *  - `callerRange` / `unbounded` → no ceiling by construction. Those are
 *    asserted the other way: the registry must state a REASON, so an unbounded
 *    read reads as a decision rather than as an oversight.
 *
 * Each bounded read is also asserted to serve **fewer rows than were seeded** —
 * a window that is registered but never applied passes a `<=` check trivially
 * when the corpus happens to be small, and this is the assertion that would have
 * caught it.
 *
 * ## Facades that are not on disk yet
 *
 * He3b lands as several files, so a loader can outrun the facade that serves it.
 * Such a loader is **not skipped silently**: `TableProbe.served` is optional, and
 * a probe without it still gets its registry entry asserted (window, note,
 * provenance, reason) while the call becomes an `it.todo` naming the facade that
 * owes it — visible in the report rather than absent from it. Every read
 * currently has a live probe; the branch stays for the next one that does not.
 *
 * ## Aggregates serve rows too
 *
 * Three reads reach the ledger through a method that returns a SUMMARY rather
 * than rows — `waterSummary` and `getWeeklyTrend`. They are still probed, not
 * exempted: `HealthWaterSummary.entry_count` is literally the number of rows the
 * day's total was summed from, and the trend's day slots are the fourteen days
 * its two windows cover. An aggregate computed over the whole table instead of
 * the window is exactly the regression this file exists to catch, and it shows
 * up in those numbers.
 *
 * ## Seeding writes straight to the ledger
 *
 * The corpus is pushed onto the live ledger arrays rather than written through
 * the facades. This suite exercises READS; routing ~4000 seed rows through
 * `writeLocal` would re-capture and re-diff the whole ledger 4000 times
 * (`localWrite.ts` header) and turn a one-second suite into a minute of
 * cryptography that proves nothing about windows.
 */
import {
  closeLocalHealthSession,
  getLocalHealthLedger,
  openLocalHealthSessionForTests,
} from '../engine';
import { localDateKey } from '../ids';
import { localBodyApi } from '../localBodyApi';
import { localEntriesApi } from '../localEntriesApi';
import { localGoalsApi } from '../localGoalsApi';
import { localHabitsApi } from '../localHabitsApi';
import { localNutritionApi } from '../localNutritionApi';
import { localSummariesApi } from '../localSummariesApi';
import { localWaterApi } from '../localWaterApi';
import { localWeightApi } from '../localWeightApi';
import { HEALTH_LEDGER_TABLE_NAMES, type HealthLedgerTableName } from '../schema';
import type {
  LocalBodyMeasurement,
  LocalHabitLog,
  LocalHealthEntry,
  LocalHealthGoal,
  LocalNutritionEntry,
  LocalUserHabit,
  LocalWaterEntry,
  LocalWeightEntry,
} from '../types';
import {
  HEALTH_HOME_LOADERS,
  HEALTH_HOME_LOADER_COUNT,
  HEALTH_LOADER_NAMES,
  HEALTH_READ_WINDOWS,
  maxDaysForWindow,
  maxRowsForWindow,
  type HealthLedgerRead,
  type HealthLoaderName,
  type HealthReadWindow,
} from '../windows';

const USER_ID = 'user_windows_test';
const HABIT_WITH_LOGS = 'habit_windows_0';

/* ------------------------------------------------------------------ */
/* The corpus                                                          */
/* ------------------------------------------------------------------ */

/**
 * Dated log tables: one row per day going back `days`, plus `extraToday` more
 * rows all dated today.
 *
 * `days` is chosen to exceed the widest window on that table so every window
 * genuinely bites: 1200 for `bodyMeasurements` (1000-row window), 600 for the
 * 400-day and 500-row tables, 200 for nutrition's 120 days.
 *
 * `extraToday` is what makes a `singleDay` window's ceiling a real number rather
 * than "one row": `loadWaterDay` allows sixty rows on one day precisely because
 * a member logs many glasses on one day.
 */
const DATED_SEED: Partial<Record<HealthLedgerTableName, { days: number; extraToday: number }>> = {
  weightEntries: { days: 600, extraToday: 4 },
  waterEntries: { days: 600, extraToday: 80 },
  nutritionEntries: { days: 200, extraToday: 12 },
  healthEntries: { days: 600, extraToday: 3 },
  bodyMeasurements: { days: 1200, extraToday: 2 },
  // No burst: `unique(habit_id, date)` means a second row for one habit on one
  // day is not a second log, it is the SAME log. The per-habit day window is
  // what this table's seed has to stress, so it is one row per day per habit.
  habitLogs: { days: 600, extraToday: 0 },
};

/**
 * Always-resident tables (`schema.ts` — "must load without a month probe"), so
 * a flat count rather than a calendar.
 */
const FLAT_SEED: Partial<Record<HealthLedgerTableName, number>> = {
  // Over the 40-row window, so `loadHabits` has something to truncate.
  userHabits: 60,
  // Several day-slots, so `goalFor`'s "newest with effective_date <= date" has
  // more than one candidate and the 1-row window is doing real work.
  healthGoals: 5,
};

/** The three `entry_type`s the registry filters on, seeded side by side. */
const ENTRY_TYPES = ['workout', 'steps', 'sleep'] as const;

function dayKey(daysAgo: number): string {
  return localDateKey(new Date(Date.now() - daysAgo * 86_400_000));
}

function stamp(daysAgo: number, index = 0): string {
  return `${dayKey(daysAgo)}T${String(index % 24).padStart(2, '0')}:00:00.000Z`;
}

function base(id: string, daysAgo: number, index: number) {
  return {
    id,
    user_id: USER_ID,
    created_at: stamp(daysAgo, index),
    updated_at: stamp(daysAgo, index),
    deleted_at: null,
  };
}

/** Push the corpus straight onto the live ledger — see the header. */
function seedLedger(): void {
  const ledger = getLocalHealthLedger();

  const weight = DATED_SEED.weightEntries!;
  for (let i = 0; i < weight.days + weight.extraToday; i += 1) {
    const daysAgo = i < weight.days ? i : 0;
    ledger.weightEntries.push({
      ...base(`w_${i}`, daysAgo, i),
      date: dayKey(daysAgo),
      weight: 80,
      unit: 'kg',
      note: null,
      source: 'manual',
    } as LocalWeightEntry);
  }

  const water = DATED_SEED.waterEntries!;
  for (let i = 0; i < water.days + water.extraToday; i += 1) {
    const daysAgo = i < water.days ? i : 0;
    ledger.waterEntries.push({
      ...base(`h2o_${i}`, daysAgo, i),
      date: dayKey(daysAgo),
      amount_ml: 240,
      beverage_type: 'water',
      container: null,
    } as LocalWaterEntry);
  }

  const nutrition = DATED_SEED.nutritionEntries!;
  for (let i = 0; i < nutrition.days + nutrition.extraToday; i += 1) {
    const daysAgo = i < nutrition.days ? i : 0;
    ledger.nutritionEntries.push({
      ...base(`n_${i}`, daysAgo, i),
      date: dayKey(daysAgo),
      food_name: 'Oats',
      portion: 100,
      unit: 'g',
      meal_type: 'breakfast',
      calories: 300,
      proteins: 10,
      carbohydrates: 50,
      fats: 5,
      source: 'manual',
    } as LocalNutritionEntry);
  }

  // One row per type per day: the registry applies `entry_type` BEFORE the
  // 400-row limit, so each type must independently overflow its window.
  const entries = DATED_SEED.healthEntries!;
  for (const entryType of ENTRY_TYPES) {
    for (let i = 0; i < entries.days + entries.extraToday; i += 1) {
      const daysAgo = i < entries.days ? i : 0;
      ledger.healthEntries.push({
        ...base(`e_${entryType}_${i}`, daysAgo, i),
        date: dayKey(daysAgo),
        entry_type: entryType,
        data: '{}',
        source: 'manual',
        intensity: null,
      } as LocalHealthEntry);
    }
  }

  const body = DATED_SEED.bodyMeasurements!;
  for (let i = 0; i < body.days + body.extraToday; i += 1) {
    const daysAgo = i < body.days ? i : 0;
    ledger.bodyMeasurements.push({
      ...base(`bm_${i}`, daysAgo, i),
      date: dayKey(daysAgo),
      unit: 'cm',
      waist: 82,
    } as LocalBodyMeasurement);
  }

  for (let i = 0; i < FLAT_SEED.userHabits!; i += 1) {
    ledger.userHabits.push({
      ...base(i === 0 ? HABIT_WITH_LOGS : `habit_windows_${i}`, 0, i),
      name: `Habit ${i}`,
      icon: 'goals',
      category: 'custom',
      time_of_day: 'anytime',
      frequency: 'daily',
      custom_days: null,
      reminder_time: null,
      reminder_enabled: 0,
      target_duration: null,
      notes: null,
      is_archived: 0,
      sort_order: i,
    } as LocalUserHabit);
  }

  // Every log belongs to ONE habit, because the window is per habit.
  const logs = DATED_SEED.habitLogs!;
  for (let i = 0; i < logs.days; i += 1) {
    ledger.habitLogs.push({
      ...base(`hl_${i}`, i, i),
      habit_id: HABIT_WITH_LOGS,
      date: dayKey(i),
      time_of_day: 'anytime',
      completed_at: stamp(i, i),
      duration: null,
      notes: null,
    } as LocalHabitLog);
  }

  for (let i = 0; i < FLAT_SEED.healthGoals!; i += 1) {
    ledger.healthGoals.push({
      ...base(`hg_${i}`, i * 30, i),
      effective_date: dayKey(i * 30),
      daily_calories: 2000 + i,
      daily_water_ml: 2000,
    } as LocalHealthGoal);
  }
}

/** How many rows of a table the corpus actually holds. */
function seededRows(table: HealthLedgerTableName): number {
  return (getLocalHealthLedger() as unknown as Record<string, unknown[]>)[table]?.length ?? 0;
}

/* ------------------------------------------------------------------ */
/* Probes — one per (loader, table) the registry declares              */
/* ------------------------------------------------------------------ */

/**
 * How a loader's read is actually served locally.
 *
 * `served` returns the DAY KEYS the local method handed back for that table, so
 * one probe answers both questions the window asks: how many rows, and how far
 * back. `served` absent means the facade has not landed — see `PENDING_FACADES`.
 */
type TableProbe = {
  /** `module.method`, the local facade that serves this read. */
  readonly via: string;
  readonly served?: () => Promise<readonly string[]>;
  /**
   * The from/to the probe asked for, when the window is a `callerRange` with no
   * row cap. That is the ONE case with no ceiling to check, so the range itself
   * becomes the assertion: *"honour the caller's from/to exactly; there is no
   * row cap to fall back on"* (`windows.ts`, `listExistingNutrition`).
   */
  readonly callerRange?: { readonly from: string; readonly to: string };
};

type LoaderProbes = Partial<Record<HealthLedgerTableName, TableProbe>>;

const goalProbe: TableProbe = {
  via: 'localGoalsApi.getGoal',
  served: async () => {
    const { goal } = await localGoalsApi.getGoal();
    return goal ? [goal.effective_date] : [];
  },
};

/**
 * `loadWaterHistory` asks for MORE than the registry allows on purpose.
 *
 * The client sends a 400-day from/to; asking for 600 here proves the ceiling is
 * the registered WINDOW and not the caller's query — which is the only version
 * of this assertion that would catch a facade that simply forwards `from`/`to`.
 */
const waterHistoryProbe: TableProbe = {
  via: 'localWaterApi.listWater',
  served: async () => {
    const { entries } = await localWaterApi.listWater({ from: dayKey(600), to: dayKey(0) });
    return entries.map((entry) => entry.date);
  },
};

const waterDayProbe: TableProbe = {
  via: 'localWaterApi.listWater',
  served: async () => {
    const { entries } = await localWaterApi.listWater({ from: dayKey(0), to: dayKey(0) });
    return entries.map((entry) => entry.date);
  },
};

const bodyProbe: TableProbe = {
  via: 'localBodyApi.listMeasurements',
  served: async () => {
    const { measurements } = await localBodyApi.listMeasurements();
    return measurements.map((row) => row.date);
  },
};

const habitsProbe: TableProbe = {
  via: 'localHabitsApi.listHabits',
  served: async () => {
    const { habits } = await localHabitsApi.listHabits();
    return habits.map((habit) => habit.created_at.slice(0, 10));
  },
};

/**
 * The 400 days are PER HABIT (`windows.ts`: *"400 days is PER HABIT"*), so the
 * busiest habit is the measurement — a per-table total would pass while one
 * habit alone dragged a decade of ticks onto Home.
 */
const habitLogsProbe: TableProbe = {
  via: 'localHabitsApi.listHabits',
  served: async () => {
    const { habits } = await localHabitsApi.listHabits();
    return habits.reduce<readonly string[]>(
      (widest, habit) => (habit.days.length > widest.length ? habit.days : widest),
      [],
    );
  },
};

const oneHabitProbe: TableProbe = {
  via: 'localHabitsApi.listHabits',
  served: async () => {
    const { habits } = await localHabitsApi.listHabits();
    const one = habits.find((habit) => habit.id === HABIT_WITH_LOGS);
    return one ? [one.created_at.slice(0, 10)] : [];
  },
};

const oneHabitLogsProbe: TableProbe = {
  via: 'localHabitsApi.listHabits',
  served: async () => {
    const { habits } = await localHabitsApi.listHabits();
    return habits.find((habit) => habit.id === HABIT_WITH_LOGS)?.days ?? [];
  },
};

/** `loadWeightLog` sends `limit: MAX_WEIGHT_ENTRIES` (`healthLocalStorage.ts:283`). */
const weightLogProbe: TableProbe = {
  via: 'localWeightApi.listWeight',
  served: async () => {
    const { entries } = await localWeightApi.listWeight({ limit: 500 });
    return entries.map((entry) => entry.date);
  },
};

/**
 * ⚠️ 200, not 500. The drain sends NO `limit` over its own range, so the route's
 * default applies — the registry's own warning on this entry.
 */
const drainWeightProbe: TableProbe = {
  via: 'localWeightApi.listWeight',
  served: async () => {
    const { entries } = await localWeightApi.listWeight({ from: dayKey(600), to: dayKey(0) });
    return entries.map((entry) => entry.date);
  },
};

/** No parameters — the 120-day window is the whole ceiling, per the registry. */
const mealsProbe: TableProbe = {
  via: 'localNutritionApi.listNutrition',
  served: async () => {
    const { entries } = await localNutritionApi.listNutrition({});
    return entries.map((entry) => entry.date);
  },
};

const mealsForDateProbe: TableProbe = {
  via: 'localNutritionApi.listNutrition',
  served: async () => {
    const { entries } = await localNutritionApi.listNutrition({ date: dayKey(0) });
    return entries.map((entry) => entry.date);
  },
};

/**
 * The only genuinely range-only read in the registry: `listNutrition` carries no
 * server limit, so there is no ceiling to assert — the caller's own from/to is
 * the whole window, and honouring it exactly is the contract.
 */
const DRAIN_NUTRITION_RANGE = { from: dayKey(30), to: dayKey(0) } as const;

const drainNutritionProbe: TableProbe = {
  via: 'localNutritionApi.listNutrition',
  callerRange: DRAIN_NUTRITION_RANGE,
  served: async () => {
    const { entries } = await localNutritionApi.listNutrition({ ...DRAIN_NUTRITION_RANGE });
    return entries.map((entry) => entry.date);
  },
};

/**
 * `entry_type` is INSIDE the window, not outside it.
 *
 * The corpus holds one row per day per type, so a facade that took the newest
 * 400 rows and filtered afterwards would serve roughly a third of them — the
 * exact bug `windows.ts` names ("zero workouts for anyone who logs steps
 * daily"), caught here as a count.
 */
function entriesProbe(type: 'workout' | 'steps' | 'sleep'): TableProbe {
  return {
    via: 'localEntriesApi.listEntries',
    served: async () => {
      const { entries } = await localEntriesApi.listEntries({ type, limit: 400 });
      return entries.map((entry) => entry.date);
    },
  };
}

const stepsForDateProbe: TableProbe = {
  via: 'localEntriesApi.listEntries',
  served: async () => {
    const { entries } = await localEntriesApi.listEntries({
      type: 'steps',
      from: dayKey(0),
      to: dayKey(0),
    });
    return entries.map((entry) => entry.date);
  },
};

const drainEntriesProbe: TableProbe = {
  via: 'localEntriesApi.listEntries',
  served: async () => {
    const { entries } = await localEntriesApi.listEntries({ from: dayKey(600), to: dayKey(0) });
    return entries.map((entry) => entry.date);
  },
};

/**
 * An aggregate, probed through the count it carries.
 *
 * `entry_count` is how many rows the day's total was summed from, so a summary
 * computed over the whole table instead of the single day shows up here as
 * hundreds instead of the day's own burst.
 */
const waterTodayProbe: TableProbe = {
  via: 'localSummariesApi.waterSummary',
  served: async () => {
    const { summary } = await localSummariesApi.waterSummary(dayKey(0));
    return Array.from({ length: summary.entry_count }, () => summary.date);
  },
};

/**
 * The trend's own day slots ARE its window: two calendar weeks, fourteen days,
 * one slot per day. A read that widened past the registered 14 would surface as
 * more slots, and one anchored on wall-clock now rather than on the week would
 * surface as slots outside the floor.
 */
const weeklyTrendNutritionProbe: TableProbe = {
  via: 'localSummariesApi.getWeeklyTrend',
  served: async () => {
    const trend = await localSummariesApi.getWeeklyTrend();
    return [...trend.this_week.days, ...trend.last_week.days].map((day) => day.date);
  },
};

const weeklyTrendWeightProbe: TableProbe = {
  via: 'localSummariesApi.getWeeklyTrend',
  served: async () => {
    const trend = await localSummariesApi.getWeeklyTrend();
    return [...trend.this_week.daily_weight, ...trend.last_week.daily_weight].map(
      (point) => point.date,
    );
  },
};

/**
 * Loader → the probe for each table it reads.
 *
 * Typed `Record<HealthLoaderName, …>`, so this object cannot compile with a
 * loader missing. The per-loader `it` below additionally proves each declared
 * READ has a probe, which the type alone cannot express.
 */
const LOADER_PROBES: Record<HealthLoaderName, LoaderProbes> = {
  // ---- Home, in `HealthHomeScreen.tsx:198-219` order ----
  loadWeightLog: { weightEntries: weightLogProbe },
  loadHealthPrefs: { healthGoals: goalProbe },
  loadWaterToday: { waterEntries: waterTodayProbe, healthGoals: goalProbe },
  loadWaterHistory: { waterEntries: waterHistoryProbe, healthGoals: goalProbe },
  loadNoteForDate: {},
  loadMeals: { nutritionEntries: mealsProbe },
  loadNutritionGoals: { healthGoals: goalProbe },
  loadWorkouts: { healthEntries: entriesProbe('workout') },
  loadStepDays: { healthEntries: entriesProbe('steps') },
  loadActivityGoals: { healthGoals: goalProbe },
  loadHabits: { userHabits: habitsProbe, habitLogs: habitLogsProbe },
  loadBodyEntries: { bodyMeasurements: bodyProbe },
  loadSleepLog: { healthEntries: entriesProbe('sleep'), healthGoals: goalProbe },
  loadHomeLayout: {},
  loadWeeklyTrend: {
    weightEntries: weeklyTrendWeightProbe,
    nutritionEntries: weeklyTrendNutritionProbe,
  },
  loadChallengesWeeklyOverview: {},
  loadChallengesWidgetExpanded: {},
  // ---- Off Home ----
  loadMealsForDate: { nutritionEntries: mealsForDateProbe },
  loadWaterDay: { waterEntries: waterDayProbe, healthGoals: goalProbe },
  loadStepsForDate: { healthEntries: stepsForDateProbe },
  loadHabit: { userHabits: oneHabitProbe, habitLogs: oneHabitLogsProbe },
  loadWeightGoal: { healthGoals: goalProbe },
  loadWaterPrefs: { healthGoals: goalProbe },
  loadCalorieWeek: { healthGoals: goalProbe },
  loadMacroWeek: { healthGoals: goalProbe },
  loadHealthGoals: {},
  // ---- He11 Wave B drain ----
  'healthKitImportSink.listExisting': { healthEntries: drainEntriesProbe },
  'healthKitImportSink.listExistingWeight': { weightEntries: drainWeightProbe },
  'healthKitImportSink.listExistingNutrition': { nutritionEntries: drainNutritionProbe },
};

/* ------------------------------------------------------------------ */
/* Ceilings, derived from the window and the seed                      */
/* ------------------------------------------------------------------ */

/**
 * The most rows this window may serve out of the seeded corpus, or `null` when
 * the window declares no ceiling at all (`callerRange` without `maxRows`,
 * `unbounded`).
 *
 * Derived from `maxRowsForWindow` / `maxDaysForWindow` — the two helpers
 * `windows.ts` exports for exactly this — plus the seed's own shape, never from
 * a number restated here.
 */
function ceilingFor(read: HealthLedgerRead): number | null {
  const rows = maxRowsForWindow(read.window);
  if (rows !== null) return rows;
  const days = maxDaysForWindow(read.window);
  if (days === null) return null;
  // A day window is inclusive at both ends, so N days spans N+1 day keys; every
  // extra row dated today falls inside any of them.
  return days + 1 + (DATED_SEED[read.table]?.extraToday ?? 0);
}

/** The oldest day key the window may reach back to, or `null` when undated. */
function floorFor(window: HealthReadWindow): string | null {
  const days = maxDaysForWindow(window);
  if (days === null) return null;
  return window.kind === 'singleDay' ? localDateKey() : dayKey(days);
}

/* ------------------------------------------------------------------ */
/* The suite                                                           */
/* ------------------------------------------------------------------ */

describe('He3b read windows (plan §7, §12.1)', () => {
  beforeAll(async () => {
    await openLocalHealthSessionForTests({ userId: USER_ID });
    seedLedger();
  });

  afterAll(async () => {
    await closeLocalHealthSession();
  });

  /* ---------------- registry-level invariants ---------------- */

  it('registers all 17 Home loaders — derived, never listed', () => {
    expect(HEALTH_HOME_LOADERS).toHaveLength(HEALTH_HOME_LOADER_COUNT);
    expect(HEALTH_HOME_LOADER_COUNT).toBe(17);
  });

  it('has a probe for every registered loader, and no probe for a loader that is gone', () => {
    expect(Object.keys(LOADER_PROBES).sort()).toEqual([...HEALTH_LOADER_NAMES].sort());
  });

  it('reads only tables the ledger registry knows about', () => {
    for (const name of HEALTH_LOADER_NAMES) {
      for (const read of HEALTH_READ_WINDOWS[name].reads) {
        expect(HEALTH_LEDGER_TABLE_NAMES).toContain(read.table);
      }
    }
  });

  it('never reads one table twice in a single loader', () => {
    // The probe map is keyed by table; two reads of one table would silently
    // collapse into one probe and leave a window unasserted.
    for (const name of HEALTH_LOADER_NAMES) {
      const tables = HEALTH_READ_WINDOWS[name].reads.map((read) => read.table);
      expect(new Set(tables).size).toBe(tables.length);
    }
  });

  it('states a REASON wherever a read is unbounded or caller-ranged', () => {
    for (const name of HEALTH_LOADER_NAMES) {
      for (const read of HEALTH_READ_WINDOWS[name].reads) {
        if (read.window.kind !== 'unbounded' && read.window.kind !== 'callerRange') continue;
        // An omission reads as an oversight; the next engineer cannot tell the
        // two apart. `windows.ts` header, and the point of the `reason` field.
        expect(read.window.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('records where BOTH halves of every window were read from', () => {
    for (const name of HEALTH_LOADER_NAMES) {
      const entry = HEALTH_READ_WINDOWS[name];
      expect(entry.note.length).toBeGreaterThan(0);
      expect(entry.module.length).toBeGreaterThan(0);
      // "Keep the key identical to the exported function name so the two can be
      // cross-checked mechanically" (`windows.ts`). This is that cross-check.
      expect(entry.loader).toBe(name);
      for (const read of entry.reads) {
        // The window is min(client, server) — a window sourced from one half
        // gets `loadBodyEntries` and `loadHabits` exactly backwards.
        expect(read.client.length).toBeGreaterThan(0);
        expect(read.server.length).toBeGreaterThan(0);
      }
    }
  });

  it('seeds every ledger table past its widest window', () => {
    const seeded = new Set([...Object.keys(DATED_SEED), ...Object.keys(FLAT_SEED)]);
    expect([...seeded].sort()).toEqual([...HEALTH_LEDGER_TABLE_NAMES].sort());
    for (const table of HEALTH_LEDGER_TABLE_NAMES) {
      expect(seededRows(table)).toBeGreaterThan(0);
    }
  });

  /* ---------------- per loader, generated from the registry ---------------- */

  for (const name of HEALTH_LOADER_NAMES) {
    const entry = HEALTH_READ_WINDOWS[name];
    const probes = LOADER_PROBES[name];

    describe(`${name}${entry.onHome ? ' (Home)' : ''}`, () => {
      if (entry.reads.length === 0) {
        it('reads no ledger table at all, and says why', () => {
          // MMKV-only loaders and pure composites. `loadNoteForDate` is the one
          // that matters: notes stay in MMKV and are NOT a ninth ledger key.
          expect(Object.keys(probes)).toHaveLength(0);
          expect(entry.note.length).toBeGreaterThan(0);
          expect(entry.reads).toHaveLength(0);
        });
        return;
      }

      it('declares a probe for every table it reads', () => {
        for (const read of entry.reads) {
          expect(probes[read.table]).toBeDefined();
        }
      });

      for (const read of entry.reads) {
        const probe = probes[read.table];
        const ceiling = ceilingFor(read);
        const floor = floorFor(read.window);
        const label = `${read.table} — ${read.window.kind}${
          ceiling === null ? ' (no ceiling)' : ` ≤ ${ceiling} rows`
        }`;

        if (ceiling === null) {
          it(`${label}: the registry states why it is unwindowed`, () => {
            expect(read.window.kind === 'callerRange' || read.window.kind === 'unbounded').toBe(
              true,
            );
          });

          const range = probe?.callerRange;
          if (probe?.served && range) {
            it(`${label}: honours the caller's ${range.from}…${range.to} exactly`, async () => {
              const served = await probe.served!();
              for (const day of served) {
                expect(day >= range.from && day <= range.to).toBe(true);
              }
              // No row cap to fall back on, so the RANGE has to be the ceiling.
              expect(served.length).toBeLessThan(seededRows(read.table));
            });
          }
          continue;
        }

        if (!probe?.served) {
          // Named, not skipped — see the header.
          it.todo(`${label}: awaiting ${probe?.via ?? 'an unassigned facade'}`);
          continue;
        }

        it(`${label}: serves no more rows than the window allows`, async () => {
          const served = await probe.served!();
          expect(served.length).toBeLessThanOrEqual(ceiling);
          // …and the window is actually APPLIED, not merely registered: the
          // corpus is deliberately larger than every window on its table.
          expect(served.length).toBeLessThan(seededRows(read.table));
        });

        if (floor !== null) {
          it(`${label}: serves nothing older than ${floor}`, async () => {
            const served = await probe.served!();
            for (const day of served) expect(day >= floor).toBe(true);
          });
        }
      }
    });
  }
});
