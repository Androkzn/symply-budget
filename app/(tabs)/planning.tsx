import { Redirect, useLocalSearchParams } from 'expo-router';

import { isFullBudget } from '@features/budget';
import { BudgetNavigator } from '@navigation/BudgetNavigator';

/** Planning section, promoted to a first-class (customizable) tab. */
export default function PlanningTab() {
  const params = useLocalSearchParams();
  // Section tabs only exist for the full Budget suite; other brands never show
  // this route (href: null) — redirect defensively if it is reached directly.
  if (!isFullBudget()) {
    return <Redirect href="/" />;
  }
  return (
    <BudgetNavigator initialParams={params} section="planned" sectionTitle="Planning" />
  );
}
