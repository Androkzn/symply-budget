-- Smart Task Assistant Phase 3b/4: task blockers + household activity feed.
--
-- Blockers: a member can flag a task as blocked (waiting on a part/quote/person).
-- Blocked tasks surface to the household and pause "overdue" nagging until cleared.
--
-- Notes: a household-visible activity feed (progress updates, blocker reports,
-- resolutions) so members can see progress and coordinate.

-- ---- Blocker columns on maintenance_tasks ----
ALTER TABLE maintenance_tasks ADD COLUMN blocked INTEGER DEFAULT 0;
ALTER TABLE maintenance_tasks ADD COLUMN blocker_reason TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN blocked_at TEXT;
ALTER TABLE maintenance_tasks ADD COLUMN blocked_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS maintenance_tasks_blocked_idx
  ON maintenance_tasks (blocked);

-- ---- Activity feed: maintenance_task_notes ----
CREATE TABLE IF NOT EXISTS maintenance_task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'progress', -- 'progress' | 'blocker' | 'resolution'
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS maintenance_task_notes_task_id_idx
  ON maintenance_task_notes (task_id);
CREATE INDEX IF NOT EXISTS maintenance_task_notes_created_at_idx
  ON maintenance_task_notes (created_at);
