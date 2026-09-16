-- Blockers get an order the member owns, the way phases already have one.
--
-- The Timeline and Blockers tabs are the same shape from the member's side: a
-- short list of lines they wrote, drafted for them by Smart Project, or seeded
-- from a template. Phases have been reorderable-in-principle since 0100 —
-- `home_project_phases.sort_order` exists and `getProject` sorts on it — but
-- blockers never got the column, so `getProject` returned them in bare scan
-- order and there was nothing to write a new order INTO.
--
-- That asymmetry is why this migration exists at all: without it "drag to
-- reorder" would work on one of the two lists on the same screen, which reads
-- as a bug in the tab rather than a missing column.
--
-- BACKFILL, and why it is not just `DEFAULT 0`.
--
-- Every existing row would take 0 and every list would then be "sorted" by a
-- constant. SQLite is free to return equal keys in any order, so a household
-- that has looked at the same eight blockers for months could open the tab
-- after this deploy and find them shuffled — a change nobody asked for, in a
-- list where position is about to start meaning something. The backfill below
-- freezes TODAY's order (rowid, which is the order the unordered scan returned)
-- as 0..n-1 per project, so the first read after the migration looks exactly
-- like the last read before it.
--
-- Shared fleet schema: `migrations_dir` is shared, so this lands on Budget,
-- Kaizen and Health D1s too — as one unread column on a table they do not use.
-- Apply to staging AND production for every fleet brand BEFORE deploy:fleet.

-- Position within the project's blocker list, ascending. Matches
-- `home_project_phases.sort_order` in type, default and meaning.
ALTER TABLE home_project_blockers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Freeze the order the member is looking at right now. `rowid` is insertion
-- order, which is what the unordered scan in `getProject` has been returning.
UPDATE home_project_blockers
SET sort_order = (
  SELECT COUNT(*)
  FROM home_project_blockers AS earlier
  WHERE earlier.project_id = home_project_blockers.project_id
    AND earlier.rowid < home_project_blockers.rowid
);
