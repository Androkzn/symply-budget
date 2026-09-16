/**
 * Symply Health — the workout SESSION vocabulary.
 *
 * Ported from the donor's `WorkoutType` enum
 * (`Simply Health/SimpleHealth/SimpleHealth/Preview Content/Domain/Models/Health/HealthModels.swift:191`)
 * — all **61** cases, in the donor's own order, grouped into the donor's own
 * eight `HealthWorkoutCategory` buckets. The RN app shipped **7** until now, so
 * a tennis player logged "Other".
 *
 * It lives in its own module rather than in `healthActivityStorage.ts` because
 * it is pure DATA with no I/O: the store, the Activity screen, the type picker
 * and the exercise catalogue all read it, and none of them should have to pull
 * the API client in to ask what a workout type is called.
 * `healthActivityStorage` re-exports the whole surface, so every existing
 * importer keeps working untouched.
 *
 * ## Slugs: ours for 7, the donor's for the other 54 — deliberately
 *
 * The donor spells four of its cardio cases `running` / `walking` / `cycling` /
 * `swimming`; this app has been storing `run` / `walk` / `cycle` / `swim` since
 * P1. Renaming them to match the donor would have cost two things and bought
 * nothing:
 *
 *  1. every `health_entries.data.workout_type` already written would need a
 *     JSON rewrite, which restamps `updated_at` on every workout a member has
 *     ever logged and forces a full re-pull on every device;
 *  2. `exercise_library.workout_type` (0123) carries a **CHECK constraint**
 *     naming exactly those seven slugs, and SQLite cannot widen a CHECK without
 *     rebuilding the table — the same rebuild 0122 and 0124 both declined.
 *
 * So the seven slugs this app already stores are kept verbatim and the other
 * 54 take the donor's raw value. **All 88 seeded `exercise_library` rows stay
 * valid** (they only ever use `walk`, `run`, `strength`, `cycle`, `swim`,
 * `yoga`, `other`) and no data migration is needed. `normalizeWorkoutType()`
 * below accepts the donor's spellings and maps them home, so a donor export or
 * a future `HKWorkout` import lands on the right type.
 *
 * DISPLAY NAMES are the donor's, including "Strength Training" where this app
 * previously said "Strength" — the slug is the contract, the label is not.
 *
 * ## Icons
 *
 * The donor names 61 SF Symbols. The Symply Health brand kit does not have 61
 * glyphs, and inventing kit keys that do not exist would render the Ionicons
 * fallback (or a missing-glyph box) rather than the brushed PNG. Every value
 * below is a REAL slug in `brands/symply-health/src/assets/icons`, chosen to be
 * the nearest honest match, so `<Icon>` always resolves the branded asset.
 */

/* ======================== Categories (donor's eight) ==================== */

/**
 * The donor's `HealthWorkoutCategory`, raw values and order preserved
 * (`HealthModels.swift:514`). Water sports fold into `cardio`, climbing and
 * gymnastics into `strengthTraining` and barre into `mindBody` — that is the
 * donor's own mapping, not a simplification of it.
 */
export const WORKOUT_CATEGORIES = [
  'cardio',
  'strengthTraining',
  'mindBody',
  'dance',
  'sports',
  'outdoor',
  'lifestyle',
  'other',
] as const;
export type WorkoutCategory = (typeof WORKOUT_CATEGORIES)[number];

/** Donor `HealthWorkoutCategory.displayName`. */
export const WORKOUT_CATEGORY_LABELS: Record<WorkoutCategory, string> = {
  cardio: 'Cardio',
  strengthTraining: 'Strength Training',
  mindBody: 'Mind & Body',
  dance: 'Dance',
  sports: 'Sports',
  outdoor: 'Outdoor & Adventure',
  lifestyle: 'Everyday Activities',
  other: 'Other',
};

/** Brand icon-kit slugs — see the module header on why these are not the donor's. */
export const WORKOUT_CATEGORY_ICONS: Record<WorkoutCategory, string> = {
  cardio: 'run',
  strengthTraining: 'strength',
  mindBody: 'stretch',
  dance: 'movement',
  sports: 'workouts',
  outdoor: 'walk',
  lifestyle: 'home',
  other: 'workouts',
};

/* =========================== The 61 types ============================== */

/**
 * Every session type, grouped the way the donor groups them and ordered inside
 * each group the way the donor orders them.
 *
 * THIS OBJECT IS THE SOURCE OF TRUTH: `WorkoutType` and the flat
 * `WORKOUT_TYPES` are both derived from it, so a type added here is a type
 * everywhere, and the label/icon tables below fail to compile until they cover
 * it. There is no second list to keep in step.
 */
export const WORKOUT_TYPES_BY_CATEGORY = {
  cardio: [
    'run',
    'walk',
    'cycle',
    'swim',
    'hiking',
    'elliptical',
    'rowing',
    'stairClimbing',
    'jumpRope',
    'waterFitness',
    'paddleSports',
    'sailing',
  ],
  strengthTraining: [
    'strength',
    'functionalStrength',
    'coreTraining',
    'hiit',
    'crossTraining',
    'mixedCardio',
    'climbing',
    'gymnastics',
  ],
  mindBody: ['yoga', 'pilates', 'flexibility', 'mindAndBody', 'stretching', 'cooldown', 'barre'],
  dance: ['dance', 'aerobics', 'stepTraining'],
  sports: [
    'tennis',
    'basketball',
    'soccer',
    'golf',
    'badminton',
    'boxing',
    'martialArts',
    'skiing',
    'snowboarding',
    'surfing',
    'skateboarding',
    'volleyball',
    'americanFootball',
    'baseball',
    'softball',
    'rugby',
    'hockey',
    'lacrosse',
    'cricket',
    'tableTennis',
    'squash',
    'racquetball',
    'handball',
    'waterPolo',
  ],
  outdoor: ['fishing', 'archery', 'equestrianSports'],
  lifestyle: ['yardwork', 'housework', 'gardening'],
  other: ['other'],
} as const;

/**
 * The 61-case union, derived from the grouping above rather than declared twice.
 * Indexing a `Record` by a union of keys yields the union of their values, so
 * this stays exact without a second list to maintain.
 */
export type WorkoutType = (typeof WORKOUT_TYPES_BY_CATEGORY)[WorkoutCategory][number];

/**
 * All 61, category order then donor order within a category.
 *
 * The seven the app shipped before this port — `walk`, `run`, `strength`,
 * `cycle`, `swim`, `yoga`, `other` — are all still here, spelled exactly as
 * they are already stored.
 */
export const WORKOUT_TYPES: readonly WorkoutType[] = WORKOUT_CATEGORIES.flatMap(
  (category) => WORKOUT_TYPES_BY_CATEGORY[category] as readonly WorkoutType[]
);

/**
 * The seven types this app has always offered, in their original order.
 *
 * They are the log form's quick-pick row: a stable default set that does not
 * depend on history, so the common case stays one tap and the 61-strong picker
 * is a deliberate second step rather than the only way in.
 */
export const QUICK_WORKOUT_TYPES: readonly WorkoutType[] = [
  'walk',
  'run',
  'strength',
  'cycle',
  'swim',
  'yoga',
  'other',
];

/** Donor `WorkoutType.displayName`. Exhaustive — a new type will not compile without one. */
export const WORKOUT_TYPE_LABELS: Record<WorkoutType, string> = {
  // Cardio
  run: 'Running',
  walk: 'Walking',
  cycle: 'Cycling',
  swim: 'Swimming',
  hiking: 'Hiking',
  elliptical: 'Elliptical',
  rowing: 'Rowing',
  stairClimbing: 'Stair Climbing',
  jumpRope: 'Jump Rope',
  waterFitness: 'Water Fitness',
  paddleSports: 'Paddle Sports',
  sailing: 'Sailing',
  // Strength & training
  strength: 'Strength Training',
  functionalStrength: 'Functional Strength',
  coreTraining: 'Core Training',
  hiit: 'HIIT',
  crossTraining: 'Cross Training',
  mixedCardio: 'Mixed Cardio',
  climbing: 'Climbing',
  gymnastics: 'Gymnastics',
  // Mind & body
  yoga: 'Yoga',
  pilates: 'Pilates',
  flexibility: 'Flexibility',
  mindAndBody: 'Mind & Body',
  stretching: 'Stretching',
  cooldown: 'Cooldown',
  barre: 'Barre',
  // Dance & aerobics
  dance: 'Dance',
  aerobics: 'Aerobics',
  stepTraining: 'Step Training',
  // Sports
  tennis: 'Tennis',
  basketball: 'Basketball',
  soccer: 'Soccer',
  golf: 'Golf',
  badminton: 'Badminton',
  boxing: 'Boxing',
  martialArts: 'Martial Arts',
  skiing: 'Skiing',
  snowboarding: 'Snowboarding',
  surfing: 'Surfing',
  skateboarding: 'Skateboarding',
  volleyball: 'Volleyball',
  americanFootball: 'American Football',
  baseball: 'Baseball',
  softball: 'Softball',
  rugby: 'Rugby',
  hockey: 'Hockey',
  lacrosse: 'Lacrosse',
  cricket: 'Cricket',
  tableTennis: 'Table Tennis',
  squash: 'Squash',
  racquetball: 'Racquetball',
  handball: 'Handball',
  waterPolo: 'Water Polo',
  // Outdoor & adventure
  fishing: 'Fishing',
  archery: 'Archery',
  equestrianSports: 'Horseback Riding',
  // Everyday activities
  yardwork: 'Yardwork',
  housework: 'Housework',
  gardening: 'Gardening',
  // Other
  other: 'Other',
};

/**
 * Brand icon-kit slugs. Every value is a real asset in the Health kit — see the
 * module header. The seven original types keep exactly the icon they had, so
 * nothing already on screen changes appearance.
 */
export const WORKOUT_TYPE_ICONS: Record<WorkoutType, string> = {
  run: 'run',
  walk: 'walk',
  cycle: 'movement',
  swim: 'movement',
  hiking: 'walk',
  elliptical: 'movement',
  rowing: 'movement',
  stairClimbing: 'steps',
  jumpRope: 'movement',
  waterFitness: 'hydration',
  paddleSports: 'movement',
  sailing: 'movement',
  strength: 'strength',
  functionalStrength: 'strength',
  coreTraining: 'strength',
  hiit: 'energy-burned',
  crossTraining: 'strength',
  mixedCardio: 'movement',
  climbing: 'strength',
  gymnastics: 'strength',
  yoga: 'stretch',
  pilates: 'stretch',
  flexibility: 'stretch',
  mindAndBody: 'mindfulness',
  stretching: 'stretch',
  cooldown: 'recovery',
  barre: 'stretch',
  dance: 'movement',
  aerobics: 'movement',
  stepTraining: 'steps',
  tennis: 'workouts',
  basketball: 'workouts',
  soccer: 'workouts',
  golf: 'workouts',
  badminton: 'workouts',
  boxing: 'energy-burned',
  martialArts: 'energy-burned',
  skiing: 'workouts',
  snowboarding: 'workouts',
  surfing: 'movement',
  skateboarding: 'movement',
  volleyball: 'workouts',
  americanFootball: 'workouts',
  baseball: 'workouts',
  softball: 'workouts',
  rugby: 'workouts',
  hockey: 'workouts',
  lacrosse: 'workouts',
  cricket: 'workouts',
  tableTennis: 'workouts',
  squash: 'workouts',
  racquetball: 'workouts',
  handball: 'workouts',
  waterPolo: 'hydration',
  fishing: 'walk',
  archery: 'workouts',
  equestrianSports: 'walk',
  yardwork: 'home',
  housework: 'home',
  gardening: 'home',
  other: 'workouts',
};

/** Which bucket a type belongs to — the reverse index of the grouping above. */
export const WORKOUT_TYPE_CATEGORY: Record<WorkoutType, WorkoutCategory> = Object.fromEntries(
  WORKOUT_CATEGORIES.flatMap((category) =>
    WORKOUT_TYPES_BY_CATEGORY[category].map((type) => [type, category])
  )
) as Record<WorkoutType, WorkoutCategory>;

/** What "no type chosen yet" means on the log form. */
export const DEFAULT_WORKOUT_TYPE: WorkoutType = 'walk';

/**
 * A Set rather than `value in WORKOUT_TYPE_LABELS`: `in` walks the prototype
 * chain, so `'toString'` and `'constructor'` would both pass as workout types.
 */
const TYPE_SET: ReadonlySet<string> = new Set(WORKOUT_TYPES);

export function isWorkoutType(value: unknown): value is WorkoutType {
  return typeof value === 'string' && TYPE_SET.has(value);
}

/**
 * Never `undefined`.
 *
 * The lookups below are total over `WorkoutType`, but a row can still arrive
 * carrying a slug this build does not know — written by a newer client, or by a
 * HealthKit import scoped to a type added after this release. Indexing a
 * `Record` with it would put `undefined` on screen, so every read goes through
 * one of these three and lands on `other`.
 */
export function workoutTypeLabel(type: string): string {
  return WORKOUT_TYPE_LABELS[type as WorkoutType] ?? WORKOUT_TYPE_LABELS.other;
}

export function workoutTypeIcon(type: string): string {
  return WORKOUT_TYPE_ICONS[type as WorkoutType] ?? WORKOUT_TYPE_ICONS.other;
}

export function workoutTypeCategory(type: string): WorkoutCategory {
  return WORKOUT_TYPE_CATEGORY[type as WorkoutType] ?? 'other';
}

/* ============================== Distance =============================== */

/**
 * The donor's `WorkoutType.supportsDistance` — the same **14** types, with our
 * four renamed slugs substituted (`HealthModels.swift:457`).
 *
 * This gates the distance field on the log form: asking a yoga session how far
 * it went is noise, and a distance stored against one would poison the weekly
 * total. Everything else is free to leave it blank, which stays NULL — see
 * `healthActivityStorage`'s note on why absent is not zero.
 */
export const DISTANCE_WORKOUT_TYPES: readonly WorkoutType[] = [
  'run',
  'walk',
  'cycle',
  'swim',
  'hiking',
  'rowing',
  'skiing',
  'snowboarding',
  'surfing',
  'skateboarding',
  'elliptical',
  'paddleSports',
  'sailing',
  'waterFitness',
] as const;

const DISTANCE_SET: ReadonlySet<string> = new Set(DISTANCE_WORKOUT_TYPES);

export function workoutSupportsDistance(type: string): boolean {
  return DISTANCE_SET.has(type);
}

/* ============================== Aliases ================================ */

/**
 * The donor's `WorkoutType.from(string:)`, ported.
 *
 * Two deliberate differences:
 *  - the donor's four raw values this app spells differently (`running`,
 *    `walking`, `cycling`, `swimming`) are aliases here, which is what lets a
 *    donor export or a future `HKWorkout` import land on the right type;
 *  - the donor's Cyrillic aliases are NOT ported. There is no Russian locale in
 *    this app and no free-text ingest path that would ever feed them, so they
 *    would be vocabulary nothing can reach.
 *
 * Anything unrecognised resolves to `other`, exactly as the donor does — the
 * alternative is dropping a session the member logged.
 */
const WORKOUT_TYPE_ALIASES: Record<string, WorkoutType> = {
  running: 'run',
  run: 'run',
  jog: 'run',
  jogging: 'run',
  walking: 'walk',
  walk: 'walk',
  cycling: 'cycle',
  cycle: 'cycle',
  bike: 'cycle',
  biking: 'cycle',
  swimming: 'swim',
  swim: 'swim',
  hike: 'hiking',
  weights: 'strength',
  weightlifting: 'strength',
  'weight training': 'strength',
  'strength training': 'strength',
  'high intensity': 'hiit',
  'interval training': 'hiit',
  core: 'coreTraining',
  abs: 'coreTraining',
  stretch: 'stretching',
  'stair climbing': 'stairClimbing',
  'jump rope': 'jumpRope',
  'table tennis': 'tableTennis',
  'water polo': 'waterPolo',
  'american football': 'americanFootball',
  'martial arts': 'martialArts',
  'horseback riding': 'equestrianSports',
  'paddle sports': 'paddleSports',
  'water fitness': 'waterFitness',
  'functional strength': 'functionalStrength',
  'cross training': 'crossTraining',
  'mixed cardio': 'mixedCardio',
  'step training': 'stepTraining',
  'mind and body': 'mindAndBody',
  'mind & body': 'mindAndBody',
};

/** Case-insensitive, alias-aware resolve. Unknown ⇒ `other` (donor behaviour). */
export function normalizeWorkoutType(raw: unknown): WorkoutType {
  if (typeof raw !== 'string') return 'other';
  const trimmed = raw.trim();
  if (isWorkoutType(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (WORKOUT_TYPE_ALIASES[lowered]) return WORKOUT_TYPE_ALIASES[lowered];
  // A donor raw value that differs only in case (`Running`, `HIIT`).
  const cased = WORKOUT_TYPES.find((type) => type.toLowerCase() === lowered);
  return cased ?? 'other';
}

/* =============================== Search ================================ */

export interface WorkoutTypeGroup {
  category: WorkoutCategory;
  label: string;
  icon: string;
  types: WorkoutType[];
}

/** Every category, in donor order, with all of its types. */
export function workoutTypeGroups(): WorkoutTypeGroup[] {
  return WORKOUT_CATEGORIES.map((category) => ({
    category,
    label: WORKOUT_CATEGORY_LABELS[category],
    icon: WORKOUT_CATEGORY_ICONS[category],
    types: [...WORKOUT_TYPES_BY_CATEGORY[category]],
  }));
}

/**
 * Grouped search over the 61.
 *
 * Matches the display name, the slug and the alias table, so "bike" finds
 * Cycling and "abs" finds Core Training. A blank query returns every group
 * unchanged; empty groups are dropped so the picker never shows a header with
 * nothing under it. Grouping is preserved on purpose — a flat list of 61 hits
 * is exactly the thing this port exists to stop.
 */
export function searchWorkoutTypes(query: string): WorkoutTypeGroup[] {
  const needle = (query ?? '').trim().toLowerCase();
  if (needle.length === 0) return workoutTypeGroups();

  const aliasHits = new Set(
    Object.entries(WORKOUT_TYPE_ALIASES)
      .filter(([alias]) => alias.includes(needle))
      .map(([, type]) => type)
  );

  return workoutTypeGroups()
    .map((group) => ({
      ...group,
      types: group.types.filter(
        (type) =>
          workoutTypeLabel(type).toLowerCase().includes(needle) ||
          type.toLowerCase().includes(needle) ||
          aliasHits.has(type)
      ),
    }))
    .filter((group) => group.types.length > 0);
}
