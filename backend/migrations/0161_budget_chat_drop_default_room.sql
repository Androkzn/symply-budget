-- Budget chat keeps ONE pre-made room: the undeletable "AI Budget Assistant".
-- Drops every auto-created default room ("General", or whatever the household
-- renamed it to — it read as a second, duplicate AI chat) from the Budget chat
-- tables, with its messages, participants and read cursors. Members' own rooms
-- are untouched: they stay creatable and deletable.
--
-- Pair with the code change that stops Budget re-creating it (no `defaultRoom`
-- in services/chat/configs.ts) — without that deploy, listRooms recreates a
-- fresh "General" on the next open. Children are deleted explicitly rather than
-- relying on ON DELETE CASCADE so the result is identical regardless of FK
-- enforcement.
--
-- Only touches `budget_chat_*` — the House `chat_*` tables keep their General
-- room. Safe to apply to every brand D1 (House, Budget, Kaizen, Health) on
-- staging AND production.
--
-- Uploaded images for these rooms stay in R2 under
-- `budget-chat-images/<householdId>/<roomId>/` (SQL cannot reach the bucket);
-- they are orphaned objects, not served by anything.

DELETE FROM budget_chat_messages
WHERE room_id IN (SELECT id FROM budget_chat_rooms WHERE is_default = 1);

DELETE FROM budget_chat_room_participants
WHERE room_id IN (SELECT id FROM budget_chat_rooms WHERE is_default = 1);

DELETE FROM budget_chat_room_reads
WHERE room_id IN (SELECT id FROM budget_chat_rooms WHERE is_default = 1);

DELETE FROM budget_chat_rooms WHERE is_default = 1;
