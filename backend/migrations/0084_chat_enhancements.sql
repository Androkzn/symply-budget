-- Household chat enhancements: image attachments, edit/delete, and per-room
-- participant scoping.
--
-- 1. chat_messages gains:
--    - attachments_json: JSON array of { key, mimeType?, width?, height? } for
--      image (and future file) attachments served from R2 via /files/:key.
--    - edited_at: set when a member edits their own message (renders "edited").
--    - deleted_at: soft-delete marker. The body/attachments are blanked and the
--      bubble renders a "message deleted" tombstone; the row is kept so history
--      pagination and reply context stay stable.
--
-- 2. chat_room_participants: OPTIONAL, additive per-room membership. A room with
--    ZERO participant rows (and the default "General" room) stays visible to
--    EVERY household member — this preserves the existing "everyone is in every
--    room" behavior with no backfill. Once an owner restricts a room by adding
--    participants, only those members (plus the room creator) can see it.
ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT;
ALTER TABLE chat_messages ADD COLUMN edited_at TEXT;
ALTER TABLE chat_messages ADD COLUMN deleted_at TEXT;

CREATE TABLE chat_room_participants (
  room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX chat_room_participants_user_idx ON chat_room_participants(user_id);
