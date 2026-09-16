-- Migration: Add maintenance feature extensions
-- Created: 2026-01-23
-- Adds tables for garbage collection, appliances, task templates, service providers, and seasonal checklists

-- ============ GARBAGE COLLECTION ============

CREATE TABLE IF NOT EXISTS garbage_schedules (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  municipality TEXT NOT NULL,
  schedules TEXT NOT NULL,
  set_out_time TEXT,
  collection_start_time TEXT,
  remove_by_time TEXT,
  holiday_shifts TEXT,
  reminders TEXT,
  source TEXT,
  last_verified TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS garbage_schedules_household_id_idx ON garbage_schedules(household_id);
CREATE INDEX IF NOT EXISTS garbage_schedules_municipality_idx ON garbage_schedules(municipality);

CREATE TABLE IF NOT EXISTS municipality_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  garbage_provider TEXT,
  garbage_schedule_lookup_url TEXT,
  noise_bylaws TEXT,
  property_maintenance_bylaws TEXT,
  contacts TEXT,
  last_updated TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS municipality_configs_name_idx ON municipality_configs(name);
CREATE UNIQUE INDEX IF NOT EXISTS municipality_configs_code_idx ON municipality_configs(code);

-- ============ APPLIANCES ============

CREATE TABLE IF NOT EXISTS appliances (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES household_spaces(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  purchase_date TEXT,
  install_date TEXT,
  expected_lifespan INTEGER,
  warranty TEXT,
  purchase_cost INTEGER,
  total_maintenance_cost INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS appliances_household_id_idx ON appliances(household_id);
CREATE INDEX IF NOT EXISTS appliances_space_id_idx ON appliances(space_id);
CREATE INDEX IF NOT EXISTS appliances_category_idx ON appliances(category);

CREATE TABLE IF NOT EXISTS appliance_documents (
  id TEXT PRIMARY KEY,
  appliance_id TEXT NOT NULL REFERENCES appliances(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  upload_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS appliance_documents_appliance_id_idx ON appliance_documents(appliance_id);
CREATE INDEX IF NOT EXISTS appliance_documents_type_idx ON appliance_documents(type);

-- ============ SERVICE PROVIDERS ============
-- Created before appliance_service_history to allow FK reference

CREATE TABLE IF NOT EXISTS service_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  service_areas TEXT,
  rating REAL,
  review_count INTEGER DEFAULT 0,
  is_verified INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS service_providers_category_idx ON service_providers(category);
CREATE INDEX IF NOT EXISTS service_providers_rating_idx ON service_providers(rating);
CREATE INDEX IF NOT EXISTS service_providers_is_verified_idx ON service_providers(is_verified);

CREATE TABLE IF NOT EXISTS appliance_service_history (
  id TEXT PRIMARY KEY,
  appliance_id TEXT NOT NULL REFERENCES appliances(id) ON DELETE CASCADE,
  service_date TEXT NOT NULL,
  description TEXT NOT NULL,
  cost INTEGER,
  provider_id TEXT REFERENCES service_providers(id),
  completed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS appliance_service_history_appliance_id_idx ON appliance_service_history(appliance_id);
CREATE INDEX IF NOT EXISTS appliance_service_history_service_date_idx ON appliance_service_history(service_date);

-- ============ TASK TEMPLATES ============

CREATE TABLE IF NOT EXISTS maintenance_task_templates (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,
  custom_interval_days INTEGER,
  preferred_months TEXT,
  seasonal_only TEXT,
  difficulty TEXT,
  estimated_duration INTEGER,
  estimated_cost TEXT,
  tools_required TEXT,
  tutorial_url TEXT,
  gva_specific INTEGER DEFAULT 0,
  climate_zone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS maintenance_task_templates_category_idx ON maintenance_task_templates(category);
CREATE INDEX IF NOT EXISTS maintenance_task_templates_frequency_idx ON maintenance_task_templates(frequency);
CREATE INDEX IF NOT EXISTS maintenance_task_templates_gva_specific_idx ON maintenance_task_templates(gva_specific);

CREATE TABLE IF NOT EXISTS service_provider_reviews (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES service_providers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  review_text TEXT,
  service_date TEXT,
  cost INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS service_provider_reviews_provider_id_idx ON service_provider_reviews(provider_id);
CREATE INDEX IF NOT EXISTS service_provider_reviews_user_id_idx ON service_provider_reviews(user_id);
CREATE INDEX IF NOT EXISTS service_provider_reviews_rating_idx ON service_provider_reviews(rating);

-- ============ SEASONAL CHECKLISTS ============

CREATE TABLE IF NOT EXISTS seasonal_checklists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  year INTEGER NOT NULL,
  climate_zone TEXT NOT NULL,
  progress INTEGER DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS seasonal_checklists_household_id_idx ON seasonal_checklists(household_id);
CREATE INDEX IF NOT EXISTS seasonal_checklists_season_year_idx ON seasonal_checklists(season, year);

CREATE TABLE IF NOT EXISTS seasonal_checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES seasonal_checklists(id) ON DELETE CASCADE,
  task_template_id TEXT REFERENCES maintenance_task_templates(id),
  title TEXT NOT NULL,
  category TEXT,
  is_completed INTEGER DEFAULT 0,
  completed_at TEXT,
  completed_by TEXT REFERENCES users(id),
  notes TEXT,
  photo_keys TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  updated_by TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS seasonal_checklist_items_checklist_id_idx ON seasonal_checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS seasonal_checklist_items_is_completed_idx ON seasonal_checklist_items(is_completed);
