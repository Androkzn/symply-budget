-- Subject-scoped chat rooms — "the chat ABOUT this thing".
--
-- A household chat room gains an optional SUBJECT: the entity the conversation
-- belongs to. House uses two of them today — `home_project` (one general chat
-- per project) and `home_project_material` (one chat per material/selection) —
-- but nothing here is project-specific, so a future "chat about this appliance"
-- or "chat about this quote" needs code, not another migration.
--
-- WHY THERE IS NO FOREIGN KEY, and why that is the whole point
-- ------------------------------------------------------------
-- House V2 is local-first: `home_projects` is Tier A, so for a local-first
-- household the project row lives ONLY in the on-device encrypted ledger and D1
-- has never seen it. Chat is Tier B (server-authoritative, Durable-Object
-- fan-out) and always will be — a live multi-member conversation with an AI
-- participant is not a thing a device ledger can serve.
--
-- A REFERENCES clause to `home_projects` would therefore make project chat
-- impossible for exactly the households House V2 is built for: every insert
-- would fail on a subject id the server is not allowed to know. `subject_id` is
-- deliberately an OPAQUE STRING scoped by `household_id` — the same id both
-- backends already agree on — and the room carries its own denormalized
-- `subject_label` so the rooms list can render "Kitchen Reno" without asking a
-- backend that may not have it.
--
-- The cost is that a deleted project can leave an orphan room. That is paid for
-- by `deleteSubjectRooms` (called best-effort from the delete path on both
-- backends), not by a constraint that would break the local-first case.
--
-- `subject_context_json` is the AI's grounding snapshot, written by the CLIENT
-- when it opens the room. Same reason: the client is the only party that can
-- see a local-first project's budget, phases and materials, so it is the only
-- party that can tell the assistant what this conversation is about.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too. The Budget columns are added to keep the two chat
-- table sets STRUCTURALLY IDENTICAL — `chat-room-service-core.ts` runs one
-- implementation over both and casts Budget's tables to the House shape, so a
-- column present on one and missing on the other is a runtime error waiting for
-- whichever app reads it second. Budget simply never sets them.
--
-- Apply to staging AND production for every fleet brand BEFORE deploy:fleet.

-- ============ House chat ============

-- 'home_project' | 'home_project_material'. NULL for an ordinary room, which is
-- every room that exists today.
ALTER TABLE chat_rooms ADD COLUMN subject_type TEXT;

-- The subject's id, opaque and unvalidated here (see above).
ALTER TABLE chat_rooms ADD COLUMN subject_id TEXT;

-- The subject's parent, when it has one: a material chat carries its project id
-- so "every chat under this project" is one indexed read, and so the rooms list
-- can group material chats under the project they belong to.
ALTER TABLE chat_rooms ADD COLUMN subject_parent_id TEXT;

-- Display text, denormalized on purpose. The rooms list must render a room's
-- title for a local-first household whose project the Worker cannot read.
ALTER TABLE chat_rooms ADD COLUMN subject_label TEXT;
ALTER TABLE chat_rooms ADD COLUMN subject_parent_label TEXT;

-- The assistant's grounding snapshot for this subject, refreshed by the client
-- each time it opens the room. Plain text inside a JSON envelope so the shape
-- can grow without a migration.
ALTER TABLE chat_rooms ADD COLUMN subject_context_json TEXT;

-- One room per subject per household. This is what makes "open the chat for
-- this material" idempotent from two devices at once: the loser of the race
-- gets a constraint violation and re-reads instead of creating a second room
-- nobody would ever find. Partial so the millions of subject-less rooms are not
-- forced into a single-NULL-tuple collision.
CREATE UNIQUE INDEX IF NOT EXISTS chat_rooms_subject_idx
  ON chat_rooms(household_id, subject_type, subject_id)
  WHERE subject_type IS NOT NULL;

-- "Every chat under this project" — the rooms list groups on it.
CREATE INDEX IF NOT EXISTS chat_rooms_subject_parent_idx
  ON chat_rooms(household_id, subject_parent_id)
  WHERE subject_parent_id IS NOT NULL;

-- ============ Budget chat (structural parity only — never populated) ============

ALTER TABLE budget_chat_rooms ADD COLUMN subject_type TEXT;
ALTER TABLE budget_chat_rooms ADD COLUMN subject_id TEXT;
ALTER TABLE budget_chat_rooms ADD COLUMN subject_parent_id TEXT;
ALTER TABLE budget_chat_rooms ADD COLUMN subject_label TEXT;
ALTER TABLE budget_chat_rooms ADD COLUMN subject_parent_label TEXT;
ALTER TABLE budget_chat_rooms ADD COLUMN subject_context_json TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS budget_chat_rooms_subject_idx
  ON budget_chat_rooms(household_id, subject_type, subject_id)
  WHERE subject_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS budget_chat_rooms_subject_parent_idx
  ON budget_chat_rooms(household_id, subject_parent_id)
  WHERE subject_parent_id IS NOT NULL;
