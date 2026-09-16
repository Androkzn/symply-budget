-- Smart Budget: AI insight caching table + index for month-bucketing budget_items by target_date.

CREATE TABLE budget_insights (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  period TEXT NOT NULL, -- 'YYYY-MM'
  insight_text TEXT NOT NULL,
  insight_json TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX budget_insights_household_period_idx ON budget_insights(household_id, period);
CREATE INDEX budget_items_target_date_idx ON budget_items(target_date);
