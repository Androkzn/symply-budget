import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FilterTabs, type FilterTab } from '@components/ui';
import { usePensionStore, type PensionSubTab } from '@stores/pensionStore';

import { BudgetMonthHeader } from '../BudgetMonthHeader';

import { PensionAccountsView } from './PensionAccountsView';
import { PensionContributionsView } from './PensionContributionsView';
import { PensionGoalsView } from './PensionGoalsView';
import { PensionRoomView } from './PensionRoomView';

// Account setup is disabled in the UI (code kept) — the simple flow is Room/Goals/Contributions.
const SUB_TABS: FilterTab[] = [
  { id: 'room', label: 'Room' },
  { id: 'goals', label: 'Goals' },
  { id: 'contributions', label: 'Contributions' },
];

/**
 * Pension tab container (Budget → Pension). Owns the year stepper and the internal
 * Room / Goals / Accounts sub-tab switch, both bound to `usePensionStore`. Each
 * sub-view is PROP-LESS and self-fetches its BE view model (the registered-account
 * overview) — this container holds no server state and does no money math. Mirrors
 * the Savings container's structure, but Pension is an ANNUAL view (year, not month).
 */
export function PensionView() {
  const { selectedYear, activeSubTab, setActiveSubTab, setSelectedYear } = usePensionStore();

  // Deep-link sub-tab control: `simplebudget:///pension?tab=room|goals|contributions`
  // drives the active sub-tab directly. This is the reliable path for E2E and for
  // notification/widget links — the in-screen segmented sub-tab tap can be dropped on
  // iOS-26 New-Arch, and its `filter-tab-goals` testID collides with the Savings
  // view's Goals tab while both section tabs stay mounted across a warm session.
  // `useLocalSearchParams().tab` only reflects the query the FIRST time the /pension
  // route mounts. A REPEAT deep-link to the same route — E2E switching Room→Goals, or
  // a second widget/notification tap — is deduped by the router and never re-emits the
  // param, so the sub-tab would stay stuck. `Linking.useURL()` updates on EVERY
  // incoming URL, so read the sub-tab from the live URL and fall back to the route
  // param for the initial (cold-launch) mount.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const url = Linking.useURL();
  React.useEffect(() => {
    const fromUrl = url ? (Linking.parse(url).queryParams?.tab as string | undefined) : undefined;
    const next = fromUrl ?? tab;
    if (next === 'room' || next === 'goals' || next === 'contributions') {
      setActiveSubTab(next);
    }
  }, [url, tab, setActiveSubTab]);

  return (
    <View testID="pension-view" style={styles.root}>
      {/* Year selector — pension room + goals are per tax year. Same stepper
          component as every other Budget section, so its row metrics stay in
          lockstep; `pinned={false}` because this view scrolls inside
          BudgetScreen's ScrollView, which already owns the top padding and the
          horizontal chrome. */}
      <BudgetMonthHeader
        label={String(selectedYear)}
        unit="year"
        pinned={false}
        onPrev={() => setSelectedYear(selectedYear - 1)}
        onNext={() => setSelectedYear(selectedYear + 1)}
        prevTestID="pension-year-prev"
        nextTestID="pension-year-next"
      >
        <FilterTabs
          tabs={SUB_TABS}
          activeTab={activeSubTab}
          onTabChange={(id) => setActiveSubTab(id as PensionSubTab)}
          showActiveIndicator={false}
        />
      </BudgetMonthHeader>

      <View style={styles.subViewContainer}>
        {activeSubTab === 'room' && <PensionRoomView />}
        {activeSubTab === 'goals' && <PensionGoalsView />}
        {activeSubTab === 'contributions' && <PensionContributionsView />}
        {/* Accounts view kept but not surfaced as a tab (account setup disabled in UI). */}
        {activeSubTab === 'accounts' && <PensionAccountsView />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    alignSelf: 'stretch',
  },
  // The gap above the sub-view is BudgetMonthHeader's own `marginBottom`, so
  // Pension matches Planning / Spending / Savings without restating it.
  subViewContainer: {
    width: '100%',
    alignSelf: 'stretch',
  },
});
