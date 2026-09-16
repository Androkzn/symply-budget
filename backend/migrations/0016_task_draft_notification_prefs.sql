-- Migration: Add notification preferences for task drafts and maintenance suggestions
-- This adds support for:
--   - task_drafts_ready: When task drafts are generated from a report
--   - critical_findings: When critical issues are found in reports
--   - maintenance_suggestions: When maintenance suggestions are generated

-- Add task_drafts_ready column
ALTER TABLE notification_preferences ADD COLUMN task_drafts_ready INTEGER NOT NULL DEFAULT 1;

-- Add critical_findings column
ALTER TABLE notification_preferences ADD COLUMN critical_findings INTEGER NOT NULL DEFAULT 1;

-- Add maintenance_suggestions column
ALTER TABLE notification_preferences ADD COLUMN maintenance_suggestions INTEGER NOT NULL DEFAULT 1;
