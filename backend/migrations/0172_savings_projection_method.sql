-- Savings Projection: a household-wide choice of WHICH forecast method drives
-- the year-end figure shown on the Projection tab's default view, Home, the
-- iOS widget and the Watch.
--
-- Until now the Projection tab computed exactly one forecast (goal-or-pace).
-- It now offers four ('historical_average' | 'trend' | 'planned_budget' |
-- 'hybrid'), and the household picks which one is authoritative outside the
-- Projection tab itself. This is deliberately household-wide, not per-member:
-- Home/widget/Watch show ONE number per household, the same way
-- savings_goals and savings_monthly_targets are already household-scoped.
--
-- One row per household; its absence means 'hybrid' (the recommended
-- default), so a household that never opens the method picker never gets a
-- row here at all.

CREATE TABLE IF NOT EXISTS savings_projection_settings (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  default_method TEXT NOT NULL DEFAULT 'hybrid'
    CHECK (default_method IN ('historical_average', 'trend', 'planned_budget', 'hybrid')),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
