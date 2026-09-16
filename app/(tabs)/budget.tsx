import { Redirect, useLocalSearchParams } from 'expo-router';

import { isHouseBrand } from '@brand';
import { isBudgetBrand, isBudgetOff } from '@features/budget';
import { BudgetNavigator } from '@navigation/BudgetNavigator';

/**
 * Maps a legacy `/budget?activeView=…` deep link to its standalone section tab
 * under the customizable-tabs model. `dashboard` (and anything unknown) lands on
 * Home, which now hosts the Budget dashboard.
 */
const BUDGET_VIEW_ROUTE: Record<string, string> = {
  dashboard: '/',
  planned: '/planning',
  spendings: '/spending',
  savings: '/savings',
  pension: '/pension',
  wishes: '/wishes',
};

export default function BudgetTab() {
  const params = useLocalSearchParams();
  if (isBudgetOff()) {
    return <Redirect href="/" />;
  }
  // The full Budget brand no longer has a single "Budget" tab — its sections are
  // individual tabs. Redirect any lingering `/budget` link to the matching
  // section (or Home), forwarding `screen`/`subTab` so the target section's
  // stack can still open a form or Budget Settings (e.g. from a notification).
  // Other brands (House minimal) keep the combined screen.
  if (isBudgetBrand()) {
    const view = typeof params.activeView === 'string' ? params.activeView : undefined;
    const pathname = (view && BUDGET_VIEW_ROUTE[view]) || '/';
    const forward: Record<string, string> = {};
    if (typeof params.screen === 'string') forward.screen = params.screen;
    if (typeof params.subTab === 'string') forward.subTab = params.subTab;
    // `navNonce` and `itemId` are the rest of the de-dupe key the section's
    // `NavigationHandler` keys on (`screen:itemId:navNonce`). Dropping them here
    // silently collapses two different requests into one — a second "someone is
    // waiting to join" tap would arrive indistinguishable from the first and be
    // skipped as already-handled.
    if (typeof params.navNonce === 'string') forward.navNonce = params.navNonce;
    if (typeof params.itemId === 'string') forward.itemId = params.itemId;
    return <Redirect href={{ pathname, params: forward }} />;
  }
  // Health also reports budgetMode 'minimal' (it's overloaded as the Soft-Transfer
  // eligibility flag — see isHealthCapableBrand), but it has no home-budget UI at
  // all. Only House actually owns the combined Budget screen.
  if (!isHouseBrand()) {
    return <Redirect href="/" />;
  }
  return <BudgetNavigator initialParams={params} />;
}
