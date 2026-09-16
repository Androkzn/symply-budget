import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — WORKOUT LIBRARY ============
// Columns match backend/migrations/0123_health_exercise_library.sql EXACTLY.
// Ported from the donor Worker's `exercise_library` (006_video_analysis.sql +
// 013_yoga_mobility_exercises.sql); the donor's VIDEO tables are P4 media and
// deliberately absent.
//
// NOT re-exported from schema.ts — hand-written SQL migrations, same as
// schema-health.ts / schema-health-p2.ts and the budget domains.

/** The five-star scale of donor migration 008_difficulty_levels.sql. */
export const EXERCISE_DIFFICULTIES = [
  'level1',
  'level2',
  'level3',
  'level4',
  'level5',
] as const;
export type ExerciseDifficulty = (typeof EXERCISE_DIFFICULTIES)[number];

export const EXERCISE_CATEGORIES = [
  'strength',
  'cardio',
  'yoga',
  'stretching',
  'mobility',
  'rehabilitation',
  'recovery',
] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

/**
 * The GLOBAL exercise catalogue.
 *
 * No `user_id`: the rows are authored in migrations and are the same for every
 * account, which is why the HTTP surface exposes them read-only. Personalisation
 * lives entirely in `exerciseFavorites` below.
 *
 * The JSON-array columns (`aliases`, `muscle_groups`, `secondary_muscles`,
 * `equipment`, `body_parts`) are stored as TEXT exactly as the donor stored them
 * — D1 has no array type, and the service is the only thing that parses them.
 */
export const exerciseLibrary = sqliteTable(
  'exercise_library',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** JSON array of search synonyms — "press up" must find "Push-up". */
    aliases: text('aliases').notNull().default('[]'),
    category: text('category').notNull(),
    /** JSON array of the muscle tokens this movement loads FIRST. */
    muscle_groups: text('muscle_groups').notNull().default('[]'),
    secondary_muscles: text('secondary_muscles').notNull().default('[]'),
    equipment: text('equipment').notNull().default('[]'),
    /**
     * JSON array of JOINT tokens (knee, wrist, shoulder …).
     *
     * The injury gate reads `/health/injuries/active-body-parts`, whose
     * vocabulary is joints, not muscles — without this a wrist injury could not
     * flag a push-up, whose muscles are chest/triceps.
     */
    body_parts: text('body_parts').notNull().default('[]'),
    difficulty: text('difficulty').notNull().default('level1'),
    instructions: text('instructions'),
    /** Symply Health icon-kit key; the Ionicons fallback covers a miss. */
    illustration: text('illustration'),
    /** Donor `video_reference_url`. P4 media lands here; seeded NULL. */
    media_url: text('media_url'),
    default_minutes: integer('default_minutes').notNull().default(10),
    /** Mirrors the app's WorkoutType so "log this" can post a valid session. */
    workout_type: text('workout_type').notNull().default('strength'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    category: index('idx_exercise_library_category').on(t.category),
    difficulty: index('idx_exercise_library_difficulty').on(t.difficulty),
    name: index('idx_exercise_library_name').on(t.name),
  })
);

/**
 * A user's favourite exercises.
 *
 * Un-favouriting SOFT deletes (`deleted_at` + `updated_at`) so the delete
 * propagates on the next sync pull; re-favouriting resurrects the SAME row
 * through the (user_id, exercise_id) unique index rather than piling up one
 * tombstone per toggle.
 */
export const exerciseFavorites = sqliteTable(
  'exercise_favorites',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    exercise_id: text('exercise_id')
      .notNull()
      .references(() => exerciseLibrary.id, { onDelete: 'cascade' }),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_exercise_favorites_user').on(t.user_id, t.deleted_at),
    sync: index('idx_exercise_favorites_sync').on(t.user_id, t.updated_at),
    unique: unique('exercise_favorites_user_exercise').on(t.user_id, t.exercise_id),
  })
);
