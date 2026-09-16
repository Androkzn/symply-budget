/**
 * Minimal DDL for the recurring-reminders test surface. `cloudflare:test`'s D1
 * starts empty (no migrations auto-applied — see vitest.config.ts), so every
 * suite synthesizes just the tables it touches. Mirrors the pattern in
 * `services/__tests__/notification-delivery-cas.test.ts`.
 */
import type { D1Database } from '@cloudflare/workers-types';

const RECURRING_REMINDERS_DDL = `CREATE TABLE IF NOT EXISTS recurring_reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  frequency TEXT NOT NULL,
  next_nudge_at TEXT NOT NULL,
  last_nudged_at TEXT,
  nudge_count INTEGER NOT NULL DEFAULT 0,
  snoozed_until TEXT,
  completed_at TEXT,
  completed_by_user_id TEXT,
  completed_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SCHEDULED_NOTIFICATIONS_DDL = `CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  household_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data TEXT,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  failed_at TEXT,
  error_message TEXT,
  reference_type TEXT,
  reference_id TEXT,
  image_url TEXT,
  category_id TEXT,
  thread_id TEXT,
  claimed_at TEXT,
  claim_owner TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const CRON_LEASES_DDL = `CREATE TABLE IF NOT EXISTS cron_leases (
  job_name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`;

const MORTGAGE_STATEMENTS_DDL = `CREATE TABLE IF NOT EXISTS mortgage_statements (
  id TEXT PRIMARY KEY,
  mortgage_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  statement_date TEXT NOT NULL,
  closing_balance_cents INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SAVINGS_INCOME_ENTRIES_DDL = `CREATE TABLE IF NOT EXISTS savings_income_entries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  member_id TEXT,
  source_type TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  income_date TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  notes TEXT,
  template_id TEXT,
  period TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  rolled_over_from_entry_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SAVINGS_RECURRING_PAYMENTS_DDL = `CREATE TABLE IF NOT EXISTS savings_recurring_payments (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  category_id TEXT,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CAD',
  day_of_month INTEGER,
  group_label TEXT,
  is_essential INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  is_automated INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const BUDGET_RENEWALS_DDL = `CREATE TABLE IF NOT EXISTS budget_renewals (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  recurring_payment_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'other',
  provider TEXT,
  reference_number TEXT,
  cycle TEXT NOT NULL DEFAULT 'annual',
  cycle_months INTEGER,
  next_renewal_date TEXT NOT NULL,
  renewal_amount_cents INTEGER,
  auto_renew INTEGER NOT NULL DEFAULT 0,
  reminder_lead_days INTEGER NOT NULL DEFAULT 14,
  status TEXT NOT NULL DEFAULT 'upcoming',
  notes TEXT,
  last_renewed_at TEXT,
  renewal_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export async function createRecurringReminderTables(db: D1Database): Promise<void> {
  for (const ddl of [
    RECURRING_REMINDERS_DDL,
    SCHEDULED_NOTIFICATIONS_DDL,
    CRON_LEASES_DDL,
    MORTGAGE_STATEMENTS_DDL,
    BUDGET_RENEWALS_DDL,
    SAVINGS_INCOME_ENTRIES_DDL,
    SAVINGS_RECURRING_PAYMENTS_DDL,
  ]) {
    await db.prepare(ddl.replace(/\s+/g, ' ').trim()).run();
  }
}

export async function resetRecurringReminderTables(db: D1Database): Promise<void> {
  for (const table of [
    'recurring_reminders',
    'scheduled_notifications',
    'cron_leases',
    'mortgage_statements',
    'budget_renewals',
    'savings_income_entries',
    'savings_recurring_payments',
  ]) {
    await db.prepare(`DELETE FROM ${table}`).run();
  }
}
