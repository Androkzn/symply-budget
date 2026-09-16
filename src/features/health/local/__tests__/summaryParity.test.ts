/**
 * He7-lite summary parity — the differential test named in plan §12.1
 * ("Summary/streak/trend parity vs **server fixtures**", DoD He3c).
 *
 * WHAT MAKES THIS A DIFFERENTIAL TEST AND NOT A TAUTOLOGY
 * -------------------------------------------------------
 * The `SERVER` block below is a port of `backend/src/services/health-service.ts`
 * — written from the Worker's own source, one function per service method, each
 * naming the line it came from. It is deliberately NOT written from
 * `summaries.ts`. Restating the local implementation and comparing it to itself
 * would pass forever and prove nothing, which is the specific failure the plan
 * warns about when it calls this *"a differential test of
 * `backend/src/routes/health.ts:1123-1140`"* and notes that House found four
 * bugs this way.
 *
 * The two implementations are then run over ONE corpus and compared. Where they
 * are meant to differ, the divergence is asserted explicitly and points at the
 * paragraph in `summaries.ts` that decided it — so "we deliberately improved on
 * the Worker" can never be mistaken for "we drifted from it".
 *
 * HOW THE SERVER PORT MODELS D1
 * -----------------------------
 *  - **Rows are stored as D1 stores them.** `use_per_day_calories`,
 *    `is_archived` and `reminder_enabled` are INTEGER columns; drizzle's
 *    `{ mode: 'boolean' }` converts them on SELECT, so the conversion happens in
 *    `selectGoals` / `selectHabits` here, exactly where it happens on the
 *    Worker. Putting real booleans in the fixture would hide the ledger's 0/1.
 *  - **`ORDER BY` on a non-unique column is modelled as a STABLE sort**, which
 *    leaves ties in insertion order. SQLite does not promise that; where a tie
 *    actually decides an answer the case is called out and the local
 *    implementation's explicit tie-break is asserted on its own, because two
 *    devices must paint the same number even where the server was free not to.
 *  - **`crypto.randomUUID()` ids cannot be reproduced**, so the weekly-average
 *    comparison excludes `id` and asserts the local deterministic id separately.
 *
 * THE EDGES THIS COVERS, BECAUSE THEY ARE THE ONES THAT BREAK IN PRACTICE
 * ----------------------------------------------------------------------
 * empty days · `weekStartOf` Monday/Sunday boundaries · partial weeks ·
 * missing goals and future-dated goals · per-weekday goal overrides ·
 * kg/lb/lbs mixing · tombstoned rows · several entries on one day ·
 * unrecognised meal slots · malformed JSON payloads · read-window bounds.
 */
import type {
  HealthDailySummary,
  HealthMealType,
  HealthNutritionSummary,
  HealthNutritionTotals,
  HealthWaterSummary,
  HealthWeightStatistics,
} from '@api/health';

import { localDateKey } from '../ids';
import { localHabitsApi } from '../localHabitsApi';
import { HEALTH_WEEKLY_TREND_WINDOW_DAYS, localSummariesApi } from '../localSummariesApi';
import {
  HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT,
  WEIGHT_STATISTICS_ROW_LIMIT,
  addDays,
  caloriesGoalFor,
  computeDailySummary,
  computeHabitList,
  computeHabitStreak,
  computeNutritionSummary,
  computeWaterSummary,
  computeWeeklyTrend,
  computeWeeklyWeight,
  computeWeightStatistics,
  isValidDateKey,
  macrosGoalFor,
  resolveGoalFor,
  weekStartOf,
} from '../summaries';
import type {
  LocalHabitLog,
  LocalHealthEntry,
  LocalHealthGoal,
  LocalNutritionEntry,
  LocalUserHabit,
  LocalWaterEntry,
  LocalWeightEntry,
} from '../types';
import { HEALTH_READ_WINDOWS, maxDaysForWindow, maxRowsForWindow } from '../windows';

/* ================================================================== */
/* The ledger the facade reads                                         */
/* ================================================================== */

const USER_ID = 'user_parity';

interface Tables {
  weightEntries: LocalWeightEntry[];
  waterEntries: LocalWaterEntry[];
  nutritionEntries: LocalNutritionEntry[];
  healthEntries: LocalHealthEntry[];
  userHabits: LocalUserHabit[];
  habitLogs: LocalHabitLog[];
  healthGoals: LocalHealthGoal[];
}

function emptyTables(): Tables {
  return {
    weightEntries: [],
    waterEntries: [],
    nutritionEntries: [],
    healthEntries: [],
    userHabits: [],
    habitLogs: [],
    healthGoals: [],
  };
}

/**
 * `../engine` is mocked rather than opened: this suite owns the ARITHMETIC, and
 * an SQLite-backed session would make every assertion depend on the merge
 * engine landing first. The mock is the whole surface `localWrite` consumes.
 */
jest.mock('../engine', () => {
  const state: { ledger: unknown } = { ledger: null };
  return {
    getLocalHealthLedger: () => {
      if (!state.ledger) throw new Error('[test] no ledger installed');
      return state.ledger;
    },
    mutateLocalHealthLedger: jest.fn(),
    // The parity suite installs a whole ledger by hand, so every row it asserts
    // against is already in memory: residency has nothing to widen and this is
    // the "fully resident" no-op the real engine takes when
    // `EngineState.resident` is null. Present rather than omitted because the
    // facades `await` it, and an undefined export would fail as a TypeError
    // long before any parity assertion ran.
    ensureHealthRowsResident: jest.fn(async () => undefined),
    __installLedger: (ledger: unknown) => {
      state.ledger = ledger;
    },
  };
});

const engineMock = jest.requireMock('../engine') as {
  __installLedger: (ledger: unknown) => void;
};

function installLedger(tables: Tables): void {
  engineMock.__installLedger({
    version: 1,
    household: { id: 'hh_parity', userId: USER_ID, createdAt: '2020-01-01T00:00:00.000Z' },
    deviceId: 'dev_parity',
    bodyMeasurements: [],
    ops: [],
    ...tables,
  });
}

/* ================================================================== */
/* SERVER — ported from backend/src/services/health-service.ts         */
/* ================================================================== */

/** `health-service.ts:90-96`, verbatim. */
function svWeekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** `health-service.ts:98-102`, verbatim. */
function svAddDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `health-service.ts:160-170`, verbatim. */
function svParseStoredCustomDays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const days = parsed.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    return days.length > 0 ? days : null;
  } catch {
    return null;
  }
}

/** `health-service.ts:2192-2201`, verbatim (default `today` made explicit). */
function svStreakOf(days: string[], today: string): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : svAddDays(today, -1);
  if (!set.has(cursor)) return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = svAddDays(cursor, -1);
  }
  return streak;
}

/** `isNull(deleted_at)` — the D1 column always exists, so this is a `=== null`. */
function svLive<T extends { user_id?: string | null; deleted_at?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => row.user_id === USER_ID && row.deleted_at === null);
}

/** `ORDER BY <col> DESC` — stable, so ties stay in insertion order (see header). */
function svDesc<T>(rows: T[], key: (row: T) => string): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = key(a.row);
      const right = key(b.row);
      if (left === right) return a.index - b.index;
      return left > right ? -1 : 1;
    })
    .map((entry) => entry.row);
}

/** `ORDER BY <col>` ascending — likewise stable. */
function svAsc<T>(rows: T[], key: (row: T) => string): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = key(a.row);
      const right = key(b.row);
      if (left === right) return a.index - b.index;
      return left > right ? 1 : -1;
    })
    .map((entry) => entry.row);
}

/**
 * Drizzle `{ mode: 'boolean' }` on SELECT — the three INTEGER columns of
 * `health_goals` come back as real booleans (`schema-health.ts:502-611`).
 */
type ServerGoal = Omit<LocalHealthGoal, 'use_per_day_calories' | 'use_per_day_macros'> & {
  use_per_day_calories: boolean;
  use_per_day_macros: boolean;
};

function svSelectGoals(db: Tables): ServerGoal[] {
  // NOTE: `health_goals` has NO `deleted_at` column in D1, so the server cannot
  // filter one — the row is visible whatever the ledger's tombstone says.
  return db.healthGoals
    .filter((row) => row.user_id === USER_ID)
    .map((row) => ({
      ...row,
      use_per_day_calories: Boolean(row.use_per_day_calories),
      use_per_day_macros: Boolean(row.use_per_day_macros),
    }));
}

/** `goalFor` — `health-service.ts:1393-1404`. */
function svGoalFor(db: Tables, date: string): ServerGoal | null {
  const eligible = svSelectGoals(db).filter((row) => row.effective_date <= date);
  return svDesc(eligible, (row) => row.effective_date)[0] ?? null;
}

/** `caloriesGoalFor` — `health-service.ts:1406-1420`. */
function svCaloriesGoalFor(goal: ServerGoal, date: string): number {
  if (!goal.use_per_day_calories) return goal.daily_calories;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const perDay = [
    goal.sunday_calories,
    goal.monday_calories,
    goal.tuesday_calories,
    goal.wednesday_calories,
    goal.thursday_calories,
    goal.friday_calories,
    goal.saturday_calories,
  ];
  return perDay[dow] ?? goal.daily_calories;
}

/** `macrosGoalFor` — `health-service.ts:1422-1465`. */
function svMacrosGoalFor(
  goal: ServerGoal,
  date: string,
): { proteins: number | null; carbohydrates: number | null; fats: number | null } {
  const fallback = {
    proteins: goal.daily_protein_grams ?? null,
    carbohydrates: goal.daily_carbs_grams ?? null,
    fats: goal.daily_fats_grams ?? null,
  };
  if (!goal.use_per_day_macros) return fallback;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const perDayProtein = [
    goal.sunday_protein_grams,
    goal.monday_protein_grams,
    goal.tuesday_protein_grams,
    goal.wednesday_protein_grams,
    goal.thursday_protein_grams,
    goal.friday_protein_grams,
    goal.saturday_protein_grams,
  ];
  const perDayCarbs = [
    goal.sunday_carbs_grams,
    goal.monday_carbs_grams,
    goal.tuesday_carbs_grams,
    goal.wednesday_carbs_grams,
    goal.thursday_carbs_grams,
    goal.friday_carbs_grams,
    goal.saturday_carbs_grams,
  ];
  const perDayFats = [
    goal.sunday_fats_grams,
    goal.monday_fats_grams,
    goal.tuesday_fats_grams,
    goal.wednesday_fats_grams,
    goal.thursday_fats_grams,
    goal.friday_fats_grams,
    goal.saturday_fats_grams,
  ];
  return {
    proteins: perDayProtein[dow] ?? fallback.proteins,
    carbohydrates: perDayCarbs[dow] ?? fallback.carbohydrates,
    fats: perDayFats[dow] ?? fallback.fats,
  };
}

/** `listWeight` — `health-service.ts:202-212`. `ORDER BY date DESC LIMIT ?`. */
function svListWeight(
  db: Tables,
  opts: { from?: string; to?: string; limit?: number } = {},
): LocalWeightEntry[] {
  let rows = svLive(db.weightEntries);
  if (opts.from) rows = rows.filter((row) => row.date >= opts.from!);
  if (opts.to) rows = rows.filter((row) => row.date <= opts.to!);
  return svDesc(rows, (row) => row.date).slice(0, opts.limit ?? 200);
}

/** `listNutrition` — `health-service.ts:518-528`. `ORDER BY created_at`. */
function svListNutrition(
  db: Tables,
  opts: { from?: string; to?: string; date?: string } = {},
): LocalNutritionEntry[] {
  let rows = svLive(db.nutritionEntries);
  if (opts.date) rows = rows.filter((row) => row.date === opts.date);
  if (opts.from) rows = rows.filter((row) => row.date >= opts.from!);
  if (opts.to) rows = rows.filter((row) => row.date <= opts.to!);
  return svAsc(rows, (row) => row.created_at);
}

/** `listHealthEntries` — `health-service.ts:1168-1183`. `ORDER BY date DESC LIMIT ?`. */
function svListHealthEntries(
  db: Tables,
  opts: { type?: string; from?: string; to?: string; limit?: number } = {},
): LocalHealthEntry[] {
  let rows = svLive(db.healthEntries);
  if (opts.type) rows = rows.filter((row) => row.entry_type === opts.type);
  if (opts.from) rows = rows.filter((row) => row.date >= opts.from!);
  if (opts.to) rows = rows.filter((row) => row.date <= opts.to!);
  return svDesc(rows, (row) => row.date).slice(0, opts.limit ?? 400);
}

/** `nutritionSummary` — `health-service.ts:885-911`. */
function svNutritionSummary(db: Tables, date: string): HealthNutritionSummary {
  const rows = svListNutrition(db, { date });
  const goal = svGoalFor(db, date);
  const zero: HealthNutritionTotals = { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 };
  const byMeal: Record<HealthMealType, HealthNutritionTotals> = {
    breakfast: { ...zero },
    lunch: { ...zero },
    dinner: { ...zero },
    snack: { ...zero },
  };
  const totals = { ...zero };
  for (const r of rows) {
    // `byMeal[r.meal_type as MealType] ?? byMeal.snack` — the prototype hole is
    // reproduced faithfully, and the local counter-assertion lives beside the
    // one fixture that can reach it.
    const slot = byMeal[r.meal_type as HealthMealType] ?? byMeal.snack;
    slot.calories += r.calories;
    slot.proteins += r.proteins;
    slot.carbohydrates += r.carbohydrates;
    slot.fats += r.fats;
    totals.calories += r.calories;
    totals.proteins += r.proteins;
    totals.carbohydrates += r.carbohydrates;
    totals.fats += r.fats;
  }
  return {
    date,
    totals,
    by_meal: byMeal,
    entry_count: rows.length,
    goal: goal
      ? { calories: svCaloriesGoalFor(goal, date), ...svMacrosGoalFor(goal, date) }
      : null,
  };
}

/** `waterDailySummary` — `health-service.ts:492-512`. */
function svWaterDailySummary(db: Tables, date: string): HealthWaterSummary {
  const rows = svLive(db.waterEntries).filter((row) => row.date === date);
  const goal = svGoalFor(db, date);
  return {
    date,
    total_ml: rows.reduce((s, r) => s + r.amount_ml, 0),
    goal_ml: goal?.daily_water_ml ?? null,
    entry_count: rows.length,
  };
}

/** `weightStatistics` — `health-service.ts:396-418`. */
function svWeightStatistics(db: Tables, from?: string): HealthWeightStatistics {
  const rows = svListWeight(db, { from, limit: 1000 });
  if (rows.length === 0) {
    return {
      count: 0,
      unit: null,
      latest: null,
      first: null,
      change: null,
      average: null,
      min: null,
      max: null,
    };
  }
  const unit = rows[0].unit;
  const same = rows.filter((r) => r.unit === unit);
  const values = same.map((r) => r.weight);
  const latest = same[0];
  const first = same[same.length - 1];
  return {
    count: same.length,
    unit: unit as HealthWeightStatistics['unit'],
    latest: latest.weight,
    first: first.weight,
    change: Math.round((latest.weight - first.weight) * 10) / 10,
    average: Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

interface ServerWeeklyWeightRow {
  week_start: string;
  week_end: string;
  average_weight: number;
  min_weight: number;
  max_weight: number;
  entry_count: number;
  weight_unit: string;
}

/**
 * `weeklyAverages` — `health-service.ts:382-390` — reads the MATERIALISED
 * `health_weekly_weight_averages` table, which `recomputeWeeklyAverage`
 * (`:322-378`) upserts on every weight write.
 *
 * There is nothing to read on device (plan §1.5 lists it as Tier D recompute),
 * so the reference replays the writes: one `recomputeWeeklyAverage(date, unit)`
 * per live row, in insertion order, which is the order the rows were written.
 * That is what makes `weight_unit` "whichever row last triggered a recompute".
 */
function svWeeklyAverages(db: Tables, limit = 26): ServerWeeklyWeightRow[] {
  const table = new Map<string, ServerWeeklyWeightRow>();
  for (const write of db.weightEntries) {
    if (write.user_id !== USER_ID) continue;
    const start = svWeekStartOf(write.date);
    const end = svAddDays(start, 6);
    const rows = svLive(db.weightEntries).filter(
      (row) => row.date >= start && row.date <= end,
    );
    if (rows.length === 0) {
      table.delete(start);
      continue;
    }
    const values = rows.map((r) => r.weight);
    table.set(start, {
      week_start: start,
      week_end: end,
      average_weight: values.reduce((s, v) => s + v, 0) / values.length,
      min_weight: Math.min(...values),
      max_weight: Math.max(...values),
      entry_count: values.length,
      weight_unit: write.unit,
    });
  }
  return svDesc([...table.values()], (row) => row.week_start).slice(0, limit);
}

interface ServerTrendWindow {
  week_start: string;
  week_end: string;
  days: Array<{ date: string; calories: number; calorie_goal: number | null }>;
  daily_weight: Array<{ date: string; weight: number | null }>;
  total_calories: number;
  avg_calories: number;
  avg_weight: number | null;
}

interface ServerTrendResponse {
  this_week: ServerTrendWindow;
  last_week: ServerTrendWindow;
  change: { calories: number; weight: number | null };
}

/** `weeklyTrend` — `health-service.ts:934-1058`. */
function svWeeklyTrend(db: Tables, date: string): ServerTrendResponse {
  if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    const emptyWeek: ServerTrendWindow = {
      week_start: date,
      week_end: date,
      days: [],
      daily_weight: [],
      total_calories: 0,
      avg_calories: 0,
      avg_weight: null,
    };
    return { this_week: emptyWeek, last_week: emptyWeek, change: { calories: 0, weight: null } };
  }

  const thisWeekStart = svWeekStartOf(date);
  const lastWeekStart = svAddDays(thisWeekStart, -7);

  const buildWeek = (weekStart: string) => {
    const weekEnd = svAddDays(weekStart, 6);
    const weekDates = Array.from({ length: 7 }, (_, i) => svAddDays(weekStart, i));

    const nutritionRows = svLive(db.nutritionEntries).filter(
      (row) => row.date >= weekStart && row.date <= weekEnd,
    );
    // `.orderBy(weightEntries.created_at)` — ascending, so the LATEST logged
    // reading of a day wins the per-day slot (last write into the map).
    const weightRows = svAsc(
      svLive(db.weightEntries).filter((row) => row.date >= weekStart && row.date <= weekEnd),
      (row) => row.created_at,
    );
    const goals = weekDates.map((d) => svGoalFor(db, d));

    const caloriesByDate = new Map<string, number>();
    for (const r of nutritionRows) {
      caloriesByDate.set(r.date, (caloriesByDate.get(r.date) ?? 0) + r.calories);
    }
    const weightByDate = new Map<string, number>();
    for (const r of weightRows) weightByDate.set(r.date, r.weight);

    const days = weekDates.map((d, i) => {
      const goal = goals[i];
      return {
        date: d,
        calories: Math.round(caloriesByDate.get(d) ?? 0),
        calorie_goal: goal ? svCaloriesGoalFor(goal, d) : null,
      };
    });
    const dailyWeight = weekDates.map((d) => ({ date: d, weight: weightByDate.get(d) ?? null }));
    const totalCalories = days.reduce((s, d) => s + d.calories, 0);
    return {
      week_start: weekStart,
      week_end: weekEnd,
      days,
      daily_weight: dailyWeight,
      total_calories: totalCalories,
      avg_calories: Math.round(totalCalories / 7),
    };
  };

  const thisWeek = buildWeek(thisWeekStart);
  const lastWeek = buildWeek(lastWeekStart);

  const avgOfLogged = (values: Array<number | null>): number | null => {
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length === 0) return null;
    return nums.reduce((s, v) => s + v, 0) / nums.length;
  };
  const thisWeekAvgWeight = avgOfLogged(thisWeek.daily_weight.map((d) => d.weight));
  const lastWeekAvgWeight = avgOfLogged(lastWeek.daily_weight.map((d) => d.weight));

  return {
    this_week: { ...thisWeek, avg_weight: thisWeekAvgWeight },
    last_week: { ...lastWeek, avg_weight: lastWeekAvgWeight },
    change: {
      calories: thisWeek.avg_calories - lastWeek.avg_calories,
      weight:
        thisWeekAvgWeight !== null && lastWeekAvgWeight !== null
          ? Math.round((thisWeekAvgWeight - lastWeekAvgWeight) * 10) / 10
          : null,
    },
  };
}

/** `dailySummary` — `health-service.ts:1975-1993`. */
function svDailySummary(db: Tables, date: string): HealthDailySummary {
  const nutrition = svNutritionSummary(db, date);
  const water = svWaterDailySummary(db, date);
  const weightRows = svListWeight(db, { to: date, limit: 2 });
  const steps = svListHealthEntries(db, { type: 'steps', from: date, to: date, limit: 1 });
  const goal = svGoalFor(db, date);
  // A bare `JSON.parse` on the Worker: a malformed blob 500s the whole route.
  const stepValue = steps[0]
    ? ((JSON.parse(steps[0].data) as { steps?: number } | null)?.steps ?? 0)
    : 0;
  return {
    date,
    nutrition,
    water,
    weight: weightRows[0]
      ? {
          value: weightRows[0].weight,
          unit: weightRows[0].unit as HealthDailySummary['weight'] extends null
            ? never
            : 'kg' | 'lb' | 'lbs',
          date: weightRows[0].date,
        }
      : null,
    steps: { value: stepValue, goal: goal?.daily_steps ?? null },
  };
}

interface ServerHabit {
  id: string;
  user_id: string;
  template_id: string | null;
  name: string;
  icon: string;
  category: string;
  time_of_day: string;
  frequency: string;
  custom_days: number[] | null;
  reminder_time: string | null;
  reminder_enabled: boolean;
  target_duration: number | null;
  notes: string | null;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  days: string[];
  streak: number;
}

/** `listHabits` — `health-service.ts:1508-1556`. */
function svListHabits(
  db: Tables,
  today: string,
  options: { includeArchived?: boolean } = {},
): ServerHabit[] {
  const habits = svAsc(
    db.userHabits.filter(
      (row) =>
        row.user_id === USER_ID &&
        row.deleted_at === null &&
        (options.includeArchived ? true : !row.is_archived),
    ),
    (row) => String(row.sort_order).padStart(12, '0'),
  );
  const logs = svLive(db.habitLogs);

  return habits.map((h) => {
    const days = logs
      .filter((l) => l.habit_id === h.id)
      .map((l) => l.date)
      .sort((a, b) => b.localeCompare(a));
    return {
      id: h.id,
      user_id: h.user_id ?? '',
      template_id: h.template_id ?? null,
      name: h.name,
      icon: h.icon,
      category: h.category,
      time_of_day: h.time_of_day,
      frequency: h.frequency,
      custom_days: svParseStoredCustomDays(h.custom_days),
      reminder_time: h.reminder_time ?? null,
      // drizzle `{ mode: 'boolean' }` on SELECT.
      reminder_enabled: Boolean(h.reminder_enabled),
      target_duration: h.target_duration ?? null,
      notes: h.notes ?? null,
      is_archived: Boolean(h.is_archived),
      sort_order: h.sort_order,
      created_at: h.created_at,
      updated_at: h.updated_at,
      days,
      streak: svStreakOf(days, today),
    };
  });
}

/* ================================================================== */
/* Fixture builders                                                    */
/* ================================================================== */

let seq = 0;
function stamp(day: string, minute = 0): string {
  seq += 1;
  return `${day}T${String(8 + Math.floor(minute / 60)).padStart(2, '0')}:${String(
    minute % 60,
  ).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`;
}

function weightRow(
  partial: Partial<LocalWeightEntry> & { date: string; weight: number },
): LocalWeightEntry {
  return {
    id: partial.id ?? `w_${partial.date}_${partial.weight}`,
    user_id: USER_ID,
    date: partial.date,
    weight: partial.weight,
    unit: partial.unit ?? 'kg',
    note: partial.note ?? null,
    source: partial.source ?? 'manual',
    created_at: partial.created_at ?? stamp(partial.date),
    updated_at: partial.updated_at ?? partial.created_at ?? stamp(partial.date),
    deleted_at: partial.deleted_at ?? null,
  };
}

function waterRow(
  partial: Partial<LocalWaterEntry> & { date: string; amount_ml: number },
): LocalWaterEntry {
  return {
    id: partial.id ?? `h2o_${partial.date}_${partial.amount_ml}_${seq}`,
    user_id: USER_ID,
    date: partial.date,
    amount_ml: partial.amount_ml,
    beverage_type: partial.beverage_type ?? 'water',
    container: partial.container ?? null,
    created_at: partial.created_at ?? stamp(partial.date),
    updated_at: partial.updated_at ?? stamp(partial.date),
    deleted_at: partial.deleted_at ?? null,
  };
}

function mealRow(
  partial: Partial<LocalNutritionEntry> & { date: string; calories: number },
): LocalNutritionEntry {
  return {
    id: partial.id ?? `n_${partial.date}_${partial.calories}_${seq}`,
    user_id: USER_ID,
    date: partial.date,
    food_name: partial.food_name ?? 'food',
    portion: partial.portion ?? 100,
    unit: partial.unit ?? 'g',
    meal_type: partial.meal_type ?? 'lunch',
    calories: partial.calories,
    proteins: partial.proteins ?? 0,
    carbohydrates: partial.carbohydrates ?? 0,
    fats: partial.fats ?? 0,
    source: partial.source ?? 'manual',
    created_at: partial.created_at ?? stamp(partial.date),
    updated_at: partial.updated_at ?? stamp(partial.date),
    deleted_at: partial.deleted_at ?? null,
  };
}

function entryRow(
  partial: Partial<LocalHealthEntry> & { date: string; entry_type: string; data: string },
): LocalHealthEntry {
  return {
    id: partial.id ?? `he_${partial.date}_${partial.entry_type}_${seq}`,
    user_id: USER_ID,
    date: partial.date,
    entry_type: partial.entry_type,
    data: partial.data,
    source: partial.source ?? 'manual',
    intensity: partial.intensity ?? null,
    created_at: partial.created_at ?? stamp(partial.date),
    updated_at: partial.updated_at ?? stamp(partial.date),
    deleted_at: partial.deleted_at ?? null,
  };
}

function goalRow(
  partial: Partial<LocalHealthGoal> & { effective_date: string },
): LocalHealthGoal {
  return {
    id: partial.id ?? `hg_${partial.effective_date}`,
    user_id: USER_ID,
    daily_calories: partial.daily_calories ?? 2000,
    use_per_day_calories: partial.use_per_day_calories ?? 0,
    use_per_day_macros: partial.use_per_day_macros ?? 0,
    created_at: partial.created_at ?? stamp(partial.effective_date),
    updated_at: partial.updated_at ?? stamp(partial.effective_date),
    deleted_at: partial.deleted_at ?? null,
    ...partial,
  };
}

function habitRow(partial: Partial<LocalUserHabit> & { id: string; name: string }): LocalUserHabit {
  return {
    user_id: USER_ID,
    template_id: partial.template_id ?? null,
    icon: partial.icon ?? 'goals',
    category: partial.category ?? 'custom',
    time_of_day: partial.time_of_day ?? 'anytime',
    frequency: partial.frequency ?? 'daily',
    custom_days: partial.custom_days ?? null,
    reminder_time: partial.reminder_time ?? null,
    reminder_enabled: partial.reminder_enabled ?? 0,
    target_duration: partial.target_duration ?? null,
    notes: partial.notes ?? null,
    is_archived: partial.is_archived ?? 0,
    sort_order: partial.sort_order ?? 0,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
    deleted_at: partial.deleted_at ?? null,
    ...partial,
  };
}

function habitLogRow(
  partial: Partial<LocalHabitLog> & { habit_id: string; date: string },
): LocalHabitLog {
  return {
    id: partial.id ?? `hl_${partial.habit_id}_${partial.date}`,
    user_id: USER_ID,
    habit_id: partial.habit_id,
    date: partial.date,
    time_of_day: partial.time_of_day ?? 'anytime',
    completed_at: partial.completed_at ?? `${partial.date}T09:00:00.000Z`,
    duration: partial.duration ?? null,
    notes: partial.notes ?? null,
    created_at: partial.created_at ?? `${partial.date}T09:00:00.000Z`,
    updated_at: partial.updated_at ?? `${partial.date}T09:00:00.000Z`,
    deleted_at: partial.deleted_at ?? null,
  };
}

/** 2026-03-11 is a WEDNESDAY; its Monday is 2026-03-09, its Sunday 2026-03-15. */
const WED = '2026-03-11';
const MON = '2026-03-09';
const SUN = '2026-03-15';
/** The Monday and Sunday of the week BEFORE. */
const PREV_MON = '2026-03-02';
const PREV_SUN = '2026-03-08';

/* ================================================================== */
/* 1. nutritionSummary                                                 */
/* ================================================================== */

describe('He7-lite parity — nutritionSummary (health-service.ts:885)', () => {
  function localOf(db: Tables, date: string): HealthNutritionSummary {
    return computeNutritionSummary({
      date,
      nutrition: db.nutritionEntries,
      goal: resolveGoalFor(db.healthGoals, date),
    });
  }

  it('agrees on an empty day — zeros, no goal, and the date echoed back', () => {
    const db = emptyTables();
    expect(localOf(db, WED)).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED)).toEqual({
      date: WED,
      totals: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 },
      by_meal: {
        breakfast: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 },
        lunch: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 },
        dinner: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 },
        snack: { calories: 0, proteins: 0, carbohydrates: 0, fats: 0 },
      },
      entry_count: 0,
      goal: null,
    });
  });

  it('agrees on several entries in one day, across slots, with other days present', () => {
    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: WED, meal_type: 'breakfast', calories: 320, proteins: 12, fats: 9 }),
      mealRow({ date: WED, meal_type: 'lunch', calories: 640, proteins: 41, carbohydrates: 70 }),
      mealRow({ date: WED, meal_type: 'lunch', calories: 120, fats: 11 }),
      mealRow({ date: WED, meal_type: 'dinner', calories: 810, proteins: 55 }),
      mealRow({ date: WED, meal_type: 'snack', calories: 180, carbohydrates: 24 }),
      // A different day must not leak into either the totals or the count.
      mealRow({ date: addDays(WED, -1), meal_type: 'lunch', calories: 9999 }),
    ];
    expect(localOf(db, WED)).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED).entry_count).toBe(5);
    expect(localOf(db, WED).totals.calories).toBe(2070);
  });

  it('agrees that an unrecognised meal slot folds into snack and still counts', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, meal_type: 'brunch', calories: 400, fats: 7 })];
    expect(localOf(db, WED)).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED).by_meal.snack.calories).toBe(400);
    expect(localOf(db, WED).entry_count).toBe(1);
  });

  it('agrees that a tombstoned meal is invisible', () => {
    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: WED, meal_type: 'lunch', calories: 500 }),
      mealRow({ date: WED, meal_type: 'lunch', calories: 700, deleted_at: '2026-03-11T20:00:00Z' }),
    ];
    expect(localOf(db, WED)).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED).totals.calories).toBe(500);
    expect(localOf(db, WED).entry_count).toBe(1);
  });

  it('agrees on the goal in force, and on there being none before the first one', () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2100, daily_protein_grams: 150 }),
      goalRow({ effective_date: '2026-03-10', daily_calories: 1800, daily_protein_grams: 160 }),
      // Future-dated: must not apply to WED.
      goalRow({ effective_date: '2026-04-01', daily_calories: 1500 }),
    ];
    expect(localOf(db, WED)).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED).goal).toEqual({
      calories: 1800,
      proteins: 160,
      carbohydrates: null,
      fats: null,
    });

    // The day before the first goal row has no goal at all.
    expect(localOf(db, '2025-12-31')).toEqual(svNutritionSummary(db, '2025-12-31'));
    expect(localOf(db, '2025-12-31').goal).toBeNull();
  });

  it('agrees on per-weekday calorie and macro overrides, including the null fallback', () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({
        effective_date: '2026-01-01',
        daily_calories: 2000,
        use_per_day_calories: 1,
        wednesday_calories: 2400,
        // Thursday deliberately left null → falls back to `daily_calories`.
        use_per_day_macros: 1,
        daily_protein_grams: 100,
        wednesday_protein_grams: 180,
        daily_fats_grams: 60,
      }),
    ];
    for (const date of [WED, addDays(WED, 1), MON, SUN]) {
      expect(localOf(db, date)).toEqual(svNutritionSummary(db, date));
    }
    expect(localOf(db, WED).goal).toEqual({
      calories: 2400,
      proteins: 180,
      carbohydrates: null,
      fats: 60,
    });
    expect(localOf(db, addDays(WED, 1)).goal?.calories).toBe(2000);
    expect(localOf(db, addDays(WED, 1)).goal?.proteins).toBe(100);
  });

  it(
    'DIVERGES on a prototype-key meal slot, deliberately — the Worker drops those ' +
      'macros onto Function.prototype (summaries.ts, MEAL_TYPES)',
    () => {
      const db = emptyTables();
      db.nutritionEntries = [mealRow({ date: WED, meal_type: 'constructor', calories: 250 })];

      // The Worker: `byMeal['constructor']` resolves to a truthy `Function`, so
      // `?? byMeal.snack` never fires and the macros land nowhere visible.
      expect(svNutritionSummary(db, WED).by_meal.snack.calories).toBe(0);
      // The port: the guarded lookup files them under `snack`, as intended.
      expect(localOf(db, WED).by_meal.snack.calories).toBe(250);
      // Both still count the row and both still total it.
      expect(localOf(db, WED).entry_count).toBe(svNutritionSummary(db, WED).entry_count);
      expect(localOf(db, WED).totals.calories).toBe(svNutritionSummary(db, WED).totals.calories);
    },
  );
});

/* ================================================================== */
/* 2. waterSummary                                                     */
/* ================================================================== */

describe('He7-lite parity — waterSummary (health-service.ts:492)', () => {
  function localOf(db: Tables, date: string): HealthWaterSummary {
    return computeWaterSummary({
      date,
      water: db.waterEntries,
      goal: resolveGoalFor(db.healthGoals, date),
    });
  }

  it('agrees on an empty day, on many sips, and on tombstones', () => {
    const db = emptyTables();
    expect(localOf(db, WED)).toEqual(svWaterDailySummary(db, WED));

    db.waterEntries = [
      waterRow({ date: WED, amount_ml: 250 }),
      waterRow({ date: WED, amount_ml: 250 }),
      waterRow({ date: WED, amount_ml: 500, deleted_at: '2026-03-11T18:00:00Z' }),
      waterRow({ date: addDays(WED, -1), amount_ml: 1000 }),
    ];
    expect(localOf(db, WED)).toEqual(svWaterDailySummary(db, WED));
    expect(localOf(db, WED)).toEqual({
      date: WED,
      total_ml: 500,
      goal_ml: null,
      entry_count: 2,
    });
  });

  it('agrees that the goal is millilitres, with `water_unit` left as a display switch', () => {
    const db = emptyTables();
    db.waterEntries = [waterRow({ date: WED, amount_ml: 750 })];
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_water_ml: 2500, water_unit: 'oz' }),
    ];
    expect(localOf(db, WED)).toEqual(svWaterDailySummary(db, WED));
    // 2500 ml, NOT converted to ounces — converting here would double-convert at
    // render (`schema-health.ts:585-592`).
    expect(localOf(db, WED).goal_ml).toBe(2500);
    expect(localOf(db, WED).total_ml).toBe(750);
  });
});

/* ================================================================== */
/* 3. weightStatistics                                                 */
/* ================================================================== */

describe('He7-lite parity — weightStatistics (health-service.ts:396)', () => {
  function localOf(db: Tables, from?: string): HealthWeightStatistics {
    return computeWeightStatistics({
      weight: db.weightEntries,
      from,
      limit: WEIGHT_STATISTICS_ROW_LIMIT,
    });
  }

  it('agrees on an empty log — every field null, count zero', () => {
    const db = emptyTables();
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    expect(localOf(db)).toEqual({
      count: 0,
      unit: null,
      latest: null,
      first: null,
      change: null,
      average: null,
      min: null,
      max: null,
    });
  });

  it('agrees on a single-unit log, with `change`/`average` rounded and min/max not', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-03-01', weight: 82.37 }),
      weightRow({ date: '2026-03-05', weight: 81.94 }),
      weightRow({ date: '2026-03-09', weight: 80.11 }),
    ];
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    const stats = localOf(db);
    expect(stats.count).toBe(3);
    expect(stats.latest).toBe(80.11);
    expect(stats.first).toBe(82.37);
    expect(stats.change).toBe(-2.3);
    expect(stats.average).toBe(81.5);
    // Unrounded on purpose — the asymmetry is the server's.
    expect(stats.min).toBe(80.11);
    expect(stats.max).toBe(82.37);
  });

  it('agrees that only readings sharing the LATEST unit are compared (kg vs lb)', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-02-01', weight: 185, unit: 'lb' }),
      weightRow({ date: '2026-02-15', weight: 182, unit: 'lb' }),
      weightRow({ date: '2026-03-01', weight: 82.5, unit: 'kg' }),
      weightRow({ date: '2026-03-09', weight: 81.5, unit: 'kg' }),
    ];
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    const stats = localOf(db);
    expect(stats.unit).toBe('kg');
    expect(stats.count).toBe(2);
    expect(stats.change).toBe(-1);
    // 185 lb would have been the max had the units been mixed — the guard is
    // exactly what stops "you lost 100 kg this month".
    expect(stats.max).toBe(82.5);
  });

  it("agrees that a donor-imported 'lbs' unit is preserved verbatim, never rewritten", () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-03-01', weight: 180, unit: 'lbs' }),
      weightRow({ date: '2026-03-09', weight: 178, unit: 'lbs' }),
    ];
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    expect(localOf(db).unit).toBe('lbs');
  });

  it('agrees on the `from` filter', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-01-01', weight: 90 }),
      weightRow({ date: '2026-03-01', weight: 84 }),
      weightRow({ date: '2026-03-09', weight: 82 }),
    ];
    expect(localOf(db, '2026-03-01')).toEqual(svWeightStatistics(db, '2026-03-01'));
    expect(localOf(db, '2026-03-01').count).toBe(2);
    expect(localOf(db, '2026-03-01').first).toBe(84);
  });

  it('agrees that a tombstoned reading is invisible', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-03-01', weight: 84 }),
      weightRow({ date: '2026-03-09', weight: 60, deleted_at: '2026-03-09T10:00:00Z' }),
    ];
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    expect(localOf(db).latest).toBe(84);
  });

  it('breaks the same-day tie towards the LATEST logged reading, where SQL leaves it open', () => {
    const db = emptyTables();
    // Two weigh-ins on one day — supported product behaviour (plan §1.5a).
    // `ORDER BY date DESC` alone cannot separate them; the port orders by
    // `created_at` then `id`, so both devices pick the 07:30 reading.
    db.weightEntries = [
      weightRow({
        id: 'w_evening',
        date: '2026-03-09',
        weight: 81.2,
        created_at: '2026-03-09T19:30:00.000Z',
      }),
      weightRow({
        id: 'w_morning',
        date: '2026-03-09',
        weight: 82.8,
        created_at: '2026-03-09T07:30:00.000Z',
      }),
      weightRow({ date: '2026-03-01', weight: 84 }),
    ];
    expect(localOf(db).latest).toBe(81.2);
    // The count/average/min/max do not depend on the tie, so those still match.
    const local = localOf(db);
    const server = svWeightStatistics(db);
    expect(local.count).toBe(server.count);
    expect(local.average).toBe(server.average);
    expect(local.min).toBe(server.min);
    expect(local.max).toBe(server.max);
  });

  it('applies the 1000-row ceiling AFTER ordering, exactly as `listWeight` does', () => {
    const db = emptyTables();
    // 1,010 daily readings: the oldest ten fall off the server's `limit: 1000`,
    // so `first` is the 1000th-newest reading and not the member's first ever.
    for (let i = 0; i < 1010; i += 1) {
      db.weightEntries.push(weightRow({ date: addDays('2023-01-01', i), weight: 100 - i * 0.01 }));
    }
    expect(localOf(db)).toEqual(svWeightStatistics(db));
    expect(localOf(db).count).toBe(WEIGHT_STATISTICS_ROW_LIMIT);
  });
});

/* ================================================================== */
/* 4. weeklyWeight                                                     */
/* ================================================================== */

describe('He7-lite parity — weeklyWeight (health-service.ts:382 / :322)', () => {
  /** The server's ids are `wk_<uuid>` and cannot be reproduced; compare the rest. */
  function withoutId<T extends object>(rows: readonly T[]): Array<Omit<T, 'id'>> {
    return rows.map((row) => {
      const copy = { ...row } as Record<string, unknown>;
      delete copy.id;
      return copy as Omit<T, 'id'>;
    });
  }

  it('agrees on Monday-start bucketing, including the Sunday that belongs to the week before', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: MON, weight: 82 }),
      weightRow({ date: WED, weight: 81 }),
      weightRow({ date: SUN, weight: 80 }),
      // The previous Sunday — `weekStartOf` maps dow 0 back six days, so this is
      // the PREVIOUS week, not the start of one.
      weightRow({ date: PREV_SUN, weight: 84 }),
      weightRow({ date: PREV_MON, weight: 86 }),
    ];
    const local = computeWeeklyWeight({ weight: db.weightEntries });
    expect(withoutId(local)).toEqual(withoutId(svWeeklyAverages(db)));

    expect(local.map((w) => w.week_start)).toEqual([MON, PREV_MON]);
    expect(local[0]).toMatchObject({
      week_start: MON,
      week_end: SUN,
      average_weight: 81,
      min_weight: 80,
      max_weight: 82,
      entry_count: 3,
    });
    expect(local[1]).toMatchObject({ week_start: PREV_MON, week_end: PREV_SUN, entry_count: 2 });
  });

  it('agrees that a tombstoned reading leaves the week, and an empty week disappears', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: MON, weight: 82 }),
      weightRow({ date: WED, weight: 100, deleted_at: '2026-03-11T12:00:00Z' }),
      weightRow({ date: PREV_MON, weight: 90, deleted_at: '2026-03-02T12:00:00Z' }),
    ];
    const local = computeWeeklyWeight({ weight: db.weightEntries });
    expect(withoutId(local)).toEqual(withoutId(svWeeklyAverages(db)));
    expect(local).toHaveLength(1);
    expect(local[0].entry_count).toBe(1);
  });

  it('agrees on the newest-week-first `limit` slice', () => {
    const db = emptyTables();
    for (let week = 0; week < 30; week += 1) {
      db.weightEntries.push(weightRow({ date: addDays('2026-01-05', week * 7), weight: 80 + week }));
    }
    const local = computeWeeklyWeight({ weight: db.weightEntries });
    expect(withoutId(local)).toEqual(withoutId(svWeeklyAverages(db)));
    expect(local).toHaveLength(HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT);
    expect(local[0].week_start > local[1].week_start).toBe(true);

    const four = computeWeeklyWeight({ weight: db.weightEntries, limit: 4 });
    expect(withoutId(four)).toEqual(withoutId(svWeeklyAverages(db, 4)));
  });

  it(
    'agrees on the raw mean of a kg+lb week — the server does NOT unit-filter here, ' +
      'unlike weightStatistics twenty lines above it',
    () => {
      const db = emptyTables();
      db.weightEntries = [
        weightRow({ date: MON, weight: 82, unit: 'kg' }),
        weightRow({ date: WED, weight: 180, unit: 'lb' }),
      ];
      const local = computeWeeklyWeight({ weight: db.weightEntries });
      expect(withoutId(local)).toEqual(withoutId(svWeeklyAverages(db)));
      // 131 is not a weight anyone has ever had. It is the server's answer, and
      // parity means reproducing it rather than quietly fixing one surface.
      expect(local[0].average_weight).toBe(131);
    },
  );

  it('mints a DETERMINISTIC id where the server mints a random one, and keeps every other field', () => {
    const db = emptyTables();
    db.weightEntries = [weightRow({ date: WED, weight: 81 })];
    const local = computeWeeklyWeight({ weight: db.weightEntries });
    expect(local[0].id).toBe(`wk_${MON}`);
    // A random id per render would re-key every list row on every paint; the
    // server keeps its `wk_<uuid>` only because it stores the row.
    expect(svWeeklyAverages(db)).toHaveLength(1);
  });

  it('drops a calendar-impossible date instead of taking the Weight tab down', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: WED, weight: 81 }),
      weightRow({ id: 'w_bad', date: '2026-13-45', weight: 70 }),
    ];
    // `svWeeklyAverages` would throw on `.toISOString()` of an Invalid Date —
    // which is what the Worker does — so only the port is exercised here.
    expect(isValidDateKey('2026-13-45')).toBe(false);
    const local = computeWeeklyWeight({ weight: db.weightEntries });
    expect(local).toHaveLength(1);
    expect(local[0].week_start).toBe(MON);
  });
});

/* ================================================================== */
/* 5. weeklyTrend                                                      */
/* ================================================================== */

describe('He7-lite parity — weeklyTrend (health-service.ts:934)', () => {
  function localOf(db: Tables, date: string) {
    return computeWeeklyTrend({
      date,
      nutrition: db.nutritionEntries,
      weight: db.weightEntries,
      goals: db.healthGoals,
    });
  }

  it('agrees on a full week anchored mid-week, and on last week being the 7 days before', () => {
    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: MON, calories: 1800 }),
      mealRow({ date: WED, calories: 900 }),
      mealRow({ date: WED, calories: 1100 }),
      mealRow({ date: SUN, calories: 2200 }),
      mealRow({ date: PREV_MON, calories: 2000 }),
      mealRow({ date: PREV_SUN, calories: 1000 }),
    ];
    db.weightEntries = [
      weightRow({ date: MON, weight: 82 }),
      weightRow({ date: SUN, weight: 81 }),
      weightRow({ date: PREV_MON, weight: 83.5 }),
    ];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));

    const local = localOf(db, WED);
    expect(local.this_week.week_start).toBe(MON);
    expect(local.this_week.week_end).toBe(SUN);
    expect(local.last_week.week_start).toBe(PREV_MON);
    expect(local.last_week.week_end).toBe(PREV_SUN);
    expect(local.this_week.days).toHaveLength(7);
    expect(local.this_week.daily_weight).toHaveLength(7);
  });

  it('agrees when the anchor IS the Monday, and when it is the Sunday', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, calories: 1500 })];
    db.weightEntries = [weightRow({ date: WED, weight: 81 })];

    for (const anchor of [MON, SUN, PREV_SUN, PREV_MON]) {
      expect(localOf(db, anchor)).toEqual(svWeeklyTrend(db, anchor));
    }
    // The Sunday anchors the SAME week as the Monday — that is the boundary
    // `weekStartOf`'s `dow === 0 ? -6` clause exists for.
    expect(localOf(db, SUN).this_week.week_start).toBe(MON);
    expect(localOf(db, PREV_SUN).this_week.week_start).toBe(PREV_MON);
  });

  it('agrees that a partial week still divides by 7', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: MON, calories: 2100 })];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    // One logged day out of seven: 2100 / 7 = 300, not 2100.
    expect(localOf(db, WED).this_week.avg_calories).toBe(300);
    expect(localOf(db, WED).this_week.total_calories).toBe(2100);
  });

  it('agrees that a day with no reading is a `{ date, weight: null }` GAP, never a zero', () => {
    const db = emptyTables();
    db.weightEntries = [weightRow({ date: WED, weight: 81 })];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));

    const points = localOf(db, WED).this_week.daily_weight;
    expect(points[0]).toEqual({ date: MON, weight: null });
    expect(points[2]).toEqual({ date: WED, weight: 81 });
    // Objects all the way, never a bare `null` slot — `api/health.ts:239`
    // declares `Array<Point | null>`, and the Worker has never sent one.
    expect(points.every((point) => point !== null && typeof point === 'object')).toBe(true);
  });

  it('agrees that `avg_weight` averages only the days that HAVE a reading', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: MON, weight: 82 }),
      weightRow({ date: SUN, weight: 80 }),
      weightRow({ date: PREV_MON, weight: 84 }),
    ];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    // 81, not 162/7 — zero-filling the five empty days would swing the average
    // toward whichever week has fewer entries.
    expect(localOf(db, WED).this_week.avg_weight).toBe(81);
    expect(localOf(db, WED).change.weight).toBe(-3);
  });

  it('agrees that `change.weight` is null when either week has no reading at all', () => {
    const db = emptyTables();
    db.weightEntries = [weightRow({ date: WED, weight: 81 })];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    expect(localOf(db, WED).last_week.avg_weight).toBeNull();
    expect(localOf(db, WED).change.weight).toBeNull();
    // Calories still differ — the two halves of `change` are independent.
    expect(localOf(db, WED).change.calories).toBe(0);
  });

  it('agrees that a mid-window goal change applies PER DAY, not per week', () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2200 }),
      goalRow({ effective_date: WED, daily_calories: 1900 }),
    ];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));

    const days = localOf(db, WED).this_week.days;
    expect(days.map((day) => day.calorie_goal)).toEqual([
      2200, 2200, 1900, 1900, 1900, 1900, 1900,
    ]);
    // Last week is entirely before the change.
    expect(localOf(db, WED).last_week.days.every((day) => day.calorie_goal === 2200)).toBe(true);
  });

  it('agrees that a day before the first goal row has `calorie_goal: null`', () => {
    const db = emptyTables();
    db.healthGoals = [goalRow({ effective_date: SUN, daily_calories: 1900 })];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    const days = localOf(db, WED).this_week.days;
    expect(days.slice(0, 6).every((day) => day.calorie_goal === null)).toBe(true);
    expect(days[6].calorie_goal).toBe(1900);
    // `api/health.ts:225` declares this `number`. The Worker sends `null`.
  });

  it('agrees that the LATEST logged reading wins a day with two weigh-ins', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({
        id: 'w_am',
        date: WED,
        weight: 82.9,
        created_at: '2026-03-11T07:00:00.000Z',
      }),
      weightRow({
        id: 'w_pm',
        date: WED,
        weight: 81.4,
        created_at: '2026-03-11T21:00:00.000Z',
      }),
    ];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    expect(localOf(db, WED).this_week.daily_weight[2].weight).toBe(81.4);
  });

  it('agrees that tombstoned meals and weigh-ins are invisible to the trend', () => {
    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: WED, calories: 1000 }),
      mealRow({ date: WED, calories: 5000, deleted_at: '2026-03-11T23:00:00Z' }),
    ];
    db.weightEntries = [weightRow({ date: WED, weight: 60, deleted_at: '2026-03-11T23:00:00Z' })];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    expect(localOf(db, WED).this_week.total_calories).toBe(1000);
    expect(localOf(db, WED).this_week.avg_weight).toBeNull();
  });

  it('agrees on the honestly-empty envelope for a calendar-impossible date', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, calories: 1000 })];
    expect(localOf(db, '2026-13-45')).toEqual(svWeeklyTrend(db, '2026-13-45'));
    expect(localOf(db, '2026-13-45')).toEqual({
      this_week: {
        week_start: '2026-13-45',
        week_end: '2026-13-45',
        days: [],
        daily_weight: [],
        total_calories: 0,
        avg_calories: 0,
        avg_weight: null,
      },
      last_week: {
        week_start: '2026-13-45',
        week_end: '2026-13-45',
        days: [],
        daily_weight: [],
        total_calories: 0,
        avg_calories: 0,
        avg_weight: null,
      },
      change: { calories: 0, weight: null },
    });
    // Two distinct objects where the server reuses one reference — JSON
    // identical, and not shared mutable state.
    expect(localOf(db, '2026-13-45').this_week).not.toBe(localOf(db, '2026-13-45').last_week);
  });

  it('agrees on where the rounding happens — the day SUM, not each row', () => {
    const db = emptyTables();
    // Three fractional rows on one day: rounding per row would give 301, the
    // server rounds the summed total and gives 302.
    db.nutritionEntries = [
      mealRow({ date: WED, calories: 100.4 }),
      mealRow({ date: WED, calories: 100.4 }),
      mealRow({ date: WED, calories: 100.4 }),
    ];
    expect(localOf(db, WED)).toEqual(svWeeklyTrend(db, WED));
    expect(localOf(db, WED).this_week.days[2].calories).toBe(301);
    expect(localOf(db, WED).this_week.total_calories).toBe(301);
    // …and `nutritionSummary` on the same rows does NOT round at all.
    expect(
      computeNutritionSummary({ date: WED, nutrition: db.nutritionEntries, goal: null }).totals
        .calories,
    ).toBeCloseTo(301.2, 10);
  });

  it('keeps the Worker key order on both windows', () => {
    const db = emptyTables();
    expect(Object.keys(localOf(db, WED).this_week)).toEqual(
      Object.keys(svWeeklyTrend(db, WED).this_week),
    );
  });
});

/* ================================================================== */
/* 6. dailySummary                                                     */
/* ================================================================== */

describe('He7-lite parity — dailySummary (health-service.ts:1975)', () => {
  function localOf(db: Tables, date: string): HealthDailySummary {
    return computeDailySummary({
      date,
      nutrition: db.nutritionEntries,
      water: db.waterEntries,
      weight: db.weightEntries,
      entries: db.healthEntries,
      goal: resolveGoalFor(db.healthGoals, date),
    });
  }

  it('agrees on a completely empty day', () => {
    const db = emptyTables();
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));
    expect(localOf(db, WED).weight).toBeNull();
    expect(localOf(db, WED).steps).toEqual({ value: 0, goal: null });
  });

  it('agrees on a full day — nutrition, water, weight and steps against the goal', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, meal_type: 'lunch', calories: 700, proteins: 40 })];
    db.waterEntries = [waterRow({ date: WED, amount_ml: 500 })];
    db.weightEntries = [weightRow({ date: WED, weight: 81.4 })];
    db.healthEntries = [entryRow({ date: WED, entry_type: 'steps', data: '{"steps":8421}' })];
    db.healthGoals = [
      goalRow({
        effective_date: '2026-01-01',
        daily_calories: 2100,
        daily_water_ml: 2500,
        daily_steps: 10000,
      }),
    ];
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));

    const summary = localOf(db, WED);
    expect(summary.steps).toEqual({ value: 8421, goal: 10000 });
    expect(summary.weight).toEqual({ value: 81.4, unit: 'kg', date: WED });
    expect(summary.water.total_ml).toBe(500);
    expect(summary.nutrition.totals.calories).toBe(700);
  });

  it('agrees that `weight` is the last reading ON OR BEFORE the date, not just that day', () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-03-04', weight: 83.2, unit: 'lb' }),
      // A FUTURE reading must not leak backwards.
      weightRow({ date: '2026-03-20', weight: 79 }),
    ];
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));
    expect(localOf(db, WED).weight).toEqual({ value: 83.2, unit: 'lb', date: '2026-03-04' });
  });

  it('agrees that a workout entry on the same day is not a step count', () => {
    const db = emptyTables();
    db.healthEntries = [
      entryRow({ date: WED, entry_type: 'workout', data: '{"minutes":45,"steps":99999}' }),
      entryRow({ date: WED, entry_type: 'steps', data: '{"steps":3000}' }),
    ];
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));
    expect(localOf(db, WED).steps.value).toBe(3000);
  });

  it('agrees that a tombstoned step row reads as zero steps', () => {
    const db = emptyTables();
    db.healthEntries = [
      entryRow({
        date: WED,
        entry_type: 'steps',
        data: '{"steps":12000}',
        deleted_at: '2026-03-11T22:00:00Z',
      }),
    ];
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));
    expect(localOf(db, WED).steps.value).toBe(0);
  });

  it('agrees that a `null` step payload reads as zero, matching the Worker`s `?.steps ?? 0`', () => {
    const db = emptyTables();
    db.healthEntries = [entryRow({ date: WED, entry_type: 'steps', data: 'null' })];
    expect(localOf(db, WED)).toEqual(svDailySummary(db, WED));
    expect(localOf(db, WED).steps.value).toBe(0);
  });

  it('DIVERGES on a malformed step blob, deliberately — the Worker 500s the whole route', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, calories: 700 })];
    db.healthEntries = [entryRow({ date: WED, entry_type: 'steps', data: '{not json' })];

    // `JSON.parse(steps[0].data)` is bare on the Worker (`:1983`), so Home's
    // nutrition, water AND weight go down with the step blob.
    expect(() => svDailySummary(db, WED)).toThrow();
    // On device the day still renders, with the same `0` the server produces for
    // an absent `steps` key.
    expect(localOf(db, WED).steps.value).toBe(0);
    expect(localOf(db, WED).nutrition.totals.calories).toBe(700);
  });

  it('breaks the two-step-rows-on-one-day tie towards the newest, where SQL leaves it open', () => {
    const db = emptyTables();
    // `setSteps` upserts one row per day, so this needs a restored backup or a
    // merge to occur — but `ORDER BY date DESC LIMIT 1` cannot separate them if
    // it does, and a Home step count that flips between two numbers on
    // successive renders is worse than either number.
    db.healthEntries = [
      entryRow({
        id: 'he_early',
        date: WED,
        entry_type: 'steps',
        data: '{"steps":2000}',
        created_at: '2026-03-11T09:00:00.000Z',
      }),
      entryRow({
        id: 'he_late',
        date: WED,
        entry_type: 'steps',
        data: '{"steps":9000}',
        created_at: '2026-03-11T22:00:00.000Z',
      }),
    ];
    expect(localOf(db, WED).steps.value).toBe(9000);
    // The reference models SQLite's unspecified tie as insertion order, so it
    // answers the OTHER row — which is exactly why the port pins one.
    expect(svDailySummary(db, WED).steps.value).toBe(2000);
    // Everything that does not depend on the tie still matches.
    expect(localOf(db, WED).nutrition).toEqual(svDailySummary(db, WED).nutrition);
    expect(localOf(db, WED).water).toEqual(svDailySummary(db, WED).water);
  });

  it('composes the SAME nutrition and water envelopes the standalone summaries return', () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: WED, calories: 700, meal_type: 'dinner' })];
    db.waterEntries = [waterRow({ date: WED, amount_ml: 330 })];
    db.healthGoals = [goalRow({ effective_date: '2026-01-01', daily_water_ml: 2000 })];

    expect(localOf(db, WED).nutrition).toEqual(svNutritionSummary(db, WED));
    expect(localOf(db, WED).water).toEqual(svWaterDailySummary(db, WED));
  });
});

/* ================================================================== */
/* 7. Habit streaks                                                    */
/* ================================================================== */

describe('He7-lite parity — habit streaks (health-service.ts:1508 / :2192)', () => {
  const TODAY = '2026-03-11';

  function localOf(db: Tables, options: { includeArchived?: boolean } = {}) {
    return computeHabitList({
      habits: db.userHabits,
      logs: db.habitLogs,
      today: TODAY,
      includeArchived: options.includeArchived,
    });
  }

  it('agrees on a plain streak ending today', () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Water', sort_order: 0 })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -1) }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -2) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].streak).toBe(3);
    // Newest first.
    expect(localOf(db)[0].days[0]).toBe(TODAY);
  });

  it('agrees that a habit not yet ticked TODAY still has a live streak', () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Read' })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -1) }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -2) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].streak).toBe(2);
  });

  it('agrees that a two-day gap breaks the streak to zero', () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Run' })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -2) }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -3) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].streak).toBe(0);
    // The days are still all there — only the streak is zero.
    expect(localOf(db)[0].days).toHaveLength(2);
  });

  it('agrees that a mid-history gap stops the count at the gap', () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Meditate' })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -1) }),
      // -2 missing
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -3) }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -4) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].streak).toBe(2);
  });

  it('agrees that a tombstoned log shortens the streak', () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Stretch' })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({
        habit_id: 'h1',
        date: addDays(TODAY, -1),
        deleted_at: '2026-03-11T08:00:00.000Z',
      }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -2) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].streak).toBe(1);
  });

  it('agrees on archive filtering in both directions', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'Live', sort_order: 0 }),
      habitRow({ id: 'h2', name: 'Archived', sort_order: 1, is_archived: 1 }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db).map((h) => h.id)).toEqual(['h1']);

    expect(localOf(db, { includeArchived: true })).toEqual(
      svListHabits(db, TODAY, { includeArchived: true }),
    );
    expect(localOf(db, { includeArchived: true }).map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(localOf(db, { includeArchived: true })[1].is_archived).toBe(true);
  });

  it('agrees that a tombstoned HABIT disappears entirely', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'Kept' }),
      habitRow({ id: 'h2', name: 'Deleted', deleted_at: '2026-03-01T00:00:00.000Z' }),
    ];
    expect(localOf(db, { includeArchived: true })).toEqual(
      svListHabits(db, TODAY, { includeArchived: true }),
    );
    expect(localOf(db, { includeArchived: true })).toHaveLength(1);
  });

  it('agrees on `sort_order` ordering, and breaks the tie SQL leaves open', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h_c', name: 'C', sort_order: 2 }),
      habitRow({ id: 'h_a', name: 'A', sort_order: 0 }),
      // Two habits sharing a `sort_order` — `createHabit` mints that whenever a
      // habit is deleted and another added.
      habitRow({ id: 'h_b2', name: 'B2', sort_order: 1 }),
      habitRow({ id: 'h_b1', name: 'B1', sort_order: 1 }),
    ];
    expect(localOf(db).map((h) => h.sort_order)).toEqual([0, 1, 1, 2]);
    // The port orders the tie by id so two devices paint the same list.
    expect(localOf(db).map((h) => h.id)).toEqual(['h_a', 'h_b1', 'h_b2', 'h_c']);
  });

  it('agrees that `custom_days` is parsed back to an ARRAY, and a corrupt blob to null', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'Gym', frequency: 'custom', custom_days: '[2,4,6]', sort_order: 0 }),
      habitRow({ id: 'h2', name: 'Bad', custom_days: 'not json', sort_order: 1 }),
      habitRow({ id: 'h3', name: 'Junk', custom_days: '[0,9,"3"]', sort_order: 2 }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].custom_days).toEqual([2, 4, 6]);
    expect(localOf(db)[1].custom_days).toBeNull();
    // 0 and 9 are out of range; "3" coerces. `api/health.ts:403` declares this
    // `string | null`; the Worker has always sent the parsed array.
    expect(localOf(db)[2].custom_days).toEqual([3]);
  });

  it('agrees that the two INTEGER flags come back as real booleans', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'Pills', reminder_enabled: 1, reminder_time: '08:00' }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db)[0].reminder_enabled).toBe(true);
    expect(localOf(db)[0].is_archived).toBe(false);
  });

  it('agrees that a log belonging to another habit never counts', () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'One', sort_order: 0 }),
      habitRow({ id: 'h2', name: 'Two', sort_order: 1 }),
    ];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({ habit_id: 'h2', date: TODAY }),
      habitLogRow({ habit_id: 'h2', date: addDays(TODAY, -1) }),
    ];
    expect(localOf(db)).toEqual(svListHabits(db, TODAY));
    expect(localOf(db).map((h) => h.streak)).toEqual([1, 2]);
  });

  it('matches `streakOf` on the raw day sets, including the empty one', () => {
    const days = [TODAY, addDays(TODAY, -1), addDays(TODAY, -2), addDays(TODAY, -5)];
    expect(computeHabitStreak(days, TODAY)).toBe(svStreakOf(days, TODAY));
    expect(computeHabitStreak([], TODAY)).toBe(svStreakOf([], TODAY));
    expect(computeHabitStreak(days, addDays(TODAY, 5))).toBe(
      svStreakOf(days, addDays(TODAY, 5)),
    );
  });

  it(
    'requires an explicit `today` where the server defaults to a UTC day — the ' +
      'one divergence that is a fix, not a drift',
    () => {
      // A member at UTC-8 ticking at 23:00 local is already "tomorrow" in UTC.
      const localToday = '2026-03-11';
      const utcToday = '2026-03-12';
      const days = [localToday, addDays(localToday, -1)];

      expect(computeHabitStreak(days, localToday)).toBe(2);
      // The server's default would look for the 12th, miss it, fall back to the
      // 11th, and answer 2 as well — but one more day west and it breaks:
      expect(svStreakOf(days, utcToday)).toBe(computeHabitStreak(days, utcToday));
      expect(computeHabitStreak(days, addDays(utcToday, 1))).toBe(0);
    },
  );
});

/* ================================================================== */
/* 8. The facade — envelopes, windows, and the goal-union equivalence   */
/* ================================================================== */

describe('localSummariesApi — envelopes and read windows', () => {
  /** Real "today", because the habit-log window is 400 days from wall clock. */
  const TODAY = localDateKey();

  beforeEach(() => {
    installLedger(emptyTables());
  });

  it('answers the same envelopes the Worker does', async () => {
    const db = emptyTables();
    db.nutritionEntries = [mealRow({ date: TODAY, calories: 620, meal_type: 'lunch' })];
    db.waterEntries = [waterRow({ date: TODAY, amount_ml: 400 })];
    db.weightEntries = [weightRow({ date: TODAY, weight: 81.5 })];
    db.healthEntries = [entryRow({ date: TODAY, entry_type: 'steps', data: '{"steps":7200}' })];
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2000, daily_water_ml: 2500 }),
    ];
    installLedger(db);

    await expect(localSummariesApi.dailySummary(TODAY)).resolves.toEqual({
      summary: svDailySummary(db, TODAY),
    });
    await expect(localSummariesApi.nutritionSummary(TODAY)).resolves.toEqual({
      summary: svNutritionSummary(db, TODAY),
    });
    await expect(localSummariesApi.waterSummary(TODAY)).resolves.toEqual({
      summary: svWaterDailySummary(db, TODAY),
    });
    await expect(localSummariesApi.weightStatistics()).resolves.toEqual({
      statistics: svWeightStatistics(db),
    });
    await expect(localSummariesApi.getWeeklyTrend(TODAY)).resolves.toEqual(
      svWeeklyTrend(db, TODAY),
    );

    const weeks = await localSummariesApi.weeklyWeight();
    expect(weeks.weeks).toHaveLength(1);
    expect(weeks.weeks[0].week_start).toBe(weekStartOf(TODAY));
  });

  it('defaults `dailySummary` to the device`s LOCAL day, not the Worker`s UTC one', async () => {
    const db = emptyTables();
    db.waterEntries = [waterRow({ date: TODAY, amount_ml: 250 })];
    installLedger(db);

    const { summary } = await localSummariesApi.dailySummary();
    expect(summary.date).toBe(TODAY);
    expect(summary.water.total_ml).toBe(250);
  });

  it('never lets a row outside the single-day window reach a daily summary', async () => {
    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: TODAY, calories: 500 }),
      mealRow({ date: addDays(TODAY, -1), calories: 9999 }),
      mealRow({ date: addDays(TODAY, 1), calories: 9999 }),
    ];
    db.waterEntries = [
      waterRow({ date: TODAY, amount_ml: 200 }),
      waterRow({ date: addDays(TODAY, -1), amount_ml: 9999 }),
    ];
    installLedger(db);

    const { summary } = await localSummariesApi.dailySummary(TODAY);
    expect(summary.nutrition.totals.calories).toBe(500);
    expect(summary.nutrition.entry_count).toBe(1);
    expect(summary.water.total_ml).toBe(200);
  });

  it('reads the weekly trend through the registry`s 14 days, anchored on the date asked about', async () => {
    // Both halves of `loadWeeklyTrend` declare the same span, and the facade
    // derives its range from it rather than from a literal.
    expect(HEALTH_WEEKLY_TREND_WINDOW_DAYS).toBe(14);
    expect(maxDaysForWindow(HEALTH_READ_WINDOWS.loadWeeklyTrend.reads[0].window)).toBe(14);
    expect(maxDaysForWindow(HEALTH_READ_WINDOWS.loadWeeklyTrend.reads[1].window)).toBe(14);

    const db = emptyTables();
    db.nutritionEntries = [
      mealRow({ date: WED, calories: 1500 }),
      // Three weeks before the anchor — inside no window, and outside the two
      // weeks the response describes.
      mealRow({ date: addDays(PREV_MON, -7), calories: 9999 }),
    ];
    db.weightEntries = [weightRow({ date: WED, weight: 81 })];
    installLedger(db);

    // The anchor is months in the past: a wall-clock `days` window would answer
    // two empty weeks here, which is the bug this arrangement exists to avoid.
    const trend = await localSummariesApi.getWeeklyTrend(WED);
    expect(trend).toEqual(svWeeklyTrend(db, WED));
    expect(trend.this_week.total_calories).toBe(1500);
    expect(trend.last_week.total_calories).toBe(0);
  });

  it('resolves the trend`s goals per day from the union, exactly as `goalFor` would', async () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2200 }),
      goalRow({ effective_date: WED, daily_calories: 1900 }),
      goalRow({ effective_date: PREV_MON, daily_calories: 2050 }),
    ];
    installLedger(db);

    const trend = await localSummariesApi.getWeeklyTrend(WED);
    expect(trend).toEqual(svWeeklyTrend(db, WED));

    // The equivalence the union rests on, asserted directly: for every day in
    // the window the union answers what `goalFor` answers.
    for (const day of [...trend.last_week.days, ...trend.this_week.days]) {
      const server = svGoalFor(db, day.date);
      expect(day.calorie_goal).toBe(server ? svCaloriesGoalFor(server, day.date) : null);
    }
  });

  it('answers an empty trend for a calendar-impossible date instead of throwing', async () => {
    installLedger(emptyTables());
    const trend = await localSummariesApi.getWeeklyTrend('2026-13-45');
    expect(trend.this_week.days).toEqual([]);
    expect(trend.change).toEqual({ calories: 0, weight: null });
  });

  it('bounds `weeklyWeight` to the requested week count and orders newest first', async () => {
    const db = emptyTables();
    for (let week = 0; week < 40; week += 1) {
      db.weightEntries.push(weightRow({ date: addDays('2026-01-05', week * 7), weight: 80 + week }));
    }
    installLedger(db);

    const { weeks } = await localSummariesApi.weeklyWeight();
    expect(weeks).toHaveLength(HEALTH_WEEKLY_WEIGHT_DEFAULT_LIMIT);
    expect(weeks[0].week_start > weeks[weeks.length - 1].week_start).toBe(true);

    const four = await localSummariesApi.weeklyWeight({ limit: 4 });
    expect(four.weeks).toHaveLength(4);
    expect(four.weeks.map((w) => w.week_start)).toEqual(
      weeks.slice(0, 4).map((w) => w.week_start),
    );
  });

  it('bounds `weightStatistics` to the server`s own 1000-row ceiling', async () => {
    const db = emptyTables();
    for (let i = 0; i < 1200; i += 1) {
      db.weightEntries.push(weightRow({ date: addDays('2022-01-01', i), weight: 100 - i * 0.01 }));
    }
    installLedger(db);

    const { statistics } = await localSummariesApi.weightStatistics();
    expect(statistics).toEqual(svWeightStatistics(db));
    expect(statistics.count).toBe(WEIGHT_STATISTICS_ROW_LIMIT);
    expect(statistics.count).toBeLessThanOrEqual(WEIGHT_STATISTICS_ROW_LIMIT);
  });

  it('passes the `from` filter through to `weightStatistics`', async () => {
    const db = emptyTables();
    db.weightEntries = [
      weightRow({ date: '2026-01-01', weight: 90 }),
      weightRow({ date: WED, weight: 81 }),
    ];
    installLedger(db);

    await expect(localSummariesApi.weightStatistics({ from: '2026-02-01' })).resolves.toEqual({
      statistics: svWeightStatistics(db, '2026-02-01'),
    });
  });

  it('applies the steps `rowFilter` BEFORE the day window, so a workout is never a step count', async () => {
    const db = emptyTables();
    db.healthEntries = [
      entryRow({ date: TODAY, entry_type: 'workout', data: '{"minutes":45,"steps":99999}' }),
      entryRow({ date: TODAY, entry_type: 'sleep', data: '{"hours":7}' }),
      entryRow({ date: TODAY, entry_type: 'steps', data: '{"steps":4400}' }),
    ];
    installLedger(db);

    const { summary } = await localSummariesApi.dailySummary(TODAY);
    expect(summary).toEqual(svDailySummary(db, TODAY));
    expect(summary.steps.value).toBe(4400);
  });

  it('resolves the goal in force through the shared resolver, not the newest row', async () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2200, daily_water_ml: 2000 }),
      goalRow({ effective_date: '2026-06-01', daily_calories: 1700, daily_water_ml: 3000 }),
    ];
    installLedger(db);

    // A day viewed in the PAST must not see a goal set later — the calorie-week
    // editor does this routinely.
    const { summary } = await localSummariesApi.nutritionSummary('2026-03-11');
    expect(summary.goal?.calories).toBe(2200);
    expect(summary).toEqual(svNutritionSummary(db, '2026-03-11'));

    const water2026 = await localSummariesApi.waterSummary('2026-03-11');
    expect(water2026.summary.goal_ml).toBe(2000);
  });

  it('treats a goal the ledger has tombstoned as gone, where D1 has no column to say so', async () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2200 }),
      goalRow({
        effective_date: '2026-03-01',
        daily_calories: 1500,
        deleted_at: '2026-03-05T00:00:00.000Z',
      }),
    ];
    installLedger(db);

    // The server would answer 1500 — `health_goals` carries no `deleted_at`
    // (`schema-health.ts:502-611`), so `goalFor` cannot filter one. The LEDGER
    // tombstone is authoritative (`types.ts` header), and no server fixture can
    // produce a tombstoned goal, so this is an extension rather than a break.
    expect(svGoalFor(db, WED)?.daily_calories).toBe(1500);
    const { summary } = await localSummariesApi.nutritionSummary(WED);
    expect(summary.goal?.calories).toBe(2200);
  });
});

/* ================================================================== */
/* 8b. Streaks reach the wire through localHabitsApi, not this facade   */
/* ================================================================== */

/**
 * §12.1 puts STREAK parity in this file, but the facade that serves them is
 * `localHabitsApi` — `user_habits` and `habit_logs` are one table pair with one
 * owner, and three habit WRITES answer with the whole derived list
 * (`routes/health.ts:846`, `:868`), so the derivation has to sit beside them.
 *
 * Both facades reach the same `summaries.computeHabitList`, so the differential
 * assertion belongs here regardless of which module exports the method — and
 * the first test below is the guard that keeps it ONE method rather than two.
 */
describe('He7-lite parity — streaks on the wire (localHabitsApi)', () => {
  const TODAY = localDateKey();

  beforeEach(() => {
    installLedger(emptyTables());
  });

  it('has exactly one `listHabits` in the fleet', () => {
    // A duplicate would collide in the composition root, where whichever facade
    // spreads last silently wins — and the two answer different `custom_days`
    // types. `localHabitsApi` owns it; this module must not re-export it.
    expect('listHabits' in localSummariesApi).toBe(false);
    expect(typeof localHabitsApi.listHabits).toBe('function');
  });

  it('serves the Worker`s habit list, streaks included, and honours `includeArchived`', async () => {
    const db = emptyTables();
    db.userHabits = [
      habitRow({ id: 'h1', name: 'Water', sort_order: 0 }),
      habitRow({ id: 'h2', name: 'Old', sort_order: 1, is_archived: 1 }),
    ];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -1) }),
    ];
    installLedger(db);

    const { habits } = await localHabitsApi.listHabits();
    expect(habits).toEqual(svListHabits(db, TODAY));
    expect(habits).toHaveLength(1);
    expect(habits[0].streak).toBe(2);

    const all = await localHabitsApi.listHabits({ includeArchived: true });
    expect(all.habits).toEqual(svListHabits(db, TODAY, { includeArchived: true }));
  });

  it('caps habits by `sort_order`, which is what the remote`s forty actually are', async () => {
    const db = emptyTables();
    // The forty the Worker returns are the forty LOWEST `sort_order`
    // (`ORDER BY sort_order` then `.slice(0, 40)`), NOT the forty most recently
    // created — so the newest rows here carry the HIGHEST sort_order and must be
    // the ones dropped.
    for (let i = 0; i < 55; i += 1) {
      db.userHabits.push(
        habitRow({
          id: `h_${String(i).padStart(3, '0')}`,
          name: `Habit ${i}`,
          sort_order: i,
          created_at: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        }),
      );
    }
    installLedger(db);

    const cap = maxRowsForWindow(HEALTH_READ_WINDOWS.loadHabits.reads[0].window) ?? 40;
    const { habits } = await localHabitsApi.listHabits();
    expect(habits).toHaveLength(cap);
    expect(habits.map((h) => h.sort_order)).toEqual(svListHabits(db, TODAY).slice(0, cap).map((h) => h.sort_order));
    expect(habits[habits.length - 1].sort_order).toBe(cap - 1);
  });

  it('bounds each habit`s days to the registered 400-day window', async () => {
    const db = emptyTables();
    db.userHabits = [habitRow({ id: 'h1', name: 'Water' })];
    db.habitLogs = [
      habitLogRow({ habit_id: 'h1', date: TODAY }),
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -1) }),
      // The ROUTE is unbounded here (`health-service.ts:1521-1525`), so this
      // 500-day-old completion is one the Worker would return and the device
      // deliberately will not — `healthHabitsStorage.ts:433` is the whole window.
      habitLogRow({ habit_id: 'h1', date: addDays(TODAY, -500) }),
    ];
    installLedger(db);

    expect(maxDaysForWindow(HEALTH_READ_WINDOWS.loadHabits.reads[1].window)).toBe(400);
    const { habits } = await localHabitsApi.listHabits();
    expect(habits[0].days).not.toContain(addDays(TODAY, -500));
    // The streak is unaffected — it only ever walks back through CONSECUTIVE
    // days, and a 400-day run is far beyond any real one.
    expect(habits[0].streak).toBe(2);
  });
});

/* ================================================================== */
/* 9. Seeded fuzz — the sweep the hand-written cases cannot cover       */
/* ================================================================== */

/**
 * mulberry32 — seeded so a failure is reproducible from the seed alone.
 *
 * Bitwise by definition: the whole point of a named PRNG here (rather than
 * `Math.random`) is that a red sweep can be replayed exactly from its seed.
 */
/* eslint-disable no-bitwise */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

/**
 * A random 140-day corpus.
 *
 * **One weight reading and one steps row per day, all live.** Both of those are
 * read through an `ORDER BY` that SQLite leaves unspecified when a day has two
 * rows, and the port breaks that tie on purpose in a direction the reference
 * cannot model (see the two "breaks the tie" cases above). Feeding ties into a
 * sweep would make it fail for the one reason that is not a bug. Weight
 * tombstones are likewise excluded: `deleteWeight` re-runs
 * `recomputeWeeklyAverage` with the DELETED row's unit (`health-service.ts:313`),
 * so the materialised table can hold a unit no surviving reading carries —
 * a server defect the port has no way to reproduce and no reason to.
 *
 * Everything else is deliberately messy: unknown meal slots, mixed units,
 * tombstones on the order-independent tables, per-weekday goal overrides,
 * fractional macros, empty days and days with a dozen rows.
 */
function fuzzCorpus(seed: number): Tables {
  const random = rng(seed);
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const db = emptyTables();
  const START = '2026-01-05'; // a Monday
  const DAYS = 140;

  for (let i = 0; i < DAYS; i += 1) {
    const date = addDays(START, i);

    if (random() < 0.55) {
      db.weightEntries.push(
        weightRow({
          id: `fz_w_${i}`,
          date,
          weight: Math.round((70 + random() * 30) * 100) / 100,
          unit: i < DAYS / 2 ? 'lb' : pick(['kg', 'kg', 'lbs']),
          created_at: `${date}T07:00:00.000Z`,
          updated_at: `${date}T07:00:00.000Z`,
        }),
      );
    }

    const meals = Math.floor(random() * 5);
    for (let m = 0; m < meals; m += 1) {
      db.nutritionEntries.push(
        mealRow({
          id: `fz_n_${i}_${m}`,
          date,
          meal_type: pick(['breakfast', 'lunch', 'dinner', 'snack', 'brunch']),
          calories: Math.round(random() * 900 * 10) / 10,
          proteins: Math.round(random() * 60 * 10) / 10,
          carbohydrates: Math.round(random() * 120 * 10) / 10,
          fats: Math.round(random() * 40 * 10) / 10,
          created_at: `${date}T${String(8 + m).padStart(2, '0')}:00:00.000Z`,
          deleted_at: random() < 0.1 ? `${date}T23:00:00.000Z` : null,
        }),
      );
    }

    const sips = Math.floor(random() * 6);
    for (let s = 0; s < sips; s += 1) {
      db.waterEntries.push(
        waterRow({
          id: `fz_h2o_${i}_${s}`,
          date,
          amount_ml: pick([200, 250, 330, 500]),
          created_at: `${date}T${String(8 + s).padStart(2, '0')}:30:00.000Z`,
          deleted_at: random() < 0.08 ? `${date}T23:00:00.000Z` : null,
        }),
      );
    }

    if (random() < 0.6) {
      db.healthEntries.push(
        entryRow({
          id: `fz_he_${i}`,
          date,
          entry_type: 'steps',
          data: JSON.stringify({ steps: Math.floor(random() * 20000) }),
          created_at: `${date}T23:00:00.000Z`,
        }),
      );
    }
    if (random() < 0.3) {
      db.healthEntries.push(
        entryRow({
          id: `fz_hw_${i}`,
          date,
          entry_type: 'workout',
          data: JSON.stringify({ minutes: 30, steps: 12345 }),
          created_at: `${date}T18:00:00.000Z`,
        }),
      );
    }
  }

  // Four goal slots across the corpus, one of them with per-weekday overrides.
  db.healthGoals = [
    goalRow({ effective_date: '2026-01-10', daily_calories: 2200, daily_water_ml: 2000, daily_steps: 8000 }),
    goalRow({
      effective_date: '2026-02-14',
      daily_calories: 2000,
      use_per_day_calories: 1,
      monday_calories: 1700,
      saturday_calories: 2600,
      use_per_day_macros: 1,
      daily_protein_grams: 150,
      sunday_protein_grams: 110,
      daily_carbs_grams: 210,
      daily_fats_grams: 65,
      daily_water_ml: 2500,
      daily_steps: 9000,
    }),
    goalRow({ effective_date: '2026-03-20', daily_calories: 1850, daily_water_ml: 3000 }),
    // Future-dated relative to the whole corpus — must never apply.
    goalRow({ effective_date: '2027-01-01', daily_calories: 1200 }),
  ];

  // Habits: five, one archived, with sparse completions.
  for (let h = 0; h < 5; h += 1) {
    db.userHabits.push(
      habitRow({
        id: `fz_h_${h}`,
        name: `Habit ${h}`,
        sort_order: h,
        is_archived: h === 4 ? 1 : 0,
        reminder_enabled: h % 2,
        custom_days: h === 2 ? '[1,3,5]' : null,
      }),
    );
    for (let i = 0; i < DAYS; i += 1) {
      if (random() < 0.45) continue;
      const date = addDays(START, i);
      db.habitLogs.push(
        habitLogRow({
          habit_id: `fz_h_${h}`,
          date,
          deleted_at: random() < 0.07 ? `${date}T23:00:00.000Z` : null,
        }),
      );
    }
  }

  return db;
}

describe('He7-lite parity — seeded fuzz sweep', () => {
  const SEEDS = [1, 7, 42, 1337, 90210, 2026];

  it.each(SEEDS)('agrees on every summary across a random corpus (seed %i)', (seed) => {
    const db = fuzzCorpus(seed);
    // A second stream for the probe dates, decorrelated from the corpus one.
    const random = rng(seed * 2654435761);

    for (let probe = 0; probe < 25; probe += 1) {
      // Probe inside the corpus, and deliberately outside it at both ends.
      const date = addDays('2026-01-01', Math.floor(random() * 160) - 5);

      expect(
        computeNutritionSummary({
          date,
          nutrition: db.nutritionEntries,
          goal: resolveGoalFor(db.healthGoals, date),
        }),
      ).toEqual(svNutritionSummary(db, date));

      expect(
        computeWaterSummary({
          date,
          water: db.waterEntries,
          goal: resolveGoalFor(db.healthGoals, date),
        }),
      ).toEqual(svWaterDailySummary(db, date));

      expect(
        computeDailySummary({
          date,
          nutrition: db.nutritionEntries,
          water: db.waterEntries,
          weight: db.weightEntries,
          entries: db.healthEntries,
          goal: resolveGoalFor(db.healthGoals, date),
        }),
      ).toEqual(svDailySummary(db, date));

      expect(
        computeWeeklyTrend({
          date,
          nutrition: db.nutritionEntries,
          weight: db.weightEntries,
          goals: db.healthGoals,
        }),
      ).toEqual(svWeeklyTrend(db, date));

      expect(
        computeHabitList({ habits: db.userHabits, logs: db.habitLogs, today: date }),
      ).toEqual(svListHabits(db, date));
      expect(
        computeHabitList({
          habits: db.userHabits,
          logs: db.habitLogs,
          today: date,
          includeArchived: true,
        }),
      ).toEqual(svListHabits(db, date, { includeArchived: true }));
    }

    expect(
      computeWeightStatistics({ weight: db.weightEntries, limit: WEIGHT_STATISTICS_ROW_LIMIT }),
    ).toEqual(svWeightStatistics(db));
    expect(
      computeWeightStatistics({
        weight: db.weightEntries,
        from: '2026-03-01',
        limit: WEIGHT_STATISTICS_ROW_LIMIT,
      }),
    ).toEqual(svWeightStatistics(db, '2026-03-01'));

    expect(
      computeWeeklyWeight({ weight: db.weightEntries }).map(({ id: _id, ...rest }) => rest),
    ).toEqual(svWeeklyAverages(db).map((row) => ({ ...row })));
  });

  it('sweeps a corpus substantial enough for the comparison to mean something', () => {
    const db = fuzzCorpus(42);
    expect(db.weightEntries.length).toBeGreaterThan(50);
    expect(db.nutritionEntries.length).toBeGreaterThan(150);
    expect(db.waterEntries.length).toBeGreaterThan(200);
    expect(db.healthEntries.length).toBeGreaterThan(80);
    expect(db.habitLogs.length).toBeGreaterThan(200);
    // Mixed units, unknown meal slots and tombstones all present.
    expect(new Set(db.weightEntries.map((r) => r.unit)).size).toBeGreaterThan(1);
    expect(db.nutritionEntries.some((r) => r.meal_type === 'brunch')).toBe(true);
    expect(db.nutritionEntries.some((r) => r.deleted_at !== null)).toBe(true);
    expect(db.habitLogs.some((r) => r.deleted_at !== null)).toBe(true);
  });

  /**
   * A differential test that cannot fail proves nothing. Each case below is a
   * plausible mis-port of a rule the Worker actually has, re-implemented inline
   * and asserted to DISAGREE with the reference — so a green sweep above is
   * evidence the port is right rather than evidence the harness is asleep.
   */
  describe('the reference bites — deliberate mis-ports are caught', () => {
    const db = fuzzCorpus(42);

    it('catches averaging calories over LOGGED days instead of over 7', () => {
      const week = svWeeklyTrend(db, '2026-02-18').this_week;
      const logged = week.days.filter((day) => day.calories > 0);
      const wrong = Math.round(
        week.days.reduce((s, d) => s + d.calories, 0) / Math.max(logged.length, 1),
      );
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.length).toBeLessThan(7);
      expect(wrong).not.toBe(week.avg_calories);
    });

    it('catches zero-filling the missing days in `avg_weight`', () => {
      const week = svWeeklyTrend(db, '2026-02-18').this_week;
      const gaps = week.daily_weight.filter((point) => point.weight === null);
      expect(gaps.length).toBeGreaterThan(0);
      const wrong = week.daily_weight.reduce((s, p) => s + (p.weight ?? 0), 0) / 7;
      expect(wrong).not.toBeCloseTo(week.avg_weight ?? 0, 6);
    });

    it('catches dropping the LATEST-unit filter from `weightStatistics`', () => {
      const stats = svWeightStatistics(db);
      const all = db.weightEntries.filter((r) => r.deleted_at === null);
      expect(new Set(all.map((r) => r.unit)).size).toBeGreaterThan(1);
      // `max` can coincide by luck; the average over a mixed-unit corpus cannot.
      const wrong =
        Math.round((all.reduce((s, r) => s + r.weight, 0) / all.length) * 10) / 10;
      expect(stats.count).toBeLessThan(all.length);
      expect(wrong).not.toBe(stats.average);
      expect(all[all.length - 1].weight).not.toBe(stats.first);
    });

    it('catches resolving the NEWEST goal instead of the newest one in force', () => {
      const date = '2026-01-20';
      const newestRow = [...db.healthGoals].sort((a, b) =>
        b.effective_date.localeCompare(a.effective_date),
      )[0];
      const inForce = svGoalFor(db, date);
      expect(inForce).not.toBeNull();
      expect(newestRow.effective_date).not.toBe(inForce!.effective_date);
      expect(newestRow.daily_calories).not.toBe(svCaloriesGoalFor(inForce!, date));
      // …and the port agrees with "in force", not with "newest".
      expect(resolveGoalFor(db.healthGoals, date)!.effective_date).toBe(inForce!.effective_date);
    });

    it('catches counting a tombstoned meal in `entry_count`', () => {
      const date = db.nutritionEntries.find((r) => r.deleted_at !== null)!.date;
      const all = db.nutritionEntries.filter((r) => r.date === date);
      const live = all.filter((r) => r.deleted_at === null);
      expect(all.length).toBeGreaterThan(live.length);
      expect(svNutritionSummary(db, date).entry_count).toBe(live.length);
    });
  });
});

/* ================================================================== */
/* 10. Pure-helper cross-checks                                        */
/* ================================================================== */

describe('He7-lite parity — date and goal helpers', () => {
  it('matches the server`s `weekStartOf` on every weekday, Sunday included', () => {
    for (let i = 0; i < 21; i += 1) {
      const date = addDays('2026-03-01', i);
      expect(weekStartOf(date)).toBe(svWeekStartOf(date));
    }
    // 2026-03-01 is a Sunday: its week started on 2026-02-23.
    expect(weekStartOf('2026-03-01')).toBe('2026-02-23');
  });

  it('matches the server`s `addDays` across a month and a year boundary', () => {
    for (const date of ['2026-01-31', '2026-02-28', '2026-12-31', '2024-02-28']) {
      for (const delta of [-7, -1, 0, 1, 7]) {
        expect(addDays(date, delta)).toBe(svAddDays(date, delta));
      }
    }
    // 2024 is a leap year.
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('matches `goalFor` on the newest effective row at or before the date', () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({ effective_date: '2026-01-01', daily_calories: 2200 }),
      goalRow({ effective_date: '2026-03-01', daily_calories: 2000 }),
      goalRow({ effective_date: '2026-06-01', daily_calories: 1800 }),
    ];
    for (const date of ['2025-12-31', '2026-01-01', '2026-02-28', '2026-03-01', '2026-12-31']) {
      const local = resolveGoalFor(db.healthGoals, date);
      const server = svGoalFor(db, date);
      expect(local?.effective_date ?? null).toBe(server?.effective_date ?? null);
      if (local && server) {
        expect(caloriesGoalFor(local, date)).toBe(svCaloriesGoalFor(server, date));
        expect(macrosGoalFor(local, date)).toEqual(svMacrosGoalFor(server, date));
      }
    }
  });

  it('matches the per-weekday goal arrays on all seven days of a week', () => {
    const db = emptyTables();
    db.healthGoals = [
      goalRow({
        effective_date: '2026-01-01',
        daily_calories: 2000,
        use_per_day_calories: 1,
        sunday_calories: 2500,
        monday_calories: 1800,
        tuesday_calories: 1850,
        wednesday_calories: 1900,
        thursday_calories: 1950,
        friday_calories: 2100,
        saturday_calories: 2400,
        use_per_day_macros: 1,
        sunday_protein_grams: 120,
        monday_protein_grams: 170,
        daily_protein_grams: 150,
        daily_carbs_grams: 200,
        daily_fats_grams: 70,
      }),
    ];
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(MON, i);
      const local = resolveGoalFor(db.healthGoals, date)!;
      const server = svGoalFor(db, date)!;
      expect(caloriesGoalFor(local, date)).toBe(svCaloriesGoalFor(server, date));
      expect(macrosGoalFor(local, date)).toEqual(svMacrosGoalFor(server, date));
    }
    expect(caloriesGoalFor(resolveGoalFor(db.healthGoals, SUN)!, SUN)).toBe(2500);
    expect(caloriesGoalFor(resolveGoalFor(db.healthGoals, MON)!, MON)).toBe(1800);
  });
});
