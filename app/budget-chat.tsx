import { Redirect, useLocalSearchParams } from 'expo-router';
import { NavigationContainer, NavigationIndependentTree } from 'expo-router/react-navigation';

import { isBudgetBrand } from '@features/budget';
import { ChatNavigator, budgetChatConfig } from '@features/chat';

/**
 * `/budget-chat` — hosts the Budget household chat navigator above the tabs.
 * Opened by the floating chat button (BudgetChatFab) and by Budget chat push
 * taps (see notificationRouting.ts). Budget-only: other brands bounce home if
 * the route is reached via a stale deep link.
 *
 * The shared ChatNavigator is a raw native-stack navigator, so under expo-router
 * it needs its own container (mirrors app/(tabs)/settings.tsx). It's driven by
 * `budgetChatConfig` — the same shared chat as House, just pointed at the Budget
 * backend + notification namespace.
 */
export default function BudgetChatRoute() {
  const params = useLocalSearchParams();

  if (!isBudgetBrand()) {
    return <Redirect href="/" />;
  }

  return (
    <NavigationIndependentTree>
      <NavigationContainer>
        <ChatNavigator config={budgetChatConfig} initialParams={params} />
      </NavigationContainer>
    </NavigationIndependentTree>
  );
}
