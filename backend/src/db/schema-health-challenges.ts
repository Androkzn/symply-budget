import { index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — personal FOOD CHALLENGES ============
// Columns match backend/migrations/0136_food_challenges.sql EXACTLY. Ported from
// the donor Worker (`~/Desktop/Symply Ecosystem/Simply Health/backend/`); see
// that migration's header for the full donor mapping and deviations.
//
// NOT re-exported from schema.ts — hand-written SQL migration, same convention
// as every other schema-health-*.ts sibling in this domain.
//
// NAMING: this is a COMPLETELY DIFFERENT feature from `health_challenges` /
// `health_challenge_participants` / `health_challenge_progress` in
// `schema-health-social.ts` (multi-user, joinable, family-accountability
// challenges). These tables are PERSONAL per-user food-gram targets (donor
// `food_challenges` / `challenge_progress` / `challenge_achievements`). The DB
// table names do not collide (donor never called its table `health_challenges`),
// but the Drizzle export names are deliberately prefixed `food*` / disambiguated
// so nobody greps `Challenge` and wires the wrong table into a route.

/** A personal food-gram target — "Eat 1000g vegetables this week" (donor `036`). */
export const foodChallenges = sqliteTable(
  'food_challenges',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 'vegetables' | 'fruits' | 'fish' | 'seafood' | 'meat' | 'dairy' | 'grains' | 'legumes' | 'nuts' | 'custom_ingredient' | NULL. */
    target_category: text('target_category'),
    /** Specific ingredient name for a `custom_ingredient` challenge, e.g. 'Avocado'. */
    target_food_name: text('target_food_name'),
    target_amount_grams: real('target_amount_grams').notNull(),
    /** 'daily' | 'weekly'. */
    frequency: text('frequency').notNull(),
    start_date: text('start_date').notNull(),
    end_date: text('end_date'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** Emoji the member picked for this challenge (donor `050`). NULL = default icon. */
    custom_icon: text('custom_icon'),
    current_streak: integer('current_streak').notNull().default(0),
    longest_streak: integer('longest_streak').notNull().default(0),
    total_completions: integer('total_completions').notNull().default(0),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    // NO deleted_at — donor hard-deletes these tables (041/049). See migration header.
  },
  (t) => ({
    userActive: index('idx_food_challenges_user_active').on(t.user_id, t.is_active),
    userStart: index('idx_food_challenges_user_start').on(t.user_id, t.start_date),
    sync: index('idx_food_challenges_sync').on(t.user_id, t.updated_at),
  })
);

/** One row per (challenge, day) — the cache `GET /challenges/progress/today` upserts into. */
export const foodChallengeProgress = sqliteTable(
  'challenge_progress',
  {
    id: text('id').primaryKey(),
    challenge_id: text('challenge_id')
      .notNull()
      .references(() => foodChallenges.id, { onDelete: 'cascade' }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    consumed_grams: real('consumed_grams').notNull().default(0),
    target_grams: real('target_grams').notNull(),
    is_completed: integer('is_completed', { mode: 'boolean' }).notNull().default(false),
    /** JSON array of {food_name, grams, confidence} — what matched, for the UI to explain the number. */
    matched_foods: text('matched_foods').notNull().default('[]'),
    last_updated_at: text('last_updated_at').notNull(),
  },
  (t) => ({
    // FULL unique (not partial — there is no deleted_at to filter on), required
    // for the `ON CONFLICT(challenge_id, date)` upsert every progress write uses.
    uniqueDay: unique().on(t.challenge_id, t.date),
    userDate: index('idx_challenge_progress_user_date').on(t.user_id, t.date),
    challenge: index('idx_challenge_progress_challenge').on(t.challenge_id),
  })
);

/** Unlocked milestones — 'first_completion' | 'streak_3' | 'streak_7' | 'streak_30' | 'weekly_complete' | '<category>_master' | 'daily_perfect'. */
export const foodChallengeAchievements = sqliteTable(
  'challenge_achievements',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievement_type: text('achievement_type').notNull(),
    /** Which challenge triggered it, or NULL for an account-wide achievement (e.g. `daily_perfect`). */
    challenge_id: text('challenge_id').references(() => foodChallenges.id, { onDelete: 'set null' }),
    unlocked_at: text('unlocked_at').notNull(),
  },
  (t) => ({
    uniqueType: unique().on(t.user_id, t.achievement_type),
    user: index('idx_challenge_achievements_user').on(t.user_id),
  })
);

/**
 * Deterministic food→category pattern table (donor `036`, seeded verbatim).
 * `food-category-detector.ts` substring-matches (then Levenshtein-fuzzy-matches)
 * a logged food name against these rows to set `nutrition_entries.detected_category`.
 * Global, not per-user — the same ~115 rows every account reads.
 */
export const foodCategoryMappings = sqliteTable(
  'food_category_mappings',
  {
    id: text('id').primaryKey(),
    /** Lowercase substring, e.g. 'broccoli'. */
    food_name_pattern: text('food_name_pattern').notNull(),
    category: text('category').notNull(),
    confidence: real('confidence').notNull().default(1.0),
    created_at: text('created_at').notNull(),
  },
  (t) => ({
    pattern: index('idx_food_category_mappings_pattern').on(t.food_name_pattern),
  })
);
