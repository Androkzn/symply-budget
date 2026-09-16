import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';
import { savingsRecurringPayments } from './schema-savings';

// ============ LOAN TRACKING (Budget-only) ============
// Columns match backend/migrations/0146_budget_loans.sql +
// 0147_budget_loans_portal_url.sql + 0148_budget_loans_amount_paid.sql EXACTLY.
// Hand-written SQL migration (db:generate is intentionally bypassed), same
// convention as schema-mortgage.ts / schema-budget-renewals.ts.
//
// One row per `savings_recurring_payments` item that opts into loan
// tracking — car loans, BNPL plans, personal loans. All derived numbers
// (payments remaining, interest paid to date, total interest) are computed
// on read by `services/budget/loan-amortization.ts`, reusing the mortgage
// amortization engine — nothing here is a cached/derived figure.
export const budgetLoans = sqliteTable(
  'budget_loans',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    recurring_payment_id: text('recurring_payment_id')
      .notNull()
      .references(() => savingsRecurringPayments.id, { onDelete: 'cascade' }),
    // 'revolving' (credit lines/cards) is reserved for a follow-up — only
    // 'installment' is populated today. See migration 0146's header comment.
    loan_kind: text('loan_kind').notNull().default('installment'), // 'installment' | 'revolving'
    rate_type: text('rate_type').notNull().default('fixed'), // 'zero' | 'fixed'
    rate_bps: integer('rate_bps').notNull().default(0),
    principal_cents: integer('principal_cents').notNull(),
    term_months: integer('term_months').notNull(),
    start_date: text('start_date').notNull(), // YYYY-MM-DD
    lender: text('lender'),
    notes: text('notes'),
    // "Manage this loan online" link (0147). NULL = not set.
    portal_url: text('portal_url'),
    // Purely informational "amount already paid" (0148) — NOT used to derive
    // `start_date` or feed the amortization summary. NULL = not set.
    amount_paid_cents: integer('amount_paid_cents'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    household_idx: index('budget_loans_household_idx').on(t.household_id),
    recurring_payment_unique_idx: uniqueIndex('budget_loans_recurring_payment_id_unique').on(
      t.recurring_payment_id
    ),
  })
);

export type BudgetLoan = typeof budgetLoans.$inferSelect;
export type NewBudgetLoan = typeof budgetLoans.$inferInsert;
