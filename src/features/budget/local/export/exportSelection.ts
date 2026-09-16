import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getActiveBudgetHouseholdId,
  listLocalBudgetHouseholds,
  type LocalBudgetLedger,
} from '../engine';

/**
 * What goes into an export — one shared vocabulary for the .xlsx workbook, the
 * CSV bundle and the Export screen's toggle list.
 *
 * Both export paths used to dump everything, which made "export my budget" an
 * all-or-nothing action: someone who only wants their spending rows got fourteen
 * tabs, and someone handing a file to an accountant had to delete the private
 * ones by hand. The section keys below are the unit of choice, and each maps 1:1
 * to a workbook tab and to a CSV file — so a section the user turns off is
 * absent from both formats, not just hidden in one.
 *
 * A missing/partial selection means "include it": callers that never pass a
 * selection keep the old whole-ledger behaviour, and a section added in a later
 * release defaults to on rather than silently dropping out of everyone's export.
 */

export type BudgetExportSectionKey =
  | 'summary'
  | 'spending'
  | 'categories'
  | 'planning'
  | 'monthlyBudgets'
  | 'subBudgets'
  | 'income'
  | 'recurring'
  | 'savingsGoals'
  | 'loans'
  | 'mortgages'
  | 'registeredAccounts'
  | 'wishes'
  | 'transfers';

export type BudgetExportSelection = Partial<Record<BudgetExportSectionKey, boolean>>;

export interface BudgetExportSectionMeta {
  key: BudgetExportSectionKey;
  /** Matches the workbook tab name, so the toggle list reads like the file. */
  label: string;
  description: string;
  /**
   * Brand icon-kit slug for the Export screen's row chip. Fourteen rows of
   * label + description read as a wall of text; the glyph is what lets someone
   * find "Mortgages" by shape while scrolling. Slugs (not Ionicons names) —
   * the Budget kit already draws every one of these domain objects.
   */
  icon: string;
  /** Rows this section would contribute — 0 for the fixed-size cover sheet. */
  rowCount: (ledger: LocalBudgetLedger) => number;
}

const len = (rows: readonly unknown[] | null | undefined): number => rows?.length ?? 0;

/** Reading order — same order as the workbook tabs and the toggle list. */
export const BUDGET_EXPORT_SECTIONS: readonly BudgetExportSectionMeta[] = [
  {
    key: 'summary',
    label: 'Summary',
    description: 'Cover sheet with household, totals and section counts',
    icon: 'review-draft',
    rowCount: () => 0,
  },
  {
    key: 'spending',
    label: 'Spending',
    description: 'Every expense — date, title, vendor, amount, tax and deposits',
    icon: 'spendings',
    rowCount: (l) => len(l.expenses),
  },
  {
    key: 'categories',
    label: 'Categories',
    description: 'Your category list, including hidden ones and usage counts',
    icon: 'categories',
    rowCount: (l) => len(l.categories),
  },
  {
    key: 'planning',
    label: 'Planning',
    description: 'Planned items with status, timeframe and estimated cost',
    icon: 'planned',
    rowCount: (l) => len(l.items),
  },
  {
    key: 'monthlyBudgets',
    label: 'Monthly Budgets',
    description: 'The per-month spending caps and what was actually spent',
    icon: 'budget',
    rowCount: (l) => len(l.goals),
  },
  {
    // The donut, not the wallet — a sub-budget is a slice of the cap above it,
    // and the two rows sit next to each other.
    key: 'subBudgets',
    label: 'Sub-budgets',
    description: 'Per-category caps inside the monthly budget',
    icon: 'remaining',
    rowCount: (l) => len(l.subBudgets),
  },
  {
    key: 'income',
    label: 'Income',
    description: 'Income entries — salary, benefits and one-off amounts',
    icon: 'income',
    rowCount: (l) => len(l.savingsIncome),
  },
  {
    key: 'recurring',
    label: 'Recurring Payments',
    description: 'Bills and subscriptions with their monthly amounts',
    icon: 'subscriptions',
    rowCount: (l) => len(l.savingsRecurringPayments),
  },
  {
    key: 'savingsGoals',
    label: 'Savings Goals',
    description: 'Goals with target, current balance and monthly allocation',
    icon: 'savings',
    rowCount: (l) => len(l.savingsGoals),
  },
  {
    key: 'loans',
    label: 'Loans',
    description: 'Lender, principal, rate and how much is paid off',
    icon: 'debt',
    rowCount: (l) => len(l.budgetLoans),
  },
  {
    key: 'mortgages',
    label: 'Mortgages',
    description: 'Mortgage products, principal and amortization',
    icon: 'housing',
    rowCount: (l) => len(l.mortgages),
  },
  {
    key: 'registeredAccounts',
    label: 'Registered Accounts',
    description: 'TFSA / RRSP balances, room and contributions',
    icon: 'registered-account',
    rowCount: (l) => len(l.registeredAccounts),
  },
  {
    key: 'wishes',
    label: 'Wishes',
    description: 'Your wish list with estimated cost and target date',
    icon: 'gift',
    rowCount: (l) => len(l.wishes),
  },
  {
    key: 'transfers',
    label: 'Transfers',
    description: 'Leftover budget moved to another month, savings or TFSA/RRSP',
    icon: 'transfer',
    rowCount: (l) => len(l.transfers),
  },
];

export const BUDGET_EXPORT_SECTION_KEYS: readonly BudgetExportSectionKey[] =
  BUDGET_EXPORT_SECTIONS.map((s) => s.key);

/** Every section set to `enabled` — the "Enable all" / "Disable all" payload. */
export function budgetExportSelectionOf(enabled: boolean): BudgetExportSelection {
  return Object.fromEntries(
    BUDGET_EXPORT_SECTION_KEYS.map((key) => [key, enabled]),
  ) as BudgetExportSelection;
}

/**
 * Absent or unspecified ⇒ included. Keeps "no selection" meaning "everything"
 * for callers that never opened the Export screen.
 */
export function isBudgetExportSectionOn(
  selection: BudgetExportSelection | undefined,
  key: BudgetExportSectionKey,
): boolean {
  return selection?.[key] ?? true;
}

export function countSelectedBudgetExportSections(
  selection: BudgetExportSelection | undefined,
): number {
  return BUDGET_EXPORT_SECTION_KEYS.filter((key) => isBudgetExportSectionOn(selection, key)).length;
}

/**
 * Pre-BR-016 key: one selection for the whole device. Still read once more, to
 * be adopted by the household it must have described — see `adoptLegacySelection`.
 */
const LEGACY_SELECTION_KEY = 'budget.export.sections';

/**
 * Per household, because the choice is about the data, not about the app.
 *
 * A member who exports their main budget in full and hands an accountant a
 * spending-only file from the household they share had one key holding both
 * intentions: whichever export ran last silently redefined the other. The
 * damage runs one way and it is the bad way — the narrow selection wins, and
 * the next full export quietly ships without the sections that were turned off
 * for somebody else's file. `:` is the separator the other AsyncStorage keys in
 * this feature use (`backupHistory.ts`), kept the same so a device's keyspace
 * stays greppable.
 */
const selectionKeyFor = (householdId: string) => `${LEGACY_SELECTION_KEY}:${householdId}`;

/**
 * Move the pre-BR-016 device-wide selection onto the household it described.
 *
 * Only when this device holds exactly one household — the state every install
 * upgrading into BR-016 is in, and the only state in which the attribution is
 * certain. With two or more there is no way to tell which budget the stored
 * toggles were chosen for, and inheriting them into the wrong one would drop
 * sections out of an export the member believes is complete. Falling back to
 * all-on is the safe wrong answer: it exports more than asked, never less.
 *
 * Best-effort throughout. This is a preference; no read of it may throw.
 */
async function adoptLegacySelection(householdId: string): Promise<string | null> {
  const held = listLocalBudgetHouseholds();
  if (held.length !== 1 || held[0]?.householdId !== householdId) return null;
  try {
    const raw = await AsyncStorage.getItem(LEGACY_SELECTION_KEY);
    if (!raw) return null;
    await AsyncStorage.setItem(selectionKeyFor(householdId), raw);
    await AsyncStorage.removeItem(LEGACY_SELECTION_KEY);
    return raw;
  } catch {
    return null;
  }
}

/**
 * Last choice the user made for one household, defaulted to all-on. Merged over
 * the defaults so a stored selection from an older build (missing a newer key)
 * still includes the new section rather than dropping it.
 *
 * `householdId` defaults to the active household — the Export screen is always
 * looking at it — and an export addressing another household should pass that
 * household, so the toggles it applies are the ones chosen for that budget.
 */
export async function loadBudgetExportSelection(
  householdId?: string,
): Promise<BudgetExportSelection> {
  const defaults = budgetExportSelectionOf(true);
  const target = householdId ?? getActiveBudgetHouseholdId();
  // No session means no household to have a preference: returning all-on is
  // right, and claiming the legacy device-wide key here would attach it to
  // whichever household happens to open next.
  if (!target) return defaults;
  try {
    const raw =
      (await AsyncStorage.getItem(selectionKeyFor(target))) ?? (await adoptLegacySelection(target));
    if (!raw) return defaults;
    const stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== 'object') return defaults;
    const merged = { ...defaults } as Record<BudgetExportSectionKey, boolean>;
    for (const key of BUDGET_EXPORT_SECTION_KEYS) {
      const value = (stored as Record<string, unknown>)[key];
      if (typeof value === 'boolean') merged[key] = value;
    }
    return merged;
  } catch {
    return defaults;
  }
}

export async function saveBudgetExportSelection(
  selection: BudgetExportSelection,
  householdId?: string,
): Promise<void> {
  const target = householdId ?? getActiveBudgetHouseholdId();
  // Nothing to key the preference to. Writing it to the legacy device-wide key
  // instead would recreate exactly the shared-selection bug above.
  if (!target) return;
  try {
    await AsyncStorage.setItem(selectionKeyFor(target), JSON.stringify(selection));
  } catch {
    // A preference that fails to persist is not worth failing an export over.
  }
}
