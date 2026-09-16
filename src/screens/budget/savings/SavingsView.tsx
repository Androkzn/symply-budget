import React from 'react';
import { StyleSheet } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { ResponsiveLayout } from '@components/layout/ResponsiveLayout';
import { FilterTabs, type FilterTab } from '@components/ui';
import { useSavingsStore, type SavingsSubTab } from '@stores/savingsStore';

import {
  BUDGET_STICKY_HEADER_INDICES,
  BUDGET_STICKY_SCROLL_CONTENT,
  BudgetMonthHeader,
  monthYearLabel,
  shiftMonth,
} from '../BudgetMonthHeader';

import { SavingsGoalsView } from './SavingsGoalsView';
import { SavingsIncomeView } from './SavingsIncomeView';
import { SavingsMonthlyView } from './SavingsMonthlyView';
import { SavingsOverviewView } from './SavingsOverviewView';
import { SavingsProjectionView } from './SavingsProjectionView';

const SUB_TABS: FilterTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'income', label: 'Income' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'projection', label: 'Projection' },
  { id: 'goals', label: 'Goals' },
];

/** Sub-tabs that show a whole YEAR, so the month stepper above is meaningless. */
const YEAR_SCOPED_TABS = new Set<SavingsSubTab>(['projection']);

/**
 * Savings container. Owns the internal sub-tab switch (overview / income /
 * spending / projection / goals) and a thin month header, both bound to
 * `useSavingsStore`.
 * Each sub-view is PROP-LESS and self-fetches its own BE view model — this
 * container does no money math and holds no server-fetched state.
 */
export function SavingsView() {
  const { selectedYear, selectedMonth, activeSubTab, setActiveSubTab, setSelectedMonth } =
    useSavingsStore();

  // Projection spans a whole calendar year, so the header steps YEARS there —
  // a month stepper on a 12-month grid would do nothing visible.
  const isYearScoped = YEAR_SCOPED_TABS.has(activeSubTab);

  return (
    <ScrollView
      testID="savings-view"
      style={styles.scroll}
      contentContainerStyle={BUDGET_STICKY_SCROLL_CONTENT}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={BUDGET_STICKY_HEADER_INDICES}
    >
      {/* Sticky index 0 — period stepper + sub-tabs stay pinned while the
          sub-view below scrolls, so the user always sees which month/tab
          they're on. Same header component (and therefore the same spacing and
          alignment) as Planning/Spending/Pension — the sub-tabs ride along as
          its children so they share the one pinned band. */}
      <BudgetMonthHeader
        label={
          isYearScoped ? String(selectedYear) : monthYearLabel(selectedYear, selectedMonth)
        }
        unit={isYearScoped ? 'year' : 'month'}
        onPrev={() => {
          if (isYearScoped) {
            setSelectedMonth(selectedYear - 1, selectedMonth);
            return;
          }
          const prev = shiftMonth(selectedYear, selectedMonth, 1);
          setSelectedMonth(prev.year, prev.month);
        }}
        onNext={() => {
          if (isYearScoped) {
            setSelectedMonth(selectedYear + 1, selectedMonth);
            return;
          }
          const next = shiftMonth(selectedYear, selectedMonth, -1);
          setSelectedMonth(next.year, next.month);
        }}
        prevTestID="savings-month-prev"
        nextTestID="savings-month-next"
        labelTestID="savings-period-label"
      >
        <FilterTabs
          tabs={SUB_TABS}
          activeTab={activeSubTab}
          onTabChange={(id) => setActiveSubTab(id as SavingsSubTab)}
          showActiveIndicator={false}
        />
      </BudgetMonthHeader>

      {/* Reading-width cap + centering on iPad — without it every sub-tab's
          single column of cards stretches edge-to-edge on wide screens (a
          stretched-iPhone layout, not a real iPad adaptation). No-op on phone
          widths. Sticky header above stays outside so the sticky index keeps
          working — mirrors the BudgetDashboardView/BudgetSpendingsView fix.
          The gap above is the header's own `marginBottom`, so it matches
          Planning/Spending exactly. */}
      <ResponsiveLayout maxWidth={700} centerContent padding={0}>
        {activeSubTab === 'overview' && <SavingsOverviewView />}
        {activeSubTab === 'income' && <SavingsIncomeView />}
        {activeSubTab === 'monthly' && <SavingsMonthlyView />}
        {activeSubTab === 'projection' && <SavingsProjectionView />}
        {activeSubTab === 'goals' && <SavingsGoalsView />}
      </ResponsiveLayout>
      <ScreenScrollEnd testID={screenScrollEndTestId('budget-dashboard')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
