/**
 * Barrel smoke test — ensures the budget screens index re-exports every screen
 * component so import paths stay wired up.
 */
import * as budgetScreens from '../index';

describe('budget screens barrel', () => {
  it('re-exports every budget/savings screen as a component', () => {
    const names = [
      'BudgetTimelineScreen',
      'BudgetScreen',
      'BudgetItemFormScreen',
      'BudgetItemAIScreen',
      'BudgetReceiptScanScreen',
      'BudgetSettingsScreen',
      'BudgetYearSetupScreen',
      'WishDetailScreen',
      'SavingsEntryForm',
      'SavingsGoalForm',
      'SavingsRegistered',
      'SavingsRecurringPaymentsScreen',
      'SavingsImportScreen',
      'PensionView',
      'PensionImportScreen',
    ] as const;
    for (const name of names) {
      expect(typeof (budgetScreens as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
