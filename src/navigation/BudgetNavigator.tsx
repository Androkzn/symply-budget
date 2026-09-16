import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useRef } from 'react';

import { isFullBudget } from '@features/budget';
import {
  BudgetDataSharingScreen,
  BudgetHouseholdEditScreen,
  BudgetHouseholdScreen,
  SoftTransferExportScreen,
  SoftTransferImportScreen,
} from '@features/budget/screens';
import {
  BudgetScreen,
  BudgetItemFormScreen,
  BudgetItemAIScreen,
  BudgetReceiptScanScreen,
  BudgetSettingsScreen,
  MortgageSetupScreen,
  MortgageSettingsScreen,
  MortgageTabsScreen,
  MortgageEditScreen,
  MortgageStatementsScreen,
  MortgageStatementFormScreen,
  MortgageRenewalScreen,
  MortgageRenewalOffersScreen,
  MortgageHistoryScreen,
  MortgageRecordChangeScreen,
  BudgetCategoriesScreen,
  BudgetSubBudgetsScreen,
  BudgetBackupScreen,
  BudgetMonthlyCapsScreen,
  BudgetSyncScreen,
  BudgetSyncInventoryScreen,
  BudgetInviteScreen,
  BudgetInviteCreateScreen,
  BudgetJoinScreen,
  BudgetExportScreen,
  BudgetTransferScreen,
  BudgetTimelineScreen,
  BudgetYearSetupScreen,
  BudgetCategoryDetailScreen,
  BudgetAllSpendingScreen,
  BudgetAllPlanningScreen,
  BudgetSpendingExtrasScreen,
  WishDetailScreen,
  SavingsEntryForm,
  SavingsGoalForm,
  SavingsRegistered,
  SavingsRecurringPaymentsScreen,
  SavingsImportScreen,
  SavingsYearHistoryScreen,
  SavingsCompareYearsScreen,
  PensionImportScreen,
} from '@screens/budget';
import type { BudgetActiveView } from '@screens/budget/BudgetScreen';
// Utilities screens are intentionally NOT imported here. Utilities is a
// House-only feature module (`@features/utilities`); Budget does not mount it.
import { AppearanceScreen } from '@screens/settings/AppearanceScreen';
import { CurrencyScreen } from '@screens/settings/CurrencyScreen';
import { NotificationSettingsScreen } from '@screens/settings/NotificationSettingsScreen';
import { RegionScreen } from '@screens/settings/RegionScreen';
import { navigateAfterInteractions } from '@services/nav-when-ready';
import { useTabBarVisibilityStore } from '@stores/tabBarVisibilityStore';

import { useBudgetFormPresentation } from './presentation';
import type { BudgetStackParamList } from './types';

const Stack = createNativeStackNavigator<BudgetStackParamList>();

interface BudgetNavigatorProps {
  initialParams?: {
    screen?: string;
    itemId?: string;
    navNonce?: string;
  };
  /**
   * Customizable-tabs model: render a single budget section as this stack's
   * root (no top segmented control). Omit for the legacy full Budget screen
   * (House's minimal `budget` tab).
   */
  section?: BudgetActiveView;
  /** Header title for the section root (e.g. "Planning"). */
  sectionTitle?: string;
}

function NavigationHandler({
  initialParams,
  children,
}: {
  initialParams?: BudgetNavigatorProps['initialParams'];
  children: React.ReactNode;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const hasNavigated = useRef<string | null>(null);
  const fullBudget = isFullBudget();

  useEffect(() => {
    const screen = initialParams?.screen;
    if (!screen || !fullBudget) return;

    const navKey = `${screen}:${initialParams?.itemId || ''}:${initialParams?.navNonce || ''}`;
    if (hasNavigated.current === navKey) return;

    if (screen === 'BudgetSettings') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetSettings'));
    } else if (screen === 'BudgetCategories') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetCategories'));
    } else if (screen === 'BudgetSubBudgets') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetSubBudgets'));
    } else if (screen === 'BudgetMonthlyCaps') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetMonthlyCaps'));
    } else if (screen === 'BudgetSync') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetSync'));
    } else if (screen === 'BudgetInvite') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetInvite'));
    } else if (screen === 'BudgetHouseholds') {
      // Reachable by URL because Sync & Sharing moved to Profile, a sibling tab
      // of the one hosting this stack: its Households row has no `navigation`
      // into here and must come through the same door as a deep link.
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetHouseholds'));
    } else if (screen === 'BudgetBackup') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetBackup'));
    } else if (screen === 'BudgetExport') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetExport'));
    } else if (screen === 'BudgetLongTermTimeline') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetLongTermTimeline'));
    } else if (screen === 'SavingsYearHistory') {
      // Reachable by URL because the INSIGHTS group that links here lives on the
      // More tab — a sibling of the tab hosting this stack, with no `navigation`
      // into it. Same door as a deep link (see `SettingsScreen`).
      hasNavigated.current = navKey;
      navigateAfterInteractions(() =>
        navigation.navigate('SavingsYearHistory', undefined),
      );
    } else if (screen === 'SavingsCompareYears') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() =>
        navigation.navigate('SavingsCompareYears', undefined),
      );
    } else if (screen === 'BudgetItemForm') {
      hasNavigated.current = navKey;
      const itemId = initialParams?.itemId;
      navigateAfterInteractions(() =>
        navigation.navigate(
          'BudgetItemForm',
          itemId ? { itemId } : undefined,
        ),
      );
    } else if (screen === 'BudgetItemAI') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetItemAI'));
    } else if (screen === 'BudgetReceiptScan') {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('BudgetReceiptScan'));
    } else if (screen === 'PensionImport' && fullBudget) {
      hasNavigated.current = navKey;
      navigateAfterInteractions(() => navigation.navigate('PensionImport'));
    }
  }, [initialParams, navigation, fullBudget]);

  return <>{children}</>;
}

export function BudgetNavigator({
  initialParams,
  section,
  sectionTitle,
}: BudgetNavigatorProps = {}) {
  const budgetFormPresentation = useBudgetFormPresentation('modal');
  const setFocusedRoute = useTabBarVisibilityStore(s => s.setFocusedRoute);
  const fullBudget = isFullBudget();

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
      initialRouteName="BudgetMain"
      screenListeners={({ route }) => ({
        focus: () => {
          setFocusedRoute('Budget', route.name as keyof BudgetStackParamList);
        },
        state: event => {
          const state = event.data.state;
          const focusedRoute = state.routes[state.index]?.name;
          if (focusedRoute) {
            setFocusedRoute('Budget', focusedRoute);
          }
        },
      })}
    >
      <Stack.Screen name="BudgetMain">
        {() => (
          <NavigationHandler initialParams={initialParams}>
            <BudgetScreen forcedSection={section} sectionTitle={sectionTitle} />
          </NavigationHandler>
        )}
      </Stack.Screen>
      {fullBudget ? (
        <>
          <Stack.Screen
            name="BudgetItemForm"
            component={BudgetItemFormScreen}
            options={{
              presentation: budgetFormPresentation,
              contentStyle: { flex: 1 },
            }}
          />
          <Stack.Screen
            name="BudgetItemAI"
            component={BudgetItemAIScreen}
            options={{
              presentation: budgetFormPresentation,
              contentStyle: { flex: 1 },
            }}
          />
          <Stack.Screen
            name="BudgetReceiptScan"
            component={BudgetReceiptScanScreen}
            options={{
              presentation: budgetFormPresentation,
              contentStyle: { flex: 1 },
            }}
          />
          <Stack.Screen
            name="BudgetSettings"
            component={BudgetSettingsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageSetup"
            component={MortgageSetupScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageSettings"
            component={MortgageSettingsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageTabs"
            component={MortgageTabsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageEdit"
            component={MortgageEditScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageStatements"
            component={MortgageStatementsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageStatementForm"
            component={MortgageStatementFormScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageRenew"
            component={MortgageRenewalScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageRenewalOffers"
            component={MortgageRenewalOffersScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageHistory"
            component={MortgageHistoryScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="MortgageRecordChange"
            component={MortgageRecordChangeScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetCategories"
            component={BudgetCategoriesScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetSubBudgets"
            component={BudgetSubBudgetsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetMonthlyCaps"
            component={BudgetMonthlyCapsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetBackup"
            component={BudgetBackupScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetSync"
            component={BudgetSyncScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetSyncInventory"
            component={BudgetSyncInventoryScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetInvite"
            component={BudgetInviteScreen}
            options={{ presentation: 'card' }}
          />
          {/* The hub's three rows. `card` on all of them: they are pushed, so
              they slide in from the right and carry a back button — which is
              the whole reason they stopped being collapsible sections. */}
          <Stack.Screen
            name="BudgetInviteCreate"
            component={BudgetInviteCreateScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetJoin"
            component={BudgetJoinScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetHouseholds"
            component={BudgetHouseholdScreen}
            options={{ presentation: 'card' }}
          />
          {/* One household's own page, pushed from a card in the list — and,
              with no `householdId`, the form that creates one. */}
          <Stack.Screen
            name="BudgetHouseholdEdit"
            component={BudgetHouseholdEditScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetExport"
            component={BudgetExportScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetTransfer"
            component={BudgetTransferScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetYearSetup"
            component={BudgetYearSetupScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetLongTermTimeline"
            component={BudgetTimelineScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetCategoryDetail"
            component={BudgetCategoryDetailScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetAllSpending"
            component={BudgetAllSpendingScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetAllPlanning"
            component={BudgetAllPlanningScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="BudgetSpendingExtras"
            component={BudgetSpendingExtrasScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="WishDetail"
            component={WishDetailScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SavingsEntryForm"
            component={SavingsEntryForm}
            options={{
              presentation: budgetFormPresentation,
              contentStyle: { flex: 1 },
            }}
          />
          <Stack.Screen
            name="SavingsGoalForm"
            component={SavingsGoalForm}
            options={{
              presentation: budgetFormPresentation,
              contentStyle: { flex: 1 },
            }}
          />
          <Stack.Screen
            name="SavingsRegistered"
            component={SavingsRegistered}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SavingsRecurringPayments"
            component={SavingsRecurringPaymentsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SavingsImport"
            component={SavingsImportScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="PensionImport"
            component={PensionImportScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SavingsYearHistory"
            component={SavingsYearHistoryScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SavingsCompareYears"
            component={SavingsCompareYearsScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SoftTransferImport"
            component={SoftTransferImportScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="SoftTransferExport"
            component={SoftTransferExportScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="DataSharing"
            component={BudgetDataSharingScreen}
            options={{ presentation: 'card' }}
          />
          {/* The shared preference screens. Full Budget's settings hub is
              BudgetSettings, so these are pushed here rather than into the
              Settings stack in another tab — same components, mounted twice, so
              "back" returns to the screen that opened them. */}
          <Stack.Screen
            name="Appearance"
            component={AppearanceScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="Currency"
            component={CurrencyScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="Region"
            component={RegionScreen}
            options={{ presentation: 'card' }}
          />
          <Stack.Screen
            name="NotificationSettings"
            component={NotificationSettingsScreen}
            options={{ presentation: 'card' }}
          />
        </>
      ) : null}
    </Stack.Navigator>
  );
}
