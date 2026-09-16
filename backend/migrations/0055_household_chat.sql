-- ============================================
-- Migration: Household chat (multi-room messaging + AI assistant)
-- Date: 2026-06-23
-- Description: Multi-room, member-to-member chat with an optional AI assistant
--              pulled into a room via `@assistant`. D1 is the source of truth;
--              the ChatRoomDO durable object only fans messages out over
--              WebSockets and stores no message state.
--              See src/db/schema-chat.ts.
-- ============================================

CREATE TABLE IF NOT EXISTS chat_rooms (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS chat_rooms_household_idx
  ON chat_rooms(household_id, archived_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS chat_messages_room_created_idx
  ON chat_messages(room_id, created_at);

CREATE INDEX IF NOT EXISTS chat_messages_household_idx
  ON chat_messages(household_id);

CREATE TABLE IF NOT EXISTS chat_room_reads (
  room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id TEXT,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_room_reads_room_user_idx
  ON chat_room_reads(room_id, user_id);
