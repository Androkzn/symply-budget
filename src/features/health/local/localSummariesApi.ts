/**
 * `healthApi`'s **summary / streak / trend** surface, served from the on-device
 * ledger — He3c, and the **He7-lite Hard Exit of He3** (plan §7, §9).
 *
 * `src/api/health.ts:10-12` states the design this file replaces: *"summaries,
 * statistics, streaks and cycle predictions are computed server-side so the
 * phone, widget and watch can never disagree."* Under E2EE that sentence
 * describes a bug — the Worker holds no rows for a flag-1 member, so every
 * figure it computes is a figure about an empty database. The plan is blunt
 * about the consequence: *"Throwing `HealthLocalUnsupportedError` on Home
 * summary methods is **not** an Exit. Widget may ship 'dark' with in-product
 * copy; **Home/Trends may not.**"*
 *
 * So this module has one job: take the seven derived reads off the Worker and
 * answer them from `summaries.ts`, which is where the arithmetic lives.
 *
 * THE METHOD MAP — one local method per derived remote read
 * ---------------------------------------------------------
 * | `healthApi` method  | Worker route                    | `summaries.ts`             |
 * |---------------------|---------------------------------|----------------------------|
 * | `dailySummary`      | `GET /summary` (`:1123`)        | `computeDailySummary`      |
 * | `getWeeklyTrend`    | `GET /summary/weekly-trend` (`:1133`) | `computeWeeklyTrend` |
 * | `nutritionSummary`  | `GET /nutrition/summary`        | `computeNutritionSummary`  |
 * | `waterSummary`      | `GET /water/summary/daily`      | `computeWaterSummary`      |
 * | `weightStatistics`  | `GET /weight/statistics`        | `computeWeightStatistics`  |
 * | `weeklyWeight`      | `GET /weight/weekly-averages`   | `computeWeeklyWeight`      |
 *
 * **HABIT STREAKS ARE THE SEVENTH DERIVED READ AND THEY ARE NOT IN THIS FILE.**
 * `summaries.computeHabitList` / `computeHabitStreak` are wired behind
 * `healthApi.listHabits` by **`localHabitsApi`**, and that is the right place
 * rather than an accident: `user_habits` and `habit_logs` are one table pair
 * with one owner, and three of the habit WRITES answer with the whole derived
 * list (`routes/health.ts:846`, `:868`), so the derivation has to sit beside
 * them or a tap and a refresh would compute a streak two different ways. A
 * second `listHabits` here would also collide on the way into the Proxy, where
 * whichever facade spreads last silently wins.
 *
 * Its window is `sort_order`-based for a reason this file's dated windows would
 * have got wrong — the remote's forty habits are the forty LOWEST `sort_order`,
 * not the forty most recently created. `localHabitsApi` documents that; the
 * streak arithmetic it calls is proven against the Worker in this module's own
 * `__tests__/summaryParity.test.ts`, which is where §12.1 puts streak parity.
 *
 * READ WINDOWS ARE PART OF THE CONTRACT
 * -------------------------------------
 * *"A local method that returns the full table where the remote returned a
 * window is a He3 blocker, not a perf nit"* (plan §7). A summary is the easiest
 * place to break that, because the answer is one small object and nothing about
 * the return value reveals that the whole ledger was walked to build it. Every
 * read below is bounded, and the bound is taken from a registry rather than
 * restated:
 *
 *  - `HEALTH_READ_WINDOWS` for anything a registered client loader reads.
 *  - `summaries.ts`'s own constants for the two reads that have no client
 *    loader — `WEIGHT_STATISTICS_ROW_LIMIT` (the server's own `limit: 1000`,
 *    `health-service.ts:396`) and `HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT`
 *    (`weeklyAverages(userId, limit = 26)`, `:382`). Those ARE the remote
 *    windows; there is no client loader to register them against.
 *
 * ⚠️ **`applyHealthReadWindow`'s `days` kind is relative to wall-clock now**
 * (`windows.ts` — `Date.now() - days * 86_400_000`), which is right for a
 * loader that always means "the last N days" and wrong for `getWeeklyTrend`,
 * whose whole point is an anchor date the caller chooses. Feeding it a date in
 * the past would return an empty week for a week that has data. So the weekly
 * trend derives its range FROM the registered day count and applies it around
 * the anchor — see {@link HEALTH_WEEKLY_TREND_WINDOW_DAYS}. The window is still
 * the registry's; only its origin moves from "today" to "the day asked about".
 * Both halves of `loadWeeklyTrend` declare the same count today, and the wider
 * of the two is taken so a future asymmetry cannot silently truncate one table.
 *
 * PARITY IS PROVEN, NOT ASSERTED
 * ------------------------------
 * `__tests__/summaryParity.test.ts` is a **differential** test: it re-implements
 * each summary from `backend/src/services/health-service.ts` and demands the
 * two agree on empty days, week boundaries, partial weeks, missing goals, mixed
 * kg/lb corpora, tombstones and multi-entry days. Every deliberate divergence
 * from the Worker is named in `summaries.ts` and pinned there as an explicit
 * counter-assertion, so "we improved on the server" can never be confused with
 * "we drifted from it".
 */
// Bare side-effect, FIRST: @noble/* captures `globalThis.crypto` at module load
// and `ids`/`localWrite` reach @symply/local-first before the engine does. This
// module is a Proxy entry point, so it can be the first Health local module a
// screen pulls into the graph.
import './cryptoPolyfill';

import type {
  HealthDailySummary,
  HealthNutritionSummary,
  HealthWaterSummary,
  HealthWeeklyWeight,
  HealthWeightStatistics,
} from '@api/health';

import { localDateKey } from './ids';
import { activeHealthGoal } from './localGoalsApi';
import { ensureResident, rowsOf, type HealthResidencyNeed } from './localWrite';
import {
  HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT,
  WEIGHT_STATISTICS_ROW_LIMIT,
  addDays,
  compareWeightNewestFirst,
  computeDailySummary,
  computeNutritionSummary,
  computeWaterSummary,
  computeWeeklyTrend,
  computeWeeklyWeight,
  computeWeightStatistics,
  isValidDateKey,
  weekStartOf,
  type LocalHealthWeeklyTrendResponse,
} from './summaries';
import type {
  LocalHealthEntry,
  LocalHealthGoal,
  LocalNutritionEntry,
  LocalWaterEntry,
  LocalWeightEntry,
} from './types';
import {
  HEALTH_READ_WINDOWS,
  applyHealthReadWindow,
  maxDaysForWindow,
  type HealthLedgerRead,
} from './windows';

/* ------------------------------------------------------------------ */
/* Windows — taken from the registry, never restated                   */
/* ------------------------------------------------------------------ */

/** One day of meals (`loadMealsForDate`) — `nutritionSummary`'s whole input. */
const NUTRITION_DAY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadMealsForDate.reads[0];

/** One day of water (`loadWaterToday`) — the Home ring's own read. */
const WATER_DAY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWaterToday.reads[0];

/**
 * One day of `healthEntries` filtered to `entry_type = 'steps'`
 * (`loadStepsForDate`). The `rowFilter` runs BEFORE the window inside
 * `applyHealthReadWindow`, which is the order the route uses
 * (`health-service.ts:1172-1182`) and the order that stops a daily step count
 * from disappearing behind a day of workout rows.
 */
const STEPS_DAY_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadStepsForDate.reads[0];

/**
 * The newest 500 weigh-ins (`loadWeightLog`).
 *
 * `dailySummary` needs exactly one — the latest reading on or before the date —
 * where the server asks for `{ to: date, limit: 2 }` (`health-service.ts:1980`).
 * Both bounds are applied: the registry's ceiling first, then the server's own,
 * so the local read is never wider than either.
 */
const WEIGHT_LOG_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWeightLog.reads[0];

/** Weekly trend, weight half — 14 days (`loadWeeklyTrend`, reads[0]). */
const WEEKLY_TREND_WEIGHT_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWeeklyTrend.reads[0];

/** Weekly trend, nutrition half — 14 days (`loadWeeklyTrend`, reads[1]). */
const WEEKLY_TREND_NUTRITION_READ: HealthLedgerRead = HEALTH_READ_WINDOWS.loadWeeklyTrend.reads[1];

/**
 * Two calendar weeks, from the registry — never the literal `14`.
 *
 * `loadWeeklyTrend`'s note calls the number out as prescriptive: *"Two calendar
 * weeks — this week and last — is 14 days."* Deriving the range from it means
 * widening the registered window automatically widens the read, and a mismatch
 * between the two is a compile-time-visible constant rather than a silent
 * truncation of last week. Both halves of the loader carry the same count;
 * `summaryParity.test.ts` asserts that they still do.
 */
export const HEALTH_WEEKLY_TREND_WINDOW_DAYS: number = Math.max(
  maxDaysForWindow(WEEKLY_TREND_WEIGHT_READ.window) ?? 14,
  maxDaysForWindow(WEEKLY_TREND_NUTRITION_READ.window) ?? 14,
);

/**
 * The months one dated summary needs resident.
 *
 * Three of the four day tables are a pure single-day range. `weightEntries` is
 * the odd one: `dailySummary` wants the newest reading **on or before** the
 * date, so an unbroken run of days with no weigh-in has to be walked BACKWARDS
 * until one turns up. `before` bounds that walk at the date in question — the
 * answer can never sit in a month newer than the day being summarised, and
 * walking forwards would decrypt years of months only to filter them out.
 */
function dayResidency(day: string): HealthResidencyNeed[] {
  return [
    { table: 'nutritionEntries', from: day, to: day },
    { table: 'waterEntries', from: day, to: day },
    { table: 'healthEntries', from: day, to: day },
    {
      table: 'weightEntries',
      minRows: 1,
      before: day,
      count: (ledger) =>
        ledger.weightEntries.filter((row) => row.deleted_at == null && row.date <= day).length,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Row access                                                          */
/* ------------------------------------------------------------------ */

/*
 * Every accessor goes through `rowsOf` — live rows only. Each remote query
 * being replaced carries `isNull(deleted_at)`: `listNutrition`
 * (`health-service.ts:518-528`), `listWater` (`:422-431`), `listWeight`
 * (`:202-212`) and `listHealthEntries` (`:1168-1183`).
 * The compute functions filter tombstones a second time, on purpose — they are
 * pure and are also called from tests and the widget projection with rows that
 * did not come through `rowsOf`.
 */

function nutritionRows(): LocalNutritionEntry[] {
  return rowsOf<LocalNutritionEntry>('nutritionEntries');
}

function waterRows(): LocalWaterEntry[] {
  return rowsOf<LocalWaterEntry>('waterEntries');
}

function weightRows(): LocalWeightEntry[] {
  return rowsOf<LocalWeightEntry>('weightEntries');
}

function healthEntryRows(): LocalHealthEntry[] {
  return rowsOf<LocalHealthEntry>('healthEntries');
}

/**
 * The newest `limit` weigh-ins, ordered as `listWeight` orders them.
 *
 * `ORDER BY date DESC LIMIT ?` (`health-service.ts:202-212`) with the tie broken
 * explicitly — SQLite leaves two weigh-ins on one day unspecified, and two
 * weigh-ins on one day is supported product behaviour (plan §1.5a). The
 * comparator is `summaries.ts`'s, so the facade and the arithmetic can never
 * disagree about which reading is "the latest".
 */
function newestWeight(rows: readonly LocalWeightEntry[], limit: number): LocalWeightEntry[] {
  const ordered = rows.slice().sort(compareWeightNewestFirst);
  return ordered.length > limit ? ordered.slice(0, limit) : ordered;
}

/**
 * Every goal row that can be in force on any day of `days`, deduplicated.
 *
 * `computeWeeklyTrend` resolves the goal PER DAY (`health-service.ts:995` runs
 * `goalFor` for all seven dates), so it cannot be handed the single row
 * `activeHealthGoal` returns — a member who raised their calorie target
 * mid-week would see the new target back-applied to the days before they
 * changed it.
 *
 * Reading the whole `health_goals` table instead would be the unbounded scan
 * this file exists to avoid, so the set is built the other way round: resolve
 * the goal in force on each day through the registered `ACTIVE_GOAL_READ`
 * window, and take the union. That is at most one row per day, and it is
 * provably the same answer — `resolveGoalFor(union, d)` equals
 * `activeHealthGoal(d)` for every `d` in the range, because `activeHealthGoal(d)`
 * is a member of the union and no other member can beat it: a goal resolved for
 * an earlier day cannot have a later `effective_date`, and one resolved for a
 * later day either has `effective_date > d` (which `resolveGoalFor` skips) or is
 * the same row. `summaryParity.test.ts` pins that equivalence directly.
 */
function goalsInForceOver(days: readonly string[]): LocalHealthGoal[] {
  const byId = new Map<string, LocalHealthGoal>();
  for (const day of days) {
    const goal = activeHealthGoal(day);
    if (goal && !byId.has(goal.id)) byId.set(goal.id, goal);
  }
  return [...byId.values()];
}

/* ------------------------------------------------------------------ */
/* The facade                                                          */
/* ------------------------------------------------------------------ */

export const localSummariesApi = {
  /**
   * `GET /health/summary` — `HealthService.dailySummary` (`:1975`).
   *
   * The one call that fills Home: nutrition, water, the latest weight and the
   * day's steps, each against the goal in force on that date. Four bounded
   * reads, no table walked.
   *
   * `weight` is the most recent reading **on or before** `date`, not just that
   * day's — the server queries `{ to: date, limit: 2 }` and reads `[0]`, so a
   * member who has not weighed in today still sees their last number. Future
   * readings are excluded.
   *
   * `date` defaults to the device's LOCAL day where the route defaults to a UTC
   * one; see `healthHabitListSnapshot` for why.
   */
  dailySummary: async (date?: string): Promise<{ summary: HealthDailySummary }> => {
    const day = date ?? localDateKey();
    await ensureResident(dayResidency(day));

    // `{ to: date }` first, then the registry's 500-row ceiling, then the
    // server's own `limit: 2`. Narrowing in that order is what keeps the local
    // answer identical to the remote one while reading two rows instead of all.
    const onOrBefore = weightRows().filter((row) => row.date <= day);
    const windowedWeight = applyHealthReadWindow(WEIGHT_LOG_READ, onOrBefore, { today: day });

    return {
      summary: computeDailySummary({
        date: day,
        nutrition: applyHealthReadWindow(NUTRITION_DAY_READ, nutritionRows(), { today: day }),
        water: applyHealthReadWindow(WATER_DAY_READ, waterRows(), { today: day }),
        weight: newestWeight(windowedWeight, 2),
        entries: applyHealthReadWindow(STEPS_DAY_READ, healthEntryRows(), { today: day }),
        goal: activeHealthGoal(day),
      }),
    };
  },

  /**
   * `GET /health/nutrition/summary` — `HealthService.nutritionSummary` (`:885`).
   *
   * Per-slot and day totals against the goal in force on that date. Nothing is
   * rounded: the server sums raw column values and so does the port.
   */
  nutritionSummary: async (date: string): Promise<{ summary: HealthNutritionSummary }> => {
    await ensureResident([{ table: 'nutritionEntries', from: date, to: date }]);
    return {
      summary: computeNutritionSummary({
        date,
        nutrition: applyHealthReadWindow(NUTRITION_DAY_READ, nutritionRows(), { today: date }),
        goal: activeHealthGoal(date),
      }),
    };
  },

  /**
   * `GET /health/water/summary/daily` — `HealthService.waterDailySummary` (`:492`).
   *
   * Millilitres logged that day against `health_goals.daily_water_ml`. **No unit
   * conversion happens here and that is correct** — `water_unit` is a display
   * switch, not a quantity (`schema-health.ts:585-592`), and converting here
   * would double-convert at render.
   */
  waterSummary: async (date: string): Promise<{ summary: HealthWaterSummary }> => {
    await ensureResident([{ table: 'waterEntries', from: date, to: date }]);
    return {
      summary: computeWaterSummary({
        date,
        water: applyHealthReadWindow(WATER_DAY_READ, waterRows(), { today: date }),
        goal: activeHealthGoal(date),
      }),
    };
  },

  /**
   * `GET /health/weight/statistics` — `HealthService.weightStatistics` (`:396`).
   *
   * The window is the server's own `listWeight(userId, { from, limit: 1000 })`:
   * the `from` filter, then the newest-first ordering, then the 1000-row
   * ceiling — in that order, because the ceiling is applied AFTER the ordering
   * on the Worker too. On a corpus larger than 1000 the `first` figure is the
   * 1000th-newest reading rather than the member's first ever; that is the
   * shipped contract and silently widening it would change every "change since"
   * number on the Weight tab.
   *
   * Only readings sharing the LATEST unit are compared — see
   * `computeWeightStatistics`.
   */
  weightStatistics: async (params?: {
    from?: string;
  }): Promise<{ statistics: HealthWeightStatistics }> => {
    // `from` is a real range when the caller sends one; without it the read is
    // bounded only by the 1000-row ceiling, which on a daily weigher is nearly
    // three years — well past the resident window.
    await ensureResident([
      params?.from !== undefined
        ? { table: 'weightEntries', from: params.from, to: localDateKey() }
        : { table: 'weightEntries', minRows: WEIGHT_STATISTICS_ROW_LIMIT },
    ]);
    return {
      statistics: computeWeightStatistics({
        weight: weightRows(),
        from: params?.from,
        limit: WEIGHT_STATISTICS_ROW_LIMIT,
      }),
    };
  },

  /**
   * `GET /health/weight/weekly-averages` — `HealthService.weeklyAverages` (`:382`).
   *
   * ⚠️ The server READS a materialised table (`health_weekly_weight_averages`)
   * that `recomputeWeeklyAverage` upserts on every weight write. That table is
   * **not ledgered** — plan §1.5 lists it as Tier D recompute — so the port
   * rebuilds it from `weightEntries`. `computeWeeklyWeight` documents the two
   * consequences (deterministic `wk_<week_start>` ids; every week with a reading
   * appears, where the server's table only holds weeks a write has touched).
   *
   * The bucketing read is capped at `WEIGHT_STATISTICS_ROW_LIMIT` rows — the
   * widest bound the Worker ever applies to `weight_entries` — before grouping,
   * because grouping first is exactly the "collapse the table, then window the
   * buckets" mistake `loadWaterHistory`'s note names. 26 weeks is 182 days, so
   * the cap only bites above ~5.5 readings a day sustained for half a year, at
   * which point the oldest returned week may be partial.
   */
  weeklyWeight: async (params?: {
    limit?: number;
  }): Promise<{ weeks: HealthWeeklyWeight[] }> => {
    await ensureResident([{ table: 'weightEntries', minRows: WEIGHT_STATISTICS_ROW_LIMIT }]);
    return {
      weeks: computeWeeklyWeight({
        weight: newestWeight(weightRows(), WEIGHT_STATISTICS_ROW_LIMIT),
        limit: params?.limit ?? HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT,
      }),
    };
  },

  /**
   * `GET /health/summary/weekly-trend` — `HealthService.weeklyTrend` (`:934`).
   *
   * Calories against weight, this week versus last, for the Dashboard "Weekly
   * Trends" widget. `date` names any day in "this week"; `last_week` is the
   * seven days immediately before it — a plain `-7` offset of the same Monday,
   * no gap and no overlap.
   *
   * ⚠️ This method returns `LocalHealthWeeklyTrendResponse`, a strict WIDENING
   * of the declared `HealthWeeklyTrendResponse`. `src/api/health.ts`
   * under-declares the envelope in three places (`days[].calorie_goal` is
   * nullable; `daily_weight[]` slots are always objects whose `weight` is the
   * gap; `avg_weight` rides on both windows) — the runtime shape is what the
   * screens actually receive today, so it is what the port returns. The drift is
   * catalogued on `computeWeeklyTrend`; correcting `api/health.ts` belongs to
   * that module's owner.
   *
   * An unparseable `date` answers an honestly-empty pair of weeks rather than
   * taking Home down, matching `health-service.ts:943-958`.
   */
  getWeeklyTrend: async (date?: string): Promise<LocalHealthWeeklyTrendResponse> => {
    const day = date ?? localDateKey();
    if (!isValidDateKey(day)) {
      return computeWeeklyTrend({ date: day, nutrition: [], weight: [], goals: [] });
    }

    // The registered 14-day window, applied around the ANCHOR rather than
    // around wall-clock now — see the file header. `to` is this week's Sunday
    // and `from` falls out of the window's own day count, so last week's Monday
    // is never hard-coded.
    //
    // `applyHealthReadWindow` is deliberately NOT used for these two reads and
    // this is the only place in the Health facades where that is true: its
    // `days` kind cuts at `Date.now() - days`, so anchoring the trend on any
    // date but today would drop every row the caller asked about and paint two
    // empty weeks over a week that has data. The range below is the same
    // window — same table, same day count, taken from the same registry entry —
    // measured from the day in question. It also reproduces the route's own
    // `gte(date, weekStart)` / `lte(date, weekEnd)` exactly.
    const to = addDays(weekStartOf(day), 6);
    const from = addDays(to, -(HEALTH_WEEKLY_TREND_WINDOW_DAYS - 1));
    // Anchored on the CALLER'S week, not on today — the Dashboard trend widget
    // pages, so `date` can name a week from years back. The residency range is
    // the same `from`/`to` the read below uses, derived once.
    await ensureResident([
      { table: 'nutritionEntries', from, to },
      { table: 'weightEntries', from, to },
    ]);
    const inRange = <TRow extends { date: string }>(rows: readonly TRow[]): TRow[] =>
      rows.filter((row) => row.date >= from && row.date <= to);

    const days = Array.from({ length: HEALTH_WEEKLY_TREND_WINDOW_DAYS }, (_, index) =>
      addDays(from, index),
    );

    return computeWeeklyTrend({
      date: day,
      nutrition: inRange(nutritionRows()),
      weight: inRange(weightRows()),
      goals: goalsInForceOver(days),
    });
  },
};

export default localSummariesApi;
