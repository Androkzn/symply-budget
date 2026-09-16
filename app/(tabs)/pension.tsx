import { Redirect, useLocalSearchParams } from 'expo-router';

import { isFullBudget } from '@features/budget';
import { BudgetNavigator } from '@navigation/BudgetNavigator';

/** Pension section, promoted to a first-class (customizable) tab. */
export default function PensionTab() {
  const params = useLocalSearchParams();
  if (!isFullBudget()) {
    return <Redirect href="/" />;
  }
  return (
    <BudgetNavigator initialParams={params} section="pension" sectionTitle="Pension" />
  );
}
