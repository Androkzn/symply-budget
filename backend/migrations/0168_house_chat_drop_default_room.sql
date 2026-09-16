-- House chat keeps ONE pre-made room: the undeletable "AI Assistant".
--
-- Retires every auto-created default room ("General", or whatever the household
-- renamed it to) from the House chat tables. Members' own rooms and every
-- project/material chat are untouched: still creatable, still deletable.
--
-- ARCHIVED, NOT DELETED — deliberately, and unlike the Budget equivalent
-- (0161). Budget's "General" was a duplicate nobody wrote in; House's is the
-- household's shared room and may hold real conversation history. `listRooms`
-- filters on `archived_at IS NULL`, so an archived room is gone from every list,
-- every unread count and every notification target — the same disappearance a
-- DELETE gives — while the messages stay recoverable if this turns out to be
-- the wrong call. To purge later, delete the children then the rows below.
--
-- Pair with the code change that stops House creating it at all (no
-- `defaultRoom` in services/chat/configs.ts). Archiving alone holds for the
-- households that exist today — `ensureDefaultRoom` matches on `is_default`
-- without checking `archived_at`, so it sees the archived row and creates
-- nothing — but a household created after this migration on the old code would
-- still be handed a "General". The config change is what closes that.
--
-- Only touches `chat_rooms` — the `budget_chat_*` tables are unaffected. Safe
-- to apply to every brand D1 (House, Budget, Kaizen, Health) on staging AND
-- production; re-running it is a no-op.

UPDATE chat_rooms
SET archived_at = datetime('now')
WHERE is_default = 1 AND archived_at IS NULL;
