-- The link between a home project and its jobs, moved onto the parent row.
--
-- `home_project_tasks` was a PK-less join — `project_id`, `task_id`, a
-- timestamp and nothing to address a row by. That is hazard S2 in the
-- local-first plan (§1.5): a row-oriented op log needs a stable row key, and
-- both ways of inventing one are worse than the join table itself.
--
--  - a RANDOM surrogate `id` re-creates the S3b duplicate: two members linking
--    the same task to the same project offline get two link rows;
--  - a DETERMINISTIC id derived from `(project_id, task_id)` fixes that and
--    walks into S3a instead, because link/unlink/re-link is the *normal* action
--    on a join row and the tombstone is absorbing — the second link would never
--    come back.
--
-- So the plan's own answer, taken here: model the link as an array on the
-- parent, exactly as `projects.linked_task_ids` (migration 0061) already does
-- and exactly as `home_projects.access_json` (0163) already does for the other
-- list this table could not hold. The parent row is keyed, already ledgered and
-- already read on every screen that would render the links.
--
-- What this buys, in member-visible terms: a local-first household can hold a
-- project's own tasks. Until this migration `homeProjectsApi.listTasks`,
-- `.linkTask` and `.createTask` all REFUSED on device, which is why the Smart
-- Project wizard shipped its "Tasks" tick-box disabled — the member could ask
-- for tasks and there was nowhere to put them.
--
-- The cost, stated plainly: under per-field LWW two devices that link two
-- different tasks OFFLINE converge on one device's array and the other link is
-- lost. That is a link to re-make, not a row that can never come back, which is
-- the trade the plan accepted over S3a/S3b. Sequential links (the ordinary
-- case, including every task the Smart Project wizard writes) union correctly.
--
-- Shape: a JSON array of task ids, `["task_a","task_b"]`. NULL means "none" and
-- is stored in preference to '[]', matching `access_json`.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as one unread column on a table they do not use,
-- and a drop of a table they never wrote to. Apply to staging AND production
-- for every fleet brand BEFORE deploy:fleet.

-- JSON array of `tasks.id`. NULL = no linked tasks.
ALTER TABLE home_projects ADD COLUMN linked_task_ids TEXT;

-- Carry every existing link across BEFORE the table goes. Unordered on
-- purpose: the join carried `created_at` but nothing ever read it — the service
-- returned rows in scan order — so insertion order is preserved in practice and
-- nothing downstream depends on it.
UPDATE home_projects
SET linked_task_ids = (
  SELECT json_group_array(task_id)
  FROM home_project_tasks
  WHERE home_project_tasks.project_id = home_projects.id
)
WHERE id IN (SELECT project_id FROM home_project_tasks);

-- The join table is now dead: `home-projects-service.ts` reads and writes the
-- column, and leaving an empty table behind would leave hazard S2 nominally
-- open for a table nobody writes.
DROP TABLE IF EXISTS home_project_tasks;
