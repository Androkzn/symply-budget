-- Migration: Add utilities and taxes tables
-- Created: 2026-01-23

-- Utility providers table (BC Hydro, FortisBC, municipal utilities)
CREATE TABLE IF NOT EXISTS utility_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'electricity', 'gas', 'garbage', 'water', 'sewer'
    service_area TEXT, -- city/municipality name or 'provincial'
    website_url TEXT,
    portal_url TEXT,
    billing_cycle TEXT, -- 'monthly', 'bimonthly', 'quarterly', 'annual'
    contact_phone TEXT,
    contact_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS utility_providers_type_idx ON utility_providers(type);
CREATE INDEX IF NOT EXISTS utility_providers_service_area_idx ON utility_providers(service_area);

-- Utility accounts table (user's utility accounts)
CREATE TABLE IF NOT EXISTS utility_accounts (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL REFERENCES utility_providers(id),
    account_number TEXT NOT NULL,
    service_type TEXT NOT NULL, -- 'electricity', 'gas', 'water', 'sewer', 'garbage', 'other'
    start_date TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    billing_cycle_preference TEXT, -- 'monthly', 'bimonthly', 'quarterly', 'annual'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS utility_accounts_household_id_idx ON utility_accounts(household_id);
CREATE INDEX IF NOT EXISTS utility_accounts_provider_id_idx ON utility_accounts(provider_id);
CREATE INDEX IF NOT EXISTS utility_accounts_service_type_idx ON utility_accounts(service_type);

-- Utility bills table
CREATE TABLE IF NOT EXISTS utility_bills (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id TEXT REFERENCES utility_accounts(id),
    bill_type TEXT NOT NULL, -- 'electricity', 'gas', 'water', 'sewer', 'garbage', 'other'
    provider TEXT,
    account_number TEXT,
    billing_period_start TEXT NOT NULL,
    billing_period_end TEXT NOT NULL,
    amount INTEGER NOT NULL, -- in cents
    due_date TEXT NOT NULL,
    paid_date TEXT,
    paid_amount INTEGER, -- in cents
    usage_quantity REAL,
    usage_unit TEXT, -- 'kWh', 'GJ', 'm³', etc.
    document_url TEXT, -- R2 storage key
    ai_extracted_data TEXT, -- JSON
    confidence_score REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS utility_bills_household_id_idx ON utility_bills(household_id);
CREATE INDEX IF NOT EXISTS utility_bills_account_id_idx ON utility_bills(account_id);
CREATE INDEX IF NOT EXISTS utility_bills_bill_type_idx ON utility_bills(bill_type);
CREATE INDEX IF NOT EXISTS utility_bills_due_date_idx ON utility_bills(due_date);
CREATE INDEX IF NOT EXISTS utility_bills_billing_period_idx ON utility_bills(billing_period_start, billing_period_end);

-- Property taxes table
CREATE TABLE IF NOT EXISTS property_taxes (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    tax_year INTEGER NOT NULL,
    assessed_value INTEGER NOT NULL, -- in cents
    tax_amount INTEGER NOT NULL, -- in cents
    advance_payment_amount INTEGER,
    advance_payment_due_date TEXT,
    advance_payment_paid_date TEXT,
    main_payment_amount INTEGER NOT NULL,
    main_payment_due_date TEXT NOT NULL,
    main_payment_paid_date TEXT,
    homeowner_grant_eligible INTEGER NOT NULL DEFAULT 0,
    homeowner_grant_amount INTEGER, -- in cents
    homeowner_grant_applied_date TEXT,
    homeowner_grant_status TEXT, -- 'pending', 'approved', 'rejected'
    penalties TEXT, -- JSON array
    document_url TEXT, -- R2 storage key
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS property_taxes_household_id_idx ON property_taxes(household_id);
CREATE INDEX IF NOT EXISTS property_taxes_tax_year_idx ON property_taxes(tax_year);
CREATE UNIQUE INDEX IF NOT EXISTS property_taxes_household_year_idx ON property_taxes(household_id, tax_year);

-- BC Assessment data table
CREATE TABLE IF NOT EXISTS bc_assessment_data (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    assessment_year INTEGER NOT NULL,
    property_class TEXT,
    assessed_value INTEGER NOT NULL, -- in cents
    land_value INTEGER, -- in cents
    improvement_value INTEGER, -- in cents
    previous_year_value INTEGER, -- in cents
    change_percent REAL,
    assessment_pdf_key TEXT, -- R2 storage key
    appeal_deadline TEXT,
    appeal_filed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS bc_assessment_data_household_id_idx ON bc_assessment_data(household_id);
CREATE INDEX IF NOT EXISTS bc_assessment_data_assessment_year_idx ON bc_assessment_data(assessment_year);
CREATE UNIQUE INDEX IF NOT EXISTS bc_assessment_data_household_year_idx ON bc_assessment_data(household_id, assessment_year);

-- Utility reminders table
CREATE TABLE IF NOT EXISTS utility_reminders (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    bill_id TEXT REFERENCES utility_bills(id) ON DELETE CASCADE,
    reminder_type TEXT NOT NULL, -- 'payment_due', 'overdue', 'homeowner_grant', 'assessment_appeal'
    scheduled_for TEXT NOT NULL,
    sent_at TEXT,
    reminder_days_before INTEGER,
    notification_channel TEXT, -- 'push', 'email', 'sms'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS utility_reminders_household_id_idx ON utility_reminders(household_id);
CREATE INDEX IF NOT EXISTS utility_reminders_bill_id_idx ON utility_reminders(bill_id);
CREATE INDEX IF NOT EXISTS utility_reminders_scheduled_for_idx ON utility_reminders(scheduled_for);
CREATE INDEX IF NOT EXISTS utility_reminders_sent_at_idx ON utility_reminders(sent_at);

-- Utility trends table (pre-calculated trend data)
CREATE TABLE IF NOT EXISTS utility_trends (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    utility_type TEXT NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER,
    total_amount INTEGER NOT NULL, -- in cents
    average_amount INTEGER, -- in cents
    change_from_previous INTEGER, -- in cents
    change_percent REAL,
    usage_total REAL,
    usage_average REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS utility_trends_household_id_idx ON utility_trends(household_id);
CREATE INDEX IF NOT EXISTS utility_trends_utility_type_idx ON utility_trends(utility_type);
CREATE INDEX IF NOT EXISTS utility_trends_year_month_idx ON utility_trends(year, month);
CREATE UNIQUE INDEX IF NOT EXISTS utility_trends_household_type_year_month_idx ON utility_trends(household_id, utility_type, year, month);

-- Municipality configurations table
CREATE TABLE IF NOT EXISTS municipality_configs (
    id TEXT PRIMARY KEY,
    municipality_name TEXT NOT NULL UNIQUE,
    municipality_code TEXT NOT NULL UNIQUE, -- 'VAN', 'BUR', 'SUR', etc.
    property_tax_advance_due_date TEXT,
    property_tax_main_due_date TEXT NOT NULL,
    utility_due_date TEXT,
    early_discount_percentage REAL,
    penalty_structure TEXT, -- JSON
    portal_url TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS municipality_configs_code_idx ON municipality_configs(municipality_code);
