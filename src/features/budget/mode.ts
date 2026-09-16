export {
  getBudgetMode,
  isBudgetOff,
  isBudgetEnabled,
  isFullBudget,
  isMinimalBudget,
} from '@brand/capabilities';

import {
  isBudgetOff,
  isFullBudget,
} from '@brand/capabilities';

/**
 * Sub-tabs shown on BudgetScreen.
 * House (off) = none; minimal = dashboard glance; Simple Budget (full) = full suite.
 */
export type BudgetSubView =
  | 'dashboard'
  | 'spendings'
  | 'savings'
  | 'pension'
  | 'wishes';

export const MINIMAL_BUDGET_VIEWS: readonly BudgetSubView[] = ['dashboard'];

export const FULL_BUDGET_VIEWS: readonly BudgetSubView[] = [
  'dashboard',
  'spendings',
  'savings',
  'pension',
  'wishes',
];

export function getBudgetSubViews(options?: {
  savingsEnabled?: boolean;
}): BudgetSubView[] {
  if (isBudgetOff()) return [];
  const base = isFullBudget()
    ? [...FULL_BUDGET_VIEWS]
    : [...MINIMAL_BUDGET_VIEWS];
  if (options?.savingsEnabled === false) {
    return base.filter(v => v !== 'savings' && v !== 'pension');
  }
  return base;
}

/** Stack routes that require full budget mode. */
export const FULL_BUDGET_STACK_ROUTES = [
  'BudgetItemForm',
  'BudgetItemAI',
  'BudgetReceiptScan',
  'BudgetSettings',
  'BudgetCategories',
  'BudgetSubBudgets',
  'BudgetMonthlyCaps',
  'BudgetBackup',
  'BudgetSync',
  // Pushed from Device sync. Full-budget for the same reason its parent is:
  // the record census is a multi-device verification tool, and a minimal-budget
  // brand has no second device to verify against.
  'BudgetSyncInventory',
  'BudgetInvite',
  // The hub's three destinations. They are full-budget for the same reason the
  // hub is: a minimal-budget brand has no local-first control plane to invite
  // into, join, or hold several households on.
  'BudgetInviteCreate',
  'BudgetJoin',
  'BudgetHouseholds',
  // The household list's own destination — one household's page, and the form
  // that creates one.
  'BudgetHouseholdEdit',
  'BudgetExport',
  'BudgetTransfer',
  'BudgetYearSetup',
  'BudgetLongTermTimeline',
  'BudgetCategoryDetail',
  'BudgetAllSpending',
  'BudgetAllPlanning',
  // Behind the Spent tab's banners — the tab itself is full-budget only.
  'BudgetSpendingExtras',
  'WishDetail',
  'SavingsEntryForm',
  'SavingsGoalForm',
  'SavingsRegistered',
  'SavingsRecurringPayments',
  'SavingsImport',
  'PensionImport',
  'SavingsYearHistory',
  'SavingsCompareYears',
  'MortgageSetup',
  'MortgageSettings',
  'MortgageTabs',
  'MortgageEdit',
  'MortgageStatements',
  'MortgageStatementForm',
  'MortgageRenew',
  'MortgageRenewalOffers',
  'MortgageHistory',
  'MortgageRecordChange',
  // Utilities routes (UtilityBills / AddUtilityBill / ConfirmBillPayments /
  // UtilityDetail / PropertyTax / AddPropertyTax / UtilityCharts /
  // UtilitySettings / UtilityProvider) were removed here: Utilities is now a
  // House-only feature module (`@features/utilities`) with its own brand
  // capability, and Budget neither mounts nor routes to it.
  'SoftTransferImport',
  'SoftTransferExport',
  'DataSharing',
  // The shared preference screens. They are registered in the Budget stack as
  // well as in the Settings one because full Budget's settings hub is
  // BudgetSettings — More kept only the overflow tabs — and full-budget-only for
  // the same reason its parent is: a minimal-budget brand still reaches these
  // from its own More tab, and has no BudgetSettings to open them from.
  'Appearance',
  'Currency',
  'Region',
  'NotificationSettings',
] as const;

export function isFullBudgetStackRoute(route: string): boolean {
  return (FULL_BUDGET_STACK_ROUTES as readonly string[]).includes(route);
}

/** Strip full-budget-only / disabled navigation targets. */
export function sanitizeBudgetNavigation(opts?: {
  screen?: string;
  activeView?: string;
}) {
  if (isBudgetOff()) return {};
  if (isFullBudget()) return opts ?? {};
  return {}; // minimal: no full-only targets
}
