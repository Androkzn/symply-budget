import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households } from './schema';

// ============ UTILITIES & TAXES ============

// Utility providers (BC Hydro, FortisBC, municipal utilities)
export const utilityProviders = sqliteTable(
  'utility_providers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(), // 'electricity', 'gas', 'garbage', 'water', 'sewer'
    service_area: text('service_area'), // city/municipality name or 'provincial'
    website_url: text('website_url'),
    portal_url: text('portal_url'),
    billing_cycle: text('billing_cycle'), // 'monthly', 'bimonthly', 'quarterly', 'annual'
    contact_phone: text('contact_phone'),
    contact_email: text('contact_email'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    type_idx: index('utility_providers_type_idx').on(table.type),
    service_area_idx: index('utility_providers_service_area_idx').on(table.service_area),
  })
);

// Utility accounts (user's utility accounts)
export const utilityAccounts = sqliteTable(
  'utility_accounts',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    provider_id: text('provider_id')
      .notNull()
      .references(() => utilityProviders.id),
    account_number: text('account_number').notNull(),
    service_type: text('service_type').notNull(), // 'electricity', 'gas', 'water', 'sewer', 'garbage', 'other'
    start_date: text('start_date'),
    is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    billing_cycle_preference: text('billing_cycle_preference'), // 'monthly', 'bimonthly', 'quarterly', 'annual'
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('utility_accounts_household_id_idx').on(table.household_id),
    provider_id_idx: index('utility_accounts_provider_id_idx').on(table.provider_id),
    service_type_idx: index('utility_accounts_service_type_idx').on(table.service_type),
  })
);

// Utility bills
export const utilityBills = sqliteTable(
  'utility_bills',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    account_id: text('account_id').references(() => utilityAccounts.id),
    bill_type: text('bill_type').notNull(), // 'electricity', 'gas', 'water', 'sewer', 'garbage', 'other'
    provider: text('provider'),
    account_number: text('account_number'),
    billing_period_start: text('billing_period_start').notNull(),
    billing_period_end: text('billing_period_end').notNull(),
    amount: integer('amount').notNull(), // in cents
    due_date: text('due_date').notNull(),
    paid_date: text('paid_date'),
    paid_amount: integer('paid_amount'), // in cents
    usage_quantity: real('usage_quantity'),
    usage_unit: text('usage_unit'), // 'kWh', 'GJ', 'm³', etc.
    document_url: text('document_url'), // R2 storage key
    ai_extracted_data: text('ai_extracted_data'), // JSON
    confidence_score: real('confidence_score'),
    // The one-time "Pay <provider> bill" task auto-created while this bill is
    // unpaid. Completed when the bill is marked paid; re-created if it flips
    // back to unpaid. NULL when no task is currently linked.
    task_id: text('task_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('utility_bills_household_id_idx').on(table.household_id),
    account_id_idx: index('utility_bills_account_id_idx').on(table.account_id),
    bill_type_idx: index('utility_bills_bill_type_idx').on(table.bill_type),
    due_date_idx: index('utility_bills_due_date_idx').on(table.due_date),
    billing_period_idx: index('utility_bills_billing_period_idx').on(
      table.billing_period_start,
      table.billing_period_end
    ),
    task_id_idx: index('utility_bills_task_id_idx').on(table.task_id),
  })
);

// Property taxes
export const propertyTaxes = sqliteTable(
  'property_taxes',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    tax_year: integer('tax_year').notNull(),
    assessed_value: integer('assessed_value').notNull(), // in cents
    tax_amount: integer('tax_amount').notNull(), // in cents
    advance_payment_amount: integer('advance_payment_amount'),
    advance_payment_due_date: text('advance_payment_due_date'),
    advance_payment_paid_date: text('advance_payment_paid_date'),
    main_payment_amount: integer('main_payment_amount').notNull(),
    main_payment_due_date: text('main_payment_due_date').notNull(),
    main_payment_paid_date: text('main_payment_paid_date'),
    homeowner_grant_eligible: integer('homeowner_grant_eligible', { mode: 'boolean' })
      .notNull()
      .default(false),
    homeowner_grant_amount: integer('homeowner_grant_amount'), // in cents
    homeowner_grant_applied_date: text('homeowner_grant_applied_date'),
    homeowner_grant_status: text('homeowner_grant_status'), // 'pending', 'approved', 'rejected'
    penalties: text('penalties'), // JSON array
    document_url: text('document_url'), // R2 storage key
    // One-time reminder tasks auto-created while the tax is UNPAID (null once
    // paid / grant applied, or if no task is linked). See migration 0074.
    main_payment_task_id: text('main_payment_task_id'),
    grant_task_id: text('grant_task_id'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('property_taxes_household_id_idx').on(table.household_id),
    tax_year_idx: index('property_taxes_tax_year_idx').on(table.tax_year),
    household_year_idx: uniqueIndex('property_taxes_household_year_idx').on(
      table.household_id,
      table.tax_year
    ),
  })
);

// BC Assessment data
export const bcAssessmentData = sqliteTable(
  'bc_assessment_data',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    assessment_year: integer('assessment_year').notNull(),
    property_class: text('property_class'),
    assessed_value: integer('assessed_value').notNull(), // in cents
    land_value: integer('land_value'), // in cents
    improvement_value: integer('improvement_value'), // in cents
    previous_year_value: integer('previous_year_value'), // in cents
    change_percent: real('change_percent'),
    assessment_pdf_key: text('assessment_pdf_key'), // R2 storage key
    appeal_deadline: text('appeal_deadline'),
    appeal_filed: integer('appeal_filed', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('bc_assessment_data_household_id_idx').on(table.household_id),
    assessment_year_idx: index('bc_assessment_data_assessment_year_idx').on(table.assessment_year),
    household_year_idx: uniqueIndex('bc_assessment_data_household_year_idx').on(
      table.household_id,
      table.assessment_year
    ),
  })
);

// Utility reminders
export const utilityReminders = sqliteTable(
  'utility_reminders',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    bill_id: text('bill_id').references(() => utilityBills.id, { onDelete: 'cascade' }),
    reminder_type: text('reminder_type').notNull(), // 'payment_due', 'overdue', 'homeowner_grant', 'assessment_appeal'
    scheduled_for: text('scheduled_for').notNull(),
    sent_at: text('sent_at'),
    reminder_days_before: integer('reminder_days_before'),
    notification_channel: text('notification_channel'), // 'push', 'email', 'sms'
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('utility_reminders_household_id_idx').on(table.household_id),
    bill_id_idx: index('utility_reminders_bill_id_idx').on(table.bill_id),
    scheduled_for_idx: index('utility_reminders_scheduled_for_idx').on(table.scheduled_for),
    sent_at_idx: index('utility_reminders_sent_at_idx').on(table.sent_at),
  })
);

// Utility trends (pre-calculated trend data)
export const utilityTrends = sqliteTable(
  'utility_trends',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    utility_type: text('utility_type').notNull(),
    year: integer('year').notNull(),
    month: integer('month'),
    total_amount: integer('total_amount').notNull(), // in cents
    average_amount: integer('average_amount'), // in cents
    change_from_previous: integer('change_from_previous'), // in cents
    change_percent: real('change_percent'),
    usage_total: real('usage_total'),
    usage_average: real('usage_average'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('utility_trends_household_id_idx').on(table.household_id),
    utility_type_idx: index('utility_trends_utility_type_idx').on(table.utility_type),
    year_month_idx: index('utility_trends_year_month_idx').on(table.year, table.month),
    household_type_year_month_idx: uniqueIndex('utility_trends_household_type_year_month_idx').on(
      table.household_id,
      table.utility_type,
      table.year,
      table.month
    ),
  })
);

// Municipality configurations
export const municipalityConfigs = sqliteTable(
  'municipality_configs',
  {
    id: text('id').primaryKey(),
    municipality_name: text('municipality_name').notNull().unique(),
    municipality_code: text('municipality_code').notNull().unique(), // 'VAN', 'BUR', 'SUR', etc.
    property_tax_advance_due_date: text('property_tax_advance_due_date'),
    property_tax_main_due_date: text('property_tax_main_due_date').notNull(),
    utility_due_date: text('utility_due_date'),
    early_discount_percentage: real('early_discount_percentage'),
    penalty_structure: text('penalty_structure'), // JSON
    portal_url: text('portal_url'),
    contact_phone: text('contact_phone'),
    contact_email: text('contact_email'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    code_idx: index('municipality_configs_code_idx').on(table.municipality_code),
  })
);

// Export types
export type UtilityProvider = typeof utilityProviders.$inferSelect;
export type UtilityAccount = typeof utilityAccounts.$inferSelect;
export type UtilityBill = typeof utilityBills.$inferSelect;
export type PropertyTax = typeof propertyTaxes.$inferSelect;
export type BCAssessmentData = typeof bcAssessmentData.$inferSelect;
export type UtilityReminder = typeof utilityReminders.$inferSelect;
export type UtilityTrend = typeof utilityTrends.$inferSelect;
export type MunicipalityConfig = typeof municipalityConfigs.$inferSelect;
