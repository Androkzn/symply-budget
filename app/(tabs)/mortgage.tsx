import { Redirect, useLocalSearchParams } from 'expo-router';

import { isFullBudget } from '@features/budget';
import { BudgetNavigator } from '@navigation/BudgetNavigator';

/** Mortgage section (Budget-only), promoted to a first-class (customizable) tab. */
export default function MortgageTab() {
  const params = useLocalSearchParams();
  if (!isFullBudget()) {
    return <Redirect href="/" />;
  }
  return (
    <BudgetNavigator initialParams={params} section="mortgage" sectionTitle="Mortgage" />
  );
}
