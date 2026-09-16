import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { budgetApi, type MonthlyOverview } from '@api/budget';
import { AppBackground, ScreenHeader } from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, GradientButton, IconBackgroundChip, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { getActiveBudgetHouseholdId, isLocalBudgetSessionOpen } from '@features/budget/local/engine';
import { syncHouseholdStoreFromLocalLedger } from '@features/budget/local/ensureSession';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { formatBudgetCurrency } from '@screens/budget/budgetFormat';
import { widgetSync } from '@services/widget-sync';
import { useAppStore } from '@stores/appStore';
import { useAuthStore } from '@stores/authStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, useAppColors } from '@theme';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A loaded overview together with the household it was loaded FOR.
 *
 * BR-016 put several households on one device, and a switch between them is a
 * store update that commits one render BEFORE the refetch it triggers can come
 * back. An unstamped `MonthlyOverview` in state is therefore household A's money
 * rendered under household B's name for that render — and, once the widget
 * effect below has forwarded it, on the member's home screen for as long as
 * nothing overwrites it.
 *
 * Stamping makes the guarantee structural rather than a matter of which effect
 * runs first: every figure on this screen is read through `overview`, which is
 * null unless the stamp matches the household the store currently names.
 *
 * `data` is null for a household whose load FAILED. Stamped rather than left
 * unstamped, so the card settles on the "no plan yet" prompt instead of spinning
 * forever waiting for a result that has already come back.
 */
type LoadedOverview = {
  householdId: string;
  data: MonthlyOverview | null;
};

export function BudgetHomeScreen() {  const colors = useAppColors();
  const router = useRouter();
  const { content: containerPadding } = useLayoutPadding();
  const displayName = useAuthStore((state) => state.user?.display_name);
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear, selectedMonth, dataRevision } = useBudgetStore();
  // Subscribe so the dashboard's money figures re-render when the user changes
  // their display currency in Settings (formatBudgetCurrency reads it fresh).
  useAppStore((state) => state.currency);

  // The household this screen is showing, normalized to `string | null` so it
  // compares cleanly against the engine's active pointer (which is null, not
  // undefined, when no session is open).
  const householdId = currentHousehold?.id ?? null;

  const [loaded, setLoaded] = useState<LoadedOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Monotonic per-load token. Switching households while a load is in flight
  // leaves two fetches racing, and under local-first the loser is routinely the
  // one asked for FIRST: `localBudgetApi.getMonthlyOverview` resolves through
  // `getLocalLedgerFor`, which hydrates the named household on demand at
  // 34–37 µs/row. Without the token a slow household A lands after a fast
  // household B and overwrites the household the member is looking at.
  const loadSeq = useRef(0);
  // Which household the App Group snapshot currently describes — see the widget
  // effect below, which has to un-say a previous household's figures.
  const widgetHouseholdId = useRef<string | null>(null);

  const overview = loaded?.householdId === householdId ? loaded.data : null;
  // No stamped result for the household now in view: the store has already moved
  // and the fetch has not returned. That is a load in progress, not an empty
  // budget, and rendering it as one flashes "no monthly budget set" across every
  // switch.
  const isAwaitingHousehold = householdId !== null && loaded?.householdId !== householdId;

  // Keep the store's household in step with the engine's ACTIVE one.
  //
  // Two ways they drift. A backup restore can replace `hh_local_*` with the
  // archive's household id; BR-016 added the everyday one — a switch, a join, or
  // the fallback after a removal moves the active household underneath the
  // store. Either way `currentHousehold.id` is what every Budget facade is
  // called with, and those facades resolve their household by id and throw on
  // one this device does not hold, so a stale pointer renders Spending, Savings
  // and Mortgage empty over data that is on disk and one id away.
  useEffect(() => {
    if (!isLocalBudgetSessionOpen()) return;
    if (householdId !== getActiveBudgetHouseholdId()) {
      syncHouseholdStoreFromLocalLedger();
    }
  }, [householdId, dataRevision]);

  const loadOverview = useCallback(async () => {
    if (!householdId) {
      setLoaded(null);
      return;
    }
    const seq = (loadSeq.current += 1);
    setIsLoading(true);
    try {
      const data = await budgetApi.getMonthlyOverview(householdId, selectedYear, selectedMonth);
      // A newer load started while this one was in flight — almost always a
      // household switch. Its result is the one on screen; drop this one rather
      // than let it win on arrival order.
      if (seq !== loadSeq.current) return;
      setLoaded({ householdId, data });
    } catch {
      if (seq !== loadSeq.current) return;
      setLoaded({ householdId, data: null });
    } finally {
      // Only the newest load owns the spinner: an overtaken load clearing it
      // would show the successor's empty state as if it had finished.
      if (seq === loadSeq.current) setIsLoading(false);
    }
  }, [householdId, selectedYear, selectedMonth]);

  // One effect for both triggers, deliberately.
  //
  // `loadOverview`'s identity changes with the household and the month;
  // `dataRevision` bumps on every ledger move for the ACTIVE household (the
  // `sync/ledgerRefresh` bridge already filters background households out, so
  // this screen never repaints for a household it is not showing). A switch
  // moves BOTH at once, and as two separate effects that fired two overlapping
  // fetches for the same household — each one hydrating rows.
  useEffect(() => {
    void loadOverview();
  }, [loadOverview, dataRevision]);

  const greeting = greetingForNow();
  const nameSuffix = displayName ? `, ${displayName.split(' ')[0]}` : '';
  const monthLabel = `${MONTH_NAMES[selectedMonth - 1]} ${selectedYear}`;

  const plannedCents = overview?.plannedBudget ?? 0;
  const spentCents = overview?.actualSpent ?? 0;
  const remainingCents = overview?.remainingBudget ?? 0;
  const hasPlan = plannedCents > 0;

  // Feed the Budget Home Screen widget (shared kit reads `widget_budget_summary`
  // from the App Group). No-op off-iOS / when the widget module isn't linked.
  //
  // The App Group is a cache with no delete — `widgetSync` can overwrite a key,
  // not remove one. So under BR-016 a switch whose new overview never arrives
  // (offline, a failed load, a household the member leaves again immediately)
  // would leave the PREVIOUS household's remaining balance on the home screen
  // and the watch face indefinitely: the one place cross-household figures
  // outlive the app. Publishing zeros for the household now in view is not
  // pretty, but it is this household's truth as far as the app knows it, and it
  // is the only way to stop showing another household's money on a surface that
  // cannot be cleared.
  useEffect(() => {
    if (overview) {
      widgetSync.setSnapshot('widget_budget_summary', {
        remaining_cents: remainingCents,
        spent_cents: spentCents,
        budget_cents: plannedCents,
        period_label: monthLabel,
      });
      widgetHouseholdId.current = householdId;
      return;
    }
    // Nothing loaded for the household in view yet. Blank the widget only when
    // what it holds belongs to a DIFFERENT household — blanking unconditionally
    // would wipe the snapshot `BudgetDashboardView` publishes (BUDGET-WIDGET-004:
    // no "$0 remaining" flash before real data lands). And only while there IS a
    // household in view: with none there is nothing to assert, and sign-out owns
    // the widget through `widgetSync.clear()`, which this must not undo.
    if (
      householdId !== null &&
      widgetHouseholdId.current !== null &&
      widgetHouseholdId.current !== householdId
    ) {
      widgetSync.setSnapshot('widget_budget_summary', {
        remaining_cents: 0,
        spent_cents: 0,
        budget_cents: 0,
        period_label: monthLabel,
      });
      widgetHouseholdId.current = householdId;
    }
  }, [overview, remainingCents, spentCents, plannedCents, monthLabel, householdId]);

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="budget-home-screen">
        <ScreenHeader
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.content, { paddingHorizontal: containerPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <AdaptiveContainer width="reading">
            <Typography variant="title2" weight="bold" color={colors.textPrimary}>
              {greeting}
              {nameSuffix}
            </Typography>
            <Typography
              variant="body"
              color={colors.textSecondary}
              style={styles.tagline}
            >
              Symply Budget keeps your household spending on track — planned caps, bills, savings, and more.
            </Typography>

            <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
                THIS MONTH
              </Typography>
              <Typography variant="title3" weight="semibold" color={colors.textPrimary} style={styles.cardTitle}>
                {monthLabel}
              </Typography>

              {isLoading || isAwaitingHousehold ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : !householdId ? (
                <Typography variant="body" color={colors.textSecondary}>
                  Sign in and pick a household to see your month at a glance.
                </Typography>
              ) : hasPlan ? (
                <View style={styles.summaryRows}>
                  <SummaryRow label="Planned" value={formatBudgetCurrency(plannedCents)} />
                  <SummaryRow label="Spent" value={formatBudgetCurrency(spentCents)} />
                  <SummaryRow
                    label="Remaining"
                    value={formatBudgetCurrency(remainingCents)}
                    emphasize
                  />
                </View>
              ) : (
                <Typography variant="body" color={colors.textSecondary}>
                  No monthly budget set yet — open Budget to plan {MONTH_NAMES[selectedMonth - 1]}.
                </Typography>
              )}
            </Card>

            <GradientButton
              title="Open Budget"
              variant="teal"
              onPress={() => router.push('/budget')}
              fullWidth
              style={styles.cta}
              testID="budget-home-open-budget"
            />

            <Pressable
              onPress={() => router.push('/budget')}
              style={({ pressed }) => [
                styles.quickLink,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go to budget dashboard"
            >
              <IconBackgroundChip name="budget" size={22} style={styles.quickLinkIcon} />
              <View style={styles.quickLinkText}>
                <Typography variant="body" weight="medium">
                  Budget dashboard
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  Spendings, bills, savings, and wishes
                </Typography>
              </View>
              <Icon name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>
          </AdaptiveContainer>
        </ScrollView>
      </View>
    </AppBackground>
  );
}

function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.summaryRow}>
      <Typography variant="footnote" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography
        variant={emphasize ? 'body' : 'footnote'}
        weight={emphasize ? 'semibold' : 'medium'}
        color={emphasize ? colors.primary : colors.textPrimary}
      >
        {value}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingTop: Spacing.md,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  tagline: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  card: {
    marginBottom: Spacing.lg,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
  },
  sectionLabel: {
    letterSpacing: 0.6,
    marginBottom: Spacing.xxs,
  },
  cardTitle: {
    marginBottom: Spacing.md,
  },
  loadingRow: {
    paddingVertical: Spacing.md,
    alignItems: 'flex-start',
  },
  summaryRows: {
    gap: Spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cta: {
    marginBottom: Spacing.lg,
  },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    paddingVertical: Spacing.smd,
  },
  quickLinkIcon: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLinkText: {
    flex: 1,
  },
});
