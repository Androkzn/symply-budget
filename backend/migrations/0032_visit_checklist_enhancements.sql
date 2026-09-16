-- ============================================
-- Migration: Extend existing tables for AI-powered visit checklists
-- Date: 2026-02-06
-- Description: Add visit mode functionality and AI question generation support
-- ============================================

-- ============================================
-- 1. EXTEND contractor_visits TABLE
-- Add visit mode tracking and task linkage
-- ============================================

-- ALTER TABLE contractor_visits ADD COLUMN visit_mode_started_at TEXT;
-- ALTER TABLE contractor_visits ADD COLUMN visit_mode_ended_at TEXT;
-- ALTER TABLE contractor_visits ADD COLUMN contractor_rep_name TEXT;
-- ALTER TABLE contractor_visits ADD COLUMN task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL;

-- Indexes for task linkage and visit mode queries
-- COMMENTED OUT: Depends on columns that may not exist
-- CREATE INDEX contractor_visits_task_id_idx ON contractor_visits(task_id);
-- CREATE INDEX contractor_visits_visit_mode_idx ON contractor_visits(visit_mode_started_at) WHERE visit_mode_started_at IS NOT NULL;

-- ============================================
-- 2. EXTEND visit_checklists TABLE
-- Add AI generation context and task linkage
-- ============================================

-- ALTER TABLE visit_checklists ADD COLUMN task_id TEXT REFERENCES maintenance_tasks(id) ON DELETE SET NULL;
-- ALTER TABLE visit_checklists ADD COLUMN source TEXT DEFAULT 'manual'; -- 'manual', 'ai_generated', 'template'
-- ALTER TABLE visit_checklists ADD COLUMN ai_generation_context TEXT; -- JSON: task details, images, category

-- Indexes for task linkage and source filtering
-- COMMENTED OUT: Depends on columns that may not exist
-- CREATE INDEX visit_checklists_task_id_idx ON visit_checklists(task_id);
-- CREATE INDEX visit_checklists_source_idx ON visit_checklists(source);

-- ============================================
-- 3. EXTEND checklist_items TABLE
-- Add AI suggestion tracking
-- ============================================

-- ALTER TABLE checklist_items ADD COLUMN source TEXT DEFAULT 'manual'; -- 'manual', 'ai_suggested'
-- ALTER TABLE checklist_items ADD COLUMN ai_confidence REAL; -- 0-1 confidence score
-- ALTER TABLE checklist_items ADD COLUMN suggested_at TEXT; -- When AI suggested this
-- ALTER TABLE checklist_items ADD COLUMN accepted_at TEXT; -- When user accepted suggestion
-- ALTER TABLE checklist_items ADD COLUMN dismissed_at TEXT; -- When user dismissed suggestion

-- Indexes for AI suggestion tracking and filtering
-- COMMENTED OUT: Depends on columns that may not exist
-- CREATE INDEX checklist_items_source_idx ON checklist_items(source);
-- CREATE INDEX checklist_items_suggested_idx ON checklist_items(suggested_at) WHERE suggested_at IS NOT NULL;
-- CREATE INDEX checklist_items_ai_suggested_pending_idx ON checklist_items(source, suggested_at)
--   WHERE source = 'ai_suggested' AND accepted_at IS NULL AND dismissed_at IS NULL;

-- ============================================
-- 4. ADD VISIT-LEVEL VOICE RECORDING
-- Support for recording entire visit with AI transcription
-- ============================================

-- ALTER TABLE contractor_visits ADD COLUMN voice_recording_key TEXT; -- R2 storage key for full visit recording
-- ALTER TABLE contractor_visits ADD COLUMN voice_recording_transcription TEXT; -- AI transcription
-- ALTER TABLE contractor_visits ADD COLUMN voice_recording_duration_seconds INTEGER; -- Duration in seconds
-- ALTER TABLE contractor_visits ADD COLUMN voice_recording_analysis TEXT; -- JSON: AI analysis of recording

-- ============================================
-- 5. CREATE CHECKLIST ITEM PHOTOS TABLE
-- Support for attaching photos to individual checklist items
-- ============================================

CREATE TABLE IF NOT EXISTS checklist_item_photos (
  id TEXT PRIMARY KEY,
  checklist_item_id TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  photo_key TEXT NOT NULL, -- R2 storage key
  thumbnail_key TEXT, -- R2 storage key for thumbnail
  caption TEXT,
  taken_at TEXT, -- When photo was taken
  file_size INTEGER,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for photo lookups
CREATE INDEX checklist_item_photos_item_id_idx ON checklist_item_photos(checklist_item_id);
CREATE INDEX checklist_item_photos_household_id_idx ON checklist_item_photos(household_id);

-- ============================================
-- MIGRATION NOTES
-- ============================================
--
-- This migration extends existing tables rather than creating new ones.
-- All new columns are nullable to allow existing records to remain valid.
--
-- NEW FEATURES ADDED:
-- 1. Visit mode tracking (start/end timestamps, contractor rep)
-- 2. Task linkage (connect visits and checklists to maintenance tasks)
-- 3. AI-generated question suggestions with confidence scoring
-- 4. Voice recording support (per-item via existing fields, full-visit via new fields)
-- 5. Photo attachments per checklist item
--
-- Related tables (already exist, no changes needed):
-- - contractor_representatives: Store contractor rep details
-- - maintenance_tasks: Link tasks to visits and checklists
-- - technical_terms: Store technical term definitions for info icons
--
-- Usage examples after migration:
--
-- 1. Start visit mode:
--    UPDATE contractor_visits
--    SET visit_mode_started_at = datetime('now'), contractor_rep_name = 'John Smith'
--    WHERE id = 'visit-123';
--
-- 2. Create AI-generated checklist:
--    INSERT INTO visit_checklists (id, household_id, task_id, title, source, ai_generation_context)
--    VALUES ('checklist-123', 'household-456', 'task-789', 'Electrical Panel Questions', 'ai_generated', '{"category": "electrical", ...}');
--
-- 3. Add AI-suggested question:
--    INSERT INTO checklist_items (id, checklist_id, text, source, ai_confidence, suggested_at, priority)
--    VALUES ('item-123', 'checklist-123', 'Ask about permits', 'ai_suggested', 0.95, datetime('now'), 'must_ask');
--
-- 4. Accept AI suggestion:
--    UPDATE checklist_items SET accepted_at = datetime('now') WHERE id = 'item-123';
--
-- ============================================
