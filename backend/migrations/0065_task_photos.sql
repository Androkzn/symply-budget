-- Task attachment photos (max 5 enforced in service layer).
CREATE TABLE IF NOT EXISTS task_photos (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  photo_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS task_photos_task_id_idx ON task_photos(task_id);
CREATE INDEX IF NOT EXISTS task_photos_household_id_idx ON task_photos(household_id);

ALTER TABLE tasks ADD COLUMN cover_photo_id TEXT;
CREATE INDEX IF NOT EXISTS tasks_cover_photo_id_idx ON tasks(cover_photo_id);
