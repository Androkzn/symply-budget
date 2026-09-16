import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { households, users } from './schema';

// ============ BUDGET & TIMELINE PLANNING ============

// Budget categories for organizing expenses
export const budgetCategories = sqliteTable(
  'budget_categories',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'), // emoji
    color: text('color'), // hex color
    sort_order: integer('sort_order').default(0),
    // Predefined (app-seeded) categories can be hidden instead of deleted; custom
    // ones are deleted outright. A hidden category drops out of pickers, suggestions
    // and the dashboard, but still resolves for existing items in the timeline lookup
    // so their label doesn't disappear. Whether a category is "predefined" is derived
    // by the service from its name matching a built-in default, so it needs no column.
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('budget_categories_household_id_idx').on(table.household_id),
  })
);

// Planned expenses (from action items, manual entries, and predictions)
export const budgetItems = sqliteTable(
  'budget_items',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    category_id: text('category_id').references(() => budgetCategories.id),
    // Planning horizon (intent-based). Source of truth for how an item is
    // bucketed and whether it counts toward the budget:
    //   'short_term' — buying soon (target_date within ~12 months) → monthly fit
    //   'long_term'  — 1+ year out (rough `year`)                  → long projection
    //   'someday'    — wish/dream: no date, cost is an optional ballpark, and it
    //                  is EXCLUDED from committed/affordability/fit math.
    horizon: text('horizon').notNull().default('short_term'),
    // Timeframe for planning (legacy granular bucket — retained for back-compat;
    // `horizon` supersedes it). 'immediate', '1_month', … '10_years'
    timeframe: text('timeframe').notNull(),
    year: integer('year'), // Specific year for multi-year planning
    quarter: integer('quarter'), // 1-4 for quarterly planning
    // Item details
    title: text('title').notNull(),
    description: text('description'),
    // Cost estimates (in cents)
    estimated_cost_min: integer('estimated_cost_min'),
    estimated_cost_max: integer('estimated_cost_max'),
    actual_cost: integer('actual_cost'),
    // Priority and status
    priority: text('priority').notNull(), // 'critical', 'high', 'medium', 'low'
    status: text('status').notNull(), // 'planned', 'in_progress', 'completed', 'deferred', 'cancelled'
    is_recurring: integer('is_recurring', { mode: 'boolean' }).default(false),
    recurrence_frequency: text('recurrence_frequency'), // 'monthly', 'quarterly', 'yearly'
    // Source reference
    source_type: text('source_type'), // 'task', 'manual'
    source_id: text('source_id'),
    // Dates
    target_date: text('target_date'),
    completed_at: text('completed_at'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('budget_items_household_id_idx').on(table.household_id),
    horizon_idx: index('budget_items_horizon_idx').on(table.horizon),
    timeframe_idx: index('budget_items_timeframe_idx').on(table.timeframe),
    year_idx: index('budget_items_year_idx').on(table.year),
    status_idx: index('budget_items_status_idx').on(table.status),
    priority_idx: index('budget_items_priority_idx').on(table.priority),
  })
);

// Budget goals and targets
export const budgetGoals = sqliteTable(
  'budget_goals',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month'), // null for yearly goals
    // Budget amounts (in cents)
    planned_budget: integer('planned_budget'),
    actual_spent: integer('actual_spent').default(0),
    // Category breakdowns (JSON)
    category_budgets: text('category_budgets'), // JSON: { categoryId: amount }
    notes: text('notes'),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_year_idx: index('budget_goals_household_year_idx').on(table.household_id, table.year),
  })
);

// Per-category sub-budgets (caps within a month's total budget). A row scopes a
// cap for one category to either a whole year (month IS NULL = recurring default,
// applied to every month) or a single month (month 1-12 = override that beats the
// default for just that month). A cap is EITHER a fixed amount (`amount_cents`) or
// a percent of that month's total `planned_budget` (`percent_bps`, basis points
// 0-10000 = 0-100%); percents resolve live so they follow changes to the total.
// This supersedes the legacy `budget_goals.category_budgets` JSON, which the
// resolver still falls back to so pre-existing data isn't lost.
export const budgetSubBudgets = sqliteTable(
  'budget_sub_budgets',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // No onDelete — the service detaches referencing rows before deleting a
    // category (mirrors budgetItems.category_id).
    category_id: text('category_id')
      .notNull()
      .references(() => budgetCategories.id),
    year: integer('year').notNull(),
    month: integer('month'), // NULL = recurring default for the year; 1-12 = month override
    limit_type: text('limit_type').notNull(), // 'amount' | 'percent'
    amount_cents: integer('amount_cents'), // set when limit_type = 'amount'
    percent_bps: integer('percent_bps'), // basis points 0-10000; set when limit_type = 'percent'
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text('updated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_year_idx: index('budget_sub_budgets_household_year_idx').on(
      table.household_id,
      table.year
    ),
    // One cap per (household, year, month|default, category).
    unique_scope_idx: uniqueIndex('budget_sub_budgets_scope_idx').on(
      table.household_id,
      table.year,
      table.month,
      table.category_id
    ),
  })
);

// Expense history/actual spending
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    budget_item_id: text('budget_item_id').references(() => budgetItems.id),
    category_id: text('category_id').references(() => budgetCategories.id),
    title: text('title').notNull(),
    description: text('description'),
    amount: integer('amount').notNull(), // in cents
    // Discount/sale savings applied to this line item, in cents (0 = full price).
    // Populated by grocery receipt scanning; aggregated per month.
    saved_amount: integer('saved_amount').notNull().default(0),
    // Sales tax INCLUDED in `amount` for this line, in cents (0 = exempt / no
    // tax). Populated by receipt scanning so budget totals are tax-inclusive;
    // informational breakdown (amount already contains it).
    tax_amount: integer('tax_amount').notNull().default(0),
    // Container deposit + US CRV included in `amount`, in cents (0 = none).
    // Populated by receipt scanning; aggregated per month like saved_amount.
    deposit_amount: integer('deposit_amount').notNull().default(0),
    expense_date: text('expense_date').notNull(),
    vendor: text('vendor'),
    receipt_key: text('receipt_key'), // R2 key for receipt image
    // Provenance: 'manual' (hand-entered / receipt scan) | 'ai_import' | 'history_import'.
    // Historical (previous-years) AI imports stamp 'history_import' + import_batch_id
    // so they can be replaced/undone without touching manual rows.
    source: text('source').notNull().default('manual'),
    import_batch_id: text('import_batch_id'), // groups one history-import commit; NULL for manual
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_id_idx: index('expenses_household_id_idx').on(table.household_id),
    expense_date_idx: index('expenses_expense_date_idx').on(table.expense_date),
    budget_item_id_idx: index('expenses_budget_item_id_idx').on(table.budget_item_id),
    import_batch_idx: index('expenses_import_batch_idx').on(table.import_batch_id),
  })
);

// Cached AI-generated budget insights, keyed by household + month period
export const budgetInsights = sqliteTable(
  'budget_insights',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    period: text('period').notNull(), // 'YYYY-MM'
    insight_text: text('insight_text').notNull(),
    insight_json: text('insight_json').notNull(),
    input_hash: text('input_hash').notNull(),
    generated_at: text('generated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    household_period_idx: index('budget_insights_household_period_idx').on(
      table.household_id,
      table.period
    ),
  })
);

// A one-way move of a month's leftover budget to a destination. The source
// month's remaining balance is DERIVED — it subtracts the sum of transfers out
// of that month (so the same leftover can't be moved twice), and a 'next_month'
// transfer adds a carry-in credit to the target month. Savings-goal and
// registered-account transfers additionally mutate those subsystems (goal
// current amount / account balance via a linked registered_transactions row),
// and `destination_ref_id` records that linked row so an undo can reverse it.
// `destination_label` is denormalized at creation time so history renders
// (and stays stable) even if the target goal/account is later deleted.
export const budgetTransfers = sqliteTable(
  'budget_transfers',
  {
    id: text('id').primaryKey(),
    household_id: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    // Source month the leftover is drawn from.
    source_year: integer('source_year').notNull(),
    source_month: integer('source_month').notNull(), // 1-12
    amount_cents: integer('amount_cents').notNull(),
    // 'next_month' | 'savings_goal' | 'registered_account'
    destination_type: text('destination_type').notNull(),
    // For 'next_month': the target budget month that receives the carry-in.
    dest_year: integer('dest_year'),
    dest_month: integer('dest_month'),
    // For 'savings_goal' / 'registered_account': the target's id (nulled if the
    // target is later deleted; the row survives as history).
    goal_id: text('goal_id'),
    account_id: text('account_id'),
    // The registered_transactions row created for an account transfer, so undo
    // can reverse the balance move.
    destination_ref_id: text('destination_ref_id'),
    // Snapshot of the destination's display name at transfer time.
    destination_label: text('destination_label').notNull(),
    note: text('note'),
    created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => ({
    source_idx: index('budget_transfers_source_idx').on(
      table.household_id,
      table.source_year,
      table.source_month
    ),
    dest_idx: index('budget_transfers_dest_idx').on(
      table.household_id,
      table.dest_year,
      table.dest_month
    ),
  })
);

// Export types
export type BudgetCategory = typeof budgetCategories.$inferSelect;
export type NewBudgetCategory = typeof budgetCategories.$inferInsert;
export type BudgetItem = typeof budgetItems.$inferSelect;
export type NewBudgetItem = typeof budgetItems.$inferInsert;
export type BudgetGoal = typeof budgetGoals.$inferSelect;
export type NewBudgetGoal = typeof budgetGoals.$inferInsert;
export type SubBudget = typeof budgetSubBudgets.$inferSelect;
export type NewSubBudget = typeof budgetSubBudgets.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type BudgetInsight = typeof budgetInsights.$inferSelect;
export type NewBudgetInsight = typeof budgetInsights.$inferInsert;
export type BudgetTransfer = typeof budgetTransfers.$inferSelect;
export type NewBudgetTransfer = typeof budgetTransfers.$inferInsert;
