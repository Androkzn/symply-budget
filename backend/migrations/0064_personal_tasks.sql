-- Migration 0064: Personal tasks
-- Adds is_personal flag and created_by to tasks table.
-- Personal tasks are visible only to their creator within a household.

ALTER TABLE tasks ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX maintenance_tasks_is_personal_idx ON tasks (is_personal);
CREATE INDEX maintenance_tasks_created_by_idx ON tasks (created_by);
