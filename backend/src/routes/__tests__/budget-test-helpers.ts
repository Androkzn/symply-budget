import type { Env } from '../../types';

/**
 * Local D1 table bootstrap for Smart Budget tests. The shared
 * aihousekeeper test-helpers (`createCoreTables`/`resetAllTables`) cover
 * users/households/household_members but know nothing about
 * `schema-budget.ts`'s tables, so budget tests bring their own.
 */

/** Pool env uses House wrangler.toml — promote to Budget Worker for full money routes. */
export function applyBudgetWorkerTestBrand(env: Env): void {
  env.APP_BRAND = 'symply-budget';
}

export async function createBudgetTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS budget_categories (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS budget_items (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT,
      horizon TEXT NOT NULL DEFAULT 'short_term',
      timeframe TEXT NOT NULL,
      year INTEGER,
      quarter INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      estimated_cost_min INTEGER,
      estimated_cost_max INTEGER,
      actual_cost INTEGER,
      priority TEXT NOT NULL,
      status TEXT NOT NULL,
      is_recurring INTEGER DEFAULT 0,
      recurrence_frequency TEXT,
      source_type TEXT,
      source_id TEXT,
      target_date TEXT,
      completed_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS budget_goals (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER,
      planned_budget INTEGER,
      actual_spent INTEGER DEFAULT 0,
      category_budgets TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      budget_item_id TEXT,
      category_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      amount INTEGER NOT NULL,
      saved_amount INTEGER NOT NULL DEFAULT 0,
      tax_amount INTEGER NOT NULL DEFAULT 0,
      deposit_amount INTEGER NOT NULL DEFAULT 0,
      expense_date TEXT NOT NULL,
      vendor TEXT,
      receipt_key TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      import_batch_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS budget_insights (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      period TEXT NOT NULL,
      insight_text TEXT NOT NULL,
      insight_json TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS budget_transfers (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      source_year INTEGER NOT NULL,
      source_month INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      destination_type TEXT NOT NULL,
      dest_year INTEGER,
      dest_month INTEGER,
      goal_id TEXT,
      account_id TEXT,
      destination_ref_id TEXT,
      destination_label TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS budget_sub_budgets (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER,
      limit_type TEXT NOT NULL,
      amount_cents INTEGER,
      percent_bps INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of statements) {
    await db.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

export async function resetBudgetTables(db: D1Database): Promise<void> {
  const tables = [
    'budget_sub_budgets',
    'budget_transfers',
    'budget_insights',
    'expenses',
    'budget_goals',
    'budget_items',
    'budget_categories',
  ];
  for (const t of tables) {
    try {
      await db.exec(`DELETE FROM ${t}`);
    } catch {
      // table may not exist yet in this test file; ignore
    }
  }
}
