/**
 * Symply Health — the SCOPED HealthKit data-type contract (parity phase P3 +
 * background delivery).
 *
 * This file is deliberately the narrowest thing in the feature. The donor
 * (`Data/DataSources/External/HealthKitManager.swift`) asked iOS for roughly
 * THIRTY read types — steps, distance, flights, stand hours, exercise minutes,
 * mindful sessions, basal energy, body fat, lean mass, BMI, height, waist,
 * resting HR, HRV, SpO2, respiratory rate, VO2 max, sleep, and nine dietary
 * types — plus a WRITE set. Its docs disagree about how much of that was ever
 * used; the code is what we trusted, and the code reads far more than it needs.
 *
 * A blanket HealthKit request is the single most likely App Review rejection
 * and the single worst privacy outcome for a health app, so the port asks for
 * a SCOPED set and nothing else. Every identifier we hand to iOS lives in
 * `HEALTHKIT_READ_IDENTIFIERS`, which is derived from this table plus the two
 * out-of-band identifiers below (workout has no per-day scalar shape; the four
 * dietary macros share a destination but not a descriptor) — there is no
 * second list to drift, and a type that is not described here cannot be
 * requested, read, or imported.
 *
 * Adding a type is a product + privacy decision, not a code decision: it needs
 * a purpose string a user would accept, an `Info.plist` usage description, and
 * a matching row in the parity matrix. Do not extend this table casually.
 *
 * READ-ONLY. `HEALTHKIT_WRITE_IDENTIFIERS` is empty and stays empty — we never
 * write a sample back into Apple Health.
 */

import type { HealthEntryType } from '@api/health';

/* =========================== The scoped types ============================ */

export type HealthKitDataType =
  | 'steps'
  | 'activeEnergy'
  | 'sleep'
  | 'heartRate'
  | 'bodyMass'
  | 'dietaryEnergy'
  | 'dietaryProtein'
  | 'dietaryCarbs'
  | 'dietaryFat';

/** Canonical order — the order the connect card lists them to the user. */
export const HEALTHKIT_DATA_TYPES: readonly HealthKitDataType[] = [
  'steps',
  'activeEnergy',
  'sleep',
  'heartRate',
  'bodyMass',
  'dietaryEnergy',
  'dietaryProtein',
  'dietaryCarbs',
  'dietaryFat',
] as const;

/**
 * Our own sentinel for `HKWorkoutType` — NOT an Apple constant. Unlike
 * `HKQuantityTypeIdentifier*` / `HKCategoryTypeIdentifier*`, Apple's SDK has no
 * public identifier STRING for the workout type (`HKObjectType.workoutType()`
 * returns a singleton, not something named by a string constant). Workouts are
 * discrete sessions, not a per-day scalar, so they never join `HEALTHKIT_TYPES`
 * — they get their own native query (`queryWorkouts`) and their own mapping —
 * but this string still has to round-trip through `requestAuthorization` /
 * `getAuthorizationStatus` like every other identifier, and `HEALTH-HK-340`
 * still has to pin it against the Swift side.
 */
export const HEALTHKIT_WORKOUT_IDENTIFIER = 'HKWorkoutTypeIdentifier';

/** Units we read in. One per type — no per-call unit negotiation. */
export type HealthKitUnit = 'count' | 'kcal' | 'minutes' | 'bpm' | 'kg' | 'g';

/** How several samples on one calendar day collapse into one daily figure. */
export type HealthKitAggregation = 'sum' | 'average' | 'latest';

/**
 * The `/health/entries` entry types a HealthKit sample can become.
 *
 * `Extract` rather than a hand-written union so this fails to compile if the
 * API's `HealthEntryType` ever drops one of them — the payload shape and the
 * server contract cannot silently diverge.
 */
export type HealthKitEntryType = Extract<
  HealthEntryType,
  'steps' | 'sleep' | 'heart_rate' | 'active_energy'
>;

/**
 * Where a type's daily figure is written once it has been read.
 *
 * `'entries'`   → `POST /health/entries` (steps, energy, sleep, heart rate).
 * `'weight'`    → `POST /health/weight/entries` (body mass only — a different
 *                 table with a different shape, hence a different destination
 *                 rather than a sixth `entry_type`).
 * `'nutrition'` → the four dietary macros are combined into ONE
 *                 `POST /health/nutrition/entries` row per local day (see
 *                 `mapSamplesToNutritionPayloads` in `healthKit.ts`) — not four
 *                 separate rows, since a nutrition diary row is one food/meal
 *                 entry with several macro columns, not a metric-per-row like
 *                 `/health/entries`.
 * `null`        → read for display, never posted. Nothing is `null` today; the
 *                 case is kept so a future display-only type does not need a
 *                 new column in this table.
 */
export type HealthKitImportDestination = 'entries' | 'weight' | 'nutrition';

export interface HealthKitTypeDescriptor {
  readonly type: HealthKitDataType;
  /** Apple's HK identifier — the ONLY string ever handed to the OS. */
  readonly identifier: string;
  /** Shown in the connect card's scope list. */
  readonly label: string;
  /** Why we read it, in words a user can hold us to. */
  readonly purpose: string;
  /** Brand icon-kit key (`brands/symply-health/.../SymplyHealthIcon.tsx`). */
  readonly icon: string;
  readonly unit: HealthKitUnit;
  readonly aggregation: HealthKitAggregation;
  /** Which table a read figure lands in, or `null` for display-only. */
  readonly importsTo: HealthKitImportDestination | null;
  /**
   * The `/health/entries` row this becomes, or `null` when the type does not go
   * to that table. `null` here does NOT mean "not imported" — see `importsTo`.
   */
  readonly entryType: HealthKitEntryType | null;
  /** The key the daily figure is stored under inside the entry's `data` blob. */
  readonly dataKey: string | null;
  /** Set when `importsTo` is null — the honest reason, surfaced in the UI. */
  readonly notImportedReason: string | null;
}

/**
 * The table.
 *
 * `bodyMass` is the odd one out: it is imported, but not to `/health/entries`.
 * `HealthEntryType` has no weight member, so a reading goes to the weight log via
 * `POST /health/weight/entries` with `source: 'healthkit'`.
 *
 * That `source` column is why this is possible at all. Until migration
 * `0122_health_weight_source.sql` landed, `weight_entries` had no origin column, so
 * an imported reading was indistinguishable from one the user typed — which would
 * have made "manual always wins" untestable and let a re-import quietly overwrite a
 * hand-corrected weight. 0122 exists precisely to unblock this, and the de-duplicator
 * in `healthKit.ts` (`planWeightImport`) is what spends it.
 */
export const HEALTHKIT_TYPES: Readonly<Record<HealthKitDataType, HealthKitTypeDescriptor>> = {
  steps: {
    type: 'steps',
    identifier: 'HKQuantityTypeIdentifierStepCount',
    label: 'Steps',
    purpose: 'Fills in your daily step count so you do not have to type it.',
    icon: 'steps',
    unit: 'count',
    aggregation: 'sum',
    importsTo: 'entries',
    entryType: 'steps',
    dataKey: 'steps',
    notImportedReason: null,
  },
  activeEnergy: {
    type: 'activeEnergy',
    identifier: 'HKQuantityTypeIdentifierActiveEnergyBurned',
    label: 'Active energy',
    purpose: 'Shows the calories you burned moving, alongside what you ate.',
    icon: 'energy-active',
    unit: 'kcal',
    aggregation: 'sum',
    importsTo: 'entries',
    entryType: 'active_energy',
    dataKey: 'calories',
    notImportedReason: null,
  },
  sleep: {
    type: 'sleep',
    identifier: 'HKCategoryTypeIdentifierSleepAnalysis',
    label: 'Sleep',
    purpose: 'Totals how long you actually slept each night.',
    icon: 'sleep',
    unit: 'minutes',
    aggregation: 'sum',
    importsTo: 'entries',
    entryType: 'sleep',
    dataKey: 'minutes',
    notImportedReason: null,
  },
  heartRate: {
    type: 'heartRate',
    identifier: 'HKQuantityTypeIdentifierHeartRate',
    label: 'Heart rate',
    purpose: 'Averages your heart rate per day for the Trends tab.',
    icon: 'heart-rate',
    unit: 'bpm',
    aggregation: 'average',
    importsTo: 'entries',
    entryType: 'heart_rate',
    dataKey: 'bpm',
    notImportedReason: null,
  },
  bodyMass: {
    type: 'bodyMass',
    identifier: 'HKQuantityTypeIdentifierBodyMass',
    label: 'Weight',
    purpose:
      "Adds your scale's weight to your weight log. Days you typed yourself are left alone.",
    icon: 'weight',
    unit: 'kg',
    aggregation: 'latest',
    importsTo: 'weight',
    // Not an `/health/entries` row: weight has its own table and its own route.
    entryType: null,
    dataKey: null,
    notImportedReason: null,
  },
  dietaryEnergy: {
    type: 'dietaryEnergy',
    identifier: 'HKQuantityTypeIdentifierDietaryEnergyConsumed',
    label: 'Calories eaten',
    purpose: 'Adds calories logged by a food app (e.g. a nutrition tracker) to your food diary.',
    icon: 'calories',
    unit: 'kcal',
    aggregation: 'sum',
    importsTo: 'nutrition',
    entryType: null,
    dataKey: 'calories',
    notImportedReason: null,
  },
  dietaryProtein: {
    type: 'dietaryProtein',
    identifier: 'HKQuantityTypeIdentifierDietaryProtein',
    label: 'Protein',
    purpose: 'Adds the protein grams behind an imported calorie total.',
    icon: 'macros',
    unit: 'g',
    aggregation: 'sum',
    importsTo: 'nutrition',
    entryType: null,
    dataKey: 'proteins',
    notImportedReason: null,
  },
  dietaryCarbs: {
    type: 'dietaryCarbs',
    identifier: 'HKQuantityTypeIdentifierDietaryCarbohydrates',
    label: 'Carbohydrates',
    purpose: 'Adds the carbohydrate grams behind an imported calorie total.',
    icon: 'macros',
    unit: 'g',
    aggregation: 'sum',
    importsTo: 'nutrition',
    entryType: null,
    dataKey: 'carbohydrates',
    notImportedReason: null,
  },
  dietaryFat: {
    type: 'dietaryFat',
    identifier: 'HKQuantityTypeIdentifierDietaryFatTotal',
    label: 'Fat',
    purpose: 'Adds the fat grams behind an imported calorie total.',
    icon: 'macros',
    unit: 'g',
    aggregation: 'sum',
    importsTo: 'nutrition',
    entryType: null,
    dataKey: 'fats',
    notImportedReason: null,
  },
} as const;

/** Descriptors in card order. */
export const HEALTHKIT_DESCRIPTORS: readonly HealthKitTypeDescriptor[] =
  HEALTHKIT_DATA_TYPES.map((type) => HEALTHKIT_TYPES[type]);

/**
 * EXACTLY what we ask iOS to read. Derived, never hand-maintained — plus the
 * one identifier that cannot live in the descriptor table at all
 * (`HEALTHKIT_WORKOUT_IDENTIFIER`; see its own doc comment for why).
 */
export const HEALTHKIT_READ_IDENTIFIERS: readonly string[] = [
  ...HEALTHKIT_DESCRIPTORS.map((descriptor) => descriptor.identifier),
  HEALTHKIT_WORKOUT_IDENTIFIER,
];

/**
 * EXACTLY what we ask iOS to write: nothing. P3 is a read-only integration, and
 * this constant exists so the emptiness is asserted rather than assumed.
 */
export const HEALTHKIT_WRITE_IDENTIFIERS: readonly string[] = [];

/** The types that reach `/health/entries`. */
export const HEALTHKIT_ENTRY_TYPES: readonly HealthKitDataType[] = HEALTHKIT_DESCRIPTORS.filter(
  (descriptor) => descriptor.importsTo === 'entries',
).map((descriptor) => descriptor.type);

/** The types that reach `/health/weight/entries`. */
export const HEALTHKIT_WEIGHT_TYPES: readonly HealthKitDataType[] = HEALTHKIT_DESCRIPTORS.filter(
  (descriptor) => descriptor.importsTo === 'weight',
).map((descriptor) => descriptor.type);

/** The four dietary macro types that combine into one `/health/nutrition/entries` row. */
export const HEALTHKIT_NUTRITION_TYPES: readonly HealthKitDataType[] =
  HEALTHKIT_DESCRIPTORS.filter((descriptor) => descriptor.importsTo === 'nutrition').map(
    (descriptor) => descriptor.type,
  );

/** Every type that is written somewhere, whichever table that is. */
export const HEALTHKIT_IMPORTABLE_TYPES: readonly HealthKitDataType[] =
  HEALTHKIT_DESCRIPTORS.filter((descriptor) => descriptor.importsTo !== null).map(
    (descriptor) => descriptor.type,
  );

/* ============================ Sample shapes ============================= */

/**
 * One HealthKit sample, normalised at the bridge boundary.
 *
 * The native layer converts to `descriptor.unit` before handing anything over,
 * so nothing downstream deals in HKUnit or Apple's date objects.
 */
export interface HealthKitSample {
  readonly type: HealthKitDataType;
  /** ISO-8601 instant the sample starts. Buckets the sample into a local day. */
  readonly startedAt: string;
  /** ISO-8601 instant the sample ends. */
  readonly endedAt: string;
  readonly value: number;
  readonly unit: HealthKitUnit;
  /** e.g. "Apple Watch" — kept for display, never sent to the server. */
  readonly sourceName?: string;
}

/**
 * A `POST /health/entries` body. `source` is pinned to `'healthkit'` so the
 * server can keep these rows apart from anything the user typed.
 */
export interface HealthKitEntryPayload {
  /** `YYYY-MM-DD`, in the user's local time zone. */
  readonly date: string;
  readonly entry_type: HealthKitEntryType;
  readonly data: Readonly<Record<string, number>>;
  readonly source: 'healthkit';
}

/** The unit a weight row is stored in. The API also accepts the donor's `'lbs'`. */
export type HealthKitWeightUnit = 'kg' | 'lb';

/**
 * A `POST /health/weight/entries` body.
 *
 * `source` is pinned to `'healthkit'` (0122) so the de-duplicator can tell an
 * imported reading from a typed one and apply "manual always wins". The unit is the
 * user's own display preference, not HealthKit's kilograms: the weight log stores a
 * unit per row and `weightDelta()` refuses to compare across units, so importing kg
 * into a log the user keeps in pounds would silently break their trend line.
 */
export interface HealthKitWeightPayload {
  /** `YYYY-MM-DD`, in the user's local time zone. */
  readonly date: string;
  readonly weight: number;
  readonly unit: HealthKitWeightUnit;
  readonly source: 'healthkit';
}

/* ========================= Workout sample shape =========================== */

/**
 * One `HKWorkout`, normalised at the bridge boundary. Deliberately NOT a
 * `HealthKitSample` — a workout carries several facets (type, duration,
 * calories, distance) at once, not one scalar `value`, and a day can hold more
 * than one session, so it can never be aggregated the way the five scalar
 * types are.
 */
export interface HealthKitWorkoutSample {
  /** Apple's own identity for this session — the de-duplication key. */
  readonly uuid: string;
  readonly startedAt: string;
  readonly endedAt: string;
  /** Free-text label (e.g. "Running") — the same field the manual logger writes. */
  readonly workoutType: string;
  readonly minutes: number;
  readonly calories: number;
  readonly distanceMeters?: number;
  readonly sourceName?: string;
}

/**
 * A `POST /health/entries` body for `entry_type: 'workout'`. Shares the
 * `HealthWorkoutPayload` blob shape (`src/api/health.ts`) plus the one field
 * that exists only so a re-sync can recognise "already imported this session":
 * `healthkit_uuid`, carried inside `data` because `health_entries.data` is
 * schemaless and this is exactly the kind of source-specific fact it exists
 * for — it is never read by anything that is not this importer.
 */
export interface HealthKitWorkoutPayload {
  readonly date: string;
  readonly entry_type: 'workout';
  readonly data: {
    readonly workout_type: string;
    readonly minutes: number;
    readonly calories: number;
    readonly note: string;
    readonly distance_m?: number;
    readonly started_at: string;
    readonly healthkit_uuid: string;
  };
  readonly source: 'healthkit';
}

/* ========================= Nutrition payload shape ========================= */

/**
 * A `POST /health/nutrition/entries` body built from the four dietary macro
 * types. One row per local day: HealthKit gives per-day TOTALS (via the same
 * `HKStatisticsCollectionQuery` cumulative-sum path steps/active-energy use),
 * not individual foods, so this cannot recover meal-level detail (which food,
 * which meal slot) — it lands as one `'snack'`-slotted `'Apple Health'` row
 * per day, editable like any other diary entry afterwards. `food_name` is the
 * sentinel `planNutritionImport` uses to recognise "the row we wrote", the
 * same role `source: 'healthkit'` plays for `/health/entries` and
 * `/health/weight/entries`.
 */
export interface HealthKitNutritionPayload {
  readonly date: string;
  readonly food_name: 'Apple Health';
  readonly meal_type: 'snack';
  readonly calories: number;
  readonly proteins: number;
  readonly carbohydrates: number;
  readonly fats: number;
  readonly source: 'healthkit';
}

/* ============================== Guards ================================= */

export function isHealthKitDataType(value: unknown): value is HealthKitDataType {
  return typeof value === 'string' && value in HEALTHKIT_TYPES;
}

/** The descriptor for an Apple identifier, or `null` if we never asked for it. */
export function descriptorForIdentifier(identifier: string): HealthKitTypeDescriptor | null {
  return HEALTHKIT_DESCRIPTORS.find((d) => d.identifier === identifier) ?? null;
}

/**
 * True when `identifier` is inside our scope.
 *
 * The service checks every identifier a bridge hands back through this, so a
 * native module that over-reports (or a future library that helpfully requests
 * "everything") cannot widen our permission footprint from the outside.
 */
export function isScopedIdentifier(identifier: string): boolean {
  return HEALTHKIT_READ_IDENTIFIERS.includes(identifier);
}
