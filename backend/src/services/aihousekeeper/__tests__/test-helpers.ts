/**
 * Shared test helpers for Aihousekeeper backend tests (Stream I).
 *
 * Most Aihousekeeper service tests need a few scaffolded tables (households,
 * household_members, assistant_identity, assistant_memory, etc.) and a
 * typed `Env` stub. Rather than running the full migration set for every
 * file, we synthesize the minimal schema subset needed for the test
 * surface being exercised. This keeps test startup cheap and keeps the
 * test files focused on behaviour.
 *
 * The DDL here is a faithful subset of backend/migrations/0035..0038
 * + the mainline `households` / `household_members` / `tasks`
 * tables. Tests that need FTS5 (MemoryService.recall) install the
 * `assistant_memory_fts` virtual table and sync triggers on demand.
 */

import type { D1Database } from '@cloudflare/workers-types';

export async function createCoreTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user',
      password_hash TEXT,
      apple_id TEXT,
      google_id TEXT,
      display_name TEXT,
      avatar_url TEXT,
      terms_accepted_at TEXT,
      has_completed_onboarding INTEGER NOT NULL DEFAULT 0,
      onboarding_household_created INTEGER NOT NULL DEFAULT 0,
      onboarding_report_added INTEGER NOT NULL DEFAULT 0,
      onboarding_garbage_setup INTEGER NOT NULL DEFAULT 0,
      onboarding_floor_plan_added INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state_province TEXT,
      postal_code TEXT,
      country TEXT,
      unit_system TEXT,
      photo_key TEXT,
      purchase_price INTEGER,
      purchase_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS household_members (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT,
      joined_at TEXT NOT NULL,
      responsibilities_json TEXT NOT NULL DEFAULT '[]',
      notification_channel_preference TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      space_id TEXT,
      system_category TEXT,
      title TEXT NOT NULL,
      description TEXT,
      frequency TEXT NOT NULL,
      custom_interval_days INTEGER,
      next_due_date TEXT,
      last_completed_at TEXT,
      assigned_to TEXT,
      reminder_days_before INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      source TEXT,
      reminder_enabled INTEGER DEFAULT 1,
      reminder_time TEXT DEFAULT '09:00',
      reminder_repeat INTEGER DEFAULT 1,
      last_reminder_sent_at TEXT,
      reminder_claimed_at TEXT,
      reminder_attempt_count INTEGER DEFAULT 0,
      snooze_until TEXT,
      suggested_by TEXT,
      home_feature_id TEXT,
      template_id TEXT,
      suggestion_reason TEXT,
      why_important TEXT,
      neglect_consequences TEXT,
      needs_contractor INTEGER DEFAULT 0,
      contractor_category TEXT,
      workflow_stage TEXT DEFAULT 'planning',
      scheduled_work_date TEXT,
      scheduled_work_time_start TEXT,
      scheduled_work_time_end TEXT,
      selected_quote_id TEXT,
      linked_project_id TEXT,
      priority_severity TEXT NOT NULL DEFAULT 'nice_to_have',
      risk_level TEXT,
      complexity TEXT,
      time_effort TEXT,
      ai_rationale TEXT,
      enrichment_status TEXT,
      enrichment_error TEXT,
      enrichment_attempts INTEGER DEFAULT 0,
      enriched_at TEXT,
      clarification_question TEXT,
      raw_capture_text TEXT,
      blocked INTEGER DEFAULT 0,
      blocker_reason TEXT,
      blocked_at TEXT,
      blocked_by TEXT,
      is_personal INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      cover_photo_id TEXT,
      is_purchase INTEGER DEFAULT 0,
      purchase_estimated_cost_min INTEGER,
      purchase_estimated_cost_max INTEGER,
      purchase_suggestion_dismissed INTEGER DEFAULT 0,
      budget_item_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS task_photos (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      photo_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS contractors (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      company_name TEXT,
      specialty TEXT NOT NULL,
      secondary_specialties TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      address TEXT,
      notes TEXT,
      rating INTEGER,
      is_favorite INTEGER DEFAULT 0,
      business_type TEXT,
      license_number TEXT,
      insurance_verified INTEGER DEFAULT 0,
      insurance_expiry TEXT,
      years_in_business INTEGER,
      emergency_available INTEGER DEFAULT 0,
      response_time TEXT,
      service_area TEXT,
      business_hours TEXT,
      certifications TEXT,
      portfolio_images TEXT,
      is_blocked INTEGER DEFAULT 0,
      custom_tags TEXT,
      recommended_by TEXT,
      source TEXT,
      phone_e164 TEXT,
      sms_opt_in_at TEXT,
      sms_opt_out_at TEXT,
      sms_opt_in_source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS contractor_quotes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      contractor_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      visit_id TEXT,
      amount INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      description TEXT,
      notes TEXT,
      estimated_start_date TEXT,
      estimated_completion_date TEXT,
      estimated_duration_days INTEGER,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL,
      accepted_at TEXT,
      rejected_at TEXT,
      rejection_reason TEXT,
      document_file_key TEXT,
      document_file_name TEXT,
      document_file_size INTEGER,
      document_mime_type TEXT,
      warranty_terms TEXT,
      payment_terms TEXT,
      materials_included INTEGER DEFAULT 0,
      labor_cost INTEGER,
      materials_cost INTEGER,
      cost_breakdown TEXT,
      entry_method TEXT NOT NULL DEFAULT 'manual',
      ai_extraction_status TEXT,
      ai_extracted_data TEXT,
      ai_extraction_confidence REAL,
      ai_extraction_error TEXT,
      needs_review INTEGER DEFAULT 0,
      is_recommended INTEGER DEFAULT 0,
      is_lowest_price INTEGER DEFAULT 0,
      is_fastest INTEGER DEFAULT 0,
      custom_badges TEXT,
      internal_notes TEXT,
      contractor_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // floor_plans schema — keeps in sync with backend/migrations/0023+ and
    // schema-floor-plans.ts so executor / service tests can insert real rows.
    `CREATE TABLE IF NOT EXISTS floor_plans (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      plan_context TEXT NOT NULL DEFAULT 'interior',
      original_file_key TEXT NOT NULL,
      display_image_key TEXT,
      thumbnail_key TEXT,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      building_name TEXT NOT NULL,
      floor_number INTEGER,
      floor_label TEXT,
      width_px INTEGER,
      height_px INTEGER,
      scale_pixels_per_foot REAL,
      scale_pixels_per_meter REAL,
      scale_unit TEXT DEFAULT 'feet',
      scale_calibration_method TEXT DEFAULT 'none',
      ocr_status TEXT DEFAULT 'pending',
      ocr_detected_dimensions TEXT,
      ai_analysis_status TEXT DEFAULT 'pending',
      ai_analysis_data TEXT,
      ai_property_address TEXT,
      ai_total_area_sqft REAL,
      ai_floor_count INTEGER,
      ai_analyzed_at TEXT,
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending_upload',
      processing_stage TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      platform TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS garden_plans (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
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
      source_approval_id TEXT,
      reference_image_source TEXT,
      boundary_draft_id TEXT,
      boundary_source TEXT,
      boundary_geojson TEXT,
      geocode_place_name TEXT,
      generation_prompt TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS garden_plan_boundary_drafts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
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
    )`,
    `CREATE TABLE IF NOT EXISTS garden_plan_markers (
      id TEXT PRIMARY KEY,
      garden_plan_id TEXT NOT NULL,
      x_percent INTEGER NOT NULL,
      y_percent INTEGER NOT NULL,
      linked_entity_type TEXT NOT NULL,
      linked_entity_id TEXT NOT NULL,
      marker_color TEXT NOT NULL DEFAULT '#4CAF50',
      marker_icon TEXT NOT NULL DEFAULT '🌿',
      label TEXT,
      show_label INTEGER DEFAULT 1,
      space_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    )`,
  ];
  for (const stmt of statements) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

export async function createAihousekeeperTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS assistant_identity (
      household_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'Aihousekeeper',
      tone TEXT NOT NULL DEFAULT 'warm_brief',
      pronouns TEXT,
      briefing_time TEXT NOT NULL DEFAULT '07:00',
      quiet_hours_start TEXT NOT NULL DEFAULT '22:00',
      quiet_hours_end TEXT NOT NULL DEFAULT '07:00',
      daily_interrupt_budget INTEGER NOT NULL DEFAULT 3,
      channels_enabled_json TEXT NOT NULL DEFAULT '{"push":true,"sms":false,"email_weekly":false,"watch":true}',
      timezone TEXT NOT NULL DEFAULT 'UTC',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS assistant_memory (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      type TEXT NOT NULL,
      subject_kind TEXT,
      subject_id TEXT,
      body TEXT NOT NULL,
      redacted_body TEXT,
      confidence REAL NOT NULL DEFAULT 0.7,
      source TEXT NOT NULL,
      source_ref TEXT,
      is_anniversary_tracked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      expires_at TEXT,
      superseded_by_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS assistant_followups (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      prompt TEXT NOT NULL,
      context_ref_json TEXT,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      fired_at TEXT,
      outcome_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS assistant_briefings (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      date TEXT NOT NULL,
      composed_at TEXT NOT NULL DEFAULT (datetime('now')),
      paragraph TEXT NOT NULL,
      bullets_json TEXT NOT NULL DEFAULT '[]',
      push_sent INTEGER NOT NULL DEFAULT 0,
      push_message_id TEXT,
      read_at TEXT,
      empty_reason TEXT,
      source_signals_json TEXT NOT NULL DEFAULT '[]',
      composed_by_model TEXT,
      prompt_version TEXT,
      UNIQUE(household_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS assistant_outbound_log (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      to_member_id TEXT,
      template TEXT NOT NULL,
      body TEXT NOT NULL,
      external_message_id TEXT,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      trigger_ref_json TEXT,
      user_action TEXT,
      composed_by_model TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_idempotency
       ON assistant_outbound_log(household_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS assistant_trust_ledger (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      reversible INTEGER NOT NULL DEFAULT 0,
      undo_token TEXT,
      related_refs_json TEXT,
      user_dismissed_at TEXT,
      event_idempotency_key TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_trust_ledger_idempotency
       ON assistant_trust_ledger(event_idempotency_key)
       WHERE event_idempotency_key IS NOT NULL`,
    // v1.2 ai_chat carve-out — required by Aihousekeeper HIGH_WRITE tool parking
    // (ApprovalQueueShim). Mirrors migration 0034_ai_tool_pending.sql.
    `CREATE TABLE IF NOT EXISTS ai_tool_pending (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_at TEXT,
      approved_by TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      executed_at TEXT,
      execution_result_json TEXT,
      execution_error TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_tool_pending_idempotency
       ON ai_tool_pending(household_id, idempotency_key)`,
  ];
  for (const stmt of statements) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

export async function createMemoryFtsTable(db: D1Database): Promise<void> {
  // FTS5 virtual table mirroring assistant_memory for recall().
  const statements = [
    `CREATE VIRTUAL TABLE IF NOT EXISTS assistant_memory_fts USING fts5(body, redacted_body, content='assistant_memory', content_rowid='rowid')`,
    `CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_insert AFTER INSERT ON assistant_memory BEGIN
        INSERT INTO assistant_memory_fts(rowid, body, redacted_body) VALUES (new.rowid, new.body, new.redacted_body);
     END`,
    `CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_delete AFTER DELETE ON assistant_memory BEGIN
        INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body) VALUES('delete', old.rowid, old.body, old.redacted_body);
     END`,
    `CREATE TRIGGER IF NOT EXISTS assistant_memory_fts_update AFTER UPDATE ON assistant_memory BEGIN
        INSERT INTO assistant_memory_fts(assistant_memory_fts, rowid, body, redacted_body) VALUES('delete', old.rowid, old.body, old.redacted_body);
        INSERT INTO assistant_memory_fts(rowid, body, redacted_body) VALUES (new.rowid, new.body, new.redacted_body);
     END`,
  ];
  for (const stmt of statements) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

export async function resetAllTables(db: D1Database): Promise<void> {
  const tables = [
    'ai_tool_pending',
    // assistant_memory_fts is NOT deleted directly: it's an external-content
    // FTS5 shadow table (content='assistant_memory'). A direct DELETE on it
    // corrupts its internal vtable state (SQLITE_CORRUPT_VTAB), which then
    // makes the very next statement against assistant_memory throw too —
    // silently swallowed below, leaving stale rows across tests. It stays in
    // sync automatically via the AFTER INSERT/DELETE/UPDATE triggers already
    // defined on assistant_memory (see createMemoryFtsTable).
    'assistant_memory',
    'assistant_followups',
    'assistant_briefings',
    'assistant_outbound_log',
    'assistant_trust_ledger',
    'assistant_identity',
    'contractor_quotes',
    'contractors',
    'task_photos',
    'tasks',
    'push_tokens',
    'garden_plan_markers',
    'garden_plan_boundary_drafts',
    'garden_plans',
    'floor_plans',
    'household_members',
    'households',
    'users',
  ];
  for (const t of tables) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist in this test file's subset; ignore
    }
  }
}
