-- Editable vector objects layered over completed garden plans.

CREATE TABLE garden_plan_objects (
  id TEXT PRIMARY KEY NOT NULL,
  garden_plan_id TEXT NOT NULL REFERENCES garden_plans(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  rotation REAL NOT NULL DEFAULT 0,
  label TEXT,
  color TEXT,
  metadata_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX garden_plan_objects_plan_id_idx
  ON garden_plan_objects(garden_plan_id);
