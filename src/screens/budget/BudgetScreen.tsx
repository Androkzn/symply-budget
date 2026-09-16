import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { savingsApi } from '@api/savings';
import { brandId } from '@brand';
import { getLogoSplashForScheme } from '@brand/assets';
import { AppBackground, HeaderActionButton, PermissionCard, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { FilterTabs, type FilterTab } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { getNotificationBenefit } from '@config/brandContent';
import {
  getBudgetSubViews,
  isFullBudget,
  type BudgetSubView,
} from '@features/budget';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useFeature } from '@hooks/useFeature';
import { useContainerPadding } from '@hooks/useLayoutPadding';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { usePermissionSuccess } from '@hooks/usePermissionSuccess';
import type { BudgetStackParamList } from '@navigation/types';
import { useEffectiveTabs } from '@navigation/useEffectiveTabs';
import { useAppStore } from '@stores/appStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useSavingsStore, type SavingsSubTab } from '@stores/savingsStore';
import { Header, IconSize, Layout, Spacing } from '@theme';

import { BudgetAddActionsSheet } from './BudgetAddActionsSheet';
import { BudgetDashboardView } from './BudgetDashboardView';
import { BudgetSpendingsView } from './BudgetSpendingsView';
import { MortgageSwitcher } from './mortgage/MortgageSwitcher';
import { MortgageView } from './mortgage/MortgageView';
import { PensionMemberSwitcher } from './pension/PensionMemberSwitcher';
import { PensionView } from './pension/PensionView';
import { SavingsView } from './savings/SavingsView';
import { WishesView } from './WishesView';

/**
 * Kill-switch probe outcome cache (plan IP4b). Definitive 200/404 results are
 * cached per household for the session so we don't re-probe on every render.
 * A network / timeout / 5xx result is treated as enabled (fail-open) but NOT
 * cached, so the next mount re-probes.
 */
type SavingsFeatureState = 'enabled' | 'disabled';
const savingsFeatureCache = new Map<string, SavingsFeatureState>();

/** Sub-view ids used by the segmented control + the switch below. */
export type BudgetActiveView =
  | 'dashboard'
  | 'planned'
  | 'spendings'
  | 'savings'
  | 'pension'
  | 'wishes'
  | 'mortgage';

interface BudgetScreenProps {
  /**
   * Customizable-tabs model: render a SINGLE section (no top segmented
   * control). When set, this section is shown regardless of the store's
   * `activeView`, and the FilterTabs row is hidden. When omitted, the legacy
   * segmented Budget screen renders (still used by House's minimal `budget`
   * tab).
   */
  forcedSection?: BudgetActiveView;
  /** Header title override for a section tab (e.g. "Planning"). */
  sectionTitle?: string;
}

/**
 * Section id → bottom-bar route. A section tab reached from the "More" hub
 * (i.e. one that lives in overflow, not pinned to the bar) is a drill-in and
 * needs a back button, exactly like every other More item.
 */
const SECTION_ROUTE: Record<BudgetActiveView, string> = {
  dashboard: 'index',
  planned: 'planning',
  spendings: 'spending',
  savings: 'savings',
  pension: 'pension',
  wishes: 'wishes',
  mortgage: 'mortgage',
};

export function BudgetScreen({ forcedSection, sectionTitle }: BudgetScreenProps = {}) {
  const accentScheme = useAppStore((s) => s.accentScheme);
  const containerPadding = useContainerPadding();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const router = useRouter();
  const { state: pushState, busy: pushBusy, request: requestPush } = useNotificationPermission();
  const pushJustGranted = usePermissionSuccess(pushState);
  const notificationBanner = useDismissiblePermissionBanner(
    pushJustGranted || (pushState !== 'granted' && pushState !== 'unavailable'),
  );
  const showTasks = useFeature('smartTaskAssistant');
  const { overflow } = useEffectiveTabs({ showTasks });
  // A forced-section screen opened from the More hub is an overflow tab (not on
  // the bar). Give it a back button so it navigates like the other More items;
  // pinned section tabs (Planning/Spending/…) stay header-only as tab roots.
  const isFromMoreHub =
    !!forcedSection &&
    overflow.some((t) => t.route === SECTION_ROUTE[forcedSection]);
  // The Home tab root (dashboard section, always pinned to the bar) shows the
  // left-aligned brand lockup + bell + avatar, matching the More hub header —
  // instead of a centered "Budget" title. Pinned section tabs (Planning/…) keep
  // their centered section titles; House's minimal legacy screen (no
  // `forcedSection`) is unaffected.
  const isHomeRoot = forcedSection === 'dashboard' && !isFromMoreHub;
  const { selectedYear, selectedMonth, activeView, setSelectedMonth, setActiveView } =
    useBudgetStore();
  // When a section tab forces its view, ignore the shared store `activeView`.
  const currentView: BudgetActiveView = forcedSection ?? activeView;
  const setSavingsSubTab = useSavingsStore((s) => s.setActiveSubTab);
  const { currentHousehold } = useHouseholdStore();

  // Surface an otherwise-buried Savings sub-tab from the dashboard (Goals from
  // the headroom card's CTA, Overview/Projection from tapping the dashboard's
  // own savings figures).
  const openSavingsTab = (tab: SavingsSubTab) => {
    setSavingsSubTab(tab);
    if (forcedSection) {
      // Customizable-tabs model: this screen is pinned to `forcedSection`
      // (`currentView` ignores the store's `activeView`), so flipping it here
      // would be a no-op. The Savings section is its own route — navigate to it.
      router.push('/savings');
      return;
    }
    setActiveView('savings');
  };
  const openGoals = () => openSavingsTab('goals');
  const openSavingsOverview = () => openSavingsTab('overview');
  const openProjection = () => openSavingsTab('projection');
  const searchParams = useLocalSearchParams<{ activeView?: string }>();

  const householdId = currentHousehold?.id;

  // Tri-state so the tab is hidden while the definitive probe is in flight only
  // when we already know it's disabled; unknown/enabled both show the tab.
  const [savingsFeature, setSavingsFeature] = useState<SavingsFeatureState>(
    () => (householdId && savingsFeatureCache.get(householdId)) || 'enabled'
  );

  // Kill-switch probe (IP4b, tri-state). Full Budget brand only — House minimal
  // never calls /savings (404 on House Worker).
  useEffect(() => {
    if (!householdId || !isFullBudget()) {
      if (!isFullBudget()) setSavingsFeature('disabled');
      return;
    }
    const cached = savingsFeatureCache.get(householdId);
    if (cached) {
      setSavingsFeature(cached);
      return;
    }
    let cancelled = false;
    savingsApi
      .getOverview(householdId, selectedYear, selectedMonth)
      .then(() => {
        savingsFeatureCache.set(householdId, 'enabled');
        if (!cancelled) setSavingsFeature('enabled');
      })
      .catch((error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          savingsFeatureCache.set(householdId, 'disabled');
          if (!cancelled) setSavingsFeature('disabled');
        } else {
          // Fail-open: keep the tab, don't cache — re-probe next mount.
          if (!cancelled) setSavingsFeature('enabled');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [householdId, selectedYear, selectedMonth]);

  const fullBudget = isFullBudget();
  // Every pinned main tab (Home + Planning/Spending/Savings/…) shows the gear +
  // bell + avatar cluster. More-hub drill-ins keep their clean back+title header,
  // and House's minimal legacy budget screen (no full suite) is excluded.
  const isMainTab = fullBudget && !isFromMoreHub;

  // Planning / Spending "add" actions. They used to be a permanent CTA row above
  // the list inside BudgetSpendingsView; they now live behind the header "+" so
  // the list starts at the top of the screen (see BudgetAddActionsSheet). The
  // handlers stayed here — this screen already owned every one of these routes.
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  // Mirrors the old row's behaviour: no add affordance while rows are being
  // batch-selected. Reported up by the view, which owns the selection state.
  const [spendingsSelecting, setSpendingsSelecting] = useState(false);
  const isSpendingsSection = currentView === 'planned' || currentView === 'spendings';
  const showAddAction = fullBudget && isSpendingsSection && !spendingsSelecting;
  const addKind: 'planned' | 'spent' = currentView === 'planned' ? 'planned' : 'spent';

  // Honor an incoming `activeView: 'savings'` deep-link param (e.g. from a
  // savings_pace push) by flipping the store once on arrival. Full budget only —
  // minimal House glance stays on the dashboard. Skipped for a forced section
  // tab (its view is fixed by the route, not the store).
  useEffect(() => {
    if (!forcedSection && fullBudget && searchParams.activeView === 'savings') {
      setActiveView('savings');
    }
  }, [forcedSection, fullBudget, searchParams.activeView, setActiveView]);

  const savingsEnabled = savingsFeature !== 'disabled';

  const tabs = useMemo<FilterTab[]>(() => {
    const views = getBudgetSubViews({ savingsEnabled });
    const labels: Record<BudgetSubView | 'planned', string> = {
      dashboard: 'Dashboard',
      spendings: 'Spendings',
      savings: 'Savings',
      pension: 'Pension',
      wishes: 'Wishes',
      planned: 'Planning',
    };
    const out: FilterTab[] = [];
    for (const id of views) {
      if (id === 'dashboard') {
        out.push({ id: 'dashboard', label: labels.dashboard });
        // Full suite keeps Planning as a sibling of Spendings (legacy store ids).
        if (fullBudget) {
          out.push({ id: 'planned', label: labels.planned });
        }
        continue;
      }
      if (id === 'spendings' && fullBudget) {
        out.push({ id: 'spendings', label: labels.spendings });
        continue;
      }
      if (id !== 'spendings') {
        out.push({ id, label: labels[id] });
      }
    }
    return out;
  }, [savingsEnabled, fullBudget]);

  // If savings gets disabled while savings/pension is the active view, fall back.
  // (Section tabs manage their own routing, so only the legacy segmented screen
  // rewrites the shared store here.)
  useEffect(() => {
    if (!forcedSection && !savingsEnabled && (activeView === 'savings' || activeView === 'pension')) {
      setActiveView('dashboard');
    }
  }, [forcedSection, savingsEnabled, activeView, setActiveView]);

  // Minimal brand: force dashboard glance (no Planning/Spendings/…).
  useEffect(() => {
    if (!forcedSection && !fullBudget && activeView !== 'dashboard') {
      setActiveView('dashboard');
    }
  }, [forcedSection, fullBudget, activeView, setActiveView]);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="budget-screen">
        <ScreenHeader
          // Home tab shows the left-aligned brand lockup (default branch) instead
          // of a centered "Budget" title; section tabs keep their centered title.
          title={isHomeRoot ? undefined : sectionTitle ?? 'Budget'}
          // Mortgage's title IS the property picker — a household with two
          // properties used to have to detour through the gear to switch.
          // Pension's title is the member picker for the same reason: room is
          // personal, so "whose" is a scope the screen must expose. Both fall
          // back to a plain title when there's nothing to switch between.
          titleElement={
            isHomeRoot
              ? undefined
              : currentView === 'mortgage'
                ? <MortgageSwitcher />
                : currentView === 'pension'
                  ? <PensionMemberSwitcher />
                  : undefined
          }
        titleLeadingElement={
          isHomeRoot || isFromMoreHub ? undefined : (
            <Image
              // Transparent logo mark (the same one HeaderLogo uses) instead of
              // the square launcher icon, which has an opaque tile baked in.
              source={getLogoSplashForScheme(brandId, accentScheme)}
              style={styles.headerAppIcon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          )
        }
        showBackButton={isFromMoreHub}
        onBackPress={() => {
          // Overflow section tabs are always reached from the "More" hub, so
          // Back must return there — never the Home tab. router.back() lands on
          // the initial (Home) tab once the Tabs history collapses, so navigate
          // to the More route (`settings`) explicitly instead.
          router.navigate('/settings');
        }}
        backButtonTestID="budget-section-back-button"
        // Bell + avatar on every main tab; wired to the shared notifications /
        // profile routes (same as the More hub header). Drill-ins pass neither,
        // so they stay back+title only.
        onNotificationPress={isMainTab ? () => router.push('/notifications') : undefined}
        onProfilePress={isMainTab ? () => router.push('/profile') : undefined}
        rightElement={
          fullBudget ? (
            <>
              {/* Standard "+" — leads the right cluster, ahead of the gear, so
                  the one control that ADDS something sits where every other
                  screen in the fleet puts it (see BudgetHouseholdScreen). */}
              {showAddAction ? (
                <HeaderActionButton
                  iconOnly
                  onPress={() => setAddSheetVisible(true)}
                  testID="budget-add-menu"
                  accessibilityLabel={
                    addKind === 'planned' ? 'Add a planned item' : 'Add a spending'
                  }
                >
                  <Icon name="add" size={IconSize.lg} active testID="budget-add-menu-icon" />
                </HeaderActionButton>
              ) : null}
              {/* Pension and Wishes have no dedicated settings, so their header
                  omits the gear entirely; Mortgage and the main tabs still show it. */}
              {currentView !== 'pension' && currentView !== 'wishes' ? (
                // Shared circular header action — brand-tinted to match the bell, so
                // every app's header gear reads identically (only colors/icon vary).
                // On the Mortgage tab the gear manages properties (edit / delete /
                // clean statement data — SWITCHING now lives in the title dropdown);
                // every other section opens the generic Budget settings.
                <HeaderActionButton
                  iconOnly
                  onPress={() =>
                    navigation.navigate(currentView === 'mortgage' ? 'MortgageSettings' : 'BudgetSettings')
                  }
                  testID="budget-settings-button"
                  accessibilityLabel={currentView === 'mortgage' ? 'Mortgage settings' : 'Budget settings'}
                >
                  <Icon name="settings" size={IconSize.lg} active testID="budget-settings-icon" />
                </HeaderActionButton>
              ) : null}
            </>
          ) : isHomeRoot || isFromMoreHub ? undefined : (
            // House mounts this screen as its own Budget TAB with the minimal
            // feature set, so there is no Budget settings screen to open — but
            // the tab still gets the gear every other House tab has, pointing at
            // House's own hub. A no-op outside House, and never on a drill-in.
            <SettingsGearButton />
          )
        }
      />
      <AdaptiveContainer width="standard" padding={containerPadding} style={styles.adaptiveFill}>
        {/* Legacy segmented mode (no forcedSection): the top tab row is fixed
            chrome above whichever view renders below, same as the notification
            banner — it used to scroll away inside the shared ScrollView, but
            none of the per-view bodies below own that scroll anymore. */}
        {!forcedSection && tabs.length > 1 ? (
          <FilterTabs
            tabs={tabs}
            activeTab={currentView}
            onTabChange={(id) => setActiveView(id as BudgetActiveView)}
            showActiveIndicator={false}
            scrollable
          />
        ) : null}

        {/* The dismissible notification nudge is dashboard-only chrome, fixed
            above whichever view renders below — it no longer scrolls away now
            that the dashboard owns its own sticky-header scroll (see below). */}
        {currentView === 'dashboard' && notificationBanner.visible ? (
          <PermissionCard
            state={pushState}
            icon={pushState === 'granted' ? 'checkmark-circle' : 'notifications'}
            title={pushState === 'granted' ? 'Notifications are enabled' : 'Notifications'}
            copy={{
              'not-requested': { body: getNotificationBenefit(brandId) },
              denied: {
                body: "That's a fine choice — everything still works without them. If you change your mind, notifications live in Settings.",
              },
            }}
            onRequest={() => void requestPush()}
            onOpenSettings={() => void Linking.openSettings()}
            onDismiss={notificationBanner.dismiss}
            busy={pushBusy}
            layout="compact"
            testID="budget-home-notification-permission-card"
          />
        ) : null}

        {currentView === 'savings' ? (
          // Each of these owns its OWN ScrollView (month stepper pinned via
          // `stickyHeaderIndices`) instead of nesting inside this screen's
          // shared scroll — see SavingsView / BudgetDashboardView /
          // BudgetSpendingsView.
          <SavingsView />
        ) : currentView === 'dashboard' ? (
          <BudgetDashboardView
            year={selectedYear}
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            onEditPlannedItem={
              fullBudget
                ? itemId => navigation.navigate('BudgetItemForm', { itemId })
                : undefined
            }
            onCategoryPress={
              fullBudget
                ? row =>
                    navigation.navigate('BudgetCategoryDetail', {
                      categoryId: row.id,
                      categoryName: row.name,
                      categoryIds: row.categoryIds,
                    })
                : undefined
            }
            onOpenGoals={
              fullBudget && savingsEnabled ? openGoals : undefined
            }
            onOpenSavingsOverview={
              fullBudget && savingsEnabled ? openSavingsOverview : undefined
            }
            onOpenProjection={
              fullBudget && savingsEnabled ? openProjection : undefined
            }
            onAddIncome={
              fullBudget && savingsEnabled
                ? () => navigation.navigate('SavingsEntryForm', { mode: 'income' })
                : undefined
            }
          />
        ) : currentView === 'planned' || currentView === 'spendings' ? (
          <BudgetSpendingsView
            variant={currentView === 'planned' ? 'planned' : 'spent'}
            year={selectedYear}
            month={selectedMonth}
            onMonthChange={setSelectedMonth}
            onSelectionModeChange={setSpendingsSelecting}
            onSeeAllSpending={
              currentView === 'spendings'
                ? () => navigation.navigate('BudgetAllSpending')
                : undefined
            }
            onSeeAllPlanned={
              currentView === 'planned'
                ? () => navigation.navigate('BudgetAllPlanning')
                : undefined
            }
            onOpenSpendingExtras={
              currentView === 'spendings'
                ? (kind) => navigation.navigate('BudgetSpendingExtras', { kind })
                : undefined
            }
            onSetBudget={() => navigation.navigate('BudgetSettings')}
            onEditItem={(itemId) => navigation.navigate('BudgetItemForm', { itemId })}
            onEditExpense={(expense) =>
              navigation.navigate('BudgetItemForm', {
                expenseId: expense.id,
                kind: 'spent',
                expenseDraft: {
                  title: expense.title,
                  amount: expense.amount,
                  expense_date: expense.expense_date,
                  category_id: expense.category_id,
                  tax_amount: expense.tax_amount,
                  // Only a stock-up carries a plan; an ordinary draft stays as it was.
                  ...(expense.bulk ? { bulk: expense.bulk } : {}),
                },
              })
            }
          />
        ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.viewContainer}>
            {currentView === 'mortgage' ? (
              <MortgageView />
            ) : currentView === 'pension' ? (
              <PensionView />
            ) : (
              <WishesView />
            )}
          </View>
          <ScreenScrollEnd testID={screenScrollEndTestId('budget-dashboard')} />
        </ScrollView>
        )}
      </AdaptiveContainer>

      {/* Lives at screen level, not inside the list: it is opened from the
          header, and a Modal mounted inside the scrolling body would inherit
          its transform. */}
      <BudgetAddActionsSheet
        visible={addSheetVisible && isSpendingsSection}
        onClose={() => setAddSheetVisible(false)}
        variant={addKind}
        onAddPlanned={() => navigation.navigate('BudgetItemForm', { kind: 'planned' })}
        onAddSpent={() => navigation.navigate('BudgetItemForm', { kind: 'spent' })}
        onAddAIPress={() => navigation.navigate('BudgetItemAI', { kind: addKind })}
        onScanReceipt={() => navigation.navigate('BudgetReceiptScan')}
      />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Fill the space under the header so the inner (gesture-handler) ScrollView
  // gets a real, bounded height to scroll against.
  adaptiveFill: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    // Horizontal padding is owned by AdaptiveContainer (tokenized via
    // useContainerPadding) — only vertical padding lives here so we don't
    // double-pad the sides.
    paddingTop: Spacing.md,
    // Clear the floating tab bar so the bottom "+ Add a spending" / "Add with
    // AI" CTAs (and the last spendings row) aren't tucked under the capsule.
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  viewContainer: {
    marginTop: Spacing.base,
    width: '100%',
    alignSelf: 'stretch',
  },
  headerAppIcon: {
    width: Header.logoHeight,
    height: Header.logoHeight,
  },
});
