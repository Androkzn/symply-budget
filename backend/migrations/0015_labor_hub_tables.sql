-- Labor Hub Feature Tables Migration
-- This migration creates all tables needed for the comprehensive Labor Hub feature

-- ============ APPOINTMENTS ============
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date TEXT NOT NULL,
  scheduled_time_start TEXT,
  scheduled_time_end TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  location TEXT,
  estimated_duration_minutes INTEGER,
  actual_arrival_time TEXT,
  actual_departure_time TEXT,
  notes TEXT,
  reminder_sent INTEGER DEFAULT 0,
  calendar_event_id TEXT,
  linked_quote_id TEXT,
  linked_visit_id TEXT REFERENCES contractor_visits(id) ON DELETE SET NULL,
  linked_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  linked_action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
  linked_project_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS appointments_household_id_idx ON appointments(household_id);
CREATE INDEX IF NOT EXISTS appointments_contractor_id_idx ON appointments(contractor_id);
CREATE INDEX IF NOT EXISTS appointments_scheduled_date_idx ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS appointments_status_idx ON appointments(status);
CREATE INDEX IF NOT EXISTS appointments_type_idx ON appointments(type);
CREATE INDEX IF NOT EXISTS appointments_linked_project_idx ON appointments(linked_project_id);

-- ============ QUOTES ============
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER,
  amount_range_low_cents INTEGER,
  amount_range_high_cents INTEGER,
  valid_until TEXT,
  estimated_duration TEXT,
  warranty_terms TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  document_key TEXT,
  notes TEXT,
  linked_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  linked_action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
  accepted_at TEXT,
  declined_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS quotes_household_id_idx ON quotes(household_id);
CREATE INDEX IF NOT EXISTS quotes_contractor_id_idx ON quotes(contractor_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx ON quotes(status);
CREATE INDEX IF NOT EXISTS quotes_valid_until_idx ON quotes(valid_until);

-- ============ CONTRACTOR REPRESENTATIVES ============
CREATE TABLE IF NOT EXISTS contractor_representatives (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  is_primary INTEGER DEFAULT 0,
  notes TEXT,
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_representatives_contractor_id_idx ON contractor_representatives(contractor_id);

-- ============ PROJECTS ============
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planning',
  start_date TEXT,
  estimated_end_date TEXT,
  actual_end_date TEXT,
  total_budget_cents INTEGER,
  total_spent_cents INTEGER DEFAULT 0,
  linked_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  linked_action_item_ids TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS projects_household_id_idx ON projects(household_id);
CREATE INDEX IF NOT EXISTS projects_contractor_id_idx ON projects(contractor_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);

-- ============ PROJECT MILESTONES ============
CREATE TABLE IF NOT EXISTS project_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT,
  completed_date TEXT,
  sort_order INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS project_milestones_project_id_idx ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS project_milestones_status_idx ON project_milestones(status);

-- ============ PROJECT PAYMENTS ============
CREATE TABLE IF NOT EXISTS project_payments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT,
  paid_date TEXT,
  receipt_document_key TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS project_payments_project_id_idx ON project_payments(project_id);
CREATE INDEX IF NOT EXISTS project_payments_status_idx ON project_payments(status);

-- ============ PROJECT PROGRESS PHOTOS ============
CREATE TABLE IF NOT EXISTS project_progress_photos (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id TEXT REFERENCES project_milestones(id) ON DELETE SET NULL,
  photo_key TEXT NOT NULL,
  caption TEXT,
  taken_at TEXT,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS project_progress_photos_project_id_idx ON project_progress_photos(project_id);
CREATE INDEX IF NOT EXISTS project_progress_photos_milestone_id_idx ON project_progress_photos(milestone_id);

-- ============ VISIT CHECKLISTS ============
CREATE TABLE IF NOT EXISTS visit_checklists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE SET NULL,
  visit_id TEXT REFERENCES contractor_visits(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  template_id TEXT,
  contractor_specialty TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS visit_checklists_household_id_idx ON visit_checklists(household_id);
CREATE INDEX IF NOT EXISTS visit_checklists_appointment_id_idx ON visit_checklists(appointment_id);

-- ============ CHECKLIST ITEMS ============
CREATE TABLE IF NOT EXISTS checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES visit_checklists(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  checked INTEGER DEFAULT 0,
  checked_at TEXT,
  comment TEXT,
  voice_note_key TEXT,
  voice_note_transcription TEXT,
  has_info_icon INTEGER DEFAULT 0,
  technical_term TEXT,
  category TEXT,
  priority TEXT DEFAULT 'must_ask',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checklist_items_checklist_id_idx ON checklist_items(checklist_id);
CREATE INDEX IF NOT EXISTS checklist_items_sort_order_idx ON checklist_items(checklist_id, sort_order);

-- ============ CHECKLIST TEMPLATES ============
CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  specialty TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  items TEXT NOT NULL,
  is_system INTEGER DEFAULT 1,
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS checklist_templates_specialty_idx ON checklist_templates(specialty);
CREATE INDEX IF NOT EXISTS checklist_templates_household_id_idx ON checklist_templates(household_id);

-- ============ TECHNICAL TERMS (Knowledge Base) ============
CREATE TABLE IF NOT EXISTS technical_terms (
  id TEXT PRIMARY KEY,
  term_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  short_description TEXT,
  base_prompt TEXT NOT NULL,
  related_terms TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS technical_terms_term_key_idx ON technical_terms(term_key);
CREATE INDEX IF NOT EXISTS technical_terms_category_idx ON technical_terms(category);

-- ============ AI INFO CONVERSATIONS ============
CREATE TABLE IF NOT EXISTS ai_info_conversations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  checklist_item_id TEXT REFERENCES checklist_items(id) ON DELETE SET NULL,
  technical_term TEXT NOT NULL,
  context_json TEXT,
  messages_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_info_conversations_household_id_idx ON ai_info_conversations(household_id);
CREATE INDEX IF NOT EXISTS ai_info_conversations_checklist_item_id_idx ON ai_info_conversations(checklist_item_id);

-- ============ CONTRACTOR MESSAGES ============
CREATE TABLE IF NOT EXISTS contractor_messages (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  attachments TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT,
  read_at TEXT,
  template_used TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_messages_household_id_idx ON contractor_messages(household_id);
CREATE INDEX IF NOT EXISTS contractor_messages_contractor_id_idx ON contractor_messages(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_messages_sent_at_idx ON contractor_messages(sent_at);

-- ============ MESSAGE TEMPLATES ============
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  is_system INTEGER DEFAULT 1,
  household_id TEXT REFERENCES households(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS message_templates_type_idx ON message_templates(type);
CREATE INDEX IF NOT EXISTS message_templates_household_id_idx ON message_templates(household_id);

-- ============ CONTRACTOR JOB RATINGS ============
CREATE TABLE IF NOT EXISTS contractor_job_ratings (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL REFERENCES contractor_visits(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  rated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  overall_rating INTEGER NOT NULL,
  quality_rating INTEGER,
  punctuality_rating INTEGER,
  communication_rating INTEGER,
  cleanliness_rating INTEGER,
  value_rating INTEGER,
  would_hire_again INTEGER,
  review_text TEXT,
  review_photos TEXT,
  is_private INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_job_ratings_contractor_id_idx ON contractor_job_ratings(contractor_id);
CREATE UNIQUE INDEX IF NOT EXISTS contractor_job_ratings_visit_id_idx ON contractor_job_ratings(visit_id);
CREATE INDEX IF NOT EXISTS contractor_job_ratings_household_id_idx ON contractor_job_ratings(household_id);

-- ============ CONTRACTOR ISSUE RESOLUTIONS ============
CREATE TABLE IF NOT EXISTS contractor_issue_resolutions (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  action_item_id TEXT REFERENCES action_items(id) ON DELETE SET NULL,
  visit_id TEXT REFERENCES contractor_visits(id) ON DELETE SET NULL,
  issue_title TEXT NOT NULL,
  issue_category TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'pending',
  resolution_notes TEXT,
  cost_cents INTEGER,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_issue_resolutions_contractor_id_idx ON contractor_issue_resolutions(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_issue_resolutions_household_id_idx ON contractor_issue_resolutions(household_id);
CREATE INDEX IF NOT EXISTS contractor_issue_resolutions_status_idx ON contractor_issue_resolutions(resolution_status);

-- ============ CONTRACTOR SHARES ============
CREATE TABLE IF NOT EXISTS contractor_shares (
  id TEXT PRIMARY KEY,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  shared_by_household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  shared_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_token TEXT NOT NULL UNIQUE,
  include_rating INTEGER DEFAULT 1,
  include_review INTEGER DEFAULT 1,
  include_contact_info INTEGER DEFAULT 1,
  expires_at TEXT,
  view_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS contractor_shares_contractor_id_idx ON contractor_shares(contractor_id);
CREATE UNIQUE INDEX IF NOT EXISTS contractor_shares_token_idx ON contractor_shares(share_token);

-- ============ VISIT NOTES ============
CREATE TABLE IF NOT EXISTS visit_notes (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES contractor_visits(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT,
  transcription TEXT,
  tags TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS visit_notes_visit_id_idx ON visit_notes(visit_id);
CREATE INDEX IF NOT EXISTS visit_notes_household_id_idx ON visit_notes(household_id);
CREATE INDEX IF NOT EXISTS visit_notes_type_idx ON visit_notes(type);

-- ============ LABOR HUB NOTIFICATION PREFERENCES ============
CREATE TABLE IF NOT EXISTS labor_notification_preferences (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_reminder_24h INTEGER DEFAULT 1,
  appointment_reminder_2h INTEGER DEFAULT 1,
  appointment_confirmed INTEGER DEFAULT 1,
  appointment_cancelled INTEGER DEFAULT 1,
  quote_received INTEGER DEFAULT 1,
  quote_expiring_soon INTEGER DEFAULT 1,
  visit_followup_rating INTEGER DEFAULT 1,
  warranty_expiring INTEGER DEFAULT 1,
  project_milestone_due INTEGER DEFAULT 1,
  payment_due INTEGER DEFAULT 1,
  weather_reschedule_suggestion INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS labor_notification_preferences_household_user_idx ON labor_notification_preferences(household_id, user_id);

-- ============ SEED CHECKLIST TEMPLATES ============

-- Electrician Initial Visit Template
INSERT INTO checklist_templates (id, specialty, title, description, items, is_system, household_id)
VALUES (
  'tpl_electrician_initial',
  'electrician',
  'Electrician Initial Visit',
  'Comprehensive checklist for initial electrical consultation',
  '[
    {"text": "Panel capacity (amps)", "hasInfoIcon": true, "technicalTerm": "electrical_panel_capacity", "priority": "must_ask", "sortOrder": 1},
    {"text": "Wire type (copper vs aluminum)", "hasInfoIcon": true, "technicalTerm": "wire_types", "priority": "must_ask", "sortOrder": 2},
    {"text": "AFCI breaker requirements", "hasInfoIcon": true, "technicalTerm": "afci_breakers", "priority": "must_ask", "sortOrder": 3},
    {"text": "GFCI outlets needed", "hasInfoIcon": true, "technicalTerm": "gfci_outlets", "priority": "must_ask", "sortOrder": 4},
    {"text": "Permit requirements", "hasInfoIcon": true, "technicalTerm": "electrical_permits", "priority": "must_ask", "sortOrder": 5},
    {"text": "Timeline estimate", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 6},
    {"text": "Total cost estimate", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 7},
    {"text": "Warranty offered", "hasInfoIcon": false, "priority": "nice_to_have", "sortOrder": 8},
    {"text": "Licensed & insured?", "hasInfoIcon": true, "technicalTerm": "contractor_licensing", "priority": "must_ask", "sortOrder": 9}
  ]',
  1,
  NULL
);

-- Plumber Initial Visit Template
INSERT INTO checklist_templates (id, specialty, title, description, items, is_system, household_id)
VALUES (
  'tpl_plumber_initial',
  'plumber',
  'Plumber Initial Visit',
  'Comprehensive checklist for initial plumbing consultation',
  '[
    {"text": "Pipe material (copper, PEX, galvanized)", "hasInfoIcon": true, "technicalTerm": "pipe_materials", "priority": "must_ask", "sortOrder": 1},
    {"text": "Water heater condition", "hasInfoIcon": true, "technicalTerm": "water_heater_types", "priority": "must_ask", "sortOrder": 2},
    {"text": "Water pressure check", "hasInfoIcon": true, "technicalTerm": "water_pressure", "priority": "must_ask", "sortOrder": 3},
    {"text": "Drain line inspection", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 4},
    {"text": "Permit requirements", "hasInfoIcon": true, "technicalTerm": "plumbing_permits", "priority": "must_ask", "sortOrder": 5},
    {"text": "Timeline estimate", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 6},
    {"text": "Total cost estimate", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 7}
  ]',
  1,
  NULL
);

-- HVAC Initial Visit Template
INSERT INTO checklist_templates (id, specialty, title, description, items, is_system, household_id)
VALUES (
  'tpl_hvac_initial',
  'hvac',
  'HVAC Initial Visit',
  'Comprehensive checklist for initial HVAC consultation',
  '[
    {"text": "System age and condition", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 1},
    {"text": "SEER rating", "hasInfoIcon": true, "technicalTerm": "seer_rating", "priority": "must_ask", "sortOrder": 2},
    {"text": "Ductwork condition", "hasInfoIcon": true, "technicalTerm": "hvac_ductwork", "priority": "must_ask", "sortOrder": 3},
    {"text": "Refrigerant type", "hasInfoIcon": true, "technicalTerm": "hvac_refrigerant", "priority": "must_ask", "sortOrder": 4},
    {"text": "Smart thermostat compatibility", "hasInfoIcon": true, "technicalTerm": "smart_thermostats", "priority": "nice_to_have", "sortOrder": 5},
    {"text": "Energy efficiency options", "hasInfoIcon": false, "priority": "nice_to_have", "sortOrder": 6},
    {"text": "Maintenance plan offered", "hasInfoIcon": false, "priority": "nice_to_have", "sortOrder": 7}
  ]',
  1,
  NULL
);

-- General Contractor Template
INSERT INTO checklist_templates (id, specialty, title, description, items, is_system, household_id)
VALUES (
  'tpl_general_initial',
  'general_contractor',
  'General Contractor Initial Visit',
  'General checklist for home improvement consultations',
  '[
    {"text": "Scope of work review", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 1},
    {"text": "Building permits required", "hasInfoIcon": true, "technicalTerm": "building_permits", "priority": "must_ask", "sortOrder": 2},
    {"text": "Structural concerns", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 3},
    {"text": "Material options and costs", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 4},
    {"text": "Project timeline", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 5},
    {"text": "Payment schedule", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 6},
    {"text": "Subcontractors involved", "hasInfoIcon": false, "priority": "nice_to_have", "sortOrder": 7},
    {"text": "Warranty and guarantees", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 8}
  ]',
  1,
  NULL
);

-- Roofer Initial Visit Template
INSERT INTO checklist_templates (id, specialty, title, description, items, is_system, household_id)
VALUES (
  'tpl_roofer_initial',
  'roofer',
  'Roofer Initial Visit',
  'Comprehensive checklist for roof inspection and consultation',
  '[
    {"text": "Current roof age and condition", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 1},
    {"text": "Shingle type recommended", "hasInfoIcon": true, "technicalTerm": "roofing_materials", "priority": "must_ask", "sortOrder": 2},
    {"text": "Underlayment condition", "hasInfoIcon": true, "technicalTerm": "roof_underlayment", "priority": "must_ask", "sortOrder": 3},
    {"text": "Flashing inspection", "hasInfoIcon": true, "technicalTerm": "roof_flashing", "priority": "must_ask", "sortOrder": 4},
    {"text": "Ventilation assessment", "hasInfoIcon": true, "technicalTerm": "roof_ventilation", "priority": "must_ask", "sortOrder": 5},
    {"text": "Gutter condition", "hasInfoIcon": false, "priority": "nice_to_have", "sortOrder": 6},
    {"text": "Warranty terms", "hasInfoIcon": false, "priority": "must_ask", "sortOrder": 7}
  ]',
  1,
  NULL
);

-- ============ SEED TECHNICAL TERMS ============

-- Electrical Terms
INSERT INTO technical_terms (id, term_key, display_name, category, short_description, base_prompt, related_terms)
VALUES
  ('term_afci', 'afci_breakers', 'AFCI Breakers', 'electrical', 'Arc-fault circuit interrupters protect against electrical fires', 'You are an expert electrician educator. Explain AFCI (Arc-Fault Circuit Interrupter) breakers in simple terms for a homeowner. Include: what they do, why they matter for safety, when they are required by code, typical costs, and what questions to ask an electrician.', '["gfci_outlets", "electrical_panel_capacity", "wire_types"]'),
  ('term_gfci', 'gfci_outlets', 'GFCI Outlets', 'electrical', 'Ground fault circuit interrupters prevent electric shock', 'You are an expert electrician educator. Explain GFCI (Ground Fault Circuit Interrupter) outlets in simple terms for a homeowner. Include: how they work, where they are required, how to test them, and typical costs.', '["afci_breakers", "electrical_permits"]'),
  ('term_panel', 'electrical_panel_capacity', 'Electrical Panel Capacity', 'electrical', 'The total amperage your electrical system can handle', 'You are an expert electrician educator. Explain electrical panel capacity in simple terms for a homeowner. Include: what amps mean, how to know if an upgrade is needed, signs of an overloaded panel, and typical upgrade costs.', '["afci_breakers", "wire_types"]'),
  ('term_wire', 'wire_types', 'Wire Types', 'electrical', 'Different wiring materials used in homes', 'You are an expert electrician educator. Explain different wire types (copper vs aluminum) in simple terms for a homeowner. Include: pros and cons of each, safety concerns with aluminum wiring, and when rewiring might be needed.', '["electrical_panel_capacity"]');

-- Plumbing Terms
INSERT INTO technical_terms (id, term_key, display_name, category, short_description, base_prompt, related_terms)
VALUES
  ('term_pipes', 'pipe_materials', 'Pipe Materials', 'plumbing', 'Different piping materials: copper, PEX, galvanized', 'You are an expert plumber educator. Explain different pipe materials (copper, PEX, galvanized, CPVC) in simple terms for a homeowner. Include: pros and cons of each, lifespan, and when replacement might be needed.', '["water_pressure", "water_heater_types"]'),
  ('term_wh', 'water_heater_types', 'Water Heater Types', 'plumbing', 'Tank vs tankless water heaters', 'You are an expert plumber educator. Explain water heater types (tank vs tankless, gas vs electric) in simple terms for a homeowner. Include: pros and cons, efficiency ratings, typical lifespan, and maintenance needs.', '["pipe_materials"]'),
  ('term_pressure', 'water_pressure', 'Water Pressure', 'plumbing', 'The force at which water flows through pipes', 'You are an expert plumber educator. Explain water pressure in simple terms for a homeowner. Include: ideal pressure ranges, signs of problems, causes of low or high pressure, and solutions.', '["pipe_materials"]');

-- HVAC Terms
INSERT INTO technical_terms (id, term_key, display_name, category, short_description, base_prompt, related_terms)
VALUES
  ('term_seer', 'seer_rating', 'SEER Rating', 'hvac', 'Seasonal Energy Efficiency Ratio for AC units', 'You are an expert HVAC educator. Explain SEER ratings in simple terms for a homeowner. Include: what the numbers mean, minimum requirements, cost vs efficiency tradeoffs, and how to choose the right rating.', '["hvac_refrigerant", "hvac_ductwork"]'),
  ('term_duct', 'hvac_ductwork', 'HVAC Ductwork', 'hvac', 'The system of ducts that distributes air', 'You are an expert HVAC educator. Explain ductwork in simple terms for a homeowner. Include: signs of duct problems, importance of sealing, cleaning needs, and efficiency impacts.', '["seer_rating"]'),
  ('term_refrig', 'hvac_refrigerant', 'HVAC Refrigerant', 'hvac', 'The cooling chemical in AC systems', 'You are an expert HVAC educator. Explain refrigerant types (R-22 vs R-410A) in simple terms for a homeowner. Include: the R-22 phaseout, what it means for older systems, and upgrade considerations.', '["seer_rating"]'),
  ('term_thermo', 'smart_thermostats', 'Smart Thermostats', 'hvac', 'Programmable and WiFi-connected thermostats', 'You are an expert HVAC educator. Explain smart thermostats in simple terms for a homeowner. Include: compatibility considerations, energy savings potential, popular brands, and installation requirements.', '["seer_rating"]');

-- Roofing Terms
INSERT INTO technical_terms (id, term_key, display_name, category, short_description, base_prompt, related_terms)
VALUES
  ('term_roof_mat', 'roofing_materials', 'Roofing Materials', 'roofing', 'Different shingle and roofing types', 'You are an expert roofer educator. Explain different roofing materials (asphalt, metal, tile, slate) in simple terms for a homeowner. Include: pros and cons, lifespan, costs, and climate considerations.', '["roof_underlayment", "roof_flashing"]'),
  ('term_underlay', 'roof_underlayment', 'Roof Underlayment', 'roofing', 'The protective layer under shingles', 'You are an expert roofer educator. Explain roof underlayment in simple terms for a homeowner. Include: types (felt vs synthetic), importance for waterproofing, and ice dam protection.', '["roofing_materials"]'),
  ('term_flash', 'roof_flashing', 'Roof Flashing', 'roofing', 'Metal pieces that prevent water entry', 'You are an expert roofer educator. Explain roof flashing in simple terms for a homeowner. Include: where its used, common failure points, and maintenance needs.', '["roofing_materials"]'),
  ('term_vent', 'roof_ventilation', 'Roof Ventilation', 'roofing', 'Air circulation in the attic space', 'You are an expert roofer educator. Explain roof ventilation in simple terms for a homeowner. Include: ridge vents vs soffit vents, why its important, and signs of poor ventilation.', '["roofing_materials"]');

-- General/Permit Terms
INSERT INTO technical_terms (id, term_key, display_name, category, short_description, base_prompt, related_terms)
VALUES
  ('term_elec_permit', 'electrical_permits', 'Electrical Permits', 'permits', 'Official approval for electrical work', 'You are a knowledgeable home improvement advisor. Explain electrical permits in simple terms for a homeowner. Include: when permits are required, the inspection process, risks of unpermitted work, and typical costs.', '["building_permits", "plumbing_permits"]'),
  ('term_plumb_permit', 'plumbing_permits', 'Plumbing Permits', 'permits', 'Official approval for plumbing work', 'You are a knowledgeable home improvement advisor. Explain plumbing permits in simple terms for a homeowner. Include: when permits are required, the inspection process, and typical requirements.', '["building_permits", "electrical_permits"]'),
  ('term_build_permit', 'building_permits', 'Building Permits', 'permits', 'Official approval for construction work', 'You are a knowledgeable home improvement advisor. Explain building permits in simple terms for a homeowner. Include: when permits are required, consequences of unpermitted work, and the application process.', '["electrical_permits", "plumbing_permits"]'),
  ('term_license', 'contractor_licensing', 'Contractor Licensing', 'general', 'Professional credentials for contractors', 'You are a knowledgeable home improvement advisor. Explain contractor licensing in simple terms for a homeowner. Include: how to verify a license, what insurance to look for, and red flags when hiring contractors.', '[]');

-- ============ SEED MESSAGE TEMPLATES ============

INSERT INTO message_templates (id, type, title, subject_template, body_template, is_system, household_id)
VALUES
  ('msg_tpl_quote_request', 'quote_request', 'Request for Quote', 'Quote Request: {{job_title}}', 'Hello {{contractor_name}},

I am looking for a quote on the following work at my property:

**Job Description:**
{{job_description}}

**Address:** {{property_address}}

**Preferred Timeline:** {{timeline}}

Please let me know your availability for a site visit or if you need any additional information.

Thank you,
{{user_name}}
{{user_phone}}', 1, NULL),

  ('msg_tpl_schedule', 'schedule_appointment', 'Schedule Appointment', 'Scheduling: {{job_title}}', 'Hello {{contractor_name}},

I would like to schedule an appointment for:

**Service:** {{job_title}}

**Preferred Dates:** {{preferred_dates}}
**Preferred Times:** {{preferred_times}}

Please let me know your availability.

Thank you,
{{user_name}}
{{user_phone}}', 1, NULL),

  ('msg_tpl_confirm', 'confirm_appointment', 'Confirm Appointment', 'Confirming Appointment: {{date}}', 'Hello {{contractor_name}},

I am writing to confirm our appointment:

**Date:** {{date}}
**Time:** {{time}}
**Service:** {{job_title}}
**Address:** {{property_address}}

Please let me know if anything changes.

Thank you,
{{user_name}}', 1, NULL),

  ('msg_tpl_reschedule', 'request_reschedule', 'Request Reschedule', 'Reschedule Request: {{original_date}}', 'Hello {{contractor_name}},

I need to reschedule our appointment originally set for {{original_date}} at {{original_time}}.

**New Preferred Dates:** {{new_dates}}
**Reason:** {{reason}}

I apologize for any inconvenience and appreciate your flexibility.

Thank you,
{{user_name}}
{{user_phone}}', 1, NULL),

  ('msg_tpl_thanks', 'thank_you', 'Thank You', 'Thank You for Your Service', 'Hello {{contractor_name}},

Thank you for completing the {{job_title}} at my property. I appreciate your professionalism and quality work.

I have left a review and will definitely recommend you to friends and family.

Best regards,
{{user_name}}', 1, NULL),

  ('msg_tpl_followup', 'follow_up', 'Follow Up', 'Following Up: {{job_title}}', 'Hello {{contractor_name}},

I wanted to follow up on {{subject}}.

{{custom_message}}

Please let me know at your earliest convenience.

Thank you,
{{user_name}}
{{user_phone}}', 1, NULL);
