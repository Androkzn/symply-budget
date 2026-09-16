-- ============================================
-- Migration: Aihousekeeper identity + memory (Stream A1)
-- Date: 2026-04-23
-- Plan: documents/Requirenments/AI Houskeeper /MCP_UI_Implementation_Plan_v3.1.md §A1
-- Description: Introduces the Aihousekeeper persona (assistant_identity),
--              the memory store (assistant_memory) with FTS5 recall index,
--              and FTS5 sync triggers. One row per household is seeded
--              at createHousehold time (see household-service.ts).
-- ============================================

-- Aihousekeeper persona (one row per household; seeded on createHousehold)
CREATE TABLE IF NOT EXISTS assistant_identity (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Aihousekeeper',
  tone TEXT NOT NULL DEFAULT 'warm_brief',
  pronouns TEXT,
  briefing_time TEXT NOT NULL DEFAULT '07:00',
  quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
  daily_interrupt_budget INTEGER NOT NULL DEFAULT 3,
  channels_enabled_json TEXT NOT NULL DEFAULT '{"push":true,"sms":false,"email_weekly":false,"watch":true}',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Aihousekeeper memory store
CREATE TABLE IF NOT EXISTS assistant_memory (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('fact','preference','history','decision','unresolved_question')),
  subject_kind TEXT,
  subject_id TEXT,
  body TEXT NOT NULL,
  redacted_body TEXT,                                     -- Haiku-summarized PII-masked version used for prompt injection
  confidence REAL NOT NULL DEFAULT 0.7,
  source TEXT NOT NULL CHECK (source IN ('user_said','inferred','tool_result','external_signal')),
  source_ref TEXT,
  is_anniversary_tracked INTEGER NOT NULL DEFAULT 0,     -- referenced by anniversary_of_past_event trigger (Stream D)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  expires_at TEXT,
  superseded_by_id TEXT REFERENCES assistant_memory(id)
);

CREATE INDEX IF NOT EXISTS idx_assistant_memory_household
  ON assistant_memory(household_id, type, superseded_by_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_subject
  ON assistant_memory(household_id, subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_anniversary
  ON assistant_memory(household_id, is_anniversary_tracked)
  WHERE is_anniversary_tracked = 1;

-- FTS5 index for recall. Indexes both `body` (full truth) and `redacted_body`
-- (PII-masked version the Haiku relevance scorer actually consumes).
CREATE VIRTUAL TABLE IF NOT EXISTS assistant_memory_fts USING fts5(
  body,
  redacted_body,
  content='assistant_memory',
  content_rowid='rowid'
);

-- Triggers keep FTS5 in sync with assistant_memory.
CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_insert
AFTER INSERT ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(rowid, body, redacted_body)
  VALUES (new.rowid, new.body, new.redacted_body);
END;

CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_delete
AFTER DELETE ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body)
  VALUES ('delete', old.rowid, old.body, old.redacted_body);
END;

CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_update
AFTER UPDATE ON assistant_memory BEGIN
  INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body)
  VALUES ('delete', old.rowid, old.body, old.redacted_body);
  INSERT INTO assistant_memory_fts(rowid, body, redacted_body)
  VALUES (new.rowid, new.body, new.redacted_body);
END;
