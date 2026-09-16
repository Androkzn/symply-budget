-- Create contractor_quotes table
-- A task can have many quotes from different contractors
CREATE TABLE IF NOT EXISTS contractor_quotes (
  id TEXT PRIMARY KEY,

  -- References
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  visit_id TEXT REFERENCES contractor_visits(id) ON DELETE SET NULL, -- Link to on-site visit

  -- Quote details
  amount INTEGER, -- in cents
  currency TEXT DEFAULT 'USD' NOT NULL,
  description TEXT,
  notes TEXT,

  -- Timeline
  estimated_start_date TEXT,
  estimated_completion_date TEXT,
  estimated_duration_days INTEGER,

  -- Validity
  valid_until TEXT, -- Quote expiration date

  -- Status tracking
  status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'accepted', 'rejected', 'expired', 'withdrawn'
  submitted_at TEXT NOT NULL,
  accepted_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,

  -- Document attachment (quote document/PDF)
  document_file_key TEXT, -- R2 storage key
  document_file_name TEXT,
  document_file_size INTEGER,
  document_mime_type TEXT,

  -- Additional details
  warranty_terms TEXT,
  payment_terms TEXT,
  materials_included INTEGER DEFAULT 0, -- boolean: are materials included in price?
  labor_cost INTEGER, -- separate labor cost in cents
  materials_cost INTEGER, -- separate materials cost in cents

  -- Breakdown (JSON array for line items)
  cost_breakdown TEXT, -- JSON array: [{ description, amount, quantity }]

  -- Entry method and AI extraction
  entry_method TEXT DEFAULT 'manual' NOT NULL, -- 'manual' | 'document_upload'
  ai_extraction_status TEXT, -- 'pending' | 'processing' | 'completed' | 'failed'
  ai_extracted_data TEXT, -- JSON: raw AI extracted data for reference
  ai_extraction_confidence REAL, -- 0-1 confidence score
  ai_extraction_error TEXT, -- Error message if extraction failed
  needs_review INTEGER DEFAULT 0, -- boolean: if AI extraction needs human review

  -- Badges and labels
  is_recommended INTEGER DEFAULT 0, -- boolean: contractor recommended by system
  is_lowest_price INTEGER DEFAULT 0, -- boolean: badge for lowest price
  is_fastest INTEGER DEFAULT 0, -- boolean: badge for fastest completion
  custom_badges TEXT, -- JSON array: custom badges/labels

  -- Additional notes
  internal_notes TEXT, -- Private notes not visible to contractor
  contractor_notes TEXT, -- Notes from contractor

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS contractor_quotes_task_id_idx ON contractor_quotes(task_id);
CREATE INDEX IF NOT EXISTS contractor_quotes_contractor_id_idx ON contractor_quotes(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_quotes_household_id_idx ON contractor_quotes(household_id);
CREATE INDEX IF NOT EXISTS contractor_quotes_visit_id_idx ON contractor_quotes(visit_id);
CREATE INDEX IF NOT EXISTS contractor_quotes_status_idx ON contractor_quotes(status);
CREATE INDEX IF NOT EXISTS contractor_quotes_submitted_at_idx ON contractor_quotes(submitted_at);
CREATE INDEX IF NOT EXISTS contractor_quotes_entry_method_idx ON contractor_quotes(entry_method);
CREATE INDEX IF NOT EXISTS contractor_quotes_ai_extraction_status_idx ON contractor_quotes(ai_extraction_status);

-- Unique constraint to prevent duplicate quotes from same contractor for same task
CREATE UNIQUE INDEX IF NOT EXISTS contractor_quotes_task_contractor_unique_idx
  ON contractor_quotes(task_id, contractor_id)
  WHERE status != 'withdrawn';
