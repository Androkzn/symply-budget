-- AI Housekeeper Feature Tables

-- User preferences for AI housekeeper
CREATE TABLE IF NOT EXISTS ai_housekeeper_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  notification_frequency TEXT NOT NULL DEFAULT 'daily', -- daily, three_per_week, weekly, disabled
  ai_personality TEXT NOT NULL DEFAULT 'friendly', -- friendly, professional, data_driven
  diy_skill_level TEXT NOT NULL DEFAULT 'beginner', -- none, beginner, intermediate, advanced
  budget_preference TEXT NOT NULL DEFAULT 'moderate', -- tight, moderate, flexible
  preferred_learning_style TEXT DEFAULT 'article', -- video, article, expert_call
  enable_predictions INTEGER NOT NULL DEFAULT 1,
  enable_seasonal_reminders INTEGER NOT NULL DEFAULT 1,
  enable_cost_insights INTEGER NOT NULL DEFAULT 1,
  enable_procrastination_nudges INTEGER NOT NULL DEFAULT 1,
  enable_celebrations INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_housekeeper_prefs_user ON ai_housekeeper_preferences(user_id);

-- AI-generated suggestions for household maintenance
CREATE TABLE IF NOT EXISTS ai_housekeeper_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL, -- prediction, seasonal_reminder, cost_optimization, procrastination_nudge, celebration, batching_opportunity
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence_score REAL, -- 0.0 to 1.0
  priority_score INTEGER, -- 1-10
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT, -- Suggestions can expire (e.g., seasonal)
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, dismissed, snoozed, expired, completed
  user_action_at TEXT,
  user_action_by TEXT, -- user_id who took action
  user_feedback TEXT, -- helpful, not_helpful, neutral
  related_task_id TEXT, -- If accepted, link to created task
  related_feature_ids TEXT, -- JSON array of feature IDs
  related_appliance_ids TEXT, -- JSON array of appliance IDs
  related_finding_ids TEXT, -- JSON array of finding IDs
  ai_reasoning TEXT, -- Why this suggestion was made
  data_sources TEXT, -- JSON: what data was analyzed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (related_task_id) REFERENCES maintenanceTasks(id) ON DELETE SET NULL,
  FOREIGN KEY (user_action_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_household ON ai_housekeeper_suggestions(household_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_status ON ai_housekeeper_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_type ON ai_housekeeper_suggestions(suggestion_type);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_generated ON ai_housekeeper_suggestions(generated_at);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_expires ON ai_housekeeper_suggestions(expires_at);

-- Predictive maintenance forecasts
CREATE TABLE IF NOT EXISTS ai_maintenance_predictions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  feature_id TEXT,
  appliance_id TEXT,
  prediction_type TEXT NOT NULL, -- failure, service_needed, replacement_recommended, inspection_due
  predicted_date_min TEXT, -- Earliest predicted date
  predicted_date_max TEXT, -- Latest predicted date
  confidence_level TEXT NOT NULL, -- high, medium, low
  reasoning TEXT NOT NULL, -- AI explanation of why this prediction was made
  recommended_action TEXT NOT NULL, -- What user should do
  estimated_cost_min INTEGER, -- in cents
  estimated_cost_max INTEGER, -- in cents
  status TEXT NOT NULL DEFAULT 'pending', -- pending, scheduled, resolved, false_alarm, deferred
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  actual_outcome TEXT, -- For tracking prediction accuracy (what actually happened)
  accuracy_score REAL, -- How accurate was the prediction (calculated after resolution)
  related_task_id TEXT, -- Task created from this prediction
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (feature_id) REFERENCES homeFeatures(id) ON DELETE CASCADE,
  FOREIGN KEY (appliance_id) REFERENCES appliances(id) ON DELETE CASCADE,
  FOREIGN KEY (related_task_id) REFERENCES maintenanceTasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_household ON ai_maintenance_predictions(household_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_status ON ai_maintenance_predictions(status);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_feature ON ai_maintenance_predictions(feature_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_appliance ON ai_maintenance_predictions(appliance_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_date_min ON ai_maintenance_predictions(predicted_date_min);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_type ON ai_maintenance_predictions(prediction_type);

-- Seasonal maintenance checklists
CREATE TABLE IF NOT EXISTS ai_seasonal_checklists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  season TEXT NOT NULL, -- spring, summer, fall, winter
  year INTEGER NOT NULL,
  climate_zone TEXT, -- Derived from property address
  checklist_items TEXT NOT NULL, -- JSON array of checklist items
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_items TEXT, -- JSON array of completed item IDs
  completion_rate REAL, -- 0.0 to 1.0
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_checklists_household ON ai_seasonal_checklists(household_id);
CREATE INDEX IF NOT EXISTS idx_ai_checklists_season_year ON ai_seasonal_checklists(season, year);

-- AI-generated insights (cost savings, risk prevention, etc.)
CREATE TABLE IF NOT EXISTS ai_insights (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  insight_type TEXT NOT NULL, -- cost_savings, risk_prevention, batching_opportunity, efficiency_improvement, warranty_expiration
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  potential_savings INTEGER, -- in cents (for cost_savings type)
  risk_level TEXT, -- low, medium, high, critical (for risk_prevention type)
  priority INTEGER, -- 1-10
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active, accepted, dismissed, expired, completed
  related_task_ids TEXT, -- JSON array of task IDs
  related_quote_ids TEXT, -- JSON array of quote IDs
  related_suggestion_ids TEXT, -- JSON array of suggestion IDs
  user_feedback TEXT, -- helpful, not_helpful, neutral
  user_feedback_note TEXT, -- Optional feedback text
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_household ON ai_insights(household_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_type ON ai_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_insights_status ON ai_insights(status);
CREATE INDEX IF NOT EXISTS idx_ai_insights_expires ON ai_insights(expires_at);

-- Extend maintenanceTasks table with AI fields
-- COMMENTED OUT: These tables may not exist in all environments
-- ALTER TABLE maintenanceTasks ADD COLUMN ai_suggestion_id TEXT REFERENCES ai_housekeeper_suggestions(id);
-- ALTER TABLE maintenanceTasks ADD COLUMN ai_priority_score REAL; -- Dynamic AI-calculated priority (0.0-1.0)
-- ALTER TABLE maintenanceTasks ADD COLUMN batching_group_id TEXT; -- Group related tasks for batching

-- CREATE INDEX IF NOT EXISTS idx_tasks_ai_suggestion ON maintenanceTasks(ai_suggestion_id);
-- CREATE INDEX IF NOT EXISTS idx_tasks_ai_priority ON maintenanceTasks(ai_priority_score);
-- CREATE INDEX IF NOT EXISTS idx_tasks_batching_group ON maintenanceTasks(batching_group_id);

-- Extend notificationHistory table with AI fields
-- COMMENTED OUT: These tables may not exist in all environments
-- ALTER TABLE notificationHistory ADD COLUMN ai_generated INTEGER DEFAULT 0;
-- ALTER TABLE notificationHistory ADD COLUMN suggestion_id TEXT REFERENCES ai_housekeeper_suggestions(id);
-- ALTER TABLE notificationHistory ADD COLUMN insight_id TEXT REFERENCES ai_insights(id);
-- ALTER TABLE notificationHistory ADD COLUMN prediction_id TEXT REFERENCES ai_maintenance_predictions(id);

-- CREATE INDEX IF NOT EXISTS idx_notifications_ai_generated ON notificationHistory(ai_generated);
-- CREATE INDEX IF NOT EXISTS idx_notifications_suggestion ON notificationHistory(suggestion_id);
-- CREATE INDEX IF NOT EXISTS idx_notifications_insight ON notificationHistory(insight_id);
