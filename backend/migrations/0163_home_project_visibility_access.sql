-- Home project drafts and per-project member roles.
--
-- Two independent questions land on `home_projects` together because they are
-- both answered from the row a reader has already loaded, and splitting them
-- across a column and a join table would make every list read a second query.
--
--  1. `visibility` — whether the project exists for anyone but its creator. A
--     `draft` is a private scratch plan: it is not listed, not openable and not
--     notified to the rest of the household. Publishing is the act that shares
--     it.
--  2. `default_role` + `access_json` — who may CHANGE it once it is shared.
--     `owner` may edit and manage access; `viewer` may read only.
--
-- Both defaults reproduce today's behaviour exactly: every existing project is
-- `published`, and every household member keeps the `owner` role they
-- effectively had before this migration. Nobody loses access on deploy.
--
-- Why `access_json` is a COLUMN and not a `home_project_members` table: the
-- local-first ledger cannot hold a PK-less join (hazard S2, see
-- `localHomeProjectsApi.ts`), and a per-project role list is small, read as a
-- block with its parent, and never queried across projects — the same call
-- `projects.linked_task_ids` already makes. The shape is
-- `[{ "user_id": "...", "role": "owner" | "viewer" }]`; NULL means "no explicit
-- grants, use `default_role`". `packages/contracts/src/home-project-access.ts`
-- is the single parser/resolver both backends go through.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as unread columns on a table they do not use.
-- Apply to staging AND production for every fleet brand BEFORE deploy:fleet.

-- 'draft' | 'published'. Default keeps every existing project shared.
ALTER TABLE home_projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'published';

-- 'owner' | 'viewer' — the role a household member with no explicit grant gets.
-- Default 'owner' because before this migration every member could edit every
-- project, and a schema change must not silently revoke that.
ALTER TABLE home_projects ADD COLUMN default_role TEXT NOT NULL DEFAULT 'owner';

-- [{ "user_id": "...", "role": "owner" | "viewer" }] — explicit overrides only.
-- NULL is the common case and is stored in preference to '[]'.
ALTER TABLE home_projects ADD COLUMN access_json TEXT;

-- The list query filters drafts out for everyone but their creator, so the
-- household+visibility pair is what it actually scans.
CREATE INDEX IF NOT EXISTS hp_by_household_visibility
  ON home_projects(household_id, visibility);
