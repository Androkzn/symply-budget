-- ============================================
-- Migration: push_tokens app_version (Stream A7)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A7
-- Description: Format: semver string; null for tokens registered before this
--              column. Backend gates Aihousekeeper-typed pushes on
--              `app_version >= AIHOUSEKEEPER_MIN_APP_VERSION`; null or lower →
--              falls back to `data.type: 'cards_refresh'`.
-- ============================================

ALTER TABLE push_tokens ADD COLUMN app_version TEXT;
