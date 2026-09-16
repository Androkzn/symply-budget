import {
  healthExercisesApi,
  type HealthActiveInjuryPart,
  type HealthExercise,
  type HealthExerciseCategory,
  type HealthExerciseDifficulty,
  type HealthInjuryFlag,
} from '@api/healthExercises';
import { storageHelpers } from '@services/storage';

import {
  addWorkoutEntry,
  isWorkoutType,
  WORKOUT_TYPE_LABELS,
  type WorkoutType,
} from './healthActivityStorage';
import { healthSyncStateFor, readThrough, writeThrough } from './healthRepository';

/**
 * Symply Health — WORKOUT LIBRARY (ported donor `exercise_library`).
 *
 * The record of truth is `/health/exercises*` on the `symply-health-api`
 * Worker; MMKV is an offline read-through cache exactly as in every other
 * Health store. A gym is the single most likely place on earth to have no
 * signal, so the catalogue has to render from the last snapshot.
 *
 * THE RULE THIS MODULE PROTECTS: **the injury verdict is the SERVER's.**
 *
 * `injury_flag` / `injury_body_parts` arrive already computed from the user's
 * ACTIVE injuries (`/health/injuries/active-body-parts` shares the same
 * derivation). This module renames them and orders by them; it never decides
 * for itself whether a movement is safe. A device that guessed would disagree
 * with the Worker exactly when it matters most — and it would be guessing from
 * a cached, possibly stale copy of the injury log.
 *
 * The one safety decision that DOES live here is refusing to log an `avoid`
 * exercise without an explicit acknowledgement (`logExercise`): a single
 * mistaken tap must not write a session for a movement the gate says to avoid.
 *
 * "Log this" reuses `addWorkoutEntry` → `/health/entries/workouts`. Session
 * logging is NOT duplicated: the library hands over the catalogue row's
 * `workoutType` + `defaultMinutes` and the activity store owns the write.
 */

export const HEALTH_EXERCISES_KEY = 'health.exercises.v1';

/* ==================================================================== */
/* Screen shapes                                                         */
/* ==================================================================== */

export type ExerciseDifficulty = HealthExerciseDifficulty;
export type ExerciseCategory = HealthExerciseCategory;
export type InjuryFlag = HealthInjuryFlag;

export interface ExerciseItem {
  id: string;
  name: string;
  /** Search synonyms — kept so the OFFLINE match can use them too. */
  aliases: string[];
  category: string;
  muscleGroups: string[];
  secondaryMuscles: string[];
  equipment: string[];
  /** Joints the movement loads. */
  bodyParts: string[];
  difficulty: string;
  /** 1–5, as the server derived it. */
  difficultyLevel: number;
  instructions: string | null;
  illustration: string | null;
  defaultMinutes: number;
  /** Always a value `/health/entries/workouts` accepts. */
  workoutType: WorkoutType;
  isFavorite: boolean;
  /** SERVER verdict. Never computed here. */
  injuryFlag: InjuryFlag | null;
  /** The user's OWN wording for each injury this movement loads. */
  injuryBodyParts: string[];
  updatedAt: string;
}

/** One active injury, as the library response reports it. */
export interface ActiveInjury {
  bodyPart: string;
  canonical: string;
  maxPainLevel: number;
  injuryCount: number;
}

export interface ExerciseLibrary {
  exercises: ExerciseItem[];
  /** Empty when nothing is injured — which is also the offline fallback. */
  injuries: ActiveInjury[];
}

export const EMPTY_LIBRARY: ExerciseLibrary = { exercises: [], injuries: [] };

/** The browse filters the tab exposes. `null` means "any". */
export interface ExerciseFilter {
  muscleGroup: string | null;
  equipment: string | null;
  difficulty: string | null;
  category: string | null;
  favoritesOnly: boolean;
}

export const EMPTY_EXERCISE_FILTER: ExerciseFilter = {
  muscleGroup: null,
  equipment: null,
  difficulty: null,
  category: null,
  favoritesOnly: false,
};

export function isFilterActive(filter: ExerciseFilter): boolean {
  return (
    filter.muscleGroup !== null ||
    filter.equipment !== null ||
    filter.difficulty !== null ||
    filter.category !== null ||
    filter.favoritesOnly
  );
}

/** The distinct values a filter row can offer, derived from what is cached. */
export interface ExerciseFacets {
  muscleGroups: string[];
  equipment: string[];
  difficulties: string[];
  categories: string[];
}

/* ==================================================================== */
/* Display copy                                                          */
/* ==================================================================== */

/** The route 400s a shorter needle in the food domain; keep one convention. */
export const MIN_EXERCISE_SEARCH_LENGTH = 2;

export const INJURY_FLAG_LABELS: Record<InjuryFlag, string> = {
  avoid: 'Avoid for now',
  caution: 'Take care',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  level1: 'Very easy',
  level2: 'Easy',
  level3: 'Moderate',
  level4: 'Hard',
  level5: 'Very hard',
};

export const CATEGORY_LABELS: Record<string, string> = {
  strength: 'Strength',
  cardio: 'Cardio',
  yoga: 'Yoga',
  stretching: 'Stretching',
  mobility: 'Mobility',
  rehabilitation: 'Rehab',
  recovery: 'Recovery',
};

/** `lower_back` → `Lower back`. Used for muscle, equipment and joint chips. */
export function humanizeToken(token: string): string {
  const words = String(token ?? '').split('_').filter(Boolean);
  if (words.length === 0) return '';
  const [first, ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

export function difficultyLabel(difficulty: string): string {
  return DIFFICULTY_LABELS[difficulty] ?? humanizeToken(difficulty);
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? humanizeToken(category);
}

/**
 * The sentence shown beside a flagged exercise, or `null` when it is clear.
 *
 * Reads the SERVER's flag and the user's own words for the injury back to them
 * — never a body part this module inferred.
 */
export function injuryWarningFor(item: ExerciseItem): string | null {
  if (item.injuryFlag === null) return null;
  const parts = item.injuryBodyParts.map(humanizeToken);
  const named =
    parts.length === 0
      ? 'an injury you logged'
      : parts.length === 1
        ? `your ${parts[0].toLowerCase()}`
        : `${parts.slice(0, -1).join(', ').toLowerCase()} and ${parts[parts.length - 1].toLowerCase()}`;
  return item.injuryFlag === 'avoid'
    ? `This loads ${named}. Avoid it until that has healed.`
    : `This may involve ${named}. Take it gently.`;
}

/** An `avoid` movement may not be logged on a single accidental tap. */
export function requiresInjuryAcknowledgement(item: ExerciseItem): boolean {
  return item.injuryFlag === 'avoid';
}

/* ==================================================================== */
/* Wire ↔ screen mappers                                                 */
/* ==================================================================== */

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * A `workout_type` the activity store will accept.
 *
 * The catalogue is seeded with values `/health/entries/workouts` already
 * validates, so this only ever matters if the catalogue grows a new type before
 * the app knows about it — in which case `other` logs a real session rather than
 * dropping it on the floor.
 */
export function toWorkoutType(raw: string): WorkoutType {
  return typeof raw === 'string' && isWorkoutType(raw) ? raw : 'other';
}

export function workoutTypeLabel(type: WorkoutType): string {
  return WORKOUT_TYPE_LABELS[type];
}

export function fromWireExercise(row: HealthExercise): ExerciseItem {
  return {
    id: row.id,
    name: row.name,
    aliases: stringArray(row.aliases),
    category: row.category ?? '',
    muscleGroups: stringArray(row.muscle_groups),
    secondaryMuscles: stringArray(row.secondary_muscles),
    equipment: stringArray(row.equipment),
    bodyParts: stringArray(row.body_parts),
    difficulty: row.difficulty ?? 'level1',
    difficultyLevel: Math.min(5, Math.max(1, Math.round(numberOr(row.difficulty_level, 1)))),
    instructions: row.instructions ?? null,
    illustration: row.illustration ?? null,
    defaultMinutes: Math.max(1, Math.round(numberOr(row.default_minutes, 10))),
    workoutType: toWorkoutType(row.workout_type),
    isFavorite: row.is_favorite === true,
    // Renamed, never re-derived — the whole point of this module's rule.
    injuryFlag: row.injury_flag === 'avoid' || row.injury_flag === 'caution' ? row.injury_flag : null,
    injuryBodyParts: stringArray(row.injury_body_parts),
    updatedAt: row.updated_at ?? '',
  };
}

export function fromWireInjury(row: HealthActiveInjuryPart): ActiveInjury {
  return {
    bodyPart: row.body_part,
    canonical: row.canonical,
    maxPainLevel: numberOr(row.max_pain_level),
    injuryCount: numberOr(row.injury_count),
  };
}

/* ==================================================================== */
/* Cache-shape guards                                                    */
/* ==================================================================== */

function isValidExercise(item: ExerciseItem | null | undefined): item is ExerciseItem {
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    Array.isArray(item.muscleGroups) &&
    Array.isArray(item.injuryBodyParts)
  );
}

/**
 * A cached library, sanitised.
 *
 * `readThrough` only checks that the snapshot is an OBJECT; the arrays inside it
 * are what every screen maps over, so an older-schema entry has to be repaired
 * here or the tab crashes on exactly the offline path the cache exists for.
 */
export function normalizeLibrary(raw: ExerciseLibrary | null | undefined): ExerciseLibrary {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_LIBRARY };
  return {
    exercises: Array.isArray(raw.exercises) ? raw.exercises.filter(isValidExercise) : [],
    injuries: Array.isArray(raw.injuries)
      ? raw.injuries.filter((i): i is ActiveInjury => !!i && typeof i.bodyPart === 'string')
      : [],
  };
}

/* ==================================================================== */
/* Ordering, filtering and search                                        */
/* ==================================================================== */

/** Safe work first, caution next, avoid last. Mirrors the Worker exactly. */
export function injuryRank(flag: InjuryFlag | null): number {
  if (flag === 'avoid') return 2;
  if (flag === 'caution') return 1;
  return 0;
}

/**
 * The Worker's own ordering, so offline and online read the same.
 *
 * Safety outranks a favourite on purpose: a favourited squat with a live knee
 * injury must not sit at the top of the list.
 */
export function sortExercises(items: ExerciseItem[]): ExerciseItem[] {
  return [...items].sort(
    (a, b) =>
      injuryRank(a.injuryFlag) - injuryRank(b.injuryFlag) ||
      Number(b.isFavorite) - Number(a.isFavorite) ||
      a.name.localeCompare(b.name)
  );
}

export function applyExerciseFilter(items: ExerciseItem[], filter: ExerciseFilter): ExerciseItem[] {
  return items.filter((item) => {
    if (filter.favoritesOnly && !item.isFavorite) return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.difficulty && item.difficulty !== filter.difficulty) return false;
    if (filter.equipment && !item.equipment.includes(filter.equipment)) return false;
    if (
      filter.muscleGroup &&
      !item.muscleGroups.includes(filter.muscleGroup) &&
      !item.secondaryMuscles.includes(filter.muscleGroup)
    ) {
      return false;
    }
    return true;
  });
}

/** The list a screen renders for `filter` — filter first, then the ordering. */
export function viewExercises(items: ExerciseItem[], filter: ExerciseFilter): ExerciseItem[] {
  return sortExercises(applyExerciseFilter(items, filter));
}

/**
 * The chips a filter row can offer, derived from what is actually cached.
 *
 * Derived rather than hardcoded so a catalogue that grows a new muscle group or
 * a new piece of kit becomes filterable without an app release.
 */
export function deriveFacets(items: ExerciseItem[]): ExerciseFacets {
  const muscles = new Set<string>();
  const equipment = new Set<string>();
  const difficulties = new Set<string>();
  const categories = new Set<string>();
  for (const item of items) {
    for (const m of item.muscleGroups) muscles.add(m);
    for (const m of item.secondaryMuscles) muscles.add(m);
    for (const e of item.equipment) equipment.add(e);
    if (item.difficulty) difficulties.add(item.difficulty);
    if (item.category) categories.add(item.category);
  }
  return {
    muscleGroups: [...muscles].sort(),
    equipment: [...equipment].sort(),
    // level1..level5 sorts correctly as a string, and stays in intensity order.
    difficulties: [...difficulties].sort(),
    categories: [...categories].sort(),
  };
}

/**
 * Name / alias / muscle / equipment match over a cached catalogue — the offline
 * stand-in for `/exercises?search=`.
 *
 * Ranking is the Worker's (exact > prefix > substring, aliases weighted), so
 * this degrades to a plain contains-match rather than pretending to reproduce
 * the score.
 */
export function matchExercises(items: ExerciseItem[], query: string): ExerciseItem[] {
  const needle = String(query ?? '').toLowerCase().trim();
  if (needle.length === 0) return [];
  const token = needle.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.aliases.some((alias) => alias.includes(token)) ||
      item.muscleGroups.some((m) => m.includes(token)) ||
      item.equipment.some((e) => e.includes(token))
  );
}

/* ==================================================================== */
/* Failure copy — no raw error string ever reaches the UI                */
/* ==================================================================== */

export type ExerciseWriteStatus = 'saved' | 'offline' | 'rejected';

export const OFFLINE_WRITE_MESSAGE =
  'Saved on this device — it will sync when you are back online.';
export const MISSING_EXERCISE_MESSAGE = 'That exercise is no longer in the library.';

/**
 * Friendly copy for a request the SERVER refused, or `null` when the failure
 * looks like a lost connection. Only the HTTP status is ever inspected — the
 * error's own message is never read, so a raw string cannot leak into the UI.
 */
export function rejectionMessageFor(error: unknown): string | null {
  const status = httpStatusOf(error);
  if (status === undefined) return null; // no answer at all → treat as offline
  if (status === 404) return MISSING_EXERCISE_MESSAGE;
  if (status === 400 || status === 422) return 'That could not be saved. Please try again.';
  if (status === 401 || status === 403) return 'Please sign in again to save this.';
  if (status >= 500) return null; // a server wobble behaves like being offline
  return 'That could not be saved. Please try again.';
}

function httpStatusOf(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } } | null | undefined)?.response;
  const status = response?.status;
  return typeof status === 'number' ? status : undefined;
}

/* ==================================================================== */
/* Reads                                                                 */
/* ==================================================================== */

async function fetchLibrary(): Promise<ExerciseLibrary> {
  const payload = await healthExercisesApi.listExercises();
  return {
    exercises: (payload?.exercises ?? []).map(fromWireExercise),
    injuries: (payload?.injury_body_parts ?? []).map(fromWireInjury),
  };
}

/**
 * The WHOLE catalogue, unfiltered.
 *
 * Filters are applied after the fetch on purpose: caching a filtered response
 * under the one snapshot key would leave an offline read showing only the
 * muscle group the user last tapped.
 */
export async function loadExerciseLibrary(): Promise<ExerciseLibrary> {
  const library = normalizeLibrary(
    await readThrough(HEALTH_EXERCISES_KEY, fetchLibrary, { ...EMPTY_LIBRARY })
  );
  return { exercises: sortExercises(library.exercises), injuries: library.injuries };
}

/**
 * Relevance-ranked search over the catalogue.
 *
 * A failed request degrades to a substring match on the cached snapshot, so a
 * gym with no signal still searches — it just loses the Worker's ranking.
 */
export async function searchExercises(query: string): Promise<ExerciseItem[]> {
  const needle = typeof query === 'string' ? query.trim() : '';
  if (needle.length === 0) return [];
  if (needle.length < MIN_EXERCISE_SEARCH_LENGTH) {
    return sortExercises(matchExercises((await loadExerciseLibrary()).exercises, needle));
  }
  try {
    const payload = await healthExercisesApi.listExercises({ search: needle });
    return (payload?.exercises ?? []).map(fromWireExercise);
  } catch {
    // A failed search must never blank the screen or surface a raw error.
    return sortExercises(matchExercises((await loadExerciseLibrary()).exercises, needle));
  }
}

/* ==================================================================== */
/* Writes                                                                */
/* ==================================================================== */

export interface ExerciseWriteResult {
  library: ExerciseLibrary;
  status: ExerciseWriteStatus;
  message: string | null;
}

/**
 * Favourite / un-favourite.
 *
 * Three outcomes, same contract as the food store:
 *  - `saved`    — the Worker took it;
 *  - `offline`  — the request never landed, so the optimistic row stands and the
 *                 user still sees what they just did;
 *  - `rejected` — the Worker refused it. The optimistic row is ROLLED BACK,
 *                 because it does not exist server-side and a phantom favourite
 *                 would outlive the session.
 */
export async function setExerciseFavorite(
  id: string,
  isFavorite: boolean
): Promise<ExerciseWriteResult> {
  const before = await loadExerciseLibrary();
  const optimistic: ExerciseLibrary = {
    injuries: before.injuries,
    exercises: sortExercises(
      before.exercises.map((item) => (item.id === id ? { ...item, isFavorite } : item))
    ),
  };

  // A holder rather than a `let`: TypeScript does not track assignments made
  // inside the callback below.
  const outcome: { rejection: string | null } = { rejection: null };

  const library = await writeThrough(
    HEALTH_EXERCISES_KEY,
    async () => {
      try {
        await healthExercisesApi.setFavorite(id, isFavorite);
      } catch (error) {
        outcome.rejection = rejectionMessageFor(error);
        throw error;
      }
    },
    fetchLibrary,
    optimistic,
    `favorite exercise=${id} value=${isFavorite}`
  );

  if (outcome.rejection !== null) {
    await storageHelpers.setObject(HEALTH_EXERCISES_KEY, before);
    return { library: before, status: 'rejected', message: outcome.rejection };
  }

  const normalized = normalizeLibrary(library);
  const offline = healthSyncStateFor(HEALTH_EXERCISES_KEY) === 'offline';
  return {
    library: { exercises: sortExercises(normalized.exercises), injuries: normalized.injuries },
    status: offline ? 'offline' : 'saved',
    message: offline ? OFFLINE_WRITE_MESSAGE : null,
  };
}

export type LogExerciseStatus = 'logged' | 'offline' | 'blocked';

export interface LogExerciseResult {
  status: LogExerciseStatus;
  message: string;
  /** Minutes actually written; `null` when nothing was. */
  minutes: number | null;
}

export const INJURY_BLOCK_MESSAGE =
  'This movement loads an injury you have logged. Confirm before recording it.';

/**
 * "Log this" — record a workout session for a catalogue exercise.
 *
 * Session logging is NOT duplicated: this hands the row's `workoutType` and a
 * duration to `addWorkoutEntry`, which owns the `/health/entries/workouts`
 * write, the offline queue and the activity cache.
 *
 * SAFETY: an `avoid` exercise is REFUSED unless the caller passes
 * `acknowledgeInjury`. The gate has already told the user to avoid it, so a
 * single mis-tap on a crowded list must not quietly record the session — the
 * screen re-asks first.
 */
export async function logExercise(
  item: ExerciseItem,
  options: { minutes?: number; date?: string; acknowledgeInjury?: boolean } = {}
): Promise<LogExerciseResult> {
  if (requiresInjuryAcknowledgement(item) && options.acknowledgeInjury !== true) {
    return { status: 'blocked', message: INJURY_BLOCK_MESSAGE, minutes: null };
  }

  const minutes = Math.max(1, Math.round(options.minutes ?? item.defaultMinutes));
  await addWorkoutEntry({
    type: item.workoutType,
    minutes,
    note: item.name,
    date: options.date,
  });

  const offline = healthSyncStateFor('health.workouts.v1') === 'offline';
  return {
    status: offline ? 'offline' : 'logged',
    message: offline
      ? `Logged ${minutes} min of ${item.name} on this device — it will sync when you are back online.`
      : `Logged ${minutes} min of ${item.name}.`,
    minutes,
  };
}
