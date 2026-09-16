/**
 * Test DDL for the Home Projects tables.
 *
 * Extracted from home-projects.test.ts so suites can share the schema without
 * importing a test module — importing one registers its describe blocks into
 * the importing file, which re-runs an unrelated suite under the wrong
 * beforeEach and reports its failures against the wrong file.
 *
 * This DDL must mirror the migrations exactly, CHECK constraints and unique
 * indexes included. A test schema laxer than the real one certifies a database
 * nobody runs.
 */
export async function createHomeProjectTables(db: D1Database): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS home_projects (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'renovation',
      template_key TEXT,
      status TEXT NOT NULL DEFAULT 'planning',
      visibility TEXT NOT NULL DEFAULT 'published',
      default_role TEXT NOT NULL DEFAULT 'owner',
      access_json TEXT,
      summary TEXT,
      goals TEXT,
      constraints TEXT,
      target_budget_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      contingency_pct INTEGER NOT NULL DEFAULT 15,
      target_start_at TEXT,
      target_end_at TEXT,
      cover_attachment_id TEXT,
      -- Migration 0166: the change-of-use target ("woodworking shop").
      target_use TEXT,
      -- Migration 0170: the project own jobs, replacing home_project_tasks.
      linked_task_ids TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_spaces (
      project_id TEXT NOT NULL, space_id TEXT NOT NULL, PRIMARY KEY (project_id, space_id)
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_budget_lines (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'other',
      label TEXT NOT NULL, estimate_cents INTEGER NOT NULL DEFAULT 0, actual_cents INTEGER NOT NULL DEFAULT 0,
      selection_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_selections (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      -- The CHECK is migration 0105's and it is LOAD-BEARING in a test schema.
      -- Without it these suites passed while setPreferredSelection wrote
      -- 'chosen'/'considering' — two values D1 refuses — so every pick 500'd in
      -- staging and production while the tests stayed green. A test schema that
      -- is laxer than the real one certifies a database nobody runs.
      status TEXT NOT NULL DEFAULT 'idea'
        CHECK (status IN ('idea','shortlisted','approved','rejected','ordered','installed')),
      qty INTEGER NOT NULL DEFAULT 1, unit TEXT, unit_price_cents INTEGER, vendor TEXT,
      product_url TEXT, surface_ref TEXT, notes TEXT, assignee_user_id TEXT,
      option_group_id TEXT, brand TEXT, sku TEXT, image_url TEXT,
      coverage_per_unit REAL, coverage_unit TEXT, specs_json TEXT,
      extraction_source TEXT NOT NULL DEFAULT 'manual', extraction_confidence TEXT,
      -- Appearance + sale pricing (migration 0164). These are nullable ALTERs in
      -- the migration, so they are nullable here: this DDL has to mirror what a
      -- migrated D1 looks like, not what a fresh CREATE would ideally be.
      color_hex TEXT, grout_color_hex TEXT, unit_w_mm REAL, unit_h_mm REAL,
      list_price_cents INTEGER, sale_price_cents INTEGER,
      discount_pct INTEGER, sale_ends_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_option_groups (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'finish', area_value REAL, area_unit TEXT,
      area_source TEXT NOT NULL DEFAULT 'manual', waste_factor_pct INTEGER NOT NULL DEFAULT 10,
      preferred_selection_id TEXT,
      -- Migration 0166 provenance.
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_phases (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', starts_on TEXT, ends_on TEXT,
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_milestones (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, phase_id TEXT, title TEXT NOT NULL,
      due_on TEXT, done_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_blockers (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      notes TEXT, resolved_at TEXT,
      draft_source TEXT NOT NULL DEFAULT 'manual', draft_confidence TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_attachments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, selection_id TEXT, kind TEXT NOT NULL DEFAULT 'photo',
      r2_key TEXT, url TEXT, filename TEXT, content_type TEXT, file_size INTEGER, caption TEXT, tags TEXT,
      status TEXT NOT NULL DEFAULT 'pending_upload', created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_plan_links (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, floor_plan_id TEXT NOT NULL,
      zone_payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_geometry (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'completed', schema_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT, confidence TEXT, disclaimer TEXT, error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_comments (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, selection_id TEXT, user_id TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS home_project_activity (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL,
      entity_type TEXT, entity_id TEXT, meta_json TEXT, idempotency_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // `home_project_tasks` is gone as of migration 0170 — the link is
    // `home_projects.linked_task_ids` above.
    `CREATE TABLE IF NOT EXISTS home_project_contractors (
      project_id TEXT NOT NULL, contractor_id TEXT NOT NULL, quote_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (project_id, contractor_id)
    )`,
    // Migration 0166 — Smart Project. The UNIQUE index is load-bearing in the
    // same way the selections CHECK above is: without it a second as-is row for
    // the same element inserts happily here and 500s against a migrated D1.
    `CREATE TABLE IF NOT EXISTS home_project_as_is (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, element TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'unknown', evidence TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS hpai_project_element
      ON home_project_as_is(project_id, element)`,
    `CREATE TABLE IF NOT EXISTS home_project_smart_drafts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generating', description TEXT NOT NULL,
      spaces_json TEXT, attachment_ids_json TEXT, confidence TEXT, disclaimer TEXT,
      error_code TEXT, dropped_json TEXT, tasks_json TEXT, created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of stmts) {
    await db.prepare(sql).run();
  }
}
