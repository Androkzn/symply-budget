-- ============================================
-- Migration: household_members responsibilities + google_calendar_tokens (Stream A6)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A6, §G3
-- Description: Adds responsibility + notification-channel columns to
--              household_members. Folds: google_calendar_tokens per plan §G3
--              ("Decision: fold into A6 via an additional CREATE TABLE block
--              — one fewer migration file.")
--
-- NOTE: household_members.role already exists at backend/src/db/schema.ts:146 — do NOT re-add.
-- NOTE: deleted_at already present via softDelete spread at backend/src/db/schema.ts:150 — reuse.
-- ============================================

ALTER TABLE household_members ADD COLUMN responsibilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE household_members ADD COLUMN notification_channel_preference TEXT NOT NULL DEFAULT 'auto';
-- notification_channel_preference values: 'auto' | 'push' | 'email' | 'sms' | 'none'

-- ============================================
-- Folded: google_calendar_tokens (per §G3)
-- Per-member OAuth tokens for Google Calendar (calendar.readonly scope).
-- Tokens refresh automatically; if refresh fails, propose_calendar_slots
-- returns a tool-level error prompting the user to re-link.
-- ============================================

CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  member_id TEXT PRIMARY KEY REFERENCES household_members(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
