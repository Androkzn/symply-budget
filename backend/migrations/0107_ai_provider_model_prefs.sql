-- Per-provider chosen model. `user_ai_preferences.selected_model_id` is a single
-- global field (the active provider's model); this table remembers each provider's
-- pick so switching the active provider restores its own model instead of resetting.
-- Absent row → resolves to the provider's flagship (BYOK) or default (managed).
CREATE TABLE IF NOT EXISTS user_ai_provider_models (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  selected_model_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_ai_provider_models_user_provider_idx
  ON user_ai_provider_models (user_id, provider);
