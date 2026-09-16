-- Migration: Add missing maintenance task workflow columns
-- Created: 2026-02-04
-- Adds contractor and workflow management fields to maintenance_tasks

-- Contractor and quote management fields
-- Already-migrated remotes have these columns; a fresh database never gets
-- them without these statements, breaking the indexes below.
ALTER TABLE maintenance_tasks ADD COLUMN needs_contractor INTEGER DEFAULT 0;
ALTER TABLE maintenance_tasks ADD COLUMN contractor_category TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN workflow_stage TEXT DEFAULT 'planning';
ALTER TABLE maintenance_tasks ADD COLUMN scheduled_work_date TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN scheduled_work_time_start TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN scheduled_work_time_end TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN selected_quote_id TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN linked_project_id TEXT;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS maintenance_tasks_workflow_stage_idx ON maintenance_tasks(workflow_stage);
CREATE INDEX IF NOT EXISTS maintenance_tasks_needs_contractor_idx ON maintenance_tasks(needs_contractor);
