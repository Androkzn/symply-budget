-- Migration: Task Drafts, Home Features, and Maintenance Templates
-- Part of Report Analysis & Maintenance Features implementation

-- ============ TASK DRAFTS ============
-- Task drafts are generated from report findings for user review
-- Users can convert them to maintenance tasks or action items

CREATE TABLE IF NOT EXISTS task_drafts (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,

  -- Task Info
  title TEXT NOT NULL,
  description TEXT,
  plain_language_summary TEXT,

  -- Categorization
  system_category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'major', 'minor', 'informational')),
  priority_score INTEGER CHECK (priority_score >= 0 AND priority_score <= 100),

  -- Scheduling Suggestions
  suggested_timeframe TEXT CHECK (suggested_timeframe IN ('0-30_days', '3-6_months', '1_year', '2-5_years', '5-10_years')),
  suggested_frequency TEXT CHECK (suggested_frequency IN ('one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
  is_recurring_suggestion INTEGER DEFAULT 0,

  -- Cost Estimates (in cents)
  estimated_cost_min INTEGER,
  estimated_cost_max INTEGER,
  diy_possible INTEGER DEFAULT 0,
  diy_difficulty TEXT CHECK (diy_difficulty IN ('easy', 'medium', 'hard', 'professional_only')),
  diy_cost_min INTEGER,
  diy_cost_max INTEGER,

  -- Evidence from report
  source_page_numbers TEXT, -- JSON array
  source_quotes TEXT, -- JSON array
  image_ids TEXT, -- JSON array of report_images.id

  -- Status tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'converted', 'dismissed')),
  converted_to_task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL,
  converted_to_action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
  dismissed_reason TEXT,
  dismissed_at TEXT,
  converted_at TEXT,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_drafts_household ON task_drafts(household_id);
CREATE INDEX idx_task_drafts_report ON task_drafts(report_id);
CREATE INDEX idx_task_drafts_finding ON task_drafts(finding_id);
CREATE INDEX idx_task_drafts_status ON task_drafts(status);
CREATE INDEX idx_task_drafts_severity ON task_drafts(severity);
CREATE INDEX idx_task_drafts_category ON task_drafts(system_category);
CREATE INDEX idx_task_drafts_priority ON task_drafts(priority_score);

-- ============ HOME FEATURES ============
-- Features extracted from inspection reports (fireplaces, pools, HVAC, etc.)
-- Used to generate smart maintenance suggestions

CREATE TABLE IF NOT EXISTS home_features (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- Feature identification
  feature_type TEXT NOT NULL, -- fireplace, pool, hvac, septic, well, etc.
  feature_subtype TEXT, -- wood_burning, gas, inground, tank, etc.
  quantity INTEGER DEFAULT 1,
  location TEXT, -- living_room, backyard, basement, etc.

  -- Details
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  install_date TEXT,
  warranty_expires TEXT,
  age_years INTEGER,
  condition TEXT CHECK (condition IN ('excellent', 'good', 'fair', 'poor', 'unknown')),
  notes TEXT,

  -- Source tracking
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'report_extraction', 'user_input')),
  source_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  extraction_confidence REAL, -- 0.0-1.0 for AI-extracted features

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX idx_home_features_household ON home_features(household_id);
CREATE INDEX idx_home_features_type ON home_features(feature_type);
CREATE INDEX idx_home_features_subtype ON home_features(feature_type, feature_subtype);
CREATE INDEX idx_home_features_source ON home_features(source);

-- ============ MAINTENANCE TEMPLATES ============
-- Pre-defined maintenance task templates based on home features
-- Seeded with 150+ common maintenance tasks from research

CREATE TABLE IF NOT EXISTS maintenance_templates (
  id TEXT PRIMARY KEY,

  -- Template identification
  title TEXT NOT NULL,
  description TEXT,
  plain_language_description TEXT, -- For non-technical homeowners

  -- Matching rules
  feature_type TEXT NOT NULL, -- Matches home_features.feature_type
  feature_subtype TEXT, -- Optional: matches specific subtype
  climate_zone TEXT, -- Optional: cold, hot_humid, coastal, dry, temperate
  home_age_min INTEGER, -- Optional: min home age in years
  home_age_max INTEGER, -- Optional: max home age in years

  -- Schedule configuration
  -- every_10_years added for tpl_safety_smoke_replace (smoke detectors): the
  -- seed below used this value from the start, but it was missing from this
  -- list, so the entire seed INSERT in 0012 has always silently failed (zero
  -- rows) on every database, including already-migrated remotes — see 0012.
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'yearly', 'every_2_years', 'every_3_years', 'every_5_years', 'every_10_years')),
  best_season TEXT CHECK (best_season IN ('spring', 'summer', 'fall', 'winter', 'any')),
  best_month INTEGER CHECK (best_month >= 1 AND best_month <= 12), -- Specific month if applicable

  -- Task details
  system_category TEXT NOT NULL,
  estimated_duration_minutes INTEGER,
  diy_difficulty TEXT CHECK (diy_difficulty IN ('easy', 'medium', 'hard', 'professional_only')),
  professional_recommended INTEGER DEFAULT 0,
  estimated_cost_min INTEGER, -- In cents
  estimated_cost_max INTEGER, -- In cents
  diy_cost_min INTEGER,
  diy_cost_max INTEGER,

  -- Educational content
  why_important TEXT,
  neglect_consequences TEXT,
  how_to_steps TEXT, -- JSON array of step strings
  tools_needed TEXT, -- JSON array
  materials_needed TEXT, -- JSON array
  safety_warnings TEXT, -- JSON array
  video_url TEXT,
  article_url TEXT,

  -- Metadata
  source TEXT DEFAULT 'system' CHECK (source IN ('system', 'user_contributed', 'ai_generated')),
  is_active INTEGER DEFAULT 1,
  priority_weight INTEGER DEFAULT 50, -- For sorting suggestions
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_maintenance_templates_feature ON maintenance_templates(feature_type);
CREATE INDEX idx_maintenance_templates_feature_sub ON maintenance_templates(feature_type, feature_subtype);
CREATE INDEX idx_maintenance_templates_frequency ON maintenance_templates(frequency);
CREATE INDEX idx_maintenance_templates_category ON maintenance_templates(system_category);
CREATE INDEX idx_maintenance_templates_active ON maintenance_templates(is_active);

-- ============ MAINTENANCE TASK REMINDERS ============
-- Add reminder fields to maintenance_tasks

ALTER TABLE maintenance_tasks ADD COLUMN reminder_enabled INTEGER DEFAULT 1;
ALTER TABLE maintenance_tasks ADD COLUMN reminder_time TEXT DEFAULT '09:00';
ALTER TABLE maintenance_tasks ADD COLUMN reminder_repeat INTEGER DEFAULT 1;
ALTER TABLE maintenance_tasks ADD COLUMN last_reminder_sent_at TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN snooze_until TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN suggested_by TEXT CHECK (suggested_by IN ('system', 'report', 'user', 'template'));
ALTER TABLE maintenance_tasks ADD COLUMN home_feature_id TEXT REFERENCES home_features(id) ON DELETE SET NULL;
ALTER TABLE maintenance_tasks ADD COLUMN template_id TEXT REFERENCES maintenance_templates(id) ON DELETE SET NULL;
ALTER TABLE maintenance_tasks ADD COLUMN suggestion_reason TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN why_important TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN neglect_consequences TEXT;

-- Index for reminder queries
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_reminder ON maintenance_tasks(reminder_enabled, next_due_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_feature ON maintenance_tasks(home_feature_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tasks_template ON maintenance_tasks(template_id);

-- ============ SUGGESTED MAINTENANCE (User Review Queue) ============
-- Stores suggestions before user accepts them

CREATE TABLE IF NOT EXISTS maintenance_suggestions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  home_feature_id TEXT NOT NULL REFERENCES home_features(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES maintenance_templates(id) ON DELETE CASCADE,

  -- Suggestion details (copied from template, can be modified)
  title TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,
  suggested_start_date TEXT,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'snoozed')),
  accepted_at TEXT,
  dismissed_at TEXT,
  dismissed_reason TEXT,
  snooze_until TEXT,

  -- If accepted, link to created task
  created_task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL,

  -- Metadata
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_maintenance_suggestions_household ON maintenance_suggestions(household_id);
CREATE INDEX idx_maintenance_suggestions_status ON maintenance_suggestions(status);
CREATE INDEX idx_maintenance_suggestions_feature ON maintenance_suggestions(home_feature_id);

-- ============ NOTIFICATION SCHEDULE ============
-- scheduled_notifications is NOT (re)created here: 0002_notifications.sql
-- already created it with the shape the app actually uses (reference_type /
-- reference_id, no task_id / action_item_id / notification_type columns).
-- This redundant block used to break a from-scratch replay (the table
-- already exists, so CREATE TABLE IF NOT EXISTS no-ops, and the subsequent
-- index on the never-added task_id column then fails). Already-migrated
-- remote databases are unaffected — they never replay this file's DDL again.
