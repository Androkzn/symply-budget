/**
 * Shared DDL helpers for utilities route tests.
 */

export async function createUtilitiesTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS utility_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      service_area TEXT,
      website_url TEXT,
      portal_url TEXT,
      billing_cycle TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS utility_bills (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT,
      bill_type TEXT NOT NULL,
      provider TEXT,
      account_number TEXT,
      billing_period_start TEXT NOT NULL,
      billing_period_end TEXT NOT NULL,
      amount INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      paid_date TEXT,
      paid_amount INTEGER,
      usage_quantity REAL,
      usage_unit TEXT,
      document_url TEXT,
      ai_extracted_data TEXT,
      confidence_score REAL,
      task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS utility_reminders (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      bill_id TEXT,
      reminder_type TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      sent_at TEXT,
      reminder_days_before INTEGER,
      notification_channel TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    // property_taxes incl. the migration-0074 task-link columns the service writes.
    db.prepare(`CREATE TABLE IF NOT EXISTS property_taxes (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      tax_year INTEGER NOT NULL,
      assessed_value INTEGER NOT NULL,
      tax_amount INTEGER NOT NULL,
      advance_payment_amount INTEGER,
      advance_payment_due_date TEXT,
      advance_payment_paid_date TEXT,
      main_payment_amount INTEGER NOT NULL,
      main_payment_due_date TEXT NOT NULL,
      main_payment_paid_date TEXT,
      homeowner_grant_eligible INTEGER NOT NULL DEFAULT 0,
      homeowner_grant_amount INTEGER,
      homeowner_grant_applied_date TEXT,
      homeowner_grant_status TEXT,
      penalties TEXT,
      document_url TEXT,
      main_payment_task_id TEXT,
      grant_task_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS bc_assessment_data (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      assessment_year INTEGER NOT NULL,
      property_class TEXT,
      assessed_value INTEGER NOT NULL,
      land_value INTEGER,
      improvement_value INTEGER,
      previous_year_value INTEGER,
      change_percent REAL,
      assessment_pdf_key TEXT,
      appeal_deadline TEXT,
      appeal_filed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    // One property tax record per household+year, matching the prod uniqueIndex.
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS property_taxes_household_year_idx ON property_taxes(household_id, tax_year)`
    ),
  ]);
}

/**
 * Tables TaskService.createTask touches (subtasks + scheduled notifications).
 * Needed by any test that exercises task auto-creation (pay-bill, property-tax
 * grant/pay reminders). Not part of createCoreTables.
 */
export async function createTaskSupportTables(db: D1Database): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS maintenance_subtasks (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0, is_completed INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT, reminder_enabled INTEGER NOT NULL DEFAULT 0, reminder_days_before INTEGER NOT NULL DEFAULT 1, reminder_time TEXT NOT NULL DEFAULT '09:00', reminder_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by TEXT, deleted_at TEXT)`
  );
  await db.exec(
    `CREATE TABLE IF NOT EXISTS scheduled_notifications (id TEXT PRIMARY KEY, user_id TEXT, household_id TEXT, type TEXT, reference_type TEXT NOT NULL, reference_id TEXT NOT NULL, title TEXT, body TEXT, data TEXT, scheduled_for TEXT, sent_at TEXT, failed_at TEXT, cancelled_at TEXT, failure_reason TEXT, error_message TEXT, notification_type TEXT, task_id TEXT, action_item_id TEXT, retry_count INTEGER DEFAULT 0, last_error TEXT, priority TEXT, metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
}

export async function resetUtilitiesTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM utility_reminders'),
    db.prepare('DELETE FROM utility_bills'),
    db.prepare('DELETE FROM utility_providers'),
    db.prepare('DELETE FROM property_taxes'),
    db.prepare('DELETE FROM bc_assessment_data'),
  ]);
}
