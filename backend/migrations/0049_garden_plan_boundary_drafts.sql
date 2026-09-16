-- Boundary-confirmed garden plan generation.
-- A draft captures the address, geocode result, parcel lookup, and the final
-- user-confirmed plot polygon before any AI generation is enqueued.

CREATE TABLE garden_plan_boundary_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_json TEXT NOT NULL,
  formatted_address TEXT NOT NULL,
  geocode_json TEXT,
  geocode_place_name TEXT,
  geocode_lat REAL,
  geocode_lon REAL,
  parcel_provider TEXT,
  parcel_id TEXT,
  parcel_geojson TEXT,
  parcel_confidence TEXT,
  parcel_match_json TEXT,
  confirmed_geojson TEXT,
  boundary_source TEXT,
  preview_image_key TEXT,
  reference_image_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX garden_boundary_drafts_household_status_idx
  ON garden_plan_boundary_drafts(household_id, status);

CREATE INDEX garden_boundary_drafts_user_idx
  ON garden_plan_boundary_drafts(user_id);

ALTER TABLE garden_plans ADD COLUMN boundary_draft_id TEXT;
ALTER TABLE garden_plans ADD COLUMN boundary_source TEXT;
ALTER TABLE garden_plans ADD COLUMN boundary_geojson TEXT;
ALTER TABLE garden_plans ADD COLUMN geocode_place_name TEXT;
ALTER TABLE garden_plans ADD COLUMN generation_prompt TEXT;

CREATE INDEX garden_plans_boundary_draft_idx
  ON garden_plans(boundary_draft_id);
