import { Redirect, useLocalSearchParams } from 'expo-router';

import { isFullBudget } from '@features/budget';
import { BudgetNavigator } from '@navigation/BudgetNavigator';

/** Spending section, promoted to a first-class (customizable) tab. */
export default function SpendingTab() {
  const params = useLocalSearchParams();
  if (!isFullBudget()) {
    return <Redirect href="/" />;
  }
  return (
    <BudgetNavigator initialParams={params} section="spendings" sectionTitle="Spending" />
  );
}
