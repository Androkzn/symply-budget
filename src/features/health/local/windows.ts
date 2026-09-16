/**
 * The read-window registry — Stage He3b Exit (plan §7).
 *
 * The normative sentence, quoted, because this whole file exists to satisfy it:
 *
 * > *"Storage signatures stay" must not silently convert a bounded server read
 * > into an unbounded ledger scan. `healthNutritionStorage.ts:226-245` requests
 * > a 120-day window server-side; a naive local `listNutrition()` returns the
 * > whole table, and `HealthHomeScreen.tsx:198-219` calls it plus 16 other
 * > loaders on every focus (~11–22k rows at the 10-year corpus). Record every
 * > window in `src/features/health/local/windows.ts` — one constant per loader —
 * > with a unit test asserting the local method returns no more rows than the
 * > window. **A local method that returns the full table where the remote
 * > returned a window is a He3 blocker, not a perf nit.***
 *
 * ## Why this is a correctness file, not a performance file
 *
 * Home is a 17-way `Promise.all` re-run by `useFocusEffect` on every focus
 * (`HealthHomeScreen.tsx:198-219`). There is no React Query and no Zustand store
 * for Health domain data (plan §7 refresh contract), so nothing between the
 * screen and the data deduplicates or caps that. Drop the windows and every tab
 * switch decodes the whole ledger on the JS thread.
 *
 * ## The window is min(client, server) — and both halves had to be read
 *
 * A window is only what the device actually received, which is the *smaller* of
 * what the client asked for and what the route was willing to give. Reading only
 * the client half gets three of these wrong:
 *
 *  - `loadBodyEntries` sends **no parameters at all**
 *    (`healthBodyStorage.ts:432`) and looks unbounded. It is not: the service
 *    signature is `listMeasurements(userId, limit = 1000)`
 *    (`health-service.ts:1071`), so the device has never seen more than 1000
 *    rows. The client's own `.slice(0, 4000)` is a cap on derived *site
 *    readings*, not rows — one taped session is one row and up to 41 readings
 *    (`healthBodyStorage.ts:263-269`).
 *  - `loadHabits` is the mirror image: the route is genuinely unbounded on both
 *    `user_habits` and `habit_logs` (`health-service.ts:1508-1526`), and the
 *    only window is the client's own `.slice(0, 40)` habits and 400 days per
 *    habit. Port the cap or a ten-year habit ledger arrives whole.
 *  - The He11 HealthKit drain calls `listWeight({ from, to })` with no `limit`
 *    (`healthKit.ts:1085`), and the route silently applies `limit ?? 200`
 *    (`health-service.ts:211`). The drain has never seen more than 200 weight
 *    rows per pass regardless of the range it asked for.
 *
 * ## `entry_type` is inside the window, not outside it
 *
 * Three loaders — workouts, steps, sleep — read the SAME ledger table
 * (`healthEntries`) through `GET /health/entries`, and the route applies
 * `entry_type` **before** the 400-row limit (`health-service.ts:1172-1182`). A
 * local facade that takes the newest 400 rows and then filters by type hands
 * Home zero workouts for any user who logs steps daily. `rowFilter` carries that
 * ordering constraint into the data, and `applyHealthReadWindow` honours it.
 *
 * ## What this file is not
 *
 * It is not a list of ledger tables (that is `schema.ts`) and not a bucketing
 * policy (that is `HEALTH_WINDOWED_DATE_FIELDS`, which this file reads). It is
 * the record of what each *caller* saw, so a local implementation can be held to
 * it. Where a remote read genuinely had no window, that is stated as a decision
 * with a reason rather than left out — an omission reads as an oversight, and
 * the next engineer cannot tell the two apart.
 */
import { localDateKey } from './ids';
import { HEALTH_WINDOWED_DATE_FIELDS, type HealthLedgerTableName } from './schema';
import type { HealthLedgerRowBase } from './types';

/* ------------------------------------------------------------------ */
/* Descriptor types                                                    */
/* ------------------------------------------------------------------ */

/**
 * The shape of one window.
 *
 * `maxRows` is optional on the dated kinds because several remote reads bound
 * the *range* and nothing else — `listWater` and `listNutrition` carry no
 * `limit` at all (`health-service.ts:422-431`, `:518-528`).
 */
export type HealthReadWindow =
  /** The last N days, inclusive of today. */
  | { readonly kind: 'days'; readonly days: number; readonly maxRows?: number }
  /** The newest N rows by date, which is how every `limit` route orders. */
  | { readonly kind: 'rows'; readonly maxRows: number }
  /** Exactly one calendar day. */
  | { readonly kind: 'singleDay'; readonly maxRows?: number }
  /** The caller supplies `from`/`to` per call — the He11 drain's own window. */
  | { readonly kind: 'callerRange'; readonly maxRows?: number; readonly reason: string }
  /** No window existed remotely. State why, so it reads as a decision. */
  | { readonly kind: 'unbounded'; readonly reason: string };

/** One ledger table a loader reads, and the window it is allowed to read it through. */
export type HealthLedgerRead = {
  readonly table: HealthLedgerTableName;
  readonly window: HealthReadWindow;
  /**
   * A row filter the remote applied INSIDE the window — today, only
   * `entry_type` on `healthEntries`. Applying it after the window is a bug; see
   * the header.
   */
  readonly rowFilter?: { readonly field: string; readonly equals: string };
  /** Where the client half of the window was read from, `path:line`. */
  readonly client: string;
  /** Where the server half was read from, `path:line`. */
  readonly server: string;
};

export type HealthLoaderWindow = {
  /** The exported loader name, exactly as screens import it. */
  readonly loader: string;
  /** The module that exports it, repo-relative. */
  readonly module: string;
  /** Called by `HealthHomeScreen.tsx:198-219`, i.e. on every Home focus. */
  readonly onHome: boolean;
  /** Empty when the loader reads no ledger table at all. `note` says why. */
  readonly reads: readonly HealthLedgerRead[];
  /** Other registered loaders this one is built from, if any. */
  readonly composite?: readonly string[];
  /** Required. One line an engineer can act on. */
  readonly note: string;
};

/* ------------------------------------------------------------------ */
/* Home — the 17 loaders of `HealthHomeScreen.tsx:198-219`             */
/* ------------------------------------------------------------------ */

/** `getGoal()` — the one goal row in force on a date. Reused by six loaders. */
const ACTIVE_GOAL_READ: HealthLedgerRead = {
  table: 'healthGoals',
  // Not "all goals": `goalFor` returns the NEWEST row with
  // `effective_date <= date`, one row, and it does NOT filter `deleted_at`
  // (unlike every other list query on this service). A local implementation
  // that returns the newest goal outright is wrong on any day the user is
  // viewing in the past, which the calorie-week editor does routinely.
  window: { kind: 'rows', maxRows: 1 },
  client: 'src/features/health/healthLocalStorage.ts:472-474',
  server: 'backend/src/services/health-service.ts:1393-1403',
};

/** Weight log — the app's flagship metric, and the widest row window on Home. */
export const HEALTH_WINDOW_LOAD_WEIGHT_LOG: HealthLoaderWindow = {
  loader: 'loadWeightLog',
  module: 'src/features/health/healthLocalStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'weightEntries',
      // Client asks for 500 (`MAX_WEIGHT_ENTRIES`, :129); the route's default is
      // 200 but an explicit limit overrides it, so 500 is what arrives.
      window: { kind: 'rows', maxRows: 500 },
      client: 'src/features/health/healthLocalStorage.ts:282-286',
      server: 'backend/src/services/health-service.ts:202-212',
    },
  ],
  note: 'Newest 500 by `date` desc. Two weigh-ins in one day are supported product behaviour (plan §1.5a), so this is 500 ROWS, never 500 days.',
};

/** Unit system — a single field off the goal row. */
export const HEALTH_WINDOW_LOAD_HEALTH_PREFS: HealthLoaderWindow = {
  loader: 'loadHealthPrefs',
  module: 'src/features/health/healthLocalStorage.ts',
  onHome: true,
  reads: [ACTIVE_GOAL_READ],
  note: 'Reads `unit_system` off the active goal row. `healthGoals` is always-resident by design (schema.ts) — it must load without a month probe.',
};

/** Today's water ring. */
export const HEALTH_WINDOW_LOAD_WATER_TODAY: HealthLoaderWindow = {
  loader: 'loadWaterToday',
  module: 'src/features/health/healthLocalStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'waterEntries',
      window: { kind: 'singleDay' },
      client: 'src/features/health/healthLocalStorage.ts:587-600',
      server: 'backend/src/routes/health.ts — GET /water/summary/:date',
    },
    ACTIVE_GOAL_READ,
  ],
  note: 'One day, summed. The remote returns a total plus the effective-dated goal, which is why the ring can never disagree with the log — keep both halves local or it will.',
};

/** Water history for Trends. */
export const HEALTH_WINDOW_LOAD_WATER_HISTORY: HealthLoaderWindow = {
  loader: 'loadWaterHistory',
  module: 'src/features/health/healthLocalStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'waterEntries',
      // `listWater` has NO server limit — the from/to range IS the window.
      // 400 days, then 400 day-buckets after grouping (:648).
      window: { kind: 'days', days: 400 },
      client: 'src/features/health/healthLocalStorage.ts:629-649',
      server: 'backend/src/services/health-service.ts:422-431',
    },
    ACTIVE_GOAL_READ,
  ],
  note: '400 days of ROWS collapsed into at most 400 day buckets. The row window must be applied before grouping; grouping first is what makes this an unbounded scan.',
};

/** The daily note — MMKV, and staying there. */
export const HEALTH_WINDOW_LOAD_NOTE_FOR_DATE: HealthLoaderWindow = {
  loader: 'loadNoteForDate',
  module: 'src/features/health/healthLocalStorage.ts',
  onHome: true,
  reads: [],
  note: 'No ledger read and no server read, ever. Notes live in MMKV under `health.notes.v1` (:757) and are NOT a ninth ledger key — plan §1.5, and He1 `registryGuard` fails if they become one.',
};

/** Meals — the plan's named example, and the widest dated window on Home. */
export const HEALTH_WINDOW_LOAD_MEALS: HealthLoaderWindow = {
  loader: 'loadMeals',
  module: 'src/features/health/healthNutritionStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'nutritionEntries',
      // `listNutrition` carries no server limit; the 120-day from/to is the
      // entire window. `from` is computed as `now - 120 * 86_400_000` (:229),
      // which is the arithmetic `applyHealthReadWindow` reproduces exactly.
      window: { kind: 'days', days: 120 },
      client: 'src/features/health/healthNutritionStorage.ts:226-232',
      server: 'backend/src/services/health-service.ts:518-528',
    },
  ],
  note: 'THE case the plan names. Home deliberately loads the whole 120-day window rather than one day, because every drill-down and `loadMealsForDate` filter this same cached array (:227, :241-244) — so a local `listNutrition()` that ignores the window multiplies by the biggest table in the app.',
};

/** Calorie + macro targets. */
export const HEALTH_WINDOW_LOAD_NUTRITION_GOALS: HealthLoaderWindow = {
  loader: 'loadNutritionGoals',
  module: 'src/features/health/healthNutritionStorage.ts',
  onHome: true,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only. Client fetcher at `healthNutritionStorage.ts:888-897`.',
};

/** Workouts — `healthEntries` filtered to `entry_type = 'workout'`. */
export const HEALTH_WINDOW_LOAD_WORKOUTS: HealthLoaderWindow = {
  loader: 'loadWorkouts',
  module: 'src/features/health/healthActivityStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'healthEntries',
      window: { kind: 'rows', maxRows: 400 },
      rowFilter: { field: 'entry_type', equals: 'workout' },
      client: 'src/features/health/healthActivityStorage.ts:411-417',
      server: 'backend/src/services/health-service.ts:1168-1183',
    },
  ],
  note: 'Filter by `entry_type` FIRST, then take the newest 400. Reversing that order returns zero workouts for anyone who logs steps daily — see the header.',
};

/** Step days — the same table, a different type. */
export const HEALTH_WINDOW_LOAD_STEP_DAYS: HealthLoaderWindow = {
  loader: 'loadStepDays',
  module: 'src/features/health/healthActivityStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'healthEntries',
      window: { kind: 'rows', maxRows: 400 },
      rowFilter: { field: 'entry_type', equals: 'steps' },
      client: 'src/features/health/healthActivityStorage.ts:658-671',
      server: 'backend/src/services/health-service.ts:1168-1183',
    },
  ],
  note: 'Newest 400 step rows, re-capped at 400 after the client merge (:689). `/entries/steps` is the one upserting write path, so this is effectively 400 DAYS.',
};

/** Step + workout-minute targets. */
export const HEALTH_WINDOW_LOAD_ACTIVITY_GOALS: HealthLoaderWindow = {
  loader: 'loadActivityGoals',
  module: 'src/features/health/healthActivityStorage.ts',
  onHome: true,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only. Client fetcher at `healthActivityStorage.ts:711-718`.',
};

/** Habits — two tables, and the only place the CLIENT is the whole window. */
export const HEALTH_WINDOW_LOAD_HABITS: HealthLoaderWindow = {
  loader: 'loadHabits',
  module: 'src/features/health/healthHabitsStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'userHabits',
      // Server: unbounded. Client: `.slice(0, MAX_HABITS)` = 40.
      window: { kind: 'rows', maxRows: 40 },
      client: 'src/features/health/healthHabitsStorage.ts:432, applied :719',
      server: 'backend/src/services/health-service.ts:1508-1520 (no limit)',
    },
    {
      table: 'habitLogs',
      // Server: unbounded — it selects EVERY habit log for the user
      // (`health-service.ts:1521-1525`) and derives streaks in memory. The only
      // window is the client's per-habit day cap.
      window: { kind: 'days', days: 400 },
      client: 'src/features/health/healthHabitsStorage.ts:433, applied :663',
      server: 'backend/src/services/health-service.ts:1521-1525 (no limit)',
    },
  ],
  note: 'The mirror image of `loadBodyEntries`: the ROUTE is unbounded on both tables, so the client cap is the whole window. 400 days is PER HABIT, and streaks are derived from the days — recompute them locally, never store a counter.',
};

/** Body measurements — 40+ optional columns per row, up to 41 readings each. */
export const HEALTH_WINDOW_LOAD_BODY_ENTRIES: HealthLoaderWindow = {
  loader: 'loadBodyEntries',
  module: 'src/features/health/healthBodyStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'bodyMeasurements',
      // The client sends NO parameters; the window is the service default.
      window: { kind: 'rows', maxRows: 1000 },
      client: 'src/features/health/healthBodyStorage.ts:431-437 (no params sent)',
      server: 'backend/src/services/health-service.ts:1071-1079 (limit = 1000)',
    },
  ],
  note: "Looks unbounded at the call site and is not — the service signature carries `limit = 1000`. The client's own `.slice(0, 4000)` (:270) counts derived SITE READINGS, not rows: one taped session is one row and up to 41 readings (:263-269). Cap rows at 1000, then flatten.",
};

/** Sleep — `healthEntries` again, a third type. */
export const HEALTH_WINDOW_LOAD_SLEEP_LOG: HealthLoaderWindow = {
  loader: 'loadSleepLog',
  module: 'src/features/health/healthSleepStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'healthEntries',
      window: { kind: 'rows', maxRows: 400 },
      rowFilter: { field: 'entry_type', equals: 'sleep' },
      client: 'src/features/health/healthSleepStorage.ts:191-204',
      server: 'backend/src/services/health-service.ts:1168-1183',
    },
    ACTIVE_GOAL_READ,
  ],
  note: 'Newest 400 sleep rows, then deduped to one night per date and re-capped at 400 (:186-189). The dedupe prefers a manual row over a HealthKit one, so it must run on the windowed set, not after truncation.',
};

/** Home widget order — device-local layout. */
export const HEALTH_WINDOW_LOAD_HOME_LAYOUT: HealthLoaderWindow = {
  loader: 'loadHomeLayout',
  module: 'src/features/health/healthHomeStorage.ts',
  onHome: true,
  reads: [],
  note: 'No ledger read and no server read. MMKV `health.homeLayout.v1` (:27). Plan §1.5 lists layouts under "not ledgered" — leave it alone.',
};

/** Weekly trend — server-computed today, He3c's job tomorrow. */
export const HEALTH_WINDOW_LOAD_WEEKLY_TREND: HealthLoaderWindow = {
  loader: 'loadWeeklyTrend',
  module: 'src/features/health/healthWeeklyTrendStorage.ts',
  onHome: true,
  reads: [
    {
      table: 'weightEntries',
      window: { kind: 'days', days: 14 },
      client: 'src/features/health/healthWeeklyTrendStorage.ts:25-28',
      server: 'backend/src/routes/health.ts:1123-1140 (GET /summary/weekly-trend)',
    },
    {
      table: 'nutritionEntries',
      window: { kind: 'days', days: 14 },
      client: 'src/features/health/healthWeeklyTrendStorage.ts:25-28',
      server: 'backend/src/routes/health.ts:1123-1140 (GET /summary/weekly-trend)',
    },
  ],
  note: 'PRESCRIPTIVE, not as-built: the remote is a computed summary with no row window of its own, and He3c recomputes it on device (Tier D). Two calendar weeks — this week and last — is 14 days; the differential test against the server fixtures is what pins the arithmetic. This method must NOT throw `HealthLocalUnsupportedError` (plan §7 Hard Exit).',
};

/** Food challenges — Tier D, disposition open. */
export const HEALTH_WINDOW_LOAD_CHALLENGES_WEEKLY_OVERVIEW: HealthLoaderWindow = {
  loader: 'loadChallengesWeeklyOverview',
  module: 'src/features/health/healthChallengesStorage.ts',
  onHome: true,
  reads: [],
  note: '⚠️ UNRESOLVED — He3a must decide (plan §1.5). `food_challenges` / `food_challenge_progress` are Tier D and not ledgered, and `/health/challenges*` stays off the 410 list, so this keeps reading D1. But progress is computed from `nutrition_entries`, which He12(full) truncates — so it goes permanently stale against an emptied source. Either recompute over local `nutritionEntries` (7-day window, then this entry gains a read) or dark the loader with the copy already seeded in `unsupportedCopy.ts`.',
};

/** Challenge widget expand state — MMKV boolean. */
export const HEALTH_WINDOW_LOAD_CHALLENGES_WIDGET_EXPANDED: HealthLoaderWindow = {
  loader: 'loadChallengesWidgetExpanded',
  module: 'src/features/health/healthChallengesStorage.ts',
  onHome: true,
  reads: [],
  note: 'No ledger read and no server read. MMKV boolean `health.foodChallengesWidget.expanded.v1` (:272). Unaffected by the challenge disposition above.',
};

/* ------------------------------------------------------------------ */
/* Off-Home Wave A readers                                             */
/* ------------------------------------------------------------------ */

/** One day of meals, filtered out of the 120-day cache. */
export const HEALTH_WINDOW_LOAD_MEALS_FOR_DATE: HealthLoaderWindow = {
  loader: 'loadMealsForDate',
  module: 'src/features/health/healthNutritionStorage.ts',
  onHome: false,
  reads: [
    {
      table: 'nutritionEntries',
      window: { kind: 'singleDay' },
      client: 'src/features/health/healthNutritionStorage.ts:241-244',
      server: 'backend/src/services/health-service.ts:518-528',
    },
  ],
  composite: ['loadMeals'],
  note: 'A filter over `loadMeals`, not a second read — which is why Home loads the whole window (:227). A local implementation may narrow to one day directly; it must not widen past the 120-day parent.',
};

/** One day of water, with its individual log rows. */
export const HEALTH_WINDOW_LOAD_WATER_DAY: HealthLoaderWindow = {
  loader: 'loadWaterDay',
  module: 'src/features/health/healthWaterStorage.ts',
  onHome: false,
  reads: [
    {
      table: 'waterEntries',
      // `listWater({ from: date, to: date })`, then `.slice(0, 60)` (:94, :343).
      window: { kind: 'singleDay', maxRows: 60 },
      client: 'src/features/health/healthWaterStorage.ts:331-350',
      server: 'backend/src/services/health-service.ts:422-431',
    },
    ACTIVE_GOAL_READ,
  ],
  note: 'Two remote calls on purpose (:332-334): the summary carries the server total AND the effective-dated goal, so the ring cannot drift from the log. Keep the same split locally — total from the rows, goal from `healthGoals`.',
};

export const HEALTH_WINDOW_LOAD_STEPS_FOR_DATE: HealthLoaderWindow = {
  loader: 'loadStepsForDate',
  module: 'src/features/health/healthActivityStorage.ts',
  onHome: false,
  reads: [
    {
      table: 'healthEntries',
      window: { kind: 'singleDay' },
      rowFilter: { field: 'entry_type', equals: 'steps' },
      client: 'src/features/health/healthActivityStorage.ts:680-683',
      server: 'backend/src/services/health-service.ts:1168-1183',
    },
  ],
  composite: ['loadStepDays'],
  note: 'A filter over `loadStepDays`. Same `entry_type`-before-window rule.',
};

export const HEALTH_WINDOW_LOAD_HABIT: HealthLoaderWindow = {
  loader: 'loadHabit',
  module: 'src/features/health/healthHabitsStorage.ts',
  onHome: false,
  reads: [
    {
      table: 'userHabits',
      window: { kind: 'rows', maxRows: 1 },
      client: 'src/features/health/healthHabitsStorage.ts:729-732',
      server: 'backend/src/services/health-service.ts:1508-1520 (no limit)',
    },
    {
      table: 'habitLogs',
      window: { kind: 'days', days: 400 },
      client: 'src/features/health/healthHabitsStorage.ts:433, applied :663',
      server: 'backend/src/services/health-service.ts:1521-1525 (no limit)',
    },
  ],
  composite: ['loadHabits'],
  note: 'One habit by id out of `loadHabits`. Its day window is the same 400 — a per-habit lookup is not a licence to read the whole log table.',
};

export const HEALTH_WINDOW_LOAD_WEIGHT_GOAL: HealthLoaderWindow = {
  loader: 'loadWeightGoal',
  module: 'src/features/health/healthWeightStorage.ts',
  onHome: false,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only (`healthWeightStorage.ts:174-184`). Note the fetcher deliberately keeps the cached value when the server answers `null`, so an older Worker cannot erase a goal — a local implementation has no such ambiguity and should not reproduce the fallback.',
};

export const HEALTH_WINDOW_LOAD_WATER_PREFS: HealthLoaderWindow = {
  loader: 'loadWaterPrefs',
  module: 'src/features/health/healthWaterStorage.ts',
  onHome: false,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only (`healthWaterStorage.ts:258-262`) — reads `water_unit`.',
};

export const HEALTH_WINDOW_LOAD_CALORIE_WEEK: HealthLoaderWindow = {
  loader: 'loadCalorieWeek',
  module: 'src/features/health/healthGoalsStorage.ts',
  onHome: false,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only (`healthGoalsStorage.ts:128-135`). The seven weekday columns live ON that row — this is one row, not seven.',
};

export const HEALTH_WINDOW_LOAD_MACRO_WEEK: HealthLoaderWindow = {
  loader: 'loadMacroWeek',
  module: 'src/features/health/healthGoalsStorage.ts',
  onHome: false,
  reads: [ACTIVE_GOAL_READ],
  note: 'Active goal row only (`healthGoalsStorage.ts:446-460`). Twenty-one macro columns on one row.',
};

export const HEALTH_WINDOW_LOAD_HEALTH_GOALS: HealthLoaderWindow = {
  loader: 'loadHealthGoals',
  module: 'src/features/health/healthGoalsStorage.ts',
  onHome: false,
  reads: [],
  composite: [
    'loadNutritionGoals',
    'loadActivityGoals',
    'loadWaterToday',
    'loadCalorieWeek',
    'loadMacroWeek',
    'loadWeightGoal',
    'loadHealthPrefs',
    'loadWeightLog',
  ],
  note: 'An 8-way `Promise.all` over already-registered loaders (`healthGoalsStorage.ts:780-790`) — it introduces no window of its own. Six of the eight resolve to the same single goal row; a local implementation should read it once.',
};

/* ------------------------------------------------------------------ */
/* He11 HealthKit drain (Wave B) — caller-supplied ranges              */
/* ------------------------------------------------------------------ */

export const HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING: HealthLoaderWindow = {
  loader: 'healthKitImportSink.listExisting',
  module: 'src/features/health/healthKit.ts',
  onHome: false,
  reads: [
    {
      table: 'healthEntries',
      // No `limit` is sent, so the route's own default applies.
      window: {
        kind: 'callerRange',
        maxRows: 400,
        reason: 'the drain passes its own from/to; the route then caps at `limit ?? 400`',
      },
      client: 'src/features/health/healthKit.ts:1073-1076',
      server: 'backend/src/services/health-service.ts:1168-1183',
    },
  ],
  note: 'The dedupe read the importer plans against, so an under-read is a DUPLICATE row, not a missing one. It sends no `limit` and silently inherits 400.',
};

export const HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING_WEIGHT: HealthLoaderWindow = {
  loader: 'healthKitImportSink.listExistingWeight',
  module: 'src/features/health/healthKit.ts',
  onHome: false,
  reads: [
    {
      table: 'weightEntries',
      window: {
        kind: 'callerRange',
        maxRows: 200,
        reason: 'no `limit` is sent, so `listWeight` falls back to its default of 200',
      },
      client: 'src/features/health/healthKit.ts:1084-1087',
      server: 'backend/src/services/health-service.ts:202-212',
    },
  ],
  note: '⚠️ 200, not 500: unlike `loadWeightLog` this call sends no `limit`, so the route default applies. A drain over a range holding more than 200 weight rows has always re-imported the overflow — matching the remote here means matching that, and improving on it means fixing a real bug, deliberately.',
};

export const HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING_NUTRITION: HealthLoaderWindow = {
  loader: 'healthKitImportSink.listExistingNutrition',
  module: 'src/features/health/healthKit.ts',
  onHome: false,
  reads: [
    {
      table: 'nutritionEntries',
      window: {
        kind: 'callerRange',
        reason:
          '`listNutrition` carries no limit — the caller-supplied from/to is the whole window',
      },
      client: 'src/features/health/healthKit.ts:1101-1104',
      server: 'backend/src/services/health-service.ts:518-528',
    },
  ],
  note: "The only genuinely range-only read in the registry. Honour the caller's from/to exactly; there is no row cap to fall back on.",
};

/* ------------------------------------------------------------------ */
/* The machine-readable map                                            */
/* ------------------------------------------------------------------ */

/**
 * Loader name → window, for `windows.test.ts` to iterate.
 *
 * The point of the map is that the test needs **no hand-maintained list**: a
 * loader added here is a loader the test covers, and a loader ported without an
 * entry is a loader the parity test can flag. Keep the key identical to the
 * exported function name so the two can be cross-checked mechanically.
 */
export const HEALTH_READ_WINDOWS = {
  // Home, in `HealthHomeScreen.tsx:198-219` order.
  loadWeightLog: HEALTH_WINDOW_LOAD_WEIGHT_LOG,
  loadHealthPrefs: HEALTH_WINDOW_LOAD_HEALTH_PREFS,
  loadWaterToday: HEALTH_WINDOW_LOAD_WATER_TODAY,
  loadWaterHistory: HEALTH_WINDOW_LOAD_WATER_HISTORY,
  loadNoteForDate: HEALTH_WINDOW_LOAD_NOTE_FOR_DATE,
  loadMeals: HEALTH_WINDOW_LOAD_MEALS,
  loadNutritionGoals: HEALTH_WINDOW_LOAD_NUTRITION_GOALS,
  loadWorkouts: HEALTH_WINDOW_LOAD_WORKOUTS,
  loadStepDays: HEALTH_WINDOW_LOAD_STEP_DAYS,
  loadActivityGoals: HEALTH_WINDOW_LOAD_ACTIVITY_GOALS,
  loadHabits: HEALTH_WINDOW_LOAD_HABITS,
  loadBodyEntries: HEALTH_WINDOW_LOAD_BODY_ENTRIES,
  loadSleepLog: HEALTH_WINDOW_LOAD_SLEEP_LOG,
  loadHomeLayout: HEALTH_WINDOW_LOAD_HOME_LAYOUT,
  loadWeeklyTrend: HEALTH_WINDOW_LOAD_WEEKLY_TREND,
  loadChallengesWeeklyOverview: HEALTH_WINDOW_LOAD_CHALLENGES_WEEKLY_OVERVIEW,
  loadChallengesWidgetExpanded: HEALTH_WINDOW_LOAD_CHALLENGES_WIDGET_EXPANDED,
  // Off Home.
  loadMealsForDate: HEALTH_WINDOW_LOAD_MEALS_FOR_DATE,
  loadWaterDay: HEALTH_WINDOW_LOAD_WATER_DAY,
  loadStepsForDate: HEALTH_WINDOW_LOAD_STEPS_FOR_DATE,
  loadHabit: HEALTH_WINDOW_LOAD_HABIT,
  loadWeightGoal: HEALTH_WINDOW_LOAD_WEIGHT_GOAL,
  loadWaterPrefs: HEALTH_WINDOW_LOAD_WATER_PREFS,
  loadCalorieWeek: HEALTH_WINDOW_LOAD_CALORIE_WEEK,
  loadMacroWeek: HEALTH_WINDOW_LOAD_MACRO_WEEK,
  loadHealthGoals: HEALTH_WINDOW_LOAD_HEALTH_GOALS,
  // He11 Wave B.
  'healthKitImportSink.listExisting': HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING,
  'healthKitImportSink.listExistingWeight': HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING_WEIGHT,
  'healthKitImportSink.listExistingNutrition': HEALTH_WINDOW_HEALTHKIT_LIST_EXISTING_NUTRITION,
} as const satisfies Record<string, HealthLoaderWindow>;

export type HealthLoaderName = keyof typeof HEALTH_READ_WINDOWS;

export const HEALTH_LOADER_NAMES = Object.keys(HEALTH_READ_WINDOWS) as HealthLoaderName[];

/**
 * The Home loaders, derived rather than listed.
 *
 * `HEALTH_HOME_LOADER_COUNT` is asserted against this in `windows.test.ts`: the
 * plan cites seventeen in three separate places, and a loader added to Home
 * without a window is exactly the regression this file exists to catch.
 */
export const HEALTH_HOME_LOADERS: readonly HealthLoaderName[] = HEALTH_LOADER_NAMES.filter(
  (name) => HEALTH_READ_WINDOWS[name].onHome,
);

/** `HealthHomeScreen.tsx:198-219`. */
export const HEALTH_HOME_LOADER_COUNT = 17;

/* ------------------------------------------------------------------ */
/* Applying a window                                                   */
/* ------------------------------------------------------------------ */

/**
 * Ordering fallback for tables `HEALTH_WINDOWED_DATE_FIELDS` deliberately omits.
 *
 * `userHabits` and `healthGoals` are always-resident by design (see `schema.ts`
 * — "do not relitigate"), so they have no bucketing fields. A row-count window
 * on them still needs a stable order, and every ledger row carries `created_at`
 * (`HealthLedgerRowBase`). This affects ORDERING ONLY; the bucketing registry is
 * untouched.
 */
const HEALTH_FALLBACK_ORDER_FIELDS: readonly string[] = ['effective_date', 'created_at'];

function dateFieldsFor(table: HealthLedgerTableName): readonly string[] {
  return HEALTH_WINDOWED_DATE_FIELDS[table] ?? HEALTH_FALLBACK_ORDER_FIELDS;
}

/**
 * The first parseable date value on a row, as a `YYYY-MM-DD` key.
 *
 * Slicing to ten characters makes a `date` column (`YYYY-MM-DD`, local) and a
 * `created_at` timestamp (ISO, UTC) comparable at day granularity. That is the
 * same approximation the projection's bucketing makes on the same fields, and it
 * can put a `created_at`-only row on either side of a boundary by up to one day.
 * Windows are deliberately generous rather than exact — the remote computed its
 * own `from` the same rough way (`healthNutritionStorage.ts:229`).
 *
 * `null` means no usable date. Such a row is never dropped by a dated window,
 * mirroring the projection rule that an unparseable row degrades to
 * always-resident and never to invisible.
 */
function dayKeyOf(row: HealthLedgerRowBase, fields: readonly string[]): string | null {
  const record = row as unknown as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length >= 10) return value.slice(0, 10);
  }
  return null;
}

/** Newest first, by each candidate date field in turn, then by id for stability. */
function compareDesc(
  a: HealthLedgerRowBase,
  b: HealthLedgerRowBase,
  fields: readonly string[],
): number {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  for (const field of fields) {
    const lv = typeof left[field] === 'string' ? (left[field] as string) : '';
    const rv = typeof right[field] === 'string' ? (right[field] as string) : '';
    if (lv !== rv) return rv.localeCompare(lv);
  }
  return b.id.localeCompare(a.id);
}

export type ApplyWindowOptions = {
  /** `YYYY-MM-DD`. Defaults to today in local time. */
  today?: string;
  /** Inclusive range for a `callerRange` window — the drain's own from/to. */
  from?: string;
  to?: string;
};

/**
 * Apply a registered window to a ledger table read.
 *
 * The one helper every local facade uses instead of returning `ledger().table`.
 * It is keyed off `HEALTH_WINDOWED_DATE_FIELDS` so a table's window and its sync
 * bucketing can never disagree about which column means "when".
 *
 * Three properties worth stating, because a facade that breaks any of them is a
 * He3 blocker rather than a style nit:
 *
 *  - **`rowFilter` runs before the window**, matching the route
 *    (`health-service.ts:1172-1182`). See the header.
 *  - **The input array is never sorted in place.** `rows` is the live ledger
 *    array; sorting it would reorder the source of truth under every other
 *    reader on the same tick.
 *  - **Tombstones are the caller's business.** Pass `rowsOf()` from
 *    `localWrite.ts` (live rows) unless the caller genuinely wants them —
 *    every remote read this replaces filtered `deleted_at` server-side.
 */
export function applyHealthReadWindow<TRow extends HealthLedgerRowBase>(
  read: HealthLedgerRead,
  rows: readonly TRow[],
  options: ApplyWindowOptions = {},
): TRow[] {
  const fields = dateFieldsFor(read.table);

  const filter = read.rowFilter;
  let out: TRow[] = filter
    ? rows.filter(
        (row) => String((row as unknown as Record<string, unknown>)[filter.field]) === filter.equals,
      )
    : rows.slice();

  const window = read.window;
  switch (window.kind) {
    case 'unbounded':
      return out;
    case 'days': {
      // Same arithmetic as `healthNutritionStorage.ts:229`, so the local
      // boundary lands on the same day the remote one did.
      const cutoff = localDateKey(new Date(Date.now() - window.days * 86_400_000));
      out = out.filter((row) => {
        const key = dayKeyOf(row, fields);
        return key === null || key >= cutoff;
      });
      break;
    }
    case 'singleDay': {
      const day = options.today ?? localDateKey();
      out = out.filter((row) => dayKeyOf(row, fields) === day);
      break;
    }
    case 'callerRange': {
      const { from, to } = options;
      if (from !== undefined || to !== undefined) {
        out = out.filter((row) => {
          const key = dayKeyOf(row, fields);
          if (key === null) return true;
          if (from !== undefined && key < from) return false;
          if (to !== undefined && key > to) return false;
          return true;
        });
      }
      break;
    }
    case 'rows':
      break;
  }

  // `unbounded` returned above, and every remaining kind carries `maxRows`.
  const maxRows = window.maxRows;
  if (maxRows !== undefined && out.length > maxRows) {
    out.sort((a, b) => compareDesc(a, b, fields));
    out = out.slice(0, maxRows);
  }
  return out;
}

/**
 * The row ceiling a window implies, or `null` when it has none.
 *
 * `windows.test.ts` uses this to assert *"the local method returns no more rows
 * than the window"* without re-deriving each kind: a `days` window seeded with
 * one row per day for longer than the window has a known ceiling, and a `rows`
 * window has one outright.
 */
export function maxRowsForWindow(window: HealthReadWindow): number | null {
  switch (window.kind) {
    case 'rows':
      return window.maxRows;
    case 'days':
    case 'singleDay':
    case 'callerRange':
      return window.maxRows ?? null;
    case 'unbounded':
      return null;
  }
}

/** The day count a window covers, or `null` when it is not day-bounded. */
export function maxDaysForWindow(window: HealthReadWindow): number | null {
  switch (window.kind) {
    case 'days':
      return window.days;
    case 'singleDay':
      return 1;
    case 'rows':
    case 'callerRange':
    case 'unbounded':
      return null;
  }
}
