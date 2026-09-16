import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import { exerciseFavorites, exerciseLibrary } from '../db/schema-health-exercises';
import { injuries } from '../db/schema-health-p2';

/**
 * Symply Health WORKOUT LIBRARY service — the ported donor `exercise_library`
 * catalogue with browse, filter, search, favourites and the INJURY GATE.
 *
 * THIN CLIENT, same contract as HealthFoodService: everything derived is derived
 * HERE. In particular the D1 JSON-array columns are parsed on this side, so a
 * screen never sees a `'["chest","triceps"]'` blob and never has to decide what
 * a malformed one means.
 *
 * Three rules drive the file:
 *
 *  1. The CATALOGUE IS GLOBAL and read-only over HTTP. Rows are authored in
 *     `migrations/0123_health_exercise_library.sql`; no request can create,
 *     edit or delete one. Personalisation is `exercise_favorites`, and every
 *     query against it is scoped to the authenticated user.
 *  2. THE INJURY GATE IS A SAFETY SURFACE. An exercise that loads a body part
 *     with an ACTIVE injury is flagged and de-prioritised — never silently
 *     ranked alongside safe work. It is deliberately conservative in ONE
 *     direction: a stale active injury keeps flagging until the user resolves or
 *     deletes it (same stance as `HealthBodyExtrasService.activeBodyParts`).
 *  3. FLAGGED IS NOT HIDDEN. The donor's users own their bodies; the library
 *     tells them what is risky and pushes it down the list, but a physio-
 *     prescribed rehab movement for the injured part must still be findable.
 *     `exclude_flagged=true` is opt-in, never the default.
 *
 * Deliberate deviations from the donor, and why:
 *  - The donor "workout library" was a VIDEO library (uploads, sharing, watch
 *    history, AI form analysis). Video is P4 media; what is ported is the
 *    exercise catalogue underneath it, which the RN app had nothing of.
 *  - The donor had no injury gate on the library at all — it stored injuries and
 *    exercises in the same database and never joined them. `/injuries/
 *    active-body-parts` already exists here, so the join is made.
 *  - Session logging is NOT duplicated: "log this" posts to the existing
 *    `/health/entries/workouts` route, which is why every row carries a
 *    `workout_type` and `default_minutes` the client can hand straight to it.
 */

/* ==================================================================== */
/* Vocabulary                                                            */
/* ==================================================================== */

export const EXERCISE_DIFFICULTY_LEVELS = ['level1', 'level2', 'level3', 'level4', 'level5'] as const;
export type ExerciseDifficultyLevel = (typeof EXERCISE_DIFFICULTY_LEVELS)[number];

export const EXERCISE_CATEGORY_VALUES = [
  'strength',
  'cardio',
  'yoga',
  'stretching',
  'mobility',
  'rehabilitation',
  'recovery',
] as const;
export type ExerciseCategoryValue = (typeof EXERCISE_CATEGORY_VALUES)[number];

/** Severity of the injury gate's verdict. `null` means "nothing flagged". */
export type InjuryFlag = 'caution' | 'avoid';

/** Hard ceiling on a list response — the seeded catalogue is ~90 rows. */
export const MAX_EXERCISE_RESULTS = 300;

/* ==================================================================== */
/* Pure helpers — exported for unit tests                                */
/* ==================================================================== */

/**
 * Parse one of the JSON-array TEXT columns.
 *
 * Never throws and never returns a non-array: a hand-edited or half-migrated row
 * must degrade to "no muscle groups", not 500 the whole library. Entries are
 * normalised so the caller can compare tokens without re-normalising.
 */
export function parseTokenArray(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string')
      .map((v) => normalizeToken(v))
      .filter((v) => v.length > 0);
  } catch {
    return [];
  }
}

/**
 * Canonical token form: lowercase, trimmed, every run of non-alphanumerics
 * collapsed to one underscore. "Lower Back" / "lower-back" / "LOWER  BACK" all
 * become `lower_back`, which is what makes a free-text injury body part
 * comparable with a seeded muscle token.
 */
export function normalizeToken(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Fold a user's free-text injury body part onto the canonical joint vocabulary.
 *
 * `injuries.body_part` is whatever the user typed (the route only bounds it to
 * 60 characters), so "Shoulders", "left knee", "lumbar" and "pecs" all have to
 * land somewhere. Anything unrecognised is returned normalised and simply
 * matches nothing — a typo must not silently flag the whole catalogue.
 */
export function canonicalBodyPart(raw: string): string {
  let token = normalizeToken(raw);
  if (token.length === 0) return '';
  // Side prefixes/suffixes carry no biomechanical meaning for the gate.
  token = token.replace(/^(left|right|l|r)_/, '').replace(/_(left|right)$/, '');
  return BODY_PART_ALIASES[token] ?? token;
}

/** Free-text → canonical joint. Covers plurals, sides and common lay terms. */
const BODY_PART_ALIASES: Record<string, string> = {
  shoulders: 'shoulder',
  rotator_cuff: 'shoulder',
  deltoid: 'shoulder',
  deltoids: 'shoulder',
  knees: 'knee',
  patella: 'knee',
  meniscus: 'knee',
  acl: 'knee',
  wrists: 'wrist',
  hand: 'wrist',
  hands: 'wrist',
  forearm: 'wrist',
  forearms: 'wrist',
  elbows: 'elbow',
  bicep: 'elbow',
  biceps: 'elbow',
  tricep: 'elbow',
  triceps: 'elbow',
  hips: 'hip',
  glute: 'hip',
  glutes: 'hip',
  buttock: 'hip',
  buttocks: 'hip',
  ankles: 'ankle',
  achilles: 'ankle',
  feet: 'foot',
  toe: 'foot',
  toes: 'foot',
  heel: 'foot',
  plantar_fascia: 'foot',
  low_back: 'lower_back',
  lower_spine: 'lower_back',
  lumbar: 'lower_back',
  lumbar_spine: 'lower_back',
  upper_back: 'back',
  mid_back: 'back',
  spine: 'back',
  thoracic: 'back',
  thoracic_spine: 'back',
  lats: 'back',
  cervical: 'neck',
  cervical_spine: 'neck',
  abs: 'core',
  abdomen: 'core',
  abdominals: 'core',
  stomach: 'core',
  obliques: 'core',
  pec: 'chest',
  pecs: 'chest',
  pectoral: 'chest',
  adductor: 'groin',
  adductors: 'groin',
  hamstrings: 'hamstring',
  quad: 'quad',
  quads: 'quad',
  quadriceps: 'quad',
  thigh: 'quad',
  calves: 'calf',
  shin: 'calf',
  shins: 'calf',
};

/**
 * The muscle tokens a given joint drives.
 *
 * This is the whole reason the gate works on a catalogue whose rows are labelled
 * by MUSCLE: a wrist injury has to reach a push-up (chest/triceps), and a knee
 * injury has to reach a squat (quads/glutes).
 */
const BODY_PART_MUSCLES: Record<string, readonly string[]> = {
  neck: ['back', 'shoulders'],
  shoulder: ['shoulders', 'chest', 'triceps', 'back'],
  elbow: ['biceps', 'triceps', 'forearms'],
  wrist: ['forearms'],
  back: ['back', 'lower_back'],
  lower_back: ['lower_back', 'back'],
  chest: ['chest'],
  core: ['abs', 'obliques'],
  hip: ['hip_flexors', 'glutes', 'adductors'],
  groin: ['adductors', 'hip_flexors'],
  knee: ['quads', 'hamstrings', 'calves'],
  quad: ['quads'],
  hamstring: ['hamstrings'],
  calf: ['calves'],
  ankle: ['calves'],
  foot: ['calves'],
};

export function musclesForBodyPart(bodyPart: string): readonly string[] {
  return BODY_PART_MUSCLES[canonicalBodyPart(bodyPart)] ?? [];
}

/** An active injury as the gate consumes it. */
export interface ActiveInjuryPart {
  /** Exactly what the user typed — this is what the UI shows back to them. */
  body_part: string;
  /** The folded joint the gate matched on. */
  canonical: string;
  max_pain_level: number;
  injury_count: number;
}

/** The gate's verdict for one exercise. */
export interface InjuryVerdict {
  flag: InjuryFlag | null;
  /** The user's OWN wording for every active injury this exercise loads. */
  body_parts: string[];
}

/** Sort weight: safe work first, caution next, avoid last. */
export function injuryRank(flag: InjuryFlag | null): number {
  if (flag === 'avoid') return 2;
  if (flag === 'caution') return 1;
  return 0;
}

/** The muscle-and-joint footprint of one catalogue row, already normalised. */
export interface ExerciseFootprint {
  muscle_groups: string[];
  secondary_muscles: string[];
  body_parts: string[];
}

/**
 * RULE 2 — the injury gate.
 *
 *   AVOID   the exercise names the injured joint outright, or its PRIMARY
 *           muscles are ones that joint drives.
 *   CAUTION only the SECONDARY muscles are involved, or the row is `full_body`
 *           (which loads everything, so every active injury is implicated).
 *
 * Pain level is deliberately NOT part of the verdict. It is reported alongside
 * so the UI can say how bad the injury is, but a "0/4" ache on a knee still
 * means a heavy squat is the wrong suggestion — downgrading on self-reported
 * pain would make the gate weakest exactly when a user is under-reporting.
 */
export function injuryVerdictFor(
  exercise: ExerciseFootprint,
  activeParts: readonly ActiveInjuryPart[]
): InjuryVerdict {
  if (activeParts.length === 0) return { flag: null, body_parts: [] };

  const primary = new Set(exercise.muscle_groups);
  const secondary = new Set(exercise.secondary_muscles);
  const joints = new Set(exercise.body_parts.map((p) => canonicalBodyPart(p)));
  const loadsEverything = primary.has('full_body') || secondary.has('full_body');

  let flag: InjuryFlag | null = null;
  const matched: string[] = [];

  for (const part of activeParts) {
    const muscles = BODY_PART_MUSCLES[part.canonical] ?? [];
    const namesJoint = joints.has(part.canonical);
    const hitsPrimary = muscles.some((m) => primary.has(m));
    const hitsSecondary = muscles.some((m) => secondary.has(m));

    if (namesJoint || hitsPrimary) {
      flag = 'avoid';
      matched.push(part.body_part);
    } else if (hitsSecondary || loadsEverything) {
      if (flag === null) flag = 'caution';
      matched.push(part.body_part);
    }
  }

  return { flag, body_parts: matched };
}

/** `level3` → 3. Anything unrecognised is treated as the gentlest level. */
export function difficultyLevelOf(difficulty: string): number {
  const match = /^level([1-5])$/.exec(String(difficulty ?? ''));
  return match ? Number(match[1]) : 1;
}

/**
 * Relevance for a text search. Mirrors the shape of the food scorer: an exact
 * name beats a prefix beats a substring, and an ALIAS hit still counts —
 * "press up" has to find "Push-up", which is exactly what the donor kept its
 * `aliases` column for.
 */
export function searchScore(
  exercise: { name: string; aliases: string[]; muscle_groups: string[]; equipment: string[] },
  query: string
): number {
  const q = normalizeToken(query);
  if (q.length === 0) return 0;
  const name = normalizeToken(exercise.name);

  let score = 0;
  if (name === q) score += 300;
  else if (name.startsWith(q)) score += 150;
  else if (name.includes(q)) score += 60;

  for (const alias of exercise.aliases) {
    if (alias === q) score += 200;
    else if (alias.startsWith(q)) score += 90;
    else if (alias.includes(q)) score += 40;
  }

  // A muscle or a piece of kit is a legitimate way to search a catalogue
  // ("glutes", "kettlebell"), but it must never outrank a name match.
  if (exercise.muscle_groups.some((m) => m === q)) score += 30;
  if (exercise.equipment.some((e) => e === q)) score += 30;

  return score;
}

/* ==================================================================== */
/* Row + view shapes                                                     */
/* ==================================================================== */

export type ExerciseRow = typeof exerciseLibrary.$inferSelect;

/** A catalogue row as the HTTP surface returns it — arrays parsed, gate applied. */
export interface ExerciseView {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  muscle_groups: string[];
  secondary_muscles: string[];
  equipment: string[];
  body_parts: string[];
  difficulty: string;
  /** 1–5, derived from `difficulty` so the client never parses "level3". */
  difficulty_level: number;
  instructions: string | null;
  illustration: string | null;
  media_url: string | null;
  default_minutes: number;
  workout_type: string;
  is_favorite: boolean;
  /** RULE 2 — `null`, `'caution'` or `'avoid'`. */
  injury_flag: InjuryFlag | null;
  /** The user's own wording for the injuries this exercise loads. */
  injury_body_parts: string[];
  updated_at: string;
}

export interface ExerciseListOptions {
  search?: string;
  muscle_group?: string;
  equipment?: string;
  difficulty?: string;
  category?: string;
  favorites?: boolean;
  /** RULE 3 — opt-in. Flagged work is de-prioritised by default, never hidden. */
  exclude_flagged?: boolean;
  limit?: number;
}

export interface ExerciseListResult {
  exercises: ExerciseView[];
  /** Every currently-active injury, so the screen can explain the flags. */
  injury_body_parts: ActiveInjuryPart[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/* ==================================================================== */
/* Service                                                               */
/* ==================================================================== */

export class HealthExerciseService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* Injury gate                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * The body parts the gate must protect, grouped exactly like
   * `HealthBodyExtrasService.activeBodyParts` so both surfaces agree.
   *
   * Read straight from `injuries` rather than through that service: this is a
   * read-only join and importing the whole body-extras service would couple two
   * domains for one query.
   */
  async activeInjuryParts(userId: string): Promise<ActiveInjuryPart[]> {
    const rows = await this.db
      .select()
      .from(injuries)
      .where(
        and(eq(injuries.user_id, userId), eq(injuries.is_active, true), isNull(injuries.deleted_at))
      )
      .all();

    const grouped = new Map<string, ActiveInjuryPart>();
    for (const row of rows) {
      const canonical = canonicalBodyPart(row.body_part);
      const existing = grouped.get(canonical);
      if (existing) {
        existing.max_pain_level = Math.max(existing.max_pain_level, row.pain_level);
        existing.injury_count += 1;
      } else {
        grouped.set(canonical, {
          body_part: row.body_part,
          canonical,
          max_pain_level: row.pain_level,
          injury_count: 1,
        });
      }
    }

    return [...grouped.values()].sort(
      (a, b) => b.max_pain_level - a.max_pain_level || a.body_part.localeCompare(b.body_part)
    );
  }

  /* ---------------------------------------------------------------- */
  /* Catalogue                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Browse / filter / search the catalogue for one user.
   *
   * Filtering happens in memory on purpose (the donor did the same): the
   * catalogue is a fixed ~90 rows, the filters are all set-membership over JSON
   * columns D1 cannot index anyway, and doing it here keeps the ordering
   * identical to what the offline client computes from its cached snapshot.
   */
  async listExercises(
    userId: string,
    opts: ExerciseListOptions = {}
  ): Promise<ExerciseListResult> {
    const [rows, favorites, activeParts] = await Promise.all([
      this.db.select().from(exerciseLibrary).where(isNull(exerciseLibrary.deleted_at)).all(),
      this.favoriteIds(userId),
      this.activeInjuryParts(userId),
    ]);

    const views = rows.map((row) => toView(row, favorites, activeParts));

    const muscle = opts.muscle_group ? normalizeToken(opts.muscle_group) : undefined;
    const equipment = opts.equipment ? normalizeToken(opts.equipment) : undefined;
    const difficulty = opts.difficulty ? normalizeToken(opts.difficulty) : undefined;
    const category = opts.category ? normalizeToken(opts.category) : undefined;
    const needle = opts.search?.trim();

    let filtered = views.filter((view) => {
      if (opts.favorites && !view.is_favorite) return false;
      if (opts.exclude_flagged && view.injury_flag !== null) return false;
      if (category && view.category !== category) return false;
      if (difficulty && view.difficulty !== difficulty) return false;
      if (equipment && !view.equipment.includes(equipment)) return false;
      if (
        muscle &&
        !view.muscle_groups.includes(muscle) &&
        !view.secondary_muscles.includes(muscle)
      ) {
        return false;
      }
      return true;
    });

    if (needle && needle.length > 0) {
      const scored = filtered
        .map((view) => ({ view, score: searchScore(view, needle) }))
        .filter((entry) => entry.score > 0);
      // Relevance wins, but a flagged hit is still pushed below a safe one of
      // the same relevance — the gate outranks nothing except itself.
      scored.sort(
        (a, b) =>
          injuryRank(a.view.injury_flag) - injuryRank(b.view.injury_flag) ||
          b.score - a.score ||
          a.view.name.localeCompare(b.view.name)
      );
      filtered = scored.map((entry) => entry.view);
    } else {
      filtered.sort(compareExercises);
    }

    const limit = clampLimit(opts.limit);
    return { exercises: filtered.slice(0, limit), injury_body_parts: activeParts };
  }

  /** One catalogue row with the same favourite + gate decoration as the list. */
  async getExercise(userId: string, id: string): Promise<ExerciseView | null> {
    const row = await this.db
      .select()
      .from(exerciseLibrary)
      .where(and(eq(exerciseLibrary.id, id), isNull(exerciseLibrary.deleted_at)))
      .get();
    if (!row) return null;

    const [favorites, activeParts] = await Promise.all([
      this.favoriteIds(userId),
      this.activeInjuryParts(userId),
    ]);
    return toView(row, favorites, activeParts);
  }

  /* ---------------------------------------------------------------- */
  /* Favourites                                                        */
  /* ---------------------------------------------------------------- */

  /** The ids this user has favourited (tombstones excluded). */
  async favoriteIds(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ exercise_id: exerciseFavorites.exercise_id })
      .from(exerciseFavorites)
      .where(
        and(eq(exerciseFavorites.user_id, userId), isNull(exerciseFavorites.deleted_at))
      )
      .all();
    return new Set(rows.map((r) => r.exercise_id));
  }

  /**
   * Favourite / un-favourite. `null` when the exercise is not in the catalogue.
   *
   * Un-favouriting SOFT deletes so the change carries on the sync cursor, and
   * re-favouriting REVIVES the same row instead of inserting a second one — the
   * (user_id, exercise_id) unique index would reject that anyway, and a
   * tombstone per toggle would grow without bound.
   */
  async setFavorite(
    userId: string,
    exerciseId: string,
    isFavorite: boolean
  ): Promise<ExerciseView | null> {
    const exists = await this.db
      .select({ id: exerciseLibrary.id })
      .from(exerciseLibrary)
      .where(and(eq(exerciseLibrary.id, exerciseId), isNull(exerciseLibrary.deleted_at)))
      .get();
    if (!exists) return null;

    const ts = nowIso();
    const existing = await this.db
      .select()
      .from(exerciseFavorites)
      .where(
        and(
          eq(exerciseFavorites.user_id, userId),
          eq(exerciseFavorites.exercise_id, exerciseId)
        )
      )
      .get();

    if (existing) {
      await this.db
        .update(exerciseFavorites)
        .set({ deleted_at: isFavorite ? null : ts, updated_at: ts })
        .where(eq(exerciseFavorites.id, existing.id))
        .run();
    } else if (isFavorite) {
      await this.db
        .insert(exerciseFavorites)
        .values({
          id: newId('exfav'),
          user_id: userId,
          exercise_id: exerciseId,
          created_at: ts,
          updated_at: ts,
          deleted_at: null,
        })
        .run();
    }
    // Un-favouriting something that was never a favourite writes nothing — an
    // empty tombstone would be a row that describes an event that never happened.

    return this.getExercise(userId, exerciseId);
  }
}

/* ==================================================================== */
/* Row → view                                                            */
/* ==================================================================== */

/** Default ordering: safe first, then favourites, then alphabetical. */
export function compareExercises(a: ExerciseView, b: ExerciseView): number {
  return (
    injuryRank(a.injury_flag) - injuryRank(b.injury_flag) ||
    Number(b.is_favorite) - Number(a.is_favorite) ||
    a.name.localeCompare(b.name)
  );
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return MAX_EXERCISE_RESULTS;
  return Math.min(Math.floor(limit), MAX_EXERCISE_RESULTS);
}

export function toView(
  row: ExerciseRow,
  favorites: ReadonlySet<string>,
  activeParts: readonly ActiveInjuryPart[]
): ExerciseView {
  const footprint: ExerciseFootprint = {
    muscle_groups: parseTokenArray(row.muscle_groups),
    secondary_muscles: parseTokenArray(row.secondary_muscles),
    body_parts: parseTokenArray(row.body_parts),
  };
  const verdict = injuryVerdictFor(footprint, activeParts);

  return {
    id: row.id,
    name: row.name,
    aliases: parseTokenArray(row.aliases),
    category: normalizeToken(row.category),
    ...footprint,
    equipment: parseTokenArray(row.equipment),
    difficulty: normalizeToken(row.difficulty),
    difficulty_level: difficultyLevelOf(row.difficulty),
    instructions: row.instructions ?? null,
    illustration: row.illustration ?? null,
    media_url: row.media_url ?? null,
    default_minutes: row.default_minutes,
    workout_type: row.workout_type,
    is_favorite: favorites.has(row.id),
    injury_flag: verdict.flag,
    injury_body_parts: verdict.body_parts,
    updated_at: row.updated_at,
  };
}
