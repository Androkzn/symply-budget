-- Home Projects: household renovation / improvement planning.
-- Distinct from Labor Hub projects (contractor jobs). Full 14-table suite.
-- Additive only. Available on House; child brands 404 via gateHomeApiPaths.

CREATE TABLE IF NOT EXISTS home_projects (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'renovation'
    CHECK (type IN ('renovation','replacement','remodel','expansion','finish_refresh','outdoor','custom')),
  template_key TEXT,
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('idea','planning','ready','in_progress','on_hold','done','archived')),
  summary TEXT,
  goals TEXT,
  constraints TEXT,
  target_budget_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  contingency_pct INTEGER NOT NULL DEFAULT 15,
  target_start_at TEXT,
  target_end_at TEXT,
  cover_attachment_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hp_by_household ON home_projects(household_id);
CREATE INDEX IF NOT EXISTS hp_by_household_status ON home_projects(household_id, status);

CREATE TABLE IF NOT EXISTS home_project_spaces (
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  PRIMARY KEY (project_id, space_id)
);
CREATE INDEX IF NOT EXISTS hps_by_project ON home_project_spaces(project_id);

CREATE TABLE IF NOT EXISTS home_project_budget_lines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('materials','labor','permits','contingency','other')),
  label TEXT NOT NULL,
  estimate_cents INTEGER NOT NULL DEFAULT 0,
  actual_cents INTEGER NOT NULL DEFAULT 0,
  selection_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpbl_by_project ON home_project_budget_lines(project_id);

CREATE TABLE IF NOT EXISTS home_project_selections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('fixture','finish','material','furniture','lighting','appliance','labor_allowance','other')),
  status TEXT NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea','shortlisted','approved','rejected','ordered','installed')),
  qty INTEGER NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price_cents INTEGER,
  vendor TEXT,
  product_url TEXT,
  surface_ref TEXT,
  notes TEXT,
  assignee_user_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpsel_by_project ON home_project_selections(project_id);

CREATE TABLE IF NOT EXISTS home_project_phases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  starts_on TEXT,
  ends_on TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpph_by_project ON home_project_phases(project_id);

CREATE TABLE IF NOT EXISTS home_project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  phase_id TEXT,
  title TEXT NOT NULL,
  due_on TEXT,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpm_by_project ON home_project_milestones(project_id);

CREATE TABLE IF NOT EXISTS home_project_blockers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','wont_fix')),
  notes TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpb_by_project ON home_project_blockers(project_id);

CREATE TABLE IF NOT EXISTS home_project_attachments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  selection_id TEXT,
  kind TEXT NOT NULL DEFAULT 'photo'
    CHECK (kind IN ('photo','file','link','plan_ref','scan','schematic')),
  r2_key TEXT,
  url TEXT,
  filename TEXT,
  content_type TEXT,
  file_size INTEGER,
  caption TEXT,
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'pending_upload',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpa_by_project ON home_project_attachments(project_id);

CREATE TABLE IF NOT EXISTS home_project_plan_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  floor_plan_id TEXT NOT NULL,
  zone_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hppl_by_project ON home_project_plan_links(project_id);

CREATE TABLE IF NOT EXISTS home_project_geometry (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('roomplan','manual','ai_schematic')),
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('pending','generating','completed','failed')),
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT,
  confidence TEXT,
  disclaimer TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpg_by_project ON home_project_geometry(project_id);

CREATE TABLE IF NOT EXISTS home_project_comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  selection_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpc_by_project ON home_project_comments(project_id, created_at);

CREATE TABLE IF NOT EXISTS home_project_activity (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  meta_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS hpact_by_project ON home_project_activity(project_id, created_at);

CREATE TABLE IF NOT EXISTS home_project_tasks (
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, task_id)
);
CREATE INDEX IF NOT EXISTS hpt_by_project ON home_project_tasks(project_id);
CREATE INDEX IF NOT EXISTS hpt_by_task ON home_project_tasks(task_id);

CREATE TABLE IF NOT EXISTS home_project_contractors (
  project_id TEXT NOT NULL REFERENCES home_projects(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL,
  quote_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, contractor_id)
);
CREATE INDEX IF NOT EXISTS hpco_by_project ON home_project_contractors(project_id);
