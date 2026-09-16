import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import {
  activityNotificationPreferences,
  bodyComprehensiveInsights,
  bodyPhotoInsights,
  injuries,
  userFiles,
} from '../db/schema-health-p2';

/**
 * Symply Health — parity phase P2, `body-extras` domain service.
 *
 * Owns three donor surfaces that all hang off the same personal (never
 * household) user scope:
 *   - INJURIES — the log that gates workout suggestions,
 *   - ACTIVITY NOTIFICATION PREFERENCES — one row per user, `user_id` IS the PK,
 *   - BODY INSIGHTS — AI-produced posture/symmetry/composition analyses.
 *
 * THIN CLIENT, as in `health-service.ts`: every derived figure (the distinct
 * active-body-part set, the preference defaults) is computed HERE so the phone,
 * the widget and any future coach agree on one answer.
 *
 * DELETE IS SOFT everywhere (`deleted_at`), because the delta-sync cursor pulls
 * by `updated_at` — a hard delete would resurrect the row on the next pull from
 * another device.
 *
 * RESOLVE IS NOT DELETE. `is_active = false` means the injury HEALED: it drops
 * out of the workout gate but stays fully readable as history. Deleting is the
 * separate, soft operation that removes it from the log entirely.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Drop keys the caller never sent so a PATCH-shaped body cannot null a column. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/* ------------------------------------------------------------------ */
/* Injuries                                                            */
/* ------------------------------------------------------------------ */

/** Donor scale — 0 (none) … 4 (severe). Enforced by zod AND a DDL CHECK. */
export const MIN_PAIN_LEVEL = 0;
export const MAX_PAIN_LEVEL = 4;

export interface InjuryInput {
  date?: string;
  body_part: string;
  pain_level?: number;
  injury_type?: string;
  cause?: string | null;
  muscle_group?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface InjuryPatch {
  date?: string;
  body_part?: string;
  pain_level?: number;
  injury_type?: string;
  cause?: string | null;
  muscle_group?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface InjuryQuery {
  /** `true` = only live injuries, `false` = only resolved ones, omitted = both. */
  active?: boolean;
  body_part?: string;
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** One row of the workout-suppression set. */
export interface ActiveBodyPart {
  body_part: string;
  /** Worst live pain on that part — a caller may suppress harder above a bound. */
  max_pain_level: number;
  injury_count: number;
  /** Distinct non-null muscle groups, for suggesters that gate by group. */
  muscle_groups: string[];
}

/* ------------------------------------------------------------------ */
/* Activity notification preferences                                   */
/* ------------------------------------------------------------------ */

/**
 * Donor defaults (migration 0120 / donor `074_activity_notification_preferences`).
 *
 * Written out in full on the first save rather than left to the DDL defaults, so
 * this constant is the single source of truth for both the unsaved read and the
 * stored row — the two can never drift.
 */
export const ACTIVITY_PREFERENCE_DEFAULTS = {
  notify_recipe_created: true,
  notify_recipe_updated: false,
  notify_custom_food_created: true,
  notify_workout_video_shared: true,
  notify_photo_shared: true,
  notify_milestone_achieved: true,
  // Community traffic is opt-IN: it is the only class of notification generated
  // by strangers rather than by the user's own household.
  notify_community_recipe_created: false,
  notify_community_achievement: false,
  receive_push_notifications: true,
  receive_inapp_notifications: true,
} as const;

export type ActivityPreferenceFlags = {
  -readonly [K in keyof typeof ACTIVITY_PREFERENCE_DEFAULTS]: boolean;
};

export const ACTIVITY_PREFERENCE_FIELDS = Object.keys(
  ACTIVITY_PREFERENCE_DEFAULTS
) as Array<keyof ActivityPreferenceFlags>;

export type ActivityPreferences = ActivityPreferenceFlags & {
  user_id: string;
  /** null until the user has actually saved a preference. */
  created_at: string | null;
  updated_at: string | null;
  /**
   * Starred `WorkoutType` slugs from the RN workout-type picker (donor
   * `FavouriteWorkoutTypesManager`). NOT one of the ten
   * ACTIVITY_PREFERENCE_FIELDS booleans above — a curated list, not a flag —
   * so it is read and written outside that loop. Never null on the wire: an
   * unsaved account and a saved-but-empty one both read `[]`.
   */
  favourite_workout_types: string[];
};

/**
 * `favourite_workout_types` is stored as a JSON-encoded array of strings.
 * Never throws: a corrupt or foreign blob (an older build, a hand-edited row)
 * degrades to an empty list rather than 500ing the whole preferences read.
 */
function parseFavouriteWorkoutTypes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Body insights (AI-produced — stored + read here, produced in P3)     */
/* ------------------------------------------------------------------ */

export const BODY_PHOTO_ANGLES = ['front', 'back', 'leftSide', 'rightSide'] as const;
export type BodyPhotoAngle = (typeof BODY_PHOTO_ANGLES)[number];

export interface PhotoInsightInput {
  id?: string;
  photo_id: string;
  date: string;
  angle: BodyPhotoAngle;
  posture_score?: number | null;
  posture_head_alignment?: string | null;
  posture_shoulder_alignment?: string | null;
  posture_spine_alignment?: string | null;
  posture_hip_alignment?: string | null;
  posture_notes?: string | null;
  symmetry_overall?: number | null;
  symmetry_shoulder?: number | null;
  symmetry_arm?: number | null;
  symmetry_leg?: number | null;
  symmetry_observations?: string | null;
  body_fat_lower?: number | null;
  body_fat_upper?: number | null;
  body_fat_category?: string | null;
  muscle_definition_score?: number | null;
  visible_muscles?: string | null;
  analysis_provider?: string | null;
  analysis_confidence?: number | null;
}

export interface ComprehensiveInsightInput {
  id?: string;
  date: string;
  front_photo_id?: string | null;
  back_photo_id?: string | null;
  left_side_photo_id?: string | null;
  right_side_photo_id?: string | null;
  overall_posture_score?: number | null;
  posture_strengths?: string | null;
  posture_concerns?: string | null;
  posture_recommendations?: string | null;
  overall_symmetry_score?: number | null;
  symmetry_findings?: string | null;
  body_fat_estimate_lower?: number | null;
  body_fat_estimate_upper?: number | null;
  body_fat_category?: string | null;
  lean_mass_estimate?: number | null;
  muscle_balance_score?: number | null;
  muscle_development_front?: string | null;
  muscle_development_back?: string | null;
  muscle_development_sides?: string | null;
  areas_of_improvement?: string | null;
  strengths?: string | null;
  recommended_focus_areas?: string | null;
  analysis_provider?: string | null;
  analysis_confidence?: number | null;
  processing_notes?: string | null;
}

export class HealthBodyExtrasService {
  private db: DrizzleD1Database;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  /* ---------------------------------------------------------------- */
  /* Injuries                                                          */
  /* ---------------------------------------------------------------- */

  async listInjuries(userId: string, opts: InjuryQuery = {}) {
    const conds = [eq(injuries.user_id, userId), isNull(injuries.deleted_at)];
    if (opts.active !== undefined) conds.push(eq(injuries.is_active, opts.active));
    if (opts.body_part) conds.push(eq(injuries.body_part, opts.body_part));
    if (opts.date) conds.push(eq(injuries.date, opts.date));
    if (opts.from) conds.push(gte(injuries.date, opts.from));
    if (opts.to) conds.push(lte(injuries.date, opts.to));
    return this.db
      .select()
      .from(injuries)
      .where(and(...conds))
      .orderBy(desc(injuries.date), desc(injuries.created_at))
      .limit(opts.limit ?? 200)
      .all();
  }

  /** Live row, scoped to its owner. Soft-deleted rows are invisible here. */
  private async findInjury(userId: string, id: string) {
    return this.db
      .select()
      .from(injuries)
      .where(
        and(eq(injuries.id, id), eq(injuries.user_id, userId), isNull(injuries.deleted_at))
      )
      .get();
  }

  async createInjury(userId: string, input: InjuryInput) {
    const ts = nowIso();
    const row = {
      id: newId('inj'),
      user_id: userId,
      date: input.date ?? today(),
      body_part: input.body_part,
      // Donor default: a logged injury with no stated pain is still a mild one.
      pain_level: input.pain_level ?? 1,
      injury_type: input.injury_type ?? 'pain',
      cause: input.cause ?? null,
      muscle_group: input.muscle_group ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active ?? true,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };
    await this.db.insert(injuries).values(row).run();
    return row;
  }

  /** Returns null for an unknown id, another user's id, or a deleted row. */
  async updateInjury(userId: string, id: string, patch: InjuryPatch) {
    const existing = await this.findInjury(userId, id);
    if (!existing) return null;
    const next = { ...existing, ...definedOnly(patch), updated_at: nowIso() };
    await this.db
      .update(injuries)
      .set(next)
      .where(and(eq(injuries.id, id), eq(injuries.user_id, userId)))
      .run();
    return next;
  }

  /**
   * The injury HEALED — it leaves the workout gate but stays in history.
   *
   * Idempotent: resolving an already-resolved injury just re-stamps
   * `updated_at` so the sync cursor still carries the change.
   */
  async resolveInjury(userId: string, id: string) {
    const existing = await this.findInjury(userId, id);
    if (!existing) return null;
    const ts = nowIso();
    await this.db
      .update(injuries)
      .set({ is_active: false, updated_at: ts })
      .where(and(eq(injuries.id, id), eq(injuries.user_id, userId)))
      .run();
    return { ...existing, is_active: false, updated_at: ts };
  }

  /** Soft delete — the tombstone is what makes the delete propagate on sync. */
  async deleteInjury(userId: string, id: string) {
    const ts = nowIso();
    const res = await this.db
      .update(injuries)
      .set({ deleted_at: ts, updated_at: ts })
      .where(
        and(eq(injuries.id, id), eq(injuries.user_id, userId), isNull(injuries.deleted_at))
      )
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  /**
   * SAFETY SURFACE — the distinct body parts a workout suggester must avoid.
   *
   * Deliberately conservative in one direction only: a STALE active injury keeps
   * suppressing exercises until the user resolves or deletes it. The two ways a
   * part leaves the set are therefore explicit user acts:
   *   - `resolveInjury` (healed), and
   *   - `deleteInjury` (removed from the log).
   *
   * Grouped in JS rather than SQL: a person carries a handful of injuries, and
   * this keeps the tie-break ordering identical to what the client would compute.
   */
  async activeBodyParts(userId: string): Promise<ActiveBodyPart[]> {
    const rows = await this.db
      .select()
      .from(injuries)
      .where(
        and(
          eq(injuries.user_id, userId),
          eq(injuries.is_active, true),
          isNull(injuries.deleted_at)
        )
      )
      .all();

    const grouped = new Map<string, ActiveBodyPart & { groups: Set<string> }>();
    for (const row of rows) {
      const entry = grouped.get(row.body_part) ?? {
        body_part: row.body_part,
        max_pain_level: row.pain_level,
        injury_count: 0,
        muscle_groups: [],
        groups: new Set<string>(),
      };
      entry.max_pain_level = Math.max(entry.max_pain_level, row.pain_level);
      entry.injury_count += 1;
      if (row.muscle_group) entry.groups.add(row.muscle_group);
      grouped.set(row.body_part, entry);
    }

    return [...grouped.values()]
      .map(({ groups, ...part }) => ({ ...part, muscle_groups: [...groups].sort() }))
      .sort(
        (a, b) =>
          b.max_pain_level - a.max_pain_level || a.body_part.localeCompare(b.body_part)
      );
  }

  /* ---------------------------------------------------------------- */
  /* Activity notification preferences                                 */
  /* ---------------------------------------------------------------- */

  /**
   * `activity_notification_preferences.user_id` is the PRIMARY KEY — there is no
   * `id` column and at most one row per user. An unsaved user reads the donor
   * defaults rather than a null, so the settings screen never renders blank
   * toggles.
   */
  async getActivityPreferences(userId: string): Promise<ActivityPreferences> {
    const row = await this.db
      .select()
      .from(activityNotificationPreferences)
      .where(eq(activityNotificationPreferences.user_id, userId))
      .get();

    if (!row) {
      return {
        user_id: userId,
        ...ACTIVITY_PREFERENCE_DEFAULTS,
        favourite_workout_types: [],
        created_at: null,
        updated_at: null,
      };
    }

    const flags = {} as ActivityPreferenceFlags;
    for (const field of ACTIVITY_PREFERENCE_FIELDS) {
      // Stored as INTEGER 0/1; `!!` keeps the client contract boolean-only.
      flags[field] = !!row[field];
    }
    return {
      user_id: row.user_id,
      ...flags,
      favourite_workout_types: parseFavouriteWorkoutTypes(row.favourite_workout_types),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /**
   * Upsert keyed on `user_id`. PARTIAL: a field the caller omitted keeps its
   * stored value, so a settings screen can send one toggle at a time —
   * `favourite_workout_types` follows the same rule as the ten booleans:
   * omitted keeps the stored list, an explicit (possibly empty) array replaces
   * it wholesale.
   */
  async saveActivityPreferences(
    userId: string,
    patch: Partial<ActivityPreferenceFlags> & { favourite_workout_types?: string[] }
  ): Promise<ActivityPreferences> {
    const ts = nowIso();
    const clean: Partial<ActivityPreferenceFlags> = {};
    for (const field of ACTIVITY_PREFERENCE_FIELDS) {
      const value = patch[field];
      if (value !== undefined) clean[field] = value;
    }

    // Own field, own encoding — not one of the ten booleans in `clean`.
    const favourites: { favourite_workout_types?: string } = {};
    if (patch.favourite_workout_types !== undefined) {
      favourites.favourite_workout_types = JSON.stringify(patch.favourite_workout_types);
    }

    await this.db
      .insert(activityNotificationPreferences)
      .values({
        user_id: userId,
        ...ACTIVITY_PREFERENCE_DEFAULTS,
        ...clean,
        favourite_workout_types: favourites.favourite_workout_types ?? '[]',
        created_at: ts,
        updated_at: ts,
      })
      .onConflictDoUpdate({
        target: activityNotificationPreferences.user_id,
        // `updated_at` alone when the body was empty — drizzle cannot build an
        // UPDATE with no SET columns.
        set: { ...clean, ...favourites, updated_at: ts },
      })
      .run();

    return this.getActivityPreferences(userId);
  }

  /* ---------------------------------------------------------------- */
  /* Body insights — READ                                              */
  /* ---------------------------------------------------------------- */

  async listComprehensiveInsights(
    userId: string,
    opts: { from?: string; to?: string; limit?: number } = {}
  ) {
    const conds = [
      eq(bodyComprehensiveInsights.user_id, userId),
      isNull(bodyComprehensiveInsights.deleted_at),
    ];
    if (opts.from) conds.push(gte(bodyComprehensiveInsights.date, opts.from));
    if (opts.to) conds.push(lte(bodyComprehensiveInsights.date, opts.to));
    return this.db
      .select()
      .from(bodyComprehensiveInsights)
      .where(and(...conds))
      .orderBy(desc(bodyComprehensiveInsights.date), desc(bodyComprehensiveInsights.created_at))
      .limit(opts.limit ?? 100)
      .all();
  }

  /** Newest analysis, or null — what the Body tab opens on. */
  async latestComprehensiveInsight(userId: string) {
    const [row] = await this.listComprehensiveInsights(userId, { limit: 1 });
    return row ?? null;
  }

  async listPhotoInsights(
    userId: string,
    opts: { photo_id?: string; date?: string; limit?: number } = {}
  ) {
    const conds = [eq(bodyPhotoInsights.user_id, userId), isNull(bodyPhotoInsights.deleted_at)];
    if (opts.photo_id) conds.push(eq(bodyPhotoInsights.photo_id, opts.photo_id));
    if (opts.date) conds.push(eq(bodyPhotoInsights.date, opts.date));
    return this.db
      .select()
      .from(bodyPhotoInsights)
      .where(and(...conds))
      .orderBy(desc(bodyPhotoInsights.date), desc(bodyPhotoInsights.created_at))
      .limit(opts.limit ?? 100)
      .all();
  }

  /* ---------------------------------------------------------------- */
  /* Body insights — INTERNAL WRITE (P3 producer)                      */
  /* ---------------------------------------------------------------- */

  /**
   * Body insights are AI-PRODUCED. P2 stores and reads them; the producer lands
   * in P3 and calls these methods IN-PROCESS.
   *
   * There is deliberately NO client-writable HTTP route: a device that could
   * POST an "AI analysis" would be indistinguishable from the real analyser, and
   * these rows feed body-composition and posture advice. Ownership is still
   * re-checked here so an in-process caller cannot attach an insight to another
   * user's photo.
   *
   * Returns null when the referenced photo is not the user's (or is deleted),
   * and when `id` names a row belonging to someone else.
   */
  async savePhotoInsight(userId: string, input: PhotoInsightInput) {
    if (!(await this.ownsPhoto(userId, input.photo_id))) return null;
    if (input.id && !(await this.ownsInsight(bodyPhotoInsights, userId, input.id))) return null;

    const ts = nowIso();
    const row = {
      id: input.id ?? newId('bpi'),
      user_id: userId,
      photo_id: input.photo_id,
      date: input.date,
      angle: input.angle,
      posture_score: input.posture_score ?? null,
      posture_head_alignment: input.posture_head_alignment ?? null,
      posture_shoulder_alignment: input.posture_shoulder_alignment ?? null,
      posture_spine_alignment: input.posture_spine_alignment ?? null,
      posture_hip_alignment: input.posture_hip_alignment ?? null,
      posture_notes: input.posture_notes ?? null,
      symmetry_overall: input.symmetry_overall ?? null,
      symmetry_shoulder: input.symmetry_shoulder ?? null,
      symmetry_arm: input.symmetry_arm ?? null,
      symmetry_leg: input.symmetry_leg ?? null,
      symmetry_observations: input.symmetry_observations ?? null,
      body_fat_lower: input.body_fat_lower ?? null,
      body_fat_upper: input.body_fat_upper ?? null,
      body_fat_category: input.body_fat_category ?? null,
      muscle_definition_score: input.muscle_definition_score ?? null,
      visible_muscles: input.visible_muscles ?? null,
      analysis_provider: input.analysis_provider ?? null,
      analysis_confidence: input.analysis_confidence ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };

    const { id: _id, created_at: _created, ...mutable } = row;
    await this.db
      .insert(bodyPhotoInsights)
      .values(row)
      .onConflictDoUpdate({ target: bodyPhotoInsights.id, set: mutable })
      .run();
    return row;
  }

  /** See `savePhotoInsight` — same internal-only contract. */
  async saveComprehensiveInsight(userId: string, input: ComprehensiveInsightInput) {
    const photoIds = [
      input.front_photo_id,
      input.back_photo_id,
      input.left_side_photo_id,
      input.right_side_photo_id,
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    for (const photoId of photoIds) {
      if (!(await this.ownsPhoto(userId, photoId))) return null;
    }
    if (input.id && !(await this.ownsInsight(bodyComprehensiveInsights, userId, input.id))) {
      return null;
    }

    const ts = nowIso();
    const row = {
      id: input.id ?? newId('bci'),
      user_id: userId,
      date: input.date,
      front_photo_id: input.front_photo_id ?? null,
      back_photo_id: input.back_photo_id ?? null,
      left_side_photo_id: input.left_side_photo_id ?? null,
      right_side_photo_id: input.right_side_photo_id ?? null,
      overall_posture_score: input.overall_posture_score ?? null,
      posture_strengths: input.posture_strengths ?? null,
      posture_concerns: input.posture_concerns ?? null,
      posture_recommendations: input.posture_recommendations ?? null,
      overall_symmetry_score: input.overall_symmetry_score ?? null,
      symmetry_findings: input.symmetry_findings ?? null,
      body_fat_estimate_lower: input.body_fat_estimate_lower ?? null,
      body_fat_estimate_upper: input.body_fat_estimate_upper ?? null,
      body_fat_category: input.body_fat_category ?? null,
      lean_mass_estimate: input.lean_mass_estimate ?? null,
      muscle_balance_score: input.muscle_balance_score ?? null,
      muscle_development_front: input.muscle_development_front ?? null,
      muscle_development_back: input.muscle_development_back ?? null,
      muscle_development_sides: input.muscle_development_sides ?? null,
      areas_of_improvement: input.areas_of_improvement ?? null,
      strengths: input.strengths ?? null,
      recommended_focus_areas: input.recommended_focus_areas ?? null,
      analysis_provider: input.analysis_provider ?? null,
      analysis_confidence: input.analysis_confidence ?? null,
      processing_notes: input.processing_notes ?? null,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    };

    const { id: _id, created_at: _created, ...mutable } = row;
    await this.db
      .insert(bodyComprehensiveInsights)
      .values(row)
      .onConflictDoUpdate({ target: bodyComprehensiveInsights.id, set: mutable })
      .run();
    return row;
  }

  /** A live `user_files` row owned by this user — the photo the insight is about. */
  private async ownsPhoto(userId: string, photoId: string): Promise<boolean> {
    const file = await this.db
      .select({ id: userFiles.id })
      .from(userFiles)
      .where(
        and(
          eq(userFiles.id, photoId),
          eq(userFiles.user_id, userId),
          isNull(userFiles.deleted_at)
        )
      )
      .get();
    return !!file;
  }

  /** An explicit insight id may only overwrite a row the same user owns. */
  private async ownsInsight(
    table: typeof bodyPhotoInsights | typeof bodyComprehensiveInsights,
    userId: string,
    id: string
  ): Promise<boolean> {
    const existing = await this.db
      .select({ user_id: table.user_id })
      .from(table)
      .where(eq(table.id, id))
      .get();
    return !existing || existing.user_id === userId;
  }
}
