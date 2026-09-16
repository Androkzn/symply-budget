import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { users } from './schema';

// ============ SYMPLY HEALTH — parity phase P2 ============
// Columns match backend/migrations/0120_health_p2.sql EXACTLY. Ported from the
// donor Worker; see documents/apps/symply-health/PARITY_PLAN.md §2.
//
// NOT re-exported from schema.ts — hand-written SQL migrations, same as
// schema-health.ts and the budget/savings/mortgage domains.

export const userFiles = sqliteTable(
  'user_files',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    file_name: text('file_name').notNull(),
    // 'photo' | 'document' | 'body_photo'
    file_type: text('file_type').notNull(),
    mime_type: text('mime_type').notNull(),
    file_size: integer('file_size').notNull(),
    /** R2 object key — never a public URL. */
    storage_key: text('storage_key').notNull(),
    thumbnail_key: text('thumbnail_key'),
    category: text('category'),
    metadata: text('metadata'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_user_files_user').on(t.user_id, t.file_type),
    sync: index('idx_user_files_sync').on(t.user_id, t.updated_at),
  })
);

/**
 * A user's own food database.
 *
 * `base_*_per_100` is the exact basis: the donor derives a logged portion from
 * the per-100g values rather than scaling an already-rounded serving, so
 * repeated portioning does not compound rounding error.
 */
export const customFoods = sqliteTable(
  'custom_foods',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brand_name: text('brand_name'),
    portion: real('portion').notNull().default(100),
    unit: text('unit').notNull().default('g'),
    calories: real('calories').notNull(),
    proteins: real('proteins').notNull().default(0),
    carbohydrates: real('carbohydrates').notNull().default(0),
    fats: real('fats').notNull().default(0),
    base_calories_per_100: real('base_calories_per_100').notNull(),
    base_proteins_per_100: real('base_proteins_per_100').notNull().default(0),
    base_carbs_per_100: real('base_carbs_per_100').notNull().default(0),
    base_fats_per_100: real('base_fats_per_100').notNull().default(0),
    category: text('category'),
    barcode: text('barcode'),
    is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    use_count: integer('use_count').notNull().default(0),
    last_used_at: text('last_used_at'),
    /** JSON array of meal slots this food is usually eaten in. */
    preferred_meal_types: text('preferred_meal_types').notNull().default('[]'),
    // 'manual' | 'scanned' | 'imported' | 'shared' | 'recipe'
    source_type: text('source_type').notNull().default('manual'),
    source_recipe_id: text('source_recipe_id'),
    /**
     * Which external food database this row was imported from ('fatsecret'),
     * and that database's own id for it — migration 0127. NULL for every food
     * the user typed, scanned or converted from a recipe. The pair is what makes
     * "import the same food twice" one row instead of two; see the migration
     * header for why the donor could not do this.
     */
    external_source: text('external_source'),
    external_id: text('external_id'),
    is_shared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
    share_code: text('share_code'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_custom_foods_user').on(t.user_id, t.is_favorite, t.use_count),
    barcode: index('idx_custom_foods_barcode').on(t.user_id, t.barcode),
    sync: index('idx_custom_foods_sync').on(t.user_id, t.updated_at),
    external: index('idx_custom_foods_external').on(t.user_id, t.external_source, t.external_id),
  })
);

export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** JSON array of ingredients; totals are recomputed server-side from it. */
    ingredients: text('ingredients').notNull().default('[]'),
    servings: integer('servings').notNull().default(1),
    total_calories: real('total_calories').notNull().default(0),
    total_proteins: real('total_proteins').notNull().default(0),
    total_carbohydrates: real('total_carbohydrates').notNull().default(0),
    total_fats: real('total_fats').notNull().default(0),
    preparation_time: integer('preparation_time'),
    cooking_time: integer('cooking_time'),
    instructions: text('instructions'),
    image_url: text('image_url'),
    category: text('category'),
    tags: text('tags').notNull().default('[]'),
    is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    use_count: integer('use_count').notNull().default(0),
    last_used_at: text('last_used_at'),
    is_shared: integer('is_shared', { mode: 'boolean' }).notNull().default(false),
    share_code: text('share_code'),
    ai_calculated: integer('ai_calculated', { mode: 'boolean' }).notNull().default(false),
    ai_confidence: real('ai_confidence'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_recipes_user').on(t.user_id, t.is_favorite, t.use_count),
    sync: index('idx_recipes_sync').on(t.user_id, t.updated_at),
  })
);

/** Backs "what you usually eat at this time of day". */
export const foodUsageHistory = sqliteTable(
  'food_usage_history',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    food_id: text('food_id').notNull(),
    food_name: text('food_name').notNull(),
    used_at: text('used_at').notNull(),
    meal_type: text('meal_type').notNull(),
    // 'morning' | 'midday' | 'afternoon' | 'evening' | 'night'
    time_of_day: text('time_of_day').notNull(),
  },
  (t) => ({ user: index('idx_food_usage_user').on(t.user_id, t.used_at) })
);

/** An ACTIVE injury must suppress exercises that load the affected part. */
export const injuries = sqliteTable(
  'injuries',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    body_part: text('body_part').notNull(),
    /** 0–4 (donor scale). */
    pain_level: integer('pain_level').notNull(),
    injury_type: text('injury_type').notNull().default('pain'),
    cause: text('cause'),
    muscle_group: text('muscle_group'),
    notes: text('notes'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_injuries_user').on(t.user_id, t.is_active, t.date),
    sync: index('idx_injuries_sync').on(t.user_id, t.updated_at),
  })
);

export const activityNotificationPreferences = sqliteTable('activity_notification_preferences', {
  user_id: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  notify_recipe_created: integer('notify_recipe_created', { mode: 'boolean' }).notNull().default(true),
  notify_recipe_updated: integer('notify_recipe_updated', { mode: 'boolean' }).notNull().default(false),
  notify_custom_food_created: integer('notify_custom_food_created', { mode: 'boolean' }).notNull().default(true),
  notify_workout_video_shared: integer('notify_workout_video_shared', { mode: 'boolean' }).notNull().default(true),
  notify_photo_shared: integer('notify_photo_shared', { mode: 'boolean' }).notNull().default(true),
  notify_milestone_achieved: integer('notify_milestone_achieved', { mode: 'boolean' }).notNull().default(true),
  notify_community_recipe_created: integer('notify_community_recipe_created', { mode: 'boolean' }).notNull().default(false),
  notify_community_achievement: integer('notify_community_achievement', { mode: 'boolean' }).notNull().default(false),
  receive_push_notifications: integer('receive_push_notifications', { mode: 'boolean' }).notNull().default(true),
  receive_inapp_notifications: integer('receive_inapp_notifications', { mode: 'boolean' }).notNull().default(true),
  /**
   * JSON-encoded array of workout-type slugs (`WorkoutType` in
   * `src/features/health/healthWorkoutTypes.ts`) the member starred in the
   * workout-type picker — donor `FavouriteWorkoutTypesManager`. NULL until the
   * member favourites their first type. Deliberately NOT one of the ten
   * boolean columns above: this is a curated LIST, not a flag, and workout
   * types are a fixed 61-entry client vocabulary rather than DB rows, so there
   * is nothing to hang a per-row `is_favorite` column off. Read/written as its
   * own field in `health-body-extras-service.ts`, outside the
   * ACTIVITY_PREFERENCE_FIELDS boolean loop.
   */
  favourite_workout_types: text('favourite_workout_types'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const widgetPreferences = sqliteTable('widget_preferences', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  small_widget_metric: text('small_widget_metric').notNull().default('steps'),
  chart_type: text('chart_type').notNull().default('bar'),
  chart_metric: text('chart_metric').notNull().default('weight'),
  show_weight: integer('show_weight', { mode: 'boolean' }).notNull().default(true),
  show_nutrition: integer('show_nutrition', { mode: 'boolean' }).notNull().default(true),
  show_workouts: integer('show_workouts', { mode: 'boolean' }).notNull().default(true),
  // Layout — added by migration 0144. `small_widget_metric` etc. above say WHAT
  // the widget shows; these say HOW the Small/Medium families are arranged.
  small_widget_style: text('small_widget_style').notNull().default('standard'),
  medium_widget_layout: text('medium_widget_layout').notNull().default('standard'),
  medium_primary_metric: text('medium_primary_metric').notNull().default('steps'),
  medium_secondary_metric: text('medium_secondary_metric').notNull().default('calories'),
  medium_show_all_metrics: integer('medium_show_all_metrics', { mode: 'boolean' })
    .notNull()
    .default(true),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

/** Donor stored epoch INTEGERs; normalised to ISO TEXT so one sync cursor works. */
export const fridgeItems = sqliteTable(
  'fridge_items',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: real('quantity'),
    unit: text('unit'),
    category: text('category'),
    expiry_date: text('expiry_date'),
    is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    nutrition_json: text('nutrition_json'),
    // 'manual' | 'scan' | 'receipt' | 'photo'
    source: text('source').notNull().default('manual'),
    image_url: text('image_url'),
    notes: text('notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({
    user: index('idx_fridge_user').on(t.user_id, t.expiry_date),
    sync: index('idx_fridge_sync').on(t.user_id, t.updated_at),
  })
);

export const bodyPhotoInsights = sqliteTable(
  'body_photo_insights',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    photo_id: text('photo_id').notNull().references(() => userFiles.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    // 'front' | 'back' | 'leftSide' | 'rightSide'
    angle: text('angle').notNull(),
    posture_score: real('posture_score'),
    posture_head_alignment: text('posture_head_alignment'),
    posture_shoulder_alignment: text('posture_shoulder_alignment'),
    posture_spine_alignment: text('posture_spine_alignment'),
    posture_hip_alignment: text('posture_hip_alignment'),
    posture_notes: text('posture_notes'),
    symmetry_overall: real('symmetry_overall'),
    symmetry_shoulder: real('symmetry_shoulder'),
    symmetry_arm: real('symmetry_arm'),
    symmetry_leg: real('symmetry_leg'),
    symmetry_observations: text('symmetry_observations'),
    body_fat_lower: real('body_fat_lower'),
    body_fat_upper: real('body_fat_upper'),
    body_fat_category: text('body_fat_category'),
    muscle_definition_score: real('muscle_definition_score'),
    visible_muscles: text('visible_muscles'),
    analysis_provider: text('analysis_provider'),
    analysis_confidence: real('analysis_confidence'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({ user: index('idx_body_photo_insights_user').on(t.user_id, t.date) })
);

export const bodyComprehensiveInsights = sqliteTable(
  'body_comprehensive_insights',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    front_photo_id: text('front_photo_id'),
    back_photo_id: text('back_photo_id'),
    left_side_photo_id: text('left_side_photo_id'),
    right_side_photo_id: text('right_side_photo_id'),
    overall_posture_score: real('overall_posture_score'),
    posture_strengths: text('posture_strengths'),
    posture_concerns: text('posture_concerns'),
    posture_recommendations: text('posture_recommendations'),
    overall_symmetry_score: real('overall_symmetry_score'),
    symmetry_findings: text('symmetry_findings'),
    body_fat_estimate_lower: real('body_fat_estimate_lower'),
    body_fat_estimate_upper: real('body_fat_estimate_upper'),
    body_fat_category: text('body_fat_category'),
    lean_mass_estimate: real('lean_mass_estimate'),
    muscle_balance_score: real('muscle_balance_score'),
    muscle_development_front: text('muscle_development_front'),
    muscle_development_back: text('muscle_development_back'),
    muscle_development_sides: text('muscle_development_sides'),
    areas_of_improvement: text('areas_of_improvement'),
    strengths: text('strengths'),
    recommended_focus_areas: text('recommended_focus_areas'),
    analysis_provider: text('analysis_provider'),
    analysis_confidence: real('analysis_confidence'),
    processing_notes: text('processing_notes'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    deleted_at: text('deleted_at'),
  },
  (t) => ({ user: index('idx_body_insights_user').on(t.user_id, t.date) })
);
