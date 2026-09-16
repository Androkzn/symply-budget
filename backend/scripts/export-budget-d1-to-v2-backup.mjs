#!/usr/bin/env node
/**
 * Export Budget production (or staging) D1 financial data for one household
 * into a V2 encrypted local-first backup archive + plaintext ledger JSON.
 *
 * Usage (from backend/):
 *   node scripts/export-budget-d1-to-v2-backup.mjs \
 *     --email a.tekhtelev@gmail.com \
 *     --household ebaa46a9-378f-4dce-8989-8a48b988c991 \
 *     --env production \
 *     --out ../.tmp/v2-migration
 *
 * Then on device: Settings → Restore from backup → pick the .json archive
 * → enter the printed 12-word phrase.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..');
const ROOT = join(BACKEND, '..');

function parseArgs(argv) {
  const args = {
    email: null,
    household: null,
    env: 'production',
    out: join(ROOT, '.tmp', 'v2-migration'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') args.email = argv[++i];
    else if (a === '--household') args.household = argv[++i];
    else if (a === '--env') args.env = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.email && !args.household) {
    throw new Error('Need --email and/or --household');
  }
  if (!['staging', 'production'].includes(args.env)) {
    throw new Error('--env must be staging|production');
  }
  return args;
}

function dbName(env) {
  return env === 'production' ? 'simple-budget-db' : 'simple-budget-db-staging';
}

function d1(env, sql) {
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      dbName(env),
      '--remote',
      '--env',
      env,
      '-c',
      'wrangler.budget.toml',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, cwd: BACKEND },
  );
  const start = out.indexOf('[');
  if (start === -1) throw new Error(`Unexpected wrangler output:\n${out.slice(0, 400)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function sqlLit(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function bool(v) {
  return v === true || v === 1 || v === '1';
}

/**
 * Whitelist — must mirror the stored V2 Expense shape exactly
 * (`buildExpenseRow` in src/features/budget/local/localBudgetApi.ts).
 *
 * Anything missing here is silently dropped from the archive and is gone after
 * restore, so a new receipt-scanning column has to be added in both places.
 * D1-only provenance columns (`source`, `import_batch_id`) are deliberately
 * excluded — the local ledger has no such fields.
 *
 * `amount` is TAX-INCLUSIVE; `tax_amount` and `deposit_amount` are
 * informational breakdowns of it, not addenda (migrations 0116 / 0159).
 * Review-time `fees[]` never hit disk — only their deposit+CRV roll-up.
 */
function mapExpense(r) {
  return {
    id: r.id,
    household_id: r.household_id,
    budget_item_id: r.budget_item_id ?? null,
    category_id: r.category_id ?? null,
    title: r.title,
    description: r.description ?? null,
    amount: Number(r.amount) || 0,
    saved_amount: Number(r.saved_amount) || 0,
    tax_amount: Number(r.tax_amount) || 0,
    deposit_amount: Number(r.deposit_amount) || 0,
    expense_date: r.expense_date,
    vendor: r.vendor ?? null,
    receipt_key: r.receipt_key ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
  };
}

function mapCategory(r) {
  return {
    id: r.id,
    household_id: r.household_id,
    name: r.name,
    icon: r.icon ?? null,
    color: r.color ?? null,
    sort_order: r.sort_order ?? 0,
    hidden: bool(r.hidden),
    created_at: r.created_at,
    updated_at: r.updated_at ?? r.created_at,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Exporting Budget D1 (${args.env}) → V2 backup…`);

  let householdId = args.household;
  let userId = null;
  if (args.email) {
    const rows = d1(
      args.env,
      `SELECT u.id AS user_id, hm.household_id, hm.id AS member_id, hm.role, h.name
       FROM users u
       JOIN household_members hm ON hm.user_id = u.id AND hm.deleted_at IS NULL
       JOIN households h ON h.id = hm.household_id AND h.deleted_at IS NULL
       WHERE lower(u.email) = ${sqlLit(args.email.toLowerCase())}`,
    );
    if (!rows.length) throw new Error(`No households for ${args.email}`);
    console.log('Households:');
    for (const r of rows) {
      console.log(`  ${r.household_id}  ${r.role}  ${r.name}`);
    }
    if (!householdId) {
      // Prefer non-E2E household named Sweet Home / first owner HH.
      const preferred =
        rows.find((r) => /sweet/i.test(r.name || '')) ||
        rows.find((r) => r.role === 'owner' && !/e2e/i.test(r.name || '')) ||
        rows[0];
      householdId = preferred.household_id;
      userId = preferred.user_id;
    } else {
      userId = rows.find((r) => r.household_id === householdId)?.user_id ?? rows[0].user_id;
    }
  }

  const hh = d1(args.env, `SELECT * FROM households WHERE id = ${sqlLit(householdId)}`)[0];
  if (!hh) throw new Error(`Household not found: ${householdId}`);

  const members = d1(
    args.env,
    `SELECT * FROM household_members WHERE household_id = ${sqlLit(householdId)} AND deleted_at IS NULL`,
  );
  const owner =
    members.find((m) => m.user_id === userId) ||
    members.find((m) => m.role === 'owner') ||
    members[0];
  if (!owner) throw new Error('No household member row');

  const hid = sqlLit(householdId);
  const categories = d1(args.env, `SELECT * FROM budget_categories WHERE household_id = ${hid}`).map(
    mapCategory,
  );
  const expenses = d1(args.env, `SELECT * FROM expenses WHERE household_id = ${hid}`).map(mapExpense);
  const items = d1(args.env, `SELECT * FROM budget_items WHERE household_id = ${hid}`);
  const goals = d1(args.env, `SELECT * FROM budget_goals WHERE household_id = ${hid}`);
  const subBudgets = d1(args.env, `SELECT * FROM budget_sub_budgets WHERE household_id = ${hid}`);
  let transfers = [];
  try {
    transfers = d1(args.env, `SELECT * FROM budget_transfers WHERE household_id = ${hid}`);
  } catch {
    /* optional */
  }

  const mortgages = d1(args.env, `SELECT * FROM mortgages WHERE household_id = ${hid}`);
  const mortgageIds = mortgages.map((m) => m.id);
  const mIn = mortgageIds.length
    ? mortgageIds.map(sqlLit).join(',')
    : sqlLit('__none__');
  const mortgageTerms = mortgageIds.length
    ? d1(args.env, `SELECT * FROM mortgage_terms WHERE mortgage_id IN (${mIn})`)
    : [];
  const mortgageStatements = mortgageIds.length
    ? d1(args.env, `SELECT * FROM mortgage_statements WHERE mortgage_id IN (${mIn})`)
    : [];
  const mortgageEvents = mortgageIds.length
    ? d1(args.env, `SELECT * FROM mortgage_events WHERE mortgage_id IN (${mIn})`)
    : [];
  let mortgageOffers = [];
  try {
    mortgageOffers = mortgageIds.length
      ? d1(args.env, `SELECT * FROM mortgage_renewal_offers WHERE mortgage_id IN (${mIn})`)
      : [];
  } catch {
    /* optional */
  }

  const savingsIncome = d1(args.env, `SELECT * FROM savings_income_entries WHERE household_id = ${hid}`);
  const savingsSpending = d1(
    args.env,
    `SELECT * FROM savings_spending_entries WHERE household_id = ${hid}`,
  );
  const savingsRecurringPayments = d1(
    args.env,
    `SELECT * FROM savings_recurring_payments WHERE household_id = ${hid}`,
  );
  const savingsGoals = d1(args.env, `SELECT * FROM savings_goals WHERE household_id = ${hid}`);
  const savingsCategories = d1(args.env, `SELECT * FROM savings_categories WHERE household_id = ${hid}`);
  const savingsIncomeTemplates = d1(
    args.env,
    `SELECT * FROM savings_income_templates WHERE household_id = ${hid}`,
  );
  let savingsMonthlyTargets = [];
  try {
    savingsMonthlyTargets = d1(
      args.env,
      `SELECT period, target_cents FROM savings_monthly_targets WHERE household_id = ${hid}`,
    ).map((r) => ({ period: r.period, target_cents: Number(r.target_cents) || 0 }));
  } catch {
    /* optional */
  }

  const budgetLoans = d1(args.env, `SELECT * FROM budget_loans WHERE household_id = ${hid}`);
  let budgetRenewals = [];
  try {
    budgetRenewals = d1(args.env, `SELECT * FROM budget_renewals WHERE household_id = ${hid}`).map(
      (r) => ({
        id: r.id,
        household_id: r.household_id,
        recurring_payment_id: r.recurring_payment_id,
        next_renewal_date: r.next_renewal_date,
        status: r.status,
        reminder_lead_days: r.reminder_lead_days ?? 30,
        created_at: r.created_at,
        updated_at: r.updated_at ?? r.created_at,
      }),
    );
  } catch {
    /* optional */
  }

  const registeredAccounts = d1(
    args.env,
    `SELECT * FROM registered_accounts WHERE household_id = ${hid}`,
  );
  const regIds = registeredAccounts.map((a) => a.id);
  const rIn = regIds.length ? regIds.map(sqlLit).join(',') : sqlLit('__none__');
  const registeredTransactions = regIds.length
    ? d1(args.env, `SELECT * FROM registered_transactions WHERE account_id IN (${rIn})`)
    : [];

  const wishes = d1(args.env, `SELECT * FROM wishes WHERE household_id = ${hid}`);
  const wishIds = wishes.map((w) => w.id);
  const wIn = wishIds.length ? wishIds.map(sqlLit).join(',') : sqlLit('__none__');
  const wishEntries = wishIds.length
    ? d1(args.env, `SELECT * FROM wish_entries WHERE wish_id IN (${wIn})`)
    : [];

  const household = {
    id: hh.id,
    name: hh.name,
    address_line1: hh.address_line1 ?? null,
    address_line2: hh.address_line2 ?? null,
    city: hh.city ?? null,
    state_province: hh.state_province ?? null,
    postal_code: hh.postal_code ?? null,
    country: hh.country ?? null,
    unit_system: hh.unit_system ?? null,
    photo_key: hh.photo_key ?? null,
    photo_url: null,
    purchase_price: hh.purchase_price ?? null,
    purchase_date: hh.purchase_date ?? null,
    created_at: hh.created_at,
    updated_at: hh.updated_at ?? hh.created_at,
    member_count: members.length,
    my_role: owner.role === 'owner' ? 'owner' : 'member',
  };

  const ledger = {
    version: 1,
    household,
    memberId: owner.id,
    deviceId: `mig_${Date.now().toString(36)}`,
    categories,
    expenses,
    items,
    goals,
    subBudgets,
    transfers,
    mortgages: mortgages.map((m) => ({
      ...m,
      is_active: bool(m.is_active),
    })),
    mortgageTerms: mortgageTerms.map((t) => ({
      ...t,
      is_current: bool(t.is_current),
    })),
    mortgageStatements,
    mortgageEvents,
    mortgageOffers: mortgageOffers.map((o) => ({
      id: o.id,
      bankName: o.bank_name ?? o.bankName ?? '',
      offeredRatePct: (Number(o.offered_rate_bps ?? o.offeredRateBps ?? 0) || 0) / 100,
      rateType: o.rate_type ?? o.rateType ?? 'fixed',
      termMonths: o.term_months ?? o.termMonths ?? 0,
      monthlyPaymentCents: o.monthly_payment_cents ?? o.monthlyPaymentCents ?? 0,
      paymentSavedVsCurrentCents:
        o.payment_saved_vs_current_cents ?? o.paymentSavedVsCurrentCents ?? 0,
      status: o.status ?? 'draft',
      offerExpiresAt: o.offer_expires_at ?? o.offerExpiresAt ?? null,
      note: o.note ?? null,
    })),
    savingsIncome,
    savingsSpending,
    savingsRecurringPayments,
    savingsGoals,
    savingsCategories,
    savingsIncomeTemplates,
    savingsMonthlyTargets,
    budgetLoans,
    budgetRenewals,
    registeredAccounts,
    registeredTransactions,
    wishes,
    wishEntries,
    wishAttachments: [],
    ops: [],
  };

  const counts = {
    categories: categories.length,
    expenses: expenses.length,
    items: items.length,
    goals: goals.length,
    mortgages: mortgages.length,
    mortgageTerms: mortgageTerms.length,
    mortgageStatements: mortgageStatements.length,
    budgetLoans: budgetLoans.length,
    savingsIncome: savingsIncome.length,
    savingsRecurring: savingsRecurringPayments.length,
    registeredAccounts: registeredAccounts.length,
    registeredTransactions: registeredTransactions.length,
    wishes: wishes.length,
    // Roll-ups, not row counts: a zero here on a household that scans receipts
    // means the tax/fee columns were dropped somewhere in the pipeline again.
    taxCents: expenses.reduce((s, e) => s + e.tax_amount, 0),
    depositCents: expenses.reduce((s, e) => s + e.deposit_amount, 0),
    savedCents: expenses.reduce((s, e) => s + e.saved_amount, 0),
  };
  console.log('Exported counts:', counts);

  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = `sweet-home-v2-${stamp}`;
  const ledgerPath = join(args.out, `${base}.ledger.json`);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  // Bare `node` cannot import a .ts module (ERR_UNKNOWN_FILE_EXTENSION). That
  // hits only here, after every D1 read has succeeded and the ledger is already
  // on disk — so fail with the one-liner that finishes the job instead of
  // sending the operator back to re-query production.
  let archiveMod;
  try {
    archiveMod = await import(
      pathToFileURL(join(ROOT, 'packages/local-first/src/backup/archive.ts')).href
    );
  } catch (err) {
    if (err?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw err;
    console.error('\nLedger exported, but sealing needs a TS-aware runner. Finish with:\n');
    console.error('  cd packages/local-first && npx vite-node scripts/seal-ledger.ts \\');
    console.error(`    -- '${ledgerPath}' '${args.out}'\n`);
    process.exit(1);
  }
  const created = archiveMod.createBackupArchive({
    snapshotJson: JSON.stringify(ledger),
    householdId: household.id,
    deviceId: ledger.deviceId,
    keyEpoch: 1,
    createdAt: new Date().toISOString(),
  });

  const archivePath = join(args.out, `${base}.backup.json`);
  const phrasePath = join(args.out, `${base}.phrase.txt`);
  writeFileSync(archivePath, created.archiveJson);
  writeFileSync(
    phrasePath,
    [
      'Symply Budget V2 migration backup',
      `Household: ${household.name} (${household.id})`,
      `Source: Budget D1 ${args.env}`,
      `Created: ${new Date().toISOString()}`,
      '',
      'RECOVERY PHRASE (12 words) — store securely; required to restore:',
      created.phrase,
      '',
      `Archive file: ${archivePath}`,
      '',
      'Restore on device:',
      '1. Sign in as the Shared User on Symply Budget (local-first build)',
      '2. Settings → Restore from backup → pick the .backup.json file',
      '3. Paste the recovery phrase → Verify & restore',
      '',
      `Counts: ${JSON.stringify(counts)}`,
      '',
    ].join('\n'),
  );

  console.log('');
  console.log('Wrote:');
  console.log(' ', ledgerPath);
  console.log(' ', archivePath);
  console.log(' ', phrasePath);
  console.log('');
  console.log('RECOVERY PHRASE:');
  console.log(created.phrase);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
