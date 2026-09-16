-- Migration: Add contractor tables
-- Created: 2026-01-22

-- Contractors table
CREATE TABLE IF NOT EXISTS contractors (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    company_name TEXT,
    specialty TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    notes TEXT,
    rating INTEGER,
    is_favorite INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractors_household_id_idx ON contractors(household_id);
CREATE INDEX IF NOT EXISTS contractors_specialty_idx ON contractors(specialty);
CREATE INDEX IF NOT EXISTS contractors_is_favorite_idx ON contractors(is_favorite);

-- Contractor visits table
CREATE TABLE IF NOT EXISTS contractor_visits (
    id TEXT PRIMARY KEY,
    contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    visit_date TEXT NOT NULL,
    description TEXT,
    cost INTEGER,
    status TEXT NOT NULL,
    notes TEXT,
    rating INTEGER,
    linked_action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
    linked_budget_item_id TEXT REFERENCES budget_items(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_visits_contractor_id_idx ON contractor_visits(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_visits_household_id_idx ON contractor_visits(household_id);
CREATE INDEX IF NOT EXISTS contractor_visits_visit_date_idx ON contractor_visits(visit_date);
CREATE INDEX IF NOT EXISTS contractor_visits_status_idx ON contractor_visits(status);

-- Contractor documents table
CREATE TABLE IF NOT EXISTS contractor_documents (
    id TEXT PRIMARY KEY,
    contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    visit_id TEXT REFERENCES contractor_visits(id) ON DELETE SET NULL,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    file_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    amount INTEGER,
    document_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_documents_contractor_id_idx ON contractor_documents(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_documents_visit_id_idx ON contractor_documents(visit_id);
CREATE INDEX IF NOT EXISTS contractor_documents_household_id_idx ON contractor_documents(household_id);
CREATE INDEX IF NOT EXISTS contractor_documents_type_idx ON contractor_documents(type);
