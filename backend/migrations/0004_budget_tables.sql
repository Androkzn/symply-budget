-- Migration: Add budget tables
-- Created: 2026-01-22

-- Budget categories table
CREATE TABLE IF NOT EXISTS budget_categories (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_categories_household_id_idx ON budget_categories(household_id);

-- Budget items table
CREATE TABLE IF NOT EXISTS budget_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    category_id TEXT REFERENCES budget_categories(id),
    timeframe TEXT NOT NULL,
    year INTEGER,
    quarter INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    estimated_cost_min INTEGER,
    estimated_cost_max INTEGER,
    actual_cost INTEGER,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    is_recurring INTEGER DEFAULT 0,
    recurrence_frequency TEXT,
    source_type TEXT,
    source_id TEXT,
    target_date TEXT,
    completed_at TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_items_household_id_idx ON budget_items(household_id);
CREATE INDEX IF NOT EXISTS budget_items_timeframe_idx ON budget_items(timeframe);
CREATE INDEX IF NOT EXISTS budget_items_year_idx ON budget_items(year);
CREATE INDEX IF NOT EXISTS budget_items_status_idx ON budget_items(status);
CREATE INDEX IF NOT EXISTS budget_items_priority_idx ON budget_items(priority);

-- Budget goals table
CREATE TABLE IF NOT EXISTS budget_goals (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER,
    planned_budget INTEGER,
    actual_spent INTEGER DEFAULT 0,
    category_budgets TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_goals_household_year_idx ON budget_goals(household_id, year);

-- Expenses table
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    budget_item_id TEXT REFERENCES budget_items(id),
    category_id TEXT REFERENCES budget_categories(id),
    title TEXT NOT NULL,
    description TEXT,
    amount INTEGER NOT NULL,
    expense_date TEXT NOT NULL,
    vendor TEXT,
    receipt_key TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS expenses_household_id_idx ON expenses(household_id);
CREATE INDEX IF NOT EXISTS expenses_expense_date_idx ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS expenses_budget_item_id_idx ON expenses(budget_item_id);
