-- Garden plans: photos/sketches of yards, beds, outdoor areas with pinned tasks.
-- Intentionally separate from floor_plans (no floor detection, OCR, or scale).

CREATE TABLE garden_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL DEFAULT 'garden',
  original_file_key TEXT NOT NULL,
  display_image_key TEXT,
  thumbnail_key TEXT,
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  label TEXT,
  width_px INTEGER,
  height_px INTEGER,
  content_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending_upload',
  error_message TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX garden_plans_household_id_idx ON garden_plans(household_id);
CREATE INDEX garden_plans_status_idx ON garden_plans(status);

CREATE TABLE garden_plan_markers (
  id TEXT PRIMARY KEY,
  garden_plan_id TEXT NOT NULL REFERENCES garden_plans(id) ON DELETE CASCADE,
  x_percent INTEGER NOT NULL,
  y_percent INTEGER NOT NULL,
  linked_entity_type TEXT NOT NULL,
  linked_entity_id TEXT NOT NULL,
  marker_color TEXT NOT NULL DEFAULT '#4CAF50',
  marker_icon TEXT NOT NULL DEFAULT '🌿',
  label TEXT,
  show_label INTEGER DEFAULT 1,
  space_id TEXT REFERENCES household_spaces(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX garden_plan_markers_plan_id_idx ON garden_plan_markers(garden_plan_id);
CREATE INDEX garden_plan_markers_linked_entity_idx ON garden_plan_markers(linked_entity_type, linked_entity_id);
CREATE INDEX garden_plan_markers_space_id_idx ON garden_plan_markers(space_id);
