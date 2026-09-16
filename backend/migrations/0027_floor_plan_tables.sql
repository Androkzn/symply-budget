-- Floor Plans table
-- This table was never captured in the migration history — it exists on
-- already-migrated remotes (created out-of-band at some point), but a fresh
-- database has no way to create it, breaking this file's own foreign keys
-- below plus the later ALTERs in 0043/0044/0051. Backfilled here to match
-- src/db/schema-floor-plans.ts as it stood before those later columns.
CREATE TABLE IF NOT EXISTS floor_plans (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- File storage keys (R2/S3)
  original_file_key TEXT NOT NULL,
  display_image_key TEXT,
  thumbnail_key TEXT,

  -- Metadata
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content_type TEXT NOT NULL,

  -- Building/Floor organization
  building_name TEXT NOT NULL,
  floor_number INTEGER,
  floor_label TEXT,

  -- Image dimensions
  width_px INTEGER,
  height_px INTEGER,

  -- Scale
  scale_pixels_per_foot REAL,
  scale_pixels_per_meter REAL,
  scale_unit TEXT DEFAULT 'feet',
  scale_calibration_method TEXT DEFAULT 'none',

  -- OCR processing
  ocr_status TEXT DEFAULT 'pending',
  ocr_detected_dimensions TEXT,

  -- AI Analysis
  ai_analysis_status TEXT DEFAULT 'pending',
  ai_analysis_data TEXT,
  ai_property_address TEXT,
  ai_total_area_sqft REAL,
  ai_floor_count INTEGER,
  ai_analyzed_at TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending_upload',
  processing_stage TEXT,
  error_message TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS floor_plans_household_id_idx ON floor_plans(household_id);
CREATE INDEX IF NOT EXISTS floor_plans_building_name_idx ON floor_plans(building_name);
CREATE INDEX IF NOT EXISTS floor_plans_status_idx ON floor_plans(status);

-- Floor Plan Markers table
CREATE TABLE IF NOT EXISTS floor_plan_markers (
  id TEXT PRIMARY KEY,
  floor_plan_id TEXT NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  
  -- Position (percentage-based for scale independence)
  x_percent REAL NOT NULL,
  y_percent REAL NOT NULL,
  
  -- Linked entity
  linked_entity_type TEXT NOT NULL,
  linked_entity_id TEXT NOT NULL,
  
  -- Customization
  marker_type TEXT NOT NULL DEFAULT 'pin',
  marker_color TEXT NOT NULL DEFAULT '#FF6B6B',
  marker_icon TEXT NOT NULL DEFAULT '📍',
  label TEXT,
  show_label INTEGER DEFAULT 1,
  
  -- Space association
  space_id TEXT REFERENCES household_spaces(id) ON DELETE SET NULL,
  
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS floor_plan_markers_floor_plan_id_idx ON floor_plan_markers(floor_plan_id);
CREATE INDEX IF NOT EXISTS floor_plan_markers_linked_entity_idx ON floor_plan_markers(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS floor_plan_markers_space_id_idx ON floor_plan_markers(space_id);

-- Floor Plan Annotations table
CREATE TABLE IF NOT EXISTS floor_plan_annotations (
  id TEXT PRIMARY KEY,
  floor_plan_id TEXT NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  annotation_type TEXT NOT NULL,
  svg_data TEXT NOT NULL,
  stroke_color TEXT NOT NULL DEFAULT '#000000',
  stroke_width REAL NOT NULL DEFAULT 2,
  fill_color TEXT,
  opacity REAL NOT NULL DEFAULT 1,
  text_content TEXT,
  font_size INTEGER DEFAULT 14,
  measurement_value REAL,
  measurement_unit TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS floor_plan_annotations_floor_plan_id_idx ON floor_plan_annotations(floor_plan_id);
CREATE INDEX IF NOT EXISTS floor_plan_annotations_type_idx ON floor_plan_annotations(annotation_type);
