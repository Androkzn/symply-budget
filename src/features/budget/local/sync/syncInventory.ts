/**
 * What this device actually holds, counted — the answer to "is my budget
 * complete?"
 *
 * A sync screen can say "Last synced 2 minutes ago" and be telling the truth
 * about a ledger that is missing half a year. That is not hypothetical: it is
 * exactly what a joiner whose backfill never landed saw for weeks, and nothing
 * on the screen contradicted it. A timestamp reports an EVENT; it says nothing
 * about the CONTENT, and content is what the member is actually asking about.
 *
 * So this counts rows, per table, off the projection — which is the same array
 * every budget screen renders from, so a number here is a promise about what the
 * app can show rather than about what a database contains.
 *
 * ## Why it is a verification tool, not a statistic
 *
 * Two members open this screen and compare. Identical totals and identical
 * per-category lines mean the two devices genuinely converged; a line that
 * differs names the thing that did not arrive. That comparison is the whole
 * point, and it is why:
 *
 *  - **every category is listed, including the zeroes.** Hiding empty rows would
 *    make the two lists different SHAPES, and a member comparing them would have
 *    to notice an absence rather than a mismatched number. Absences are exactly
 *    what people fail to spot.
 *  - **the order is fixed**, not sorted by count. Sorting would reshuffle the
 *    list between two devices that hold different amounts — the two things being
 *    compared would not line up.
 *
 * Tombstones are excluded by construction: `installRowEnvelopes` removes deleted
 * rows from the projection, so a deleted expense is not "a record" on either
 * device and cannot make two synced devices disagree.
 */
import { getLocalLedgerFor, type LocalBudgetLedger } from '../engine';
import { LEDGER_TABLE_NAMES, type LedgerTableName } from '../projection';

export type BudgetInventoryLine = {
  table: LedgerTableName;
  label: string;
  count: number;
};

export type BudgetInventoryGroup = {
  title: string;
  lines: BudgetInventoryLine[];
  subtotal: number;
};

export type BudgetSyncInventory = {
  householdId: string;
  total: number;
  groups: BudgetInventoryGroup[];
};

/**
 * Human names for the ledger's tables.
 *
 * A member comparing two phones should not have to know that their income lives
 * in `savingsIncome`. Every table in `LEDGER_TABLE_KEYS` needs an entry — the
 * grouping below is built from `LEDGER_TABLE_NAMES`, so a table added without a
 * label here renders under its raw key rather than vanishing, which is the safe
 * direction: an ugly row is noticed and fixed, a missing one is not.
 */
const TABLE_LABELS: Record<LedgerTableName, string> = {
  categories: 'Categories',
  items: 'Planned items',
  expenses: 'Spending',
  goals: 'Monthly goals',
  subBudgets: 'Sub-budgets',
  transfers: 'Transfers',
  savingsIncome: 'Income entries',
  savingsIncomeTemplates: 'Income templates',
  savingsSpending: 'Savings spending',
  savingsCategories: 'Savings categories',
  savingsGoals: 'Savings goals',
  savingsMonthlyTargets: 'Monthly targets',
  savingsRecurringPayments: 'Recurring payments',
  mortgages: 'Mortgages',
  mortgageTerms: 'Mortgage terms',
  mortgageStatements: 'Mortgage statements',
  mortgageEvents: 'Mortgage events',
  mortgageOffers: 'Mortgage offers',
  budgetLoans: 'Loans',
  budgetRenewals: 'Renewals',
  registeredAccounts: 'Investment accounts',
  registeredTransactions: 'Investment transactions',
  wishes: 'Wishes',
  wishEntries: 'Wish entries',
  wishAttachments: 'Wish attachments',
};

/**
 * The sections, in the order the app presents these features.
 *
 * Declared explicitly rather than derived, because the useful grouping is the
 * PRODUCT's (what tab is this under?) and nothing in the schema encodes it.
 * Anything not listed here still appears — see `buildInventoryGroups` — so
 * forgetting to add a new table to a section cannot silently drop it from the
 * count a member is using to verify their data.
 */
const GROUPS: Array<{ title: string; tables: LedgerTableName[] }> = [
  {
    title: 'Budget',
    tables: ['categories', 'items', 'expenses', 'goals', 'subBudgets', 'transfers'],
  },
  {
    title: 'Income & savings',
    tables: [
      'savingsIncome',
      'savingsIncomeTemplates',
      'savingsSpending',
      'savingsCategories',
      'savingsGoals',
      'savingsMonthlyTargets',
      'savingsRecurringPayments',
    ],
  },
  {
    title: 'Debt',
    tables: [
      'mortgages',
      'mortgageTerms',
      'mortgageStatements',
      'mortgageEvents',
      'mortgageOffers',
      'budgetLoans',
      'budgetRenewals',
    ],
  },
  { title: 'Investments', tables: ['registeredAccounts', 'registeredTransactions'] },
  { title: 'Wishes', tables: ['wishes', 'wishEntries', 'wishAttachments'] },
];

/** Rows a ledger holds for one table. Zero for a table that is not an array. */
export function countTable(ledger: LocalBudgetLedger, table: LedgerTableName): number {
  const rows = (ledger as unknown as Record<string, unknown>)[table];
  return Array.isArray(rows) ? rows.length : 0;
}

/**
 * Group the counts, and never lose a table on the way.
 *
 * The trailing "Other" section is the safety valve: `GROUPS` is hand-maintained
 * and `LEDGER_TABLE_NAMES` is generated from the schema, so the day the two
 * disagree the count stays honest instead of quietly under-reporting — which
 * would be the worst possible failure for a screen whose entire job is telling a
 * member their data is all here.
 */
export function buildInventoryGroups(ledger: LocalBudgetLedger): BudgetInventoryGroup[] {
  const placed = new Set<LedgerTableName>();
  const groups: BudgetInventoryGroup[] = [];

  for (const group of GROUPS) {
    const lines: BudgetInventoryLine[] = [];
    for (const table of group.tables) {
      placed.add(table);
      lines.push({ table, label: TABLE_LABELS[table] ?? table, count: countTable(ledger, table) });
    }
    groups.push({
      title: group.title,
      lines,
      subtotal: lines.reduce((sum, line) => sum + line.count, 0),
    });
  }

  const orphans = LEDGER_TABLE_NAMES.filter((table) => !placed.has(table));
  if (orphans.length > 0) {
    const lines = orphans.map((table) => ({
      table,
      label: TABLE_LABELS[table] ?? table,
      count: countTable(ledger, table),
    }));
    groups.push({
      title: 'Other',
      lines,
      subtotal: lines.reduce((sum, line) => sum + line.count, 0),
    });
  }

  return groups;
}

/**
 * Count one household's records.
 *
 * `getLocalLedgerFor` hydrates on demand WITHOUT moving the active pointer, so
 * opening this screen for a background household cannot yank the member's screen
 * over to it.
 */
export async function readBudgetSyncInventory(
  householdId: string,
): Promise<BudgetSyncInventory> {
  const ledger = await getLocalLedgerFor(householdId);
  const groups = buildInventoryGroups(ledger);
  return {
    householdId,
    total: groups.reduce((sum, group) => sum + group.subtotal, 0),
    groups,
  };
}

/** `1645` → `1,645`. Thousands separators, because these numbers get compared. */
export function formatRecordCount(value: number): string {
  return value.toLocaleString('en-US');
}
