import { useLocalSearchParams } from 'expo-router';

import { isBudgetBrand } from '@features/budget';
import { HealthHomeScreen, isHealthBrand } from '@features/health';
import {
  isKaizenBrand,
  KaizenTodayScreen,
} from '@features/kaizen';
import { isLanguageBrand, LanguageLearnScreen } from '@features/language';
import { BudgetNavigator } from '@navigation/BudgetNavigator';
import { HomeScreen } from '@screens/main/HomeScreen';

/** Default tab on launch — brand-specific home or House HomeScreen. */
export default function HomeTab() {
  const params = useLocalSearchParams();
  if (isKaizenBrand()) {
    return <KaizenTodayScreen />;
  }
  if (isLanguageBrand()) {
    return <LanguageLearnScreen />;
  }
  if (isBudgetBrand()) {
    // Budget's Home tab renders the Budget Dashboard (customizable-tabs model:
    // the old lightweight BudgetHomeScreen glance is replaced by the full
    // dashboard). Wrapped in the Budget stack so the dashboard's add/edit
    // callbacks can push the shared budget forms. `initialParams` lets a
    // forwarded `/budget?screen=BudgetSettings` deep link open on this stack.
    return (
      <BudgetNavigator initialParams={params} section="dashboard" sectionTitle="Budget" />
    );
  }
  if (isHealthBrand()) {
    return <HealthHomeScreen />;
  }
  return <HomeScreen />;
}
