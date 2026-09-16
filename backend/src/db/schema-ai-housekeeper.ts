import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { users, households, tasks, homeFeatures } from './schema';
import { appliances } from './schema-maintenance';

// ============ AI HOUSEKEEPER FEATURE ============

/**
 * User preferences for AI housekeeper personalization
 */
export const aiHousekeeperPreferences = sqliteTable(
  'ai_housekeeper_preferences',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    notification_frequency: text('notification_frequency').notNull().default('daily'), // daily, three_per_week, weekly, disabled
    ai_personality: text('ai_personality').notNull().default('friendly'), // friendly, professional, data_driven
    diy_skill_level: text('diy_skill_level').notNull().default('beginner'), // none, beginner, intermediate, advanced
    budget_preference: text('budget_preference').notNull().default('moderate'), // tight, moderate, flexible
    preferred_learning_style: text('preferred_learning_style').default('article'), // video, article, expert_call
    enable_predictions: integer('enable_predictions', { mode: 'boolean' }).notNull().default(true),
    enable_seasonal_reminders: integer('enable_seasonal_reminders', { mode: 'boolean' }).notNull().default(true),
    enable_cost_insights: integer('enable_cost_insights', { mode: 'boolean' }).notNull().default(true),
    enable_procrastination_nudges: integer('enable_procrastination_nudges', { mode: 'boolean' }).notNull().default(true),
    enable_celebrations: integer('enable_celebrations', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    user_id_idx: index('idx_ai_housekeeper_prefs_user').on(table.user_id),
  })
);

/**
 * AI-generated suggestions for household maintenance
 */
export const aiHousekeeperSuggestions = sqliteTable(
  'ai_housekeeper_suggestions',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    suggestion_type: text('suggestion_type').notNull(), // prediction, seasonal_reminder, cost_optimization, procrastination_nudge, celebration, batching_opportunity
    title: text('title').notNull(),
    description: text('description').notNull(),
    confidence_score: real('confidence_score'), // 0.0 to 1.0
    priority_score: integer('priority_score'), // 1-10
    generated_at: text('generated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    expires_at: text('expires_at'),
    status: text('status').notNull().default('pending'), // pending, accepted, dismissed, snoozed, expired, completed
    user_action_at: text('user_action_at'),
    user_action_by: text('user_action_by').references(() => users.id, { onDelete: 'set null' }),
    user_feedback: text('user_feedback'), // helpful, not_helpful, neutral
    related_task_id: text('related_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    related_feature_ids: text('related_feature_ids'), // JSON array
    related_appliance_ids: text('related_appliance_ids'), // JSON array
    related_finding_ids: text('related_finding_ids'), // JSON array
    ai_reasoning: text('ai_reasoning'),
    data_sources: text('data_sources'), // JSON
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_idx: index('idx_ai_suggestions_household').on(table.household_id),
    status_idx: index('idx_ai_suggestions_status').on(table.status),
    type_idx: index('idx_ai_suggestions_type').on(table.suggestion_type),
    generated_idx: index('idx_ai_suggestions_generated').on(table.generated_at),
    expires_idx: index('idx_ai_suggestions_expires').on(table.expires_at),
  })
);

/**
 * Predictive maintenance forecasts
 */
export const aiMaintenancePredictions = sqliteTable(
  'ai_maintenance_predictions',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    feature_id: text('feature_id').references(() => homeFeatures.id, { onDelete: 'cascade' }),
    appliance_id: text('appliance_id').references(() => appliances.id, { onDelete: 'cascade' }),
    prediction_type: text('prediction_type').notNull(), // failure, service_needed, replacement_recommended, inspection_due
    predicted_date_min: text('predicted_date_min'),
    predicted_date_max: text('predicted_date_max'),
    confidence_level: text('confidence_level').notNull(), // high, medium, low
    reasoning: text('reasoning').notNull(),
    recommended_action: text('recommended_action').notNull(),
    estimated_cost_min: integer('estimated_cost_min'), // in cents
    estimated_cost_max: integer('estimated_cost_max'), // in cents
    status: text('status').notNull().default('pending'), // pending, scheduled, resolved, false_alarm, deferred
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    resolved_at: text('resolved_at'),
    actual_outcome: text('actual_outcome'),
    accuracy_score: real('accuracy_score'), // Calculated after resolution
    related_task_id: text('related_task_id').references(() => tasks.id, { onDelete: 'set null' }),
  },
  (table) => ({
    household_idx: index('idx_ai_predictions_household').on(table.household_id),
    status_idx: index('idx_ai_predictions_status').on(table.status),
    feature_idx: index('idx_ai_predictions_feature').on(table.feature_id),
    appliance_idx: index('idx_ai_predictions_appliance').on(table.appliance_id),
    date_min_idx: index('idx_ai_predictions_date_min').on(table.predicted_date_min),
    type_idx: index('idx_ai_predictions_type').on(table.prediction_type),
  })
);

/**
 * Seasonal maintenance checklists
 */
export const aiSeasonalChecklists = sqliteTable(
  'ai_seasonal_checklists',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    season: text('season').notNull(), // spring, summer, fall, winter
    year: integer('year').notNull(),
    climate_zone: text('climate_zone'),
    checklist_items: text('checklist_items').notNull(), // JSON array
    generated_at: text('generated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    completed_items: text('completed_items'), // JSON array
    completion_rate: real('completion_rate'), // 0.0 to 1.0
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_idx: index('idx_ai_checklists_household').on(table.household_id),
    season_year_idx: index('idx_ai_checklists_season_year').on(table.season, table.year),
  })
);

/**
 * AI-generated insights (cost savings, risk prevention, etc.)
 */
export const aiInsights = sqliteTable(
  'ai_insights',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    insight_type: text('insight_type').notNull(), // cost_savings, risk_prevention, batching_opportunity, efficiency_improvement, warranty_expiration
    title: text('title').notNull(),
    description: text('description').notNull(),
    potential_savings: integer('potential_savings'), // in cents
    risk_level: text('risk_level'), // low, medium, high, critical
    priority: integer('priority'), // 1-10
    generated_at: text('generated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    expires_at: text('expires_at'),
    status: text('status').notNull().default('active'), // active, accepted, dismissed, expired, completed
    related_task_ids: text('related_task_ids'), // JSON array
    related_quote_ids: text('related_quote_ids'), // JSON array
    related_suggestion_ids: text('related_suggestion_ids'), // JSON array
    user_feedback: text('user_feedback'), // helpful, not_helpful, neutral
    user_feedback_note: text('user_feedback_note'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_idx: index('idx_ai_insights_household').on(table.household_id),
    type_idx: index('idx_ai_insights_type').on(table.insight_type),
    status_idx: index('idx_ai_insights_status').on(table.status),
    expires_idx: index('idx_ai_insights_expires').on(table.expires_at),
  })
);

// TypeScript types for use in application code
export type AIHousekeeperPreference = typeof aiHousekeeperPreferences.$inferSelect;
export type NewAIHousekeeperPreference = typeof aiHousekeeperPreferences.$inferInsert;

export type AIHousekeeperSuggestion = typeof aiHousekeeperSuggestions.$inferSelect;
export type NewAIHousekeeperSuggestion = typeof aiHousekeeperSuggestions.$inferInsert;

export type AIMaintenancePrediction = typeof aiMaintenancePredictions.$inferSelect;
export type NewAIMaintenancePrediction = typeof aiMaintenancePredictions.$inferInsert;

export type AISeasonalChecklist = typeof aiSeasonalChecklists.$inferSelect;
export type NewAISeasonalChecklist = typeof aiSeasonalChecklists.$inferInsert;

export type AIInsight = typeof aiInsights.$inferSelect;
export type NewAIInsight = typeof aiInsights.$inferInsert;
