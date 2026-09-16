/**
 * The seventeen Home loaders, modelled against the ledger.
 *
 * WHY A MODEL AND NOT THE REAL FUNCTIONS
 * --------------------------------------
 * `HealthHomeScreen.tsx:198-219` fires a 17-way `Promise.all` of `load*()` on
 * every focus, and `useHealthKitSyncHydration` fires the same hydrate again
 * after every HealthKit sync. Those seventeen functions live in
 * `src/features/health/health*Storage.ts`, and every one of them imports
 * `@api/health` and `@services/storage` — aliases that do not resolve outside
 * the mobile tsconfig, on top of MMKV and React Native modules that do not
 * exist in Node. They cannot be imported here, and today they read MMKV caches
 * filled by the network anyway: importing them would measure the CACHE, not the
 * ledger, which is the opposite of what He10 has to answer.
 *
 * So each loader is re-expressed as the read it BECOMES in He3 — the same
 * filter, the same grouping, the same sort, the same slice, over the same
 * ledger tables — and the shape of each is cited from the function it models.
 * That is the same discipline `lib/mirror.ts` applies to the Budget write path.
 *
 * FOUR OF THE SEVENTEEN ARE NOT LEDGER READS, AND THAT IS THE POINT
 * ----------------------------------------------------------------
 * `loadHealthPrefs`, `loadNoteForDate`, `loadHomeLayout` and
 * `loadChallengesWidgetExpanded` stay in MMKV: notes are explicitly NOT a ninth
 * ledger key (plan §1.5) and the other three are device-local UI state. They
 * are modelled as the small key read + parse they are, because dropping them
 * would report a 13-loader fan-out for a screen that awaits seventeen — and the
 * `Promise.all` resolves at the SLOWEST of them, not the average.
 *
 * WHAT THIS DELIBERATELY DOES NOT MODEL
 * -------------------------------------
 * React state commits, the render pass, and the windowed store read. Those sit
 * either side of the fan-out; this measures the data work between them.
 */
import type { HealthScaleLedger, ScaleRow } from './health-ledger-factory';

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD`, `n` days before `key`. Mirrors `shiftDateKey` in healthActivityStorage. */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Window sizes copied from the product, not invented. */
export const HOME_WINDOWS = {
  /** `MAX_WATER_HISTORY_DAYS` — healthLocalStorage.ts. */
  waterHistoryDays: 400,
  /** `fetchMeals()` pulls 120 days "so Trends has data without a second call". */
  mealDays: 120,
  /** `MAX_WORKOUT_ENTRIES` / `MAX_STEP_DAYS` — healthActivityStorage.ts:143-144. */
  workoutEntries: 400,
  stepDays: 400,
  /** `MAX_SLEEP_NIGHTS` — healthSleepStorage.ts:45. */
  sleepNights: 400,
  /** `MAX_BODY_ENTRIES` — healthBodyStorage.ts:270. */
  bodyEntries: 4000,
  /** `MAX_HABITS` — healthHabitsStorage.ts:432. */
  habits: 40,
  /** Both the challenges widget and the weekly trend read a 7-day window. */
  weekDays: 7,
  /** The weekly trend compares this week against last. */
  trendDays: 14,
} as const;

/**
 * What Home has to make RESIDENT before the seventeen can answer — the model of
 * the `ensureResident([...])` calls the facades now make (`localWeightApi`,
 * `localBodyApi`, `localEntriesApi`).
 *
 * Only the ROW-bounded reads appear here, and that is the whole point of the
 * list. A read bounded by DAYS — `loadMeals`' 120, `loadWaterHistory`' 400,
 * `loadHabits`' 400 — is inside `HEALTH_RESIDENT_WINDOW_DAYS` by construction
 * (`schema.ts` derives the window from the registry's widest day window), so it
 * never widens and costs nothing. A read bounded by ROWS has no date bound at
 * all: 500 weigh-ins is over three years for anyone logging twice a week, and
 * 400 workouts is ~635 days at the corpus's own rate. Those are the reads that
 * reach past the window, and the decryption they force is first-paint cost.
 *
 * `count` mirrors the read's own filter — `entry_type` FIRST, then the count —
 * because a month of `health_entries` is ~77 rows but only ~19 workouts, and
 * counting the table instead of the type stops the walk three to four times too
 * early.
 */
export const HOME_RESIDENCY_NEEDS: ReadonlyArray<{
  table: string;
  minRows: number;
  count: (ledger: HealthScaleLedger) => number;
}> = [
  {
    // `loadWeightLog` — `{ kind: 'rows', maxRows: 500 }`, no date bound.
    table: 'weightEntries',
    minRows: 500,
    count: (ledger) => ledger.weightEntries.length,
  },
  {
    // `loadBodyEntries` — the service's own `limit = 1000`.
    table: 'bodyMeasurements',
    minRows: 1000,
    count: (ledger) => ledger.bodyMeasurements.length,
  },
  {
    table: 'healthEntries',
    minRows: HOME_WINDOWS.workoutEntries,
    count: (ledger) => ledger.healthEntries.filter((row) => row.entry_type === 'workout').length,
  },
  {
    table: 'healthEntries',
    minRows: HOME_WINDOWS.stepDays,
    count: (ledger) => ledger.healthEntries.filter((row) => row.entry_type === 'steps').length,
  },
  {
    table: 'healthEntries',
    minRows: HOME_WINDOWS.sleepNights,
    count: (ledger) => ledger.healthEntries.filter((row) => row.entry_type === 'sleep').length,
  },
];

const CUP_ML = 250;

/**
 * A device-local MMKV value, as it sits at rest: a JSON string that has to be
 * parsed on every read. Not free, not measurable as zero.
 */
const MMKV_BLOBS = {
  prefs: JSON.stringify({
    unitSystem: 'metric',
    preferredUnit: 'kg',
    waterUnit: 'ml',
    healthKitEnabled: false,
    aiEnabled: false,
    target: 8,
  }),
  note: JSON.stringify({
    date: '2026-03-14',
    body: 'Slept badly, went easy on the run. Knee felt fine afterwards.',
  }),
  layout: JSON.stringify({
    widgets: [
      'weight', 'water', 'meals', 'activity', 'steps', 'sleep',
      'habits', 'body', 'trend', 'challenges', 'note',
    ],
    hidden: ['coach'],
    version: 3,
  }),
  challengesExpanded: JSON.stringify({ expanded: true }),
} as const;

export type LoaderResult = { name: string; size: number };
export type Loader = { name: string; ledgerBacked: boolean; run: () => LoaderResult };

const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value));

/** Latest `healthGoals` row whose `effective_date` is on or before today. */
function activeGoal(ledger: HealthScaleLedger, today: string): ScaleRow | null {
  let best: ScaleRow | null = null;
  for (const row of ledger.healthGoals) {
    const effective = String(row.effective_date);
    if (effective > today) continue;
    if (best === null || effective > String(best.effective_date)) best = row;
  }
  return best;
}

/**
 * The seventeen, in the order `HealthHomeScreen` awaits them.
 *
 * Every one returns a `size` so V8 cannot elide the work: a loader whose result
 * is dropped is a loader that can be optimised into nothing, and the fan-out
 * would then measure the optimiser.
 */
export function buildHomeLoaders(ledger: HealthScaleLedger, today: string): Loader[] {
  const mmkv = (name: string, blob: string): Loader => ({
    name,
    ledgerBacked: false,
    run: () => ({ name, size: Object.keys(JSON.parse(blob) as object).length }),
  });

  return [
    // 1. loadWeightLog — the WHOLE log: filter, normalize, sort desc.
    {
      name: 'loadWeightLog',
      ledgerBacked: true,
      run: () => {
        const rows = ledger.weightEntries
          .filter((e) => Number.isFinite(num(e.weight)))
          .map((e) => ({
            id: e.id,
            value: num(e.weight),
            unit: e.unit,
            loggedAt: e.created_at,
            date: e.date,
            note: e.note ?? '',
            source: e.source === 'healthkit' ? 'healthkit' : 'manual',
          }))
          .sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)));
        return { name: 'loadWeightLog', size: rows.length };
      },
    },

    // 2. loadHealthPrefs — MMKV + the unit system; no ledger read.
    mmkv('loadHealthPrefs', MMKV_BLOBS.prefs),

    // 3. loadWaterToday — today's cups.
    {
      name: 'loadWaterToday',
      ledgerBacked: true,
      run: () => {
        let ml = 0;
        for (const row of ledger.waterEntries) {
          if (row.date === today) ml += num(row.amount_ml);
        }
        return { name: 'loadWaterToday', size: Math.round(ml / CUP_ML) };
      },
    },

    // 4. loadWaterHistory — 400 days grouped by day, sorted desc.
    {
      name: 'loadWaterHistory',
      ledgerBacked: true,
      run: () => {
        const from = shiftDateKey(today, -HOME_WINDOWS.waterHistoryDays);
        const mlByDay = new Map<string, number>();
        for (const row of ledger.waterEntries) {
          const date = String(row.date);
          if (date < from) continue;
          mlByDay.set(date, (mlByDay.get(date) ?? 0) + num(row.amount_ml));
        }
        const days = [...mlByDay.entries()]
          .map(([date, ml]) => ({ date, cups: Math.round(ml / CUP_ML), target: 8 }))
          .filter((d) => d.cups > 0)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, HOME_WINDOWS.waterHistoryDays);
        return { name: 'loadWaterHistory', size: days.length };
      },
    },

    // 5. loadNoteForDate — MMKV; notes are NOT a ledger key (plan §1.5).
    mmkv('loadNoteForDate', MMKV_BLOBS.note),

    // 6. loadMeals — 120-day window, mapped to the wire shape, sorted desc.
    //    The screen takes the whole window on purpose: `loadMealsForDate` is a
    //    filter over this same result.
    {
      name: 'loadMeals',
      ledgerBacked: true,
      run: () => {
        const from = shiftDateKey(today, -HOME_WINDOWS.mealDays);
        const meals: Array<{ id: unknown; date: string; slot: unknown; calories: number; loggedAt: string }> = [];
        for (const row of ledger.nutritionEntries) {
          const date = String(row.date);
          if (date < from) continue;
          meals.push({
            id: row.id,
            date,
            slot: row.meal_type,
            calories: num(row.calories),
            loggedAt: String(row.created_at),
          });
        }
        meals.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
        return { name: 'loadMeals', size: meals.length };
      },
    },

    // 7. loadNutritionGoals — the effective-dated goal row.
    {
      name: 'loadNutritionGoals',
      ledgerBacked: true,
      run: () => {
        const goal = activeGoal(ledger, today);
        return { name: 'loadNutritionGoals', size: goal ? num(goal.daily_calories) : 0 };
      },
    },

    // 8. loadWorkouts — `health_entries` where entry_type = 'workout', with a
    //    JSON.parse of `data` per kept row.
    {
      name: 'loadWorkouts',
      ledgerBacked: true,
      run: () => {
        const rows = ledger.healthEntries.filter((e) => e.entry_type === 'workout');
        rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const kept = rows.slice(0, HOME_WINDOWS.workoutEntries);
        let minutes = 0;
        for (const row of kept) {
          const data = JSON.parse(String(row.data)) as { minutes?: number };
          minutes += data.minutes ?? 0;
        }
        return { name: 'loadWorkouts', size: minutes };
      },
    },

    // 9. loadStepDays — same table, entry_type = 'steps'.
    {
      name: 'loadStepDays',
      ledgerBacked: true,
      run: () => {
        const rows = ledger.healthEntries.filter((e) => e.entry_type === 'steps');
        rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const kept = rows.slice(0, HOME_WINDOWS.stepDays);
        let steps = 0;
        for (const row of kept) {
          const data = JSON.parse(String(row.data)) as { steps?: number };
          steps += data.steps ?? 0;
        }
        return { name: 'loadStepDays', size: steps };
      },
    },

    // 10. loadActivityGoals — a SECOND scan of `healthGoals`. The screen really
    //     does read the goal row twice (nutrition goals and activity goals are
    //     separate loaders over the same effective-dated row), and collapsing
    //     them here would report a fan-out the app does not run.
    {
      name: 'loadActivityGoals',
      ledgerBacked: true,
      run: () => {
        const goal = activeGoal(ledger, today);
        return { name: 'loadActivityGoals', size: goal ? num(goal.daily_steps) : 0 };
      },
    },

    // 11. loadHabits — the definitions PLUS the per-habit completed-day list the
    //     donor's `Habit.days` carries, which `isDoneOn` then reads. That is a
    //     full group-by over `habit_logs`, the table with the most rows after
    //     water. The single most expensive loader on this screen.
    {
      name: 'loadHabits',
      ledgerBacked: true,
      run: () => {
        const daysByHabit = new Map<string, string[]>();
        for (const log of ledger.habitLogs) {
          const habitId = String(log.habit_id);
          const list = daysByHabit.get(habitId);
          if (list) list.push(String(log.date));
          else daysByHabit.set(habitId, [String(log.date)]);
        }
        const habits = ledger.userHabits
          .filter((h) => !h.is_archived)
          .sort((a, b) => num(a.sort_order) - num(b.sort_order))
          .slice(0, HOME_WINDOWS.habits)
          .map((h) => ({
            id: h.id,
            name: h.name,
            icon: h.icon,
            sortOrder: num(h.sort_order),
            days: daysByHabit.get(String(h.id)) ?? [],
          }));
        let done = 0;
        for (const habit of habits) if (habit.days.includes(today)) done += 1;
        return { name: 'loadHabits', size: habits.length * 1000 + done };
      },
    },

    // 12. loadBodyEntries — flatMap over the populated sites, sorted desc.
    {
      name: 'loadBodyEntries',
      ledgerBacked: true,
      run: () => {
        const entries: Array<{ date: string; metric: string; value: number }> = [];
        for (const row of ledger.bodyMeasurements) {
          const date = String(row.date);
          for (const [key, value] of Object.entries(row)) {
            if (typeof value !== 'number' || key === 'sort_order') continue;
            entries.push({ date, metric: key, value });
          }
        }
        entries.sort((a, b) => b.date.localeCompare(a.date) || a.metric.localeCompare(b.metric));
        return { name: 'loadBodyEntries', size: entries.slice(0, HOME_WINDOWS.bodyEntries).length };
      },
    },

    // 13. loadSleepLog — same table again, entry_type = 'sleep'.
    {
      name: 'loadSleepLog',
      ledgerBacked: true,
      run: () => {
        const rows = ledger.healthEntries.filter((e) => e.entry_type === 'sleep');
        rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const kept = rows.slice(0, HOME_WINDOWS.sleepNights);
        let minutes = 0;
        for (const row of kept) {
          const data = JSON.parse(String(row.data)) as { minutes?: number };
          minutes += data.minutes ?? 0;
        }
        return { name: 'loadSleepLog', size: minutes };
      },
    },

    // 14. loadHomeLayout — MMKV widget order.
    mmkv('loadHomeLayout', MMKV_BLOBS.layout),

    // 15. loadWeeklyTrend — this week against last: calories and weight, both
    //     derived. Server-computed today (`/health/summary/weekly-trend`);
    //     He7-lite moves it on-device, which is what is measured.
    {
      name: 'loadWeeklyTrend',
      ledgerBacked: true,
      run: () => {
        const from = shiftDateKey(today, -HOME_WINDOWS.trendDays);
        const calByDay = new Map<string, number>();
        for (const row of ledger.nutritionEntries) {
          const date = String(row.date);
          if (date < from) continue;
          calByDay.set(date, (calByDay.get(date) ?? 0) + num(row.calories));
        }
        const weightByDay = new Map<string, number[]>();
        for (const row of ledger.weightEntries) {
          const date = String(row.date);
          if (date < from) continue;
          const list = weightByDay.get(date);
          if (list) list.push(num(row.weight));
          else weightByDay.set(date, [num(row.weight)]);
        }
        let points = 0;
        for (const [, values] of weightByDay) if (values.length > 0) points += 1;
        return { name: 'loadWeeklyTrend', size: calByDay.size + points };
      },
    },

    // 16. loadChallengesWeeklyOverview — every active challenge's 7-day
    //     progress. Tier D, derived from `nutrition_entries` (plan §1.5a).
    {
      name: 'loadChallengesWeeklyOverview',
      ledgerBacked: true,
      run: () => {
        const from = shiftDateKey(today, -HOME_WINDOWS.weekDays);
        const window = ledger.nutritionEntries.filter((row) => String(row.date) >= from);
        // Three active challenges is the donor's typical case: a calorie cap, a
        // protein floor and a "log every meal" streak.
        const challenges = ['calorie_cap', 'protein_floor', 'log_every_meal'];
        const overview = challenges.map((slug) => {
          const byDay = new Map<string, number>();
          for (const row of window) {
            const date = String(row.date);
            const value =
              slug === 'protein_floor'
                ? num(row.proteins)
                : slug === 'calorie_cap'
                  ? num(row.calories)
                  : 1;
            byDay.set(date, (byDay.get(date) ?? 0) + value);
          }
          return { slug, dailyProgress: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
        });
        return { name: 'loadChallengesWeeklyOverview', size: overview.length };
      },
    },

    // 17. loadChallengesWidgetExpanded — MMKV boolean.
    mmkv('loadChallengesWidgetExpanded', MMKV_BLOBS.challengesExpanded),
  ];
}

/**
 * The fan-out exactly as the screen runs it: seventeen promises, one
 * `Promise.all`, resolved before Home can paint.
 */
export async function runHomeHydrate(loaders: readonly Loader[]): Promise<number> {
  const results = await Promise.all(loaders.map(async (loader) => loader.run()));
  let checksum = 0;
  for (const result of results) checksum += result.size;
  return checksum;
}
