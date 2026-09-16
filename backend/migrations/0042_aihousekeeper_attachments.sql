-- 0042_aihousekeeper_attachments.sql
--
-- Aihousekeeper chat attachments (v3.1 follow-up): lets the user attach images and
-- documents (receipts, quotes, floor plans, reports) directly in the Aihousekeeper
-- chat flow. Files land in R2 under `aihousekeeper-attachments/<household_id>/<id>/…`
-- and this table tracks their lifecycle + classification.
--
-- Lifecycle:
--   pending_upload  — row created, upload URL returned, file not yet in R2
--   uploaded        — user successfully PUT the bytes
--   classified      — Aihousekeeper (or user) has set `kind`; file stays in place
--   routed          — file has been copied/moved into the appropriate
--                     domain (reports, floor_plans, …) and `linked_entity_*`
--                     points to the new row
--   failed          — upload or routing failed; surfaced in trust ledger
--
-- Routing targets handled by the classify_and_save_attachment tool:
--   report     → copy to reports bucket + insert into `reports`
--   floor_plan → copy to floor_plans prefix + insert into `floor_plans`
--   photo / receipt / quote / note → stays in aihousekeeper-attachments/, kind set
--     for display; no domain row created yet (follow-up work).

CREATE TABLE IF NOT EXISTS aihousekeeper_attachments (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,

  status TEXT NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'uploaded', 'classified', 'routed', 'failed')),

  -- NULL until classified. See lifecycle comment.
  kind TEXT
    CHECK (kind IS NULL OR kind IN ('photo', 'report', 'floor_plan', 'receipt', 'quote', 'note')),

  -- Optional user hint at upload time ('image' | 'document'); non-authoritative.
  kind_hint TEXT,

  -- Set once routed; points at the row in the target domain table.
  linked_entity_type TEXT
    CHECK (linked_entity_type IS NULL OR linked_entity_type IN ('reports', 'floor_plans')),
  linked_entity_id TEXT,

  failure_reason TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_aihousekeeper_attachments_household_status
  ON aihousekeeper_attachments (household_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_aihousekeeper_attachments_household_created
  ON aihousekeeper_attachments (household_id, created_at DESC);
