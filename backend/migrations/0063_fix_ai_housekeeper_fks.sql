-- Fix dangling foreign-key references created by migration 0031.
-- ai_housekeeper_suggestions and ai_maintenance_predictions were created with
-- FKs pointing at non-existent tables `maintenanceTasks` / `homeFeatures`
-- (the Drizzle symbol names instead of the real SQL names `tasks` / `home_features`).
-- With PRAGMA foreign_keys=ON this breaks every INSERT that sets a non-null
-- related_task_id / feature_id. Both tables are empty in all environments, so a
-- drop + recreate with corrected references is safe (no data to preserve).

DROP TABLE IF EXISTS ai_housekeeper_suggestions;
CREATE TABLE ai_housekeeper_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence_score REAL,
  priority_score INTEGER,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  user_action_at TEXT,
  user_action_by TEXT,
  user_feedback TEXT,
  related_task_id TEXT,
  related_feature_ids TEXT,
  related_appliance_ids TEXT,
  related_finding_ids TEXT,
  ai_reasoning TEXT,
  data_sources TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (related_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (user_action_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_ai_suggestions_household ON ai_housekeeper_suggestions(household_id);
CREATE INDEX idx_ai_suggestions_status ON ai_housekeeper_suggestions(status);
CREATE INDEX idx_ai_suggestions_type ON ai_housekeeper_suggestions(suggestion_type);
CREATE INDEX idx_ai_suggestions_generated ON ai_housekeeper_suggestions(generated_at);
CREATE INDEX idx_ai_suggestions_expires ON ai_housekeeper_suggestions(expires_at);

DROP TABLE IF EXISTS ai_maintenance_predictions;
CREATE TABLE ai_maintenance_predictions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  feature_id TEXT,
  appliance_id TEXT,
  prediction_type TEXT NOT NULL,
  predicted_date_min TEXT,
  predicted_date_max TEXT,
  confidence_level TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  actual_outcome TEXT,
  accuracy_score REAL,
  related_task_id TEXT,
  FOREIGN KEY (household_id) REFERENCES households(id) ON DELETE CASCADE,
  FOREIGN KEY (feature_id) REFERENCES home_features(id) ON DELETE CASCADE,
  FOREIGN KEY (appliance_id) REFERENCES appliances(id) ON DELETE CASCADE,
  FOREIGN KEY (related_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX idx_ai_predictions_household ON ai_maintenance_predictions(household_id);
CREATE INDEX idx_ai_predictions_status ON ai_maintenance_predictions(status);
CREATE INDEX idx_ai_predictions_feature ON ai_maintenance_predictions(feature_id);
CREATE INDEX idx_ai_predictions_appliance ON ai_maintenance_predictions(appliance_id);
CREATE INDEX idx_ai_predictions_date_min ON ai_maintenance_predictions(predicted_date_min);
CREATE INDEX idx_ai_predictions_type ON ai_maintenance_predictions(prediction_type);
