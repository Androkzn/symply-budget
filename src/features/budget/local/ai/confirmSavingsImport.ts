import type {
  SavingsHistoryCommitResult,
  SavingsHistorySelections,
  SavingsImportCommitResult,
  SavingsImportDraft,
} from '@api/savings';

import {
  getLocalLedger,
  getLocalLedgerFor,
  mutateLocalLedger,
  runOnHousehold,
  type LocalBudgetLedger,
} from '../engine';
import { localBudgetApi } from '../localBudgetApi';
import { chunkRowsForOp } from '../projection';

import { markLocalImportCommitted } from './localImportJobStore';

type SavingsIncomeRow = LocalBudgetLedger['savingsIncome'][number];
type SavingsSpendingRow = LocalBudgetLedger['savingsSpending'][number];
type SavingsRecurringRow = LocalBudgetLedger['savingsRecurringPayments'][number];


/**
 * Name → id for the household's savings categories, built once. The import
 * never writes `savingsCategories`, so resolving every row up front is
 * equivalent to resolving them one at a time inside each mutator — and turns
 * an O(rows × categories) scan into one pass. First match wins, as before.
 *
 * Takes the ledger it should read rather than reaching for the active one: the
 * caller has already resolved which household it is writing into, and a helper
 * that resolved its own source could answer with another household's categories.
 */
function savingsCategoryIndex(source: LocalBudgetLedger, householdId: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const category of source.savingsCategories) {
    if (category.household_id !== householdId) continue;
    const key = category.name.toLowerCase();
    if (!index.has(key)) index.set(key, category.id);
  }
  return index;
}

function resolveSavingsCategoryId(
  index: Map<string, string>,
  categoryName: string | null | undefined,
): string | null {
  if (!categoryName?.trim()) return null;
  return index.get(categoryName.trim().toLowerCase()) ?? null;
}

function deterministicId(jobId: string, kind: string, index: number): string {
  return `${jobId}_${kind}_${index}`;
}

/**
 * Write one kind of import row in chunked ops.
 *
 * Ids are deterministic, so the two-layer dedupe of the original code is kept:
 * an outer filter against what the ledger already holds, plus an inner
 * membership test inside the mutator. Re-running a committed job stays a no-op.
 */
async function commitRows<T extends { id: string }>(
  rows: T[],
  jobId: string,
  select: (ledger: LocalBudgetLedger) => T[],
  op: { opType: string; entityType: string },
): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (const chunk of chunkRowsForOp(rows)) {
    await mutateLocalLedger(
      (ledger) => {
        const table = select(ledger);
        const present = new Set(table.map((r) => r.id));
        for (const row of chunk) {
          if (present.has(row.id)) continue;
          table.push(row);
        }
      },
      {
        opType: op.opType,
        entityType: op.entityType,
        entityId: jobId,
        // Rows already travel in the delta; the intent carries the shape only.
        payload: { jobId, count: chunk.length },
      },
    );
    written += chunk.length;
  }
  return written;
}

/**
 * Explicit confirm — writes selected rows to the local savings ledger.
 *
 * The whole commit runs under ONE `runOnHousehold` lock (BR-016), because this
 * function both READS and WRITES and the two must see the same household.
 *
 * `mutateLocalLedger` writes to the ACTIVE household and takes no
 * `forHouseholdId`, by design — see its header in `engine.ts`. So resolving the
 * dedupe sets with `getLocalLedgerFor(householdId)` would be worse than reading
 * the active ledger, not better: the skip-list would come off one household
 * while the rows landed in another, and re-running a committed job would
 * duplicate every row instead of being the no-op it promises to be.
 *
 * Activating and then writing was the previous shape, and it was racy: activation
 * holds the engine's session chain but the writes below do not, so another
 * household activating in that gap took the rows with it. `runOnHousehold` holds
 * the chain across both. It is re-entrant for the household it pinned, so the
 * nested `commitRows` → `mutateLocalLedger` calls run inline rather than
 * deadlocking, and a caller that already holds the lock (every `localSavingsApi`
 * route) pays nothing.
 *
 * A commit that lands in the wrong ledger leaves no trace to find it by — the
 * rows decrypt and the ops verify under the household they were misfiled into —
 * which is why the lock is here rather than only in the API layer this module is
 * usually entered through.
 */
export async function commitLocalSavingsImport(
  householdId: string,
  jobId: string,
  selections: SavingsImportDraft,
): Promise<SavingsImportCommitResult> {
  return runOnHousehold(householdId, () => commitSelectedRows(householdId, jobId, selections));
}

async function commitSelectedRows(
  householdId: string,
  jobId: string,
  selections: SavingsImportDraft,
): Promise<SavingsImportCommitResult> {
  // Safe under the lock above: the pinned household IS the active one.
  const ledger = getLocalLedger();
  const memberId = ledger.memberId;
  const categories = savingsCategoryIndex(ledger, householdId);
  const now = new Date().toISOString();

  const existingIncome = new Set(ledger.savingsIncome.map((e) => e.id));
  const incomeRows: SavingsIncomeRow[] = [];
  for (let i = 0; i < selections.income.length; i += 1) {
    const row = selections.income[i]!;
    const id = deterministicId(jobId, 'income', i);
    if (existingIncome.has(id)) continue;
    incomeRows.push({
      id,
      household_id: householdId,
      member_id: memberId,
      source_type: row.source_type,
      label: row.label,
      amount_cents: row.amount_cents,
      income_date: row.income_date,
      currency: 'CAD',
      notes: null,
      template_id: null,
      period: row.income_date.slice(0, 7),
      status: 'confirmed',
      rolled_over_from_entry_id: null,
      created_by: memberId,
      created_at: now,
      updated_at: now,
    });
  }

  const existingSpending = new Set(ledger.savingsSpending.map((e) => e.id));
  const spendingRows: SavingsSpendingRow[] = [];
  for (let i = 0; i < selections.spending.length; i += 1) {
    const row = selections.spending[i]!;
    const id = deterministicId(jobId, 'spending', i);
    if (existingSpending.has(id)) continue;
    spendingRows.push({
      id,
      household_id: householdId,
      category_id: resolveSavingsCategoryId(categories, row.category_name),
      label: row.label,
      amount_cents: row.amount_cents,
      spending_date: row.spending_date,
      currency: 'CAD',
      notes: null,
      // Explicitly absent rather than implicitly undefined: these rows are not
      // produced by a recurring payment and belong to no applied period.
      recurring_payment_id: null,
      period: null,
      created_by: memberId,
      created_at: now,
      updated_at: now,
    });
  }

  const existingRecurring = new Set(ledger.savingsRecurringPayments.map((p) => p.id));
  const recurringRows: SavingsRecurringRow[] = [];
  for (let i = 0; i < selections.recurringPayments.length; i += 1) {
    const row = selections.recurringPayments[i]!;
    const id = deterministicId(jobId, 'recurring', i);
    if (existingRecurring.has(id)) continue;
    recurringRows.push({
      id,
      household_id: householdId,
      category_id: resolveSavingsCategoryId(categories, row.category_name),
      label: row.label,
      amount_cents: row.amount_cents,
      currency: 'CAD',
      day_of_month: row.day_of_month,
      group_label: row.group_label,
      is_essential: row.is_essential,
      active: true,
      is_automated: false,
      scope_type: 'all_year',
      scope_year: null,
      active_months: null,
      source: 'ai_import',
      created_by: memberId,
      created_at: now,
      updated_at: now,
    });
  }

  // One op per chunk instead of one op per row: a 500-row import used to seal,
  // sign and re-encrypt the whole ledger 500 times.
  const income = await commitRows(incomeRows, jobId, (l) => l.savingsIncome, {
    opType: 'SAVINGS_INCOME_IMPORT',
    entityType: 'savings_income',
  });
  const spending = await commitRows(spendingRows, jobId, (l) => l.savingsSpending, {
    opType: 'SAVINGS_SPENDING_IMPORT',
    entityType: 'savings_spending',
  });
  const recurringPayments = await commitRows(
    recurringRows,
    jobId,
    (l) => l.savingsRecurringPayments,
    { opType: 'SAVINGS_RECURRING_IMPORT', entityType: 'savings_recurring' },
  );

  markLocalImportCommitted(jobId);
  return { income, spending, recurringPayments };
}

/**
 * History grid confirm — income to savings + spending to budget expenses.
 *
 * Locked as ONE unit rather than leaning on the two inner calls' own locks:
 * this writes to two different tables through two different paths, and a switch
 * landing between them would file a member's income under one household and the
 * matching spending under another. Re-entrant, so the nested
 * `commitLocalSavingsImport` and `addExpensesBulk` run inline.
 */
export async function commitLocalSavingsHistoryImport(
  householdId: string,
  jobId: string,
  selections: SavingsHistorySelections,
): Promise<SavingsHistoryCommitResult> {
  return runOnHousehold(householdId, () =>
    commitHistorySelections(householdId, jobId, selections),
  );
}

async function commitHistorySelections(
  householdId: string,
  jobId: string,
  selections: SavingsHistorySelections,
): Promise<SavingsHistoryCommitResult> {
  const incomeResult = await commitLocalSavingsImport(householdId, jobId, {
    income: selections.income,
    spending: [],
    recurringPayments: [],
  });

  const years = new Set<number>();
  const expenses = selections.monthlyGridSpending.map((row, i) => {
    years.add(parseInt(row.period.slice(0, 4), 10));
    return {
      title: row.category_name,
      amount: row.amount_cents,
      expense_date: `${row.period}-01`,
      description: `history_import:${jobId}:${i}`,
    };
  });
  // Bulk write: this was one op (and one whole-ledger re-encryption) per month cell.
  await localBudgetApi.addExpensesBulk(householdId, expenses);

  return {
    income: incomeResult.income,
    spending: expenses.length,
    years: [...years].sort((a, b) => a - b),
  };
}

/**
 * How much of a job is already in the ledger — the answer that lets a re-confirm
 * report "already imported" instead of writing again.
 *
 * A read, so it resolves with `getLocalLedgerFor(householdId)` and never
 * activates: asking what household B already holds must not move the member off
 * household A. That is also why it is async — reaching a household that has not
 * been opened yet means decrypting its rows, and the alternative (counting the
 * ACTIVE ledger for rows tagged with another household's id) would answer zero
 * for every job in every other household. Zero here reads as "nothing was
 * imported", which is exactly the answer that makes a caller commit a second
 * time.
 */
export async function countLocalImportCommitted(
  householdId: string,
  jobId: string,
): Promise<SavingsImportCommitResult> {
  const prefix = `${jobId}_`;
  const ledger = await getLocalLedgerFor(householdId);
  return {
    income: ledger.savingsIncome.filter(
      (e) => e.household_id === householdId && e.id.startsWith(prefix),
    ).length,
    spending: ledger.savingsSpending.filter(
      (e) => e.household_id === householdId && e.id.startsWith(prefix),
    ).length,
    recurringPayments: ledger.savingsRecurringPayments.filter(
      (p) => p.household_id === householdId && p.id.startsWith(prefix),
    ).length,
  };
}
