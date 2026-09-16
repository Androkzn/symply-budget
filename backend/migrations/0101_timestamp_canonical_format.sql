-- ============================================
-- Migration: Canonical timestamp format (Track B / B10)
-- Date: 2026-07-16
-- Description: Documents ISO-8601 UTC as the canonical write format and adds
--              scaffolding for a deferred chunked backfill of legacy
--              `datetime('now')` rows (`YYYY-MM-DD HH:MM:SS`).
--
-- Policy (expand-only, safe to apply before Worker cutover):
--   • NEW application writes MUST use backend/src/utils/id.ts `now()` / `nowIso()`.
--   • Full historical backfill is DEFERRED — run via cron helper stub
--     `runTimestampBackfillChunk()` once a table list and batch size are approved.
--   • Do NOT rewrite this migration after apply (DATA-1 immutability).
-- ============================================

CREATE TABLE IF NOT EXISTS timestamp_backfill_checkpoints (
  table_name TEXT PRIMARY KEY,
  last_row_id TEXT,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed checkpoint rows documenting deferred scope (no data mutation yet).
INSERT OR IGNORE INTO timestamp_backfill_checkpoints (table_name, notes)
VALUES
  ('_policy', 'canonical=ISO-8601 UTC via now(); legacy=datetime(''now'') TEXT defaults'),
  ('household_spaces', 'deferred: backfill created_at/updated_at/deleted_at when scheduled'),
  ('budget_items', 'deferred: backfill created_at/updated_at when scheduled'),
  ('registered_transactions', 'deferred: balance recompute already uses SQL aggregates');
