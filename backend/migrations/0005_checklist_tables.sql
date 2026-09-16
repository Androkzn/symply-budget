-- Migration: Add checklist tables
-- Created: 2026-01-22

-- Checklists table
CREATE TABLE IF NOT EXISTS checklists (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    frequency TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    season TEXT,
    custom_days TEXT,
    sort_order INTEGER DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checklists_household_id_idx ON checklists(household_id);
CREATE INDEX IF NOT EXISTS checklists_frequency_idx ON checklists(frequency);

-- Checklist items table
CREATE TABLE IF NOT EXISTS checklist_items (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_required INTEGER NOT NULL DEFAULT 1,
    linked_task_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checklist_items_checklist_id_idx ON checklist_items(checklist_id);

-- Checklist instances table
CREATE TABLE IF NOT EXISTS checklist_instances (
    id TEXT PRIMARY KEY,
    checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    period_label TEXT,
    total_items INTEGER NOT NULL,
    completed_items INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    completed_at TEXT,
    completed_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checklist_instances_checklist_id_idx ON checklist_instances(checklist_id);
CREATE INDEX IF NOT EXISTS checklist_instances_household_period_idx ON checklist_instances(household_id, period_start);
CREATE INDEX IF NOT EXISTS checklist_instances_status_idx ON checklist_instances(status);

-- Checklist item completions table
CREATE TABLE IF NOT EXISTS checklist_item_completions (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES checklist_instances(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
    completed_by TEXT NOT NULL REFERENCES users(id),
    completed_at TEXT NOT NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS checklist_item_completions_instance_id_idx ON checklist_item_completions(instance_id);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_item_completions_instance_item_idx ON checklist_item_completions(instance_id, item_id);
