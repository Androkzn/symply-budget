-- Per-region floor plan extraction (layout detect → crop → spaces + hybrid vectors).
-- Region rows are the source of truth for crop / semantic / trace assets.
-- Parent floor_plans.ai_analysis_data remains the aggregated My Home summary.

CREATE TABLE IF NOT EXISTS floor_plan_regions (
  id TEXT PRIMARY KEY NOT NULL,
  floor_plan_id TEXT NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- floor | detached
  name TEXT NOT NULL,
  level INTEGER,
  detached_type TEXT, -- shed, storage, detached_garage, etc. (kind=detached only)
  sort_order INTEGER NOT NULL DEFAULT 0,
  bounding_box TEXT NOT NULL, -- JSON {x1,y1,x2,y2} normalized 0-1
  crop_image_key TEXT,
  vector_trace_key TEXT,
  vector_semantic_key TEXT,
  spaces_json TEXT, -- JSON array of SpaceInfo
  status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed | skipped
  trace_status TEXT NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed | skipped
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS floor_plan_regions_floor_plan_id_idx
  ON floor_plan_regions(floor_plan_id);

CREATE INDEX IF NOT EXISTS floor_plan_regions_status_idx
  ON floor_plan_regions(status);
