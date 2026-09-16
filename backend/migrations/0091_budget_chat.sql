-- ============================================
-- Migration: Budget household chat (multi-room messaging + AI assistant)
-- Description: A 100%-independent fork of the House household chat, owned by the
--              Symply Budget app. Separate tables (budget_chat_*) so nothing is
--              shared with the House chat_* tables. Multi-room, member-to-member
--              chat with an optional AI assistant pulled into a room via
--              `@assistant` (replies only with the user's own BYOK key). D1 is
--              the source of truth; the shared, stateless ChatRoomDO durable
--              object fans messages out over WebSockets keyed by room id and
--              stores no message state.
--              See src/db/schema-budget-chat.ts.
-- ============================================

CREATE TABLE IF NOT EXISTS budget_chat_rooms (
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

CREATE INDEX IF NOT EXISTS budget_chat_rooms_household_idx
  ON budget_chat_rooms(household_id, archived_at);

CREATE TABLE IF NOT EXISTS budget_chat_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES budget_chat_rooms(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL,
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  metadata_json TEXT,
  attachments_json TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS budget_chat_messages_room_created_idx
  ON budget_chat_messages(room_id, created_at);

CREATE INDEX IF NOT EXISTS budget_chat_messages_household_idx
  ON budget_chat_messages(household_id);

CREATE TABLE IF NOT EXISTS budget_chat_room_participants (
  room_id TEXT NOT NULL REFERENCES budget_chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS budget_chat_room_participants_user_idx
  ON budget_chat_room_participants(user_id);

CREATE TABLE IF NOT EXISTS budget_chat_room_reads (
  room_id TEXT NOT NULL REFERENCES budget_chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_message_id TEXT,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS budget_chat_room_reads_room_user_idx
  ON budget_chat_room_reads(room_id, user_id);
