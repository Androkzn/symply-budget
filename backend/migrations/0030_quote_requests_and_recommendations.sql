-- ============================================
-- QUOTE REQUESTS
-- ============================================
-- Track when homeowner requests quotes from contractors for a task

CREATE TABLE IF NOT EXISTS quote_requests (
  id TEXT PRIMARY KEY,

  -- References
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  contractor_id TEXT NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,

  -- Request details
  message TEXT, -- Custom message to contractor
  requested_by TEXT NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Status tracking
  status TEXT DEFAULT 'pending' NOT NULL, -- 'pending', 'sent', 'viewed', 'responded', 'declined', 'expired'
  sent_at TEXT,
  viewed_at TEXT,
  responded_at TEXT,
  declined_at TEXT,
  decline_reason TEXT,
  expires_at TEXT, -- When this request expires

  -- Response tracking
  quote_id TEXT REFERENCES contractor_quotes(id) ON DELETE SET NULL, -- Link to submitted quote

  -- Communication
  last_message_at TEXT,
  unread_messages_count INTEGER DEFAULT 0,

  -- Metadata
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS quote_requests_task_id_idx ON quote_requests(task_id);
CREATE INDEX IF NOT EXISTS quote_requests_contractor_id_idx ON quote_requests(contractor_id);
CREATE INDEX IF NOT EXISTS quote_requests_household_id_idx ON quote_requests(household_id);
CREATE INDEX IF NOT EXISTS quote_requests_status_idx ON quote_requests(status);
CREATE INDEX IF NOT EXISTS quote_requests_requested_at_idx ON quote_requests(requested_at);

-- Unique constraint: one active request per task-contractor pair
CREATE UNIQUE INDEX IF NOT EXISTS quote_requests_task_contractor_unique_idx
  ON quote_requests(task_id, contractor_id)
  WHERE status NOT IN ('declined', 'expired');

-- ============================================
-- CONTRACTOR RECOMMENDATIONS
-- ============================================
-- AI-generated contractor recommendations for tasks

CREATE TABLE IF NOT EXISTS contractor_recommendations (
  id TEXT PRIMARY KEY,

  -- References
  task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  contractor_id TEXT REFERENCES contractors(id) ON DELETE CASCADE, -- NULL if new/external contractor

  -- Recommendation source
  source TEXT DEFAULT 'ai' NOT NULL, -- 'ai', 'existing', 'external_search', 'user_shared'

  -- Contractor details (for external/new contractors not in DB yet)
  external_contractor_name TEXT,
  external_contractor_phone TEXT,
  external_contractor_email TEXT,
  external_contractor_website TEXT,
  external_contractor_address TEXT,
  external_contractor_specialty TEXT,

  -- AI analysis
  match_score REAL, -- 0-1 confidence score
  match_reasons TEXT, -- JSON array: reasons why this contractor matches
  ai_analysis TEXT, -- JSON: detailed AI analysis data

  -- Recommendation details
  estimated_response_time TEXT, -- "Usually responds in 24 hours"
  distance_miles REAL, -- Distance from property
  availability_estimate TEXT, -- "Available next week"

  -- User actions
  status TEXT DEFAULT 'suggested' NOT NULL, -- 'suggested', 'viewed', 'request_sent', 'dismissed', 'saved'
  viewed_at TEXT,
  dismissed_at TEXT,
  dismiss_reason TEXT,
  saved_as_contractor_id TEXT REFERENCES contractors(id) ON DELETE SET NULL, -- If user saved to their contractors

  -- Ranking
  rank_position INTEGER, -- Position in recommendation list (1 = top)
  is_featured INTEGER DEFAULT 0, -- boolean: featured recommendation

  -- Metadata
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS contractor_recommendations_task_id_idx ON contractor_recommendations(task_id);
CREATE INDEX IF NOT EXISTS contractor_recommendations_household_id_idx ON contractor_recommendations(household_id);
CREATE INDEX IF NOT EXISTS contractor_recommendations_contractor_id_idx ON contractor_recommendations(contractor_id);
CREATE INDEX IF NOT EXISTS contractor_recommendations_status_idx ON contractor_recommendations(status);
CREATE INDEX IF NOT EXISTS contractor_recommendations_match_score_idx ON contractor_recommendations(match_score);
CREATE INDEX IF NOT EXISTS contractor_recommendations_source_idx ON contractor_recommendations(source);
