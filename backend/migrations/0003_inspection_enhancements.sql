-- Migration: Inspection Report Enhancements
-- Adds support for persona summaries, DIY guidance, extracted images, and finding-space mapping
-- Date: 2026-01-20
-- Note: household_spaces table already exists in schema

-- ============================================
-- NEW TABLES
-- ============================================

-- Finding-to-space mapping (many-to-many relationship)
CREATE TABLE IF NOT EXISTS finding_spaces (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES household_spaces(id) ON DELETE CASCADE,
  ai_confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(finding_id, space_id)
);

CREATE INDEX finding_spaces_finding_id_idx ON finding_spaces(finding_id);
CREATE INDEX finding_spaces_space_id_idx ON finding_spaces(space_id);

-- Extracted images from inspection reports
CREATE TABLE IF NOT EXISTS report_images (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  chunk_id TEXT REFERENCES report_chunks(id) ON DELETE SET NULL,
  finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
  page_number INTEGER,
  image_key TEXT NOT NULL,
  image_type TEXT CHECK(image_type IN ('photo', 'chart', 'table', 'diagram', 'other')),
  caption TEXT,
  ai_description TEXT,
  ai_confidence REAL,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX report_images_report_id_idx ON report_images(report_id);
CREATE INDEX report_images_finding_id_idx ON report_images(finding_id);
CREATE INDEX report_images_page_number_idx ON report_images(page_number);

-- Persona-specific summaries for inspection reports
CREATE TABLE IF NOT EXISTS report_summaries (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  summary_type TEXT NOT NULL CHECK(summary_type IN ('executive', 'novice', 'diy', 'technical')),
  overall_condition TEXT CHECK(overall_condition IN ('excellent', 'good', 'fair', 'poor')),
  key_concerns TEXT,
  immediate_actions TEXT,
  estimated_total_cost_min INTEGER,
  estimated_total_cost_max INTEGER,
  summary_text TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ai_model_version TEXT,
  prompt_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX report_summaries_report_id_idx ON report_summaries(report_id);
CREATE INDEX report_summaries_type_idx ON report_summaries(summary_type);
CREATE UNIQUE INDEX report_summaries_report_type_idx ON report_summaries(report_id, summary_type);

-- DIY guidance for action items
CREATE TABLE IF NOT EXISTS action_item_guidance (
  id TEXT PRIMARY KEY,
  action_item_id TEXT NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  is_diy_suitable INTEGER NOT NULL DEFAULT 0 CHECK(is_diy_suitable IN (0, 1)),
  diy_difficulty TEXT CHECK(diy_difficulty IN ('easy', 'moderate', 'difficult', 'expert')),
  diy_time_estimate TEXT,
  diy_instructions TEXT,
  required_skills TEXT,
  required_tools TEXT,
  materials_list TEXT,
  safety_warnings TEXT,
  when_to_hire_pro TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX action_item_guidance_action_item_id_idx ON action_item_guidance(action_item_id);
CREATE UNIQUE INDEX action_item_guidance_unique_idx ON action_item_guidance(action_item_id);

-- ============================================
-- SCHEMA MODIFICATIONS
-- ============================================

-- Add new columns to findings table
ALTER TABLE findings ADD COLUMN location_description TEXT;
ALTER TABLE findings ADD COLUMN urgency_score INTEGER CHECK(urgency_score BETWEEN 1 AND 10);
ALTER TABLE findings ADD COLUMN impact_description TEXT;

-- Add new columns to action_items table
-- space_id is NOT added here: it's already part of the action_items table
-- definition in 0000_fixed_chronomancer.sql (a later baseline rewrite), so
-- adding it again breaks a from-scratch replay (local dev / CI / test DB).
-- Already-migrated remote databases are unaffected — they passed through
-- this file before 0000 absorbed the column and never replay it again.
ALTER TABLE action_items ADD COLUMN contractor_category TEXT;
ALTER TABLE action_items ADD COLUMN estimated_hours REAL;

-- Add new columns to reports table
ALTER TABLE reports ADD COLUMN total_findings_count INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN critical_findings_count INTEGER DEFAULT 0;
ALTER TABLE reports ADD COLUMN processing_progress INTEGER DEFAULT 0 CHECK(processing_progress BETWEEN 0 AND 100);
ALTER TABLE reports ADD COLUMN processing_stage TEXT;

-- ============================================
-- INDEXES FOR NEW COLUMNS
-- ============================================

CREATE INDEX findings_urgency_score_idx ON findings(urgency_score);
-- action_items_space_id_idx: also already created by 0000_fixed_chronomancer.sql, see above.
CREATE INDEX action_items_contractor_category_idx ON action_items(contractor_category);
CREATE INDEX reports_processing_stage_idx ON reports(processing_stage);
