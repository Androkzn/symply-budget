/**
 * Local D1 table bootstrap for Savings route tests. The shared aihousekeeper
 * test-helpers (`createCoreTables`/`resetAllTables`) cover
 * users/households/household_members but not `schema-savings.ts`'s tables, so
 * savings tests bring their own. DDL mirrors
 * `backend/migrations/0067_savings_tables.sql` (incl. the partial unique
 * indexes that back idempotent apply-* actions) and the budget `expenses`
 * table (needed for the Home-from-Budget rollup in getOverview).
 */
export async function createSavingsTables(db: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS savings_categories (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      is_essential INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(household_id, name)
    )`,
    `CREATE INDEX IF NOT EXISTS savings_categories_household_idx ON savings_categories(household_id)`,
    `CREATE TABLE IF NOT EXISTS savings_income_entries (
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
    )`,
    `CREATE INDEX IF NOT EXISTS savings_income_import_batch_idx ON savings_income_entries(import_batch_id)`,
    `CREATE INDEX IF NOT EXISTS savings_income_household_idx ON savings_income_entries(household_id)`,
    `CREATE INDEX IF NOT EXISTS savings_income_date_idx ON savings_income_entries(household_id, income_date)`,
    `CREATE INDEX IF NOT EXISTS savings_income_status_idx ON savings_income_entries(household_id, status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS savings_income_template_period_idx
      ON savings_income_entries(template_id, period) WHERE template_id IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS savings_income_rollover_source_unique_idx
      ON savings_income_entries(rolled_over_from_entry_id) WHERE rolled_over_from_entry_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS savings_spending_entries (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      spending_date TEXT NOT NULL,
      notes TEXT,
      recurring_payment_id TEXT,
      period TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS savings_spending_household_idx ON savings_spending_entries(household_id)`,
    `CREATE INDEX IF NOT EXISTS savings_spending_date_idx ON savings_spending_entries(household_id, spending_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS savings_spending_recurring_period_idx
      ON savings_spending_entries(recurring_payment_id, period) WHERE recurring_payment_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS savings_income_templates (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      member_id TEXT,
      source_type TEXT NOT NULL,
      label TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      day_of_month INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS savings_income_templates_household_idx ON savings_income_templates(household_id)`,
    `CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      target_amount_cents INTEGER NOT NULL,
      current_amount_cents INTEGER NOT NULL DEFAULT 0,
      target_date TEXT,
      months_of_expenses INTEGER,
      monthly_allocation_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'CAD',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS savings_goals_household_idx ON savings_goals(household_id)`,
    `CREATE TABLE IF NOT EXISTS registered_accounts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      member_id TEXT,
      account_type TEXT NOT NULL,
      institution TEXT,
      is_employer_plan INTEGER NOT NULL DEFAULT 0,
      employer_name TEXT,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      starting_room_cents INTEGER,
      annual_limit_override_cents INTEGER,
      regular_contribution_cents INTEGER,
      annual_goal_cents INTEGER,
      annual_goal_pct INTEGER,
      is_room_only INTEGER NOT NULL DEFAULT 0,
      employer_match_cents INTEGER,
      recurring_start_month TEXT,
      room_as_of_date TEXT,
      prior_earned_income_cents INTEGER,
      pension_adjustment_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'CAD',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS registered_accounts_household_idx ON registered_accounts(household_id)`,
    `CREATE TABLE IF NOT EXISTS registered_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'manual',
      contributor TEXT NOT NULL DEFAULT 'self',
      amount_cents INTEGER NOT NULL,
      transaction_date TEXT NOT NULL,
      tax_year INTEGER,
      period TEXT,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      import_batch_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS registered_transactions_account_idx ON registered_transactions(account_id)`,
    `CREATE INDEX IF NOT EXISTS registered_transactions_import_batch_idx ON registered_transactions(import_batch_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS registered_tx_regular_period_idx
      ON registered_transactions(account_id, period, contributor) WHERE period IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS savings_recurring_payments (
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
      scope_type TEXT NOT NULL DEFAULT 'all_year',
      scope_year INTEGER,
      active_months TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS savings_recurring_payments_household_idx ON savings_recurring_payments(household_id)`,
    `CREATE TABLE IF NOT EXISTS savings_import_jobs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_upload',
      source_kind TEXT NOT NULL,
      file_key TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      content_hash TEXT,
      raw_text TEXT,
      draft_json TEXT,
      error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS savings_import_jobs_household_idx ON savings_import_jobs(household_id)`,
    // Budget expenses table — the Home-from-Budget rollup in getOverview and the
    // previous-years history read model both read it. `source`/`import_batch_id`
    // back the history-import provenance (migration 0070).
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
    `CREATE INDEX IF NOT EXISTS expenses_import_batch_idx ON expenses(import_batch_id)`,
    // Budget categories — the history read model buckets expenses by category
    // name (Food/Groceries, Monthly payments/Rent & Mortgage, Other), and the
    // history-import category resolver creates/matches rows here.
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
    `CREATE INDEX IF NOT EXISTS budget_categories_household_id_idx ON budget_categories(household_id)`,
    // Budget goals — the history goals footer reads category_budgets for the year.
    `CREATE TABLE IF NOT EXISTS budget_goals (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER,
      planned_budget INTEGER,
      actual_spent INTEGER NOT NULL DEFAULT 0,
      category_budgets TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS budget_goals_household_year_idx ON budget_goals(household_id, year)`,
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
    `CREATE INDEX IF NOT EXISTS budget_sub_budgets_household_year_idx ON budget_sub_budgets(household_id, year)`,
    `CREATE TABLE IF NOT EXISTS savings_monthly_targets (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      period TEXT NOT NULL,
      target_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // The upsert in setMonthlyTargets targets this unique index — without it the
    // ON CONFLICT clause has no arbiter and re-applying a target would duplicate.
    `CREATE UNIQUE INDEX IF NOT EXISTS savings_monthly_targets_period_idx ON savings_monthly_targets(household_id, period)`,
    // Renewal reminders for Monthly Payments (migration 0145).
    `CREATE TABLE IF NOT EXISTS budget_renewals (
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
    )`,
    `CREATE INDEX IF NOT EXISTS budget_renewals_household_idx ON budget_renewals(household_id)`,
    `CREATE TABLE IF NOT EXISTS budget_renewal_documents (
      id TEXT PRIMARY KEY,
      renewal_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS budget_renewal_documents_renewal_idx ON budget_renewal_documents(renewal_id)`,
    // Loan tracking for Monthly Payments (migration 0146 + 0147's portal_url).
    `CREATE TABLE IF NOT EXISTS budget_loans (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      recurring_payment_id TEXT NOT NULL UNIQUE,
      loan_kind TEXT NOT NULL DEFAULT 'installment',
      rate_type TEXT NOT NULL DEFAULT 'fixed',
      rate_bps INTEGER NOT NULL DEFAULT 0,
      principal_cents INTEGER NOT NULL,
      term_months INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      lender TEXT,
      notes TEXT,
      portal_url TEXT,
      amount_paid_cents INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS budget_loans_household_idx ON budget_loans(household_id)`,
    // Household-wide default Projection method (migration 0172).
    `CREATE TABLE IF NOT EXISTS savings_projection_settings (
      household_id TEXT PRIMARY KEY,
      default_method TEXT NOT NULL DEFAULT 'hybrid',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const stmt of statements) {
    await db.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

export async function resetSavingsTables(db: D1Database): Promise<void> {
  const tables = [
    'savings_projection_settings',
    'savings_import_jobs',
    'registered_transactions',
    'registered_accounts',
    'budget_loans',
    'budget_renewal_documents',
    'budget_renewals',
    'savings_recurring_payments',
    'savings_income_templates',
    'savings_goals',
    'savings_monthly_targets',
    'savings_spending_entries',
    'savings_income_entries',
    'savings_categories',
    'expenses',
    'budget_sub_budgets',
    'budget_goals',
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
