import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

// ============ MORTGAGE TRACKING (Canadian) ============
// Budget-only feature. Columns match backend/migrations/0112_mortgage.sql EXACTLY.
// NOT re-exported from schema.ts — this domain uses hand-written SQL migrations
// (db:generate is intentionally bypassed), mirroring the budget & savings domains.
// All amounts are integer cents; rates are basis points (500 = 5.00%). See
// documents/requirements/as-built/mortgage/Mortgage_Implementation_Plan.md §5.

/** One row per loan — the stable identity + initial conditions. */
export const mortgages = sqliteTable(
  'mortgages',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    lender: text('lender'),
    // 'standard' | 'heloc_flexline' | 'step' — combined/readvanceable products
    // (TD FlexLine, Scotia STEP) track only their term portion in v1.
    product_type: text('product_type').notNull().default('standard'),
    // PII — masked on display; full address optional.
    property_address: text('property_address'),
    // Only the last 4 of the mortgage/account number is ever stored (never full).
    mortgage_number_last4: text('mortgage_number_last4'),
    original_price_cents: integer('original_price_cents'),
    down_payment_cents: integer('down_payment_cents'),
    // NOT NULL — (price − down + financed premium) or entered directly.
    original_principal_cents: integer('original_principal_cents').notNull(),
    original_amortization_months: integer('original_amortization_months').notNull().default(300),
    start_date: text('start_date').notNull(),
    // Optional — powers the appreciation slice of the equity breakdown.
    current_home_value_cents: integer('current_home_value_cents'),
    // Financed CMHC/Sagen/CG premium (if any). Included in original_principal but
    // NOT counted as paydown equity (engine §4.4).
    insurance_premium_cents: integer('insurance_premium_cents'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    // Renewal reminder (added 0114). Fires reminder_months_before maturity;
    // last_renewal_reminder_sent_at gives idempotency (one send per window).
    reminder_enabled: integer('reminder_enabled', { mode: 'boolean' }).notNull().default(true),
    reminder_months_before: integer('reminder_months_before').notNull().default(3),
    last_renewal_reminder_sent_at: text('last_renewal_reminder_sent_at'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ household_idx: index('mortgages_household_idx').on(t.household_id) })
);

/** One row per term / renewal — the rate & contract axis. */
export const mortgageTerms = sqliteTable(
  'mortgage_terms',
  {
    id: text('id').primaryKey(),
    mortgage_id: text('mortgage_id')
      .notNull()
      .references(() => mortgages.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(), // 1-based; renewal = sequence + 1
    rate_type: text('rate_type').notNull(), // 'fixed' | 'variable_arm' | 'variable_vrm'
    compounding: text('compounding').notNull(), // 'semi_annual' | 'monthly'
    nominal_rate_bps: integer('nominal_rate_bps').notNull(), // 500 = 5.00%
    prime_rate_bps: integer('prime_rate_bps'), // variable: prime snapshot
    spread_bps: integer('spread_bps'), // variable: signed variance (−90 = prime − 0.90)
    term_months: integer('term_months').notNull(),
    term_start_date: text('term_start_date').notNull(),
    maturity_date: text('maturity_date').notNull(), // drives the renewal reminder
    payment_frequency: text('payment_frequency').notNull(),
    // Remaining amortization when THIS term began (shrinks each term) — the basis
    // for re-amortizing at renewal (engine §4.6), never N−k.
    amortization_months_at_start: integer('amortization_months_at_start').notNull(),
    // Outstanding balance when THIS term began (added 0113). NULL on term 1 ⇒
    // use the mortgage's original_principal. Renewal terms carry the reconciled
    // balance at renewal so the payment re-amortizes correctly (§4.6).
    starting_balance_cents: integer('starting_balance_cents'),
    scheduled_payment_cents: integer('scheduled_payment_cents'), // engine-computed if null
    property_tax_portion_cents: integer('property_tax_portion_cents'),
    insurance_portion_cents: integer('insurance_portion_cents'),
    is_current: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ mortgage_seq_idx: index('mortgage_terms_mortgage_seq_idx').on(t.mortgage_id, t.sequence) })
);

/** Captured statements — the actual / reconciliation axis (migration 0113). */
export const mortgageStatements = sqliteTable(
  'mortgage_statements',
  {
    id: text('id').primaryKey(),
    mortgage_id: text('mortgage_id')
      .notNull()
      .references(() => mortgages.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    term_id: text('term_id'), // logical FK → mortgage_terms.id (resolved by date)
    statement_date: text('statement_date').notNull(), // the reconciliation anchor date
    period_start: text('period_start'),
    period_end: text('period_end'),
    opening_balance_cents: integer('opening_balance_cents'),
    closing_balance_cents: integer('closing_balance_cents').notNull(), // HARD anchor
    interest_paid_cents: integer('interest_paid_cents'),
    interest_charged_cents: integer('interest_charged_cents'), // may differ (frequency timing)
    principal_paid_cents: integer('principal_paid_cents'),
    payment_amount_cents: integer('payment_amount_cents'),
    interest_rate_bps: integer('interest_rate_bps'),
    prime_rate_bps: integer('prime_rate_bps'),
    variance_bps: integer('variance_bps'), // signed
    remaining_amortization_months: integer('remaining_amortization_months'),
    property_tax_paid_cents: integer('property_tax_paid_cents'),
    source: text('source').notNull().default('manual'), // manual|camera|gallery|file|google_drive
    extraction_confidence: integer('extraction_confidence'), // 0-100 (int; null for manual)
    raw_extraction_json: text('raw_extraction_json'), // PII-scrubbed only; never logged
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ mortgage_date_idx: index('mortgage_statements_mortgage_date_idx').on(t.mortgage_id, t.statement_date) })
);

/**
 * Per-statement interest-rate sub-periods (migration 0118) — the dated rate axis.
 * A variable / HELOC statement lists its interest in sub-periods, so the rate
 * actually paid changes MID-statement; one row per sub-period makes that history
 * queryable (it previously only existed inside `raw_extraction_json`).
 */
export const mortgageRatePeriods = sqliteTable(
  'mortgage_rate_periods',
  {
    id: text('id').primaryKey(),
    mortgage_id: text('mortgage_id')
      .notNull()
      .references(() => mortgages.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // CASCADE — replacing/deleting a statement can never strand its rate rows.
    statement_id: text('statement_id').references(() => mortgageStatements.id, { onDelete: 'cascade' }),
    effective_date: text('effective_date').notNull(), // FIRST day the rate applied
    period_end: text('period_end'),
    rate_bps: integer('rate_bps').notNull(), // 359 = 3.59%
    prime_rate_bps: integer('prime_rate_bps'),
    variance_bps: integer('variance_bps'), // signed
    source: text('source').notNull().default('statement'), // statement|manual
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    mortgage_date_idx: index('mortgage_rate_periods_mortgage_date_idx').on(t.mortgage_id, t.effective_date),
  })
);

/** Prepayment / rate-change / renewal ledger — feeds the reconciliation engine. */
export const mortgageEvents = sqliteTable(
  'mortgage_events',
  {
    id: text('id').primaryKey(),
    mortgage_id: text('mortgage_id')
      .notNull()
      .references(() => mortgages.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // lump_sum_prepayment | payment_increase | rate_change | renewal | amortization_change
    event_type: text('event_type').notNull(),
    event_date: text('event_date').notNull(),
    amount_cents: integer('amount_cents'),
    new_rate_bps: integer('new_rate_bps'),
    new_payment_cents: integer('new_payment_cents'),
    policy: text('policy'), // keep_payment_shorten | keep_amort_lower_payment
    note: text('note'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ mortgage_date_idx: index('mortgage_events_mortgage_date_idx').on(t.mortgage_id, t.event_date) })
);

/** Renewal-shopping offers to compare across banks (migration 0115). */
export const mortgageRenewalOffers = sqliteTable(
  'mortgage_renewal_offers',
  {
    id: text('id').primaryKey(),
    mortgage_id: text('mortgage_id')
      .notNull()
      .references(() => mortgages.id, { onDelete: 'cascade' }),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    bank_name: text('bank_name').notNull(),
    offered_rate_bps: integer('offered_rate_bps').notNull(),
    rate_type: text('rate_type').notNull(), // fixed | variable_arm | variable_vrm
    term_months: integer('term_months').notNull(),
    monthly_payment_cents: integer('monthly_payment_cents'),
    offer_expires_at: text('offer_expires_at'),
    status: text('status').notNull().default('draft'), // draft|shortlisted|accepted|declined
    source: text('source').notNull().default('manual'), // manual|ai
    note: text('note'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({ mortgage_status_idx: index('mortgage_renewal_offers_mortgage_status_idx').on(t.mortgage_id, t.status) })
);

export type Mortgage = typeof mortgages.$inferSelect;
export type NewMortgage = typeof mortgages.$inferInsert;
export type MortgageRenewalOffer = typeof mortgageRenewalOffers.$inferSelect;
export type NewMortgageRenewalOffer = typeof mortgageRenewalOffers.$inferInsert;
export type MortgageTerm = typeof mortgageTerms.$inferSelect;
export type NewMortgageTerm = typeof mortgageTerms.$inferInsert;
export type MortgageStatement = typeof mortgageStatements.$inferSelect;
export type NewMortgageStatement = typeof mortgageStatements.$inferInsert;
export type MortgageEvent = typeof mortgageEvents.$inferSelect;
export type NewMortgageEvent = typeof mortgageEvents.$inferInsert;
export type MortgageRatePeriod = typeof mortgageRatePeriods.$inferSelect;
export type NewMortgageRatePeriod = typeof mortgageRatePeriods.$inferInsert;
