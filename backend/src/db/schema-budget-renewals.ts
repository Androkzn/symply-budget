import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';
import { savingsRecurringPayments } from './schema-savings';

// ============ RENEWAL REMINDERS (Budget-only) ============
// Columns match backend/migrations/0145_budget_renewals.sql EXACTLY.
// Hand-written SQL migration (db:generate is intentionally bypassed), same
// convention as schema-mortgage.ts / schema-recurring-reminders.ts.
//
// One row per `savings_recurring_payments` item that opts into renewal
// tracking. Actual nudging is delivered by the shared
// `recurring_reminders` engine (`services/recurring-reminders/`) via the
// `budget_renewal_reminder` type in `services/recurring-reminders/registry.ts`
// — this table only holds the renewal's own facts.
export const budgetRenewals = sqliteTable(
  'budget_renewals',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    recurring_payment_id: text('recurring_payment_id')
      .notNull()
      .references(() => savingsRecurringPayments.id, { onDelete: 'cascade' }),
    category: text('category').notNull().default('other'), // insurance|warranty|subscription|membership|license|other
    provider: text('provider'),
    reference_number: text('reference_number'),
    cycle: text('cycle').notNull().default('annual'), // monthly|quarterly|semi_annual|annual|custom
    cycle_months: integer('cycle_months'), // only when cycle = 'custom'
    next_renewal_date: text('next_renewal_date').notNull(), // YYYY-MM-DD
    renewal_amount_cents: integer('renewal_amount_cents'),
    auto_renew: integer('auto_renew', { mode: 'boolean' }).notNull().default(false),
    // Start nagging this many days before next_renewal_date.
    reminder_lead_days: integer('reminder_lead_days').notNull().default(14),
    status: text('status').notNull().default('upcoming'), // upcoming|renewed|lapsed|cancelled
    notes: text('notes'),
    last_renewed_at: text('last_renewed_at'),
    renewal_count: integer('renewal_count').notNull().default(0),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    household_idx: index('budget_renewals_household_idx').on(t.household_id),
    due_idx: index('budget_renewals_due_idx').on(t.household_id, t.next_renewal_date),
    recurring_payment_unique_idx: uniqueIndex('budget_renewals_recurring_payment_id_unique').on(
      t.recurring_payment_id
    ),
  })
);

/** Attachments (policy documents, renewal notices, photos) — N per renewal. */
export const budgetRenewalDocuments = sqliteTable(
  'budget_renewal_documents',
  {
    id: text('id').primaryKey(),
    renewal_id: text('renewal_id')
      .notNull()
      .references(() => budgetRenewals.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    r2_key: text('r2_key').notNull(),
    file_name: text('file_name').notNull(),
    mime_type: text('mime_type').notNull(),
    file_size: integer('file_size').notNull().default(0),
    source: text('source').notNull().default('manual'), // camera|gallery|file|drive|manual
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ renewal_idx: index('budget_renewal_documents_renewal_idx').on(t.renewal_id) })
);

export type BudgetRenewal = typeof budgetRenewals.$inferSelect;
export type NewBudgetRenewal = typeof budgetRenewals.$inferInsert;
export type BudgetRenewalDocument = typeof budgetRenewalDocuments.$inferSelect;
export type NewBudgetRenewalDocument = typeof budgetRenewalDocuments.$inferInsert;
