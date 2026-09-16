-- Per-category sub-budgets (caps within a month's total budget).
-- A row scopes a cap for one category to either a whole year (month IS NULL =
-- recurring default) or a single month (month 1-12 = override). A cap is EITHER a
-- fixed amount (amount_cents) or a percent of that month's total planned_budget
-- (percent_bps, basis points 0-10000). Additive only; Budget-only feature.

CREATE TABLE IF NOT EXISTS budget_sub_budgets (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES budget_categories(id),
  year INTEGER NOT NULL,
  month INTEGER, -- NULL = recurring default for the year; 1-12 = month override
  limit_type TEXT NOT NULL CHECK (limit_type IN ('amount','percent')),
  amount_cents INTEGER,
  percent_bps INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_sub_budgets_household_year_idx
  ON budget_sub_budgets(household_id, year);

-- One cap per (household, year, month|default, category). COALESCE(month, -1)
-- collapses the NULL default so SQLite (which treats NULLs as distinct in a plain
-- unique index) still enforces a single default row per category.
CREATE UNIQUE INDEX IF NOT EXISTS budget_sub_budgets_scope_idx
  ON budget_sub_budgets(household_id, year, COALESCE(month, -1), category_id);
