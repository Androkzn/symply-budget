-- Dedicated AI assistant chat room, fleet-wide.
-- Adds an `is_assistant` flag to both chat-room tables (House `chat_rooms` and
-- Budget `budget_chat_rooms`). A flagged room is the app's single dedicated 1:1
-- AI assistant chat: auto-created, pinned on top of the rooms list, undeletable,
-- participant-locked, and every member message triggers an AI reply (no
-- `@assistant` mention needed). Additive; existing rooms default to 0 (false).

ALTER TABLE chat_rooms ADD COLUMN is_assistant INTEGER NOT NULL DEFAULT 0;

ALTER TABLE budget_chat_rooms ADD COLUMN is_assistant INTEGER NOT NULL DEFAULT 0;
