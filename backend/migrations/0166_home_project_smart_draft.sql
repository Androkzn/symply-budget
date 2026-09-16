-- Smart Project — describe-to-draft for Home Projects.
--
-- See documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md.
--
-- Three things land together because they are the three things a generated
-- draft needs that the schema could not already express:
--
--  1. `home_project_as_is` — what ALREADY exists. This is the feature's whole
--     reason for existing. "The shed has a roof, walls and a slab; inside it is
--     bare frame" is a scope defined as much by what is done as by what is
--     wanted, and with nowhere to record it a generated plan re-roofs a shed
--     that has a roof. The member then has to DELETE a plausible-looking phase,
--     which is a worse edit than adding a missing one: it requires knowing the
--     phase is wrong.
--
--  2. `home_project_smart_drafts` — the generation job. Same shape as the
--     `home_project_geometry` AI-schematic row that already exists (status /
--     confidence / error_code), because that pattern is proven and the cron
--     stuck-row sweep is already written against it.
--
--  3. `draft_source` / `draft_confidence` on the tables a draft writes into, so
--     the review screen can badge a row "AI drafted" until the member touches
--     it. Provenance is not cosmetic here — it is what lets someone scrolling a
--     plausible plan tell which lines nobody has checked.
--
-- NO PRICE COLUMN APPEARS ANYWHERE IN THIS MIGRATION. Smart Project writes
-- budget lines with labels and categories and `estimate_cents = 0`. The wizard's
-- template tiles had their cost hints removed because a wrong anchor is worse
-- than none; generating a whole budget would be that mistake at ten times the
-- surface area.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as unused tables and unread columns. Apply to
-- staging AND production for every fleet brand BEFORE deploy:fleet.

-- ---------------------------------------------------------------------------
-- 1. As-is state
-- ---------------------------------------------------------------------------
--
-- One row per (project, element). `id` is a real primary key rather than a
-- (project_id, element) composite because the local-first ledger cannot hold a
-- PK-less or composite-PK join — the same hazard S2 that made `access_json` a
-- column in 0163 rather than a `home_project_members` table.
--
-- `state` is 'present' | 'absent' | 'unknown', and `unknown` is NOT a synonym
-- for `absent`. "The member did not mention insulation" and "there is no
-- insulation" produce different drafts: the first becomes a question, the
-- second becomes a work phase. Collapsing the two would silently turn every gap
-- in a member's paragraph into budgeted work.
--
-- `evidence` holds the member's own words that decided the state, so review can
-- show WHY the slab was marked done. An inference nobody can audit is one
-- nobody can correct.
CREATE TABLE IF NOT EXISTS home_project_as_is (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  element TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unknown',
  evidence TEXT,
  -- 'manual' | 'smart_project' — a member correcting the model must not have
  -- their answer re-badged as AI output on the next render.
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS hpai_by_project ON home_project_as_is(project_id);

-- One state per element per project. A second row for the same element would
-- make "is the roof done?" depend on read order.
CREATE UNIQUE INDEX IF NOT EXISTS hpai_project_element
  ON home_project_as_is(project_id, element);

-- ---------------------------------------------------------------------------
-- 2. The generation job
-- ---------------------------------------------------------------------------
--
-- `status` is 'generating' | 'completed' | 'failed' | 'cancelled', mirroring
-- `home_project_geometry` so the stuck-row sweep in cron/scheduled.ts can treat
-- both the same way.
--
-- `spaces_json` stores the dimensions the member TYPED, verbatim. Every area in
-- the resulting draft is derived from this column by shared contract code — the
-- model is never asked for a number it would have had to multiply. Keeping the
-- input means a draft can be regenerated later without asking for measurements
-- twice.
--
-- `dropped_json` records phases suppressed by as-is state, so review can say
-- "we skipped Roofing because you said the roof is done". A member who sees
-- only what survived cannot tell whether the model understood them or simply
-- forgot roofing.
CREATE TABLE IF NOT EXISTS home_project_smart_drafts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'generating',
  -- The member's own description. Kept so the draft can be regenerated and so
  -- review can show what was actually asked for.
  description TEXT NOT NULL,
  spaces_json TEXT,
  attachment_ids_json TEXT,
  -- 'high' | 'medium' | 'low', the model's overall self-report. Advisory only:
  -- it orders the review list, it does not gate anything.
  confidence TEXT,
  disclaimer TEXT,
  error_code TEXT,
  dropped_json TEXT,
  -- Generated tasks, held HERE rather than written to `tasks` on generation.
  -- A House task is household-shared the moment it exists, so materialising a
  -- draft's tasks would put work in everyone's list for a project nobody else
  -- can see. They become real tasks on publish and not before.
  tasks_json TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS hpsd_by_project ON home_project_smart_drafts(project_id);

-- The stuck-row sweep scans for rows left 'generating' past the grace window.
CREATE INDEX IF NOT EXISTS hpsd_by_status_updated
  ON home_project_smart_drafts(status, updated_at);

-- ---------------------------------------------------------------------------
-- 3. Provenance on the tables a draft writes into
-- ---------------------------------------------------------------------------
--
-- 'manual' | 'smart_project'. Default 'manual' means every row that already
-- exists reads as the member's own work, which is exactly what it is.
--
-- `home_project_selections` is deliberately absent from this list: it already
-- carries `extraction_source` ('manual' | 'link_og' | 'link_ai' | 'link_url')
-- for precisely this purpose, and Smart Project adds 'smart_project' as a
-- fourth rung on that existing ladder. A second provenance mechanism on the
-- same table would give one card two answers to "where did this come from".

ALTER TABLE home_project_phases ADD COLUMN draft_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE home_project_phases ADD COLUMN draft_confidence TEXT;

ALTER TABLE home_project_option_groups ADD COLUMN draft_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE home_project_option_groups ADD COLUMN draft_confidence TEXT;

ALTER TABLE home_project_blockers ADD COLUMN draft_source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE home_project_blockers ADD COLUMN draft_confidence TEXT;

-- The change-of-use target ("woodworking shop", "home gym"). NULL for a
-- like-for-like renovation, which is most projects. It lives on the project
-- rather than in the summary text because it DRIVES requirements a room-type
-- template cannot express — dust extraction, circuit load, task lighting — and
-- a requirement pack keyed off prose would have to re-parse it every time.
ALTER TABLE home_projects ADD COLUMN target_use TEXT;
