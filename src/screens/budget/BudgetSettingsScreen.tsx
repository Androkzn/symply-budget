import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRouter } from 'expo-router';
import { useFocusEffect, useNavigation } from 'expo-router/react-navigation';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { budgetApi } from '@api/budget';
import { useAIAccessEntry } from '@components/ai/useAIAccessEntry';
import { AppBackground, SafeAreaView, ScreenHeader, screenScrollViewStyle } from '@components/common';
import { Card, IconBackgroundChip, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { resolveCurrency } from '@config/currencies';
import { formatRegionLabel } from '@config/regions';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import type { BudgetStackParamList } from '@navigation/types';
import { useAppStore } from '@stores/appStore';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';


import { formatBudgetCurrency } from './budgetFormat';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Stable identity, so the "not this household's caps" branch does not re-render. */
const NO_CAPS: Record<number, number | null> = {};

export function BudgetSettingsScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  // For the two destinations that are root expo-router routes rather than
  // screens in this stack: the AI-access hub and Symply apps.
  const router = useRouter();
  const { currentHousehold } = useHouseholdStore();
  const { selectedYear } = useBudgetStore();
  const currency = useAppStore((state) => state.currency);
  const taxCountry = useAppStore((state) => state.taxCountry);
  const taxRegion = useAppStore((state) => state.taxRegion);
  // Shared AI-access entry — identical gate, destination, and copy for every
  // brand (see @components/ai/useAIAccessEntry). Never re-derive this per brand.
  const aiEntry = useAIAccessEntry();

  // planned_budget (cents) per month for selectedYear — null means "not set yet".
  // Kept here only to summarise the year on the Monthly Budget row; the editor
  // itself lives on BudgetMonthlyCapsScreen.
  //
  // Held WITH the household it was fetched for. The summary reads "8 of 12
  // months set · $42,000 planned for 2026", which states a plan as fact — carry
  // it across a household switch and Settings quietly attributes one budget's
  // year to another. Pairing it with the id lets a switch blank it in the same
  // render, while a plain refocus (returning from the caps editor) keeps showing
  // the numbers instead of flashing the empty summary.
  const [caps, setCaps] = useState<{
    householdId: string | null;
    byMonth: Record<number, number | null>;
  }>({ householdId: null, byMonth: NO_CAPS });
  const [isLoading, setIsLoading] = useState(true);

  const fetchMonthlyBudgets = useCallback(
    async (householdId: string) => {
      const results = await Promise.all(
        MONTHS.map((month) =>
          budgetApi
            .getMonthlyGoal(householdId, selectedYear, month)
            .then((res) => [month, res.goal.planned_budget] as const)
            .catch(() => [month, null] as const)
        )
      );
      return Object.fromEntries(results) as Record<number, number | null>;
    },
    [selectedYear]
  );

  // `currentHousehold` follows the engine's active household — `ensureSession`
  // republishes the store the moment the engine switches — so keying the load on
  // its id is what makes a switch refetch the caps rather than keep the previous
  // household's on screen. The local facades throw on a household mismatch, so
  // without it every row would silently resolve to `null` anyway, just slower
  // and without saying why.
  const householdId = currentHousehold?.id ?? null;

  const load = useCallback(async () => {
    if (!householdId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const byMonth = await fetchMonthlyBudgets(householdId);
      // Stamped with the household it was fetched FOR, not with whatever is
      // current when it lands: a switch mid-fetch must not file one household's
      // caps under the other's id.
      setCaps({ householdId, byMonth });
    } catch (error) {
      console.error('Error loading budget settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchMonthlyBudgets, householdId]);

  // Re-read whenever the screen regains focus, so a cap saved on the Monthly
  // Budget screen is reflected on the row that led there — and whenever the
  // active household changes underneath an already-focused screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Only the caps that belong to the household on screen. A mismatch means a
  // switch has happened and this household's answer has not landed yet, which
  // reads as "not loaded", never as "nothing is set".
  const capsAreCurrent = caps.householdId === householdId;
  const monthlyBudgets = capsAreCurrent ? caps.byMonth : NO_CAPS;

  const setCount = useMemo(
    () => MONTHS.filter((m) => monthlyBudgets[m] != null).length,
    [monthlyBudgets]
  );

  // Sum of every month that has a cap set — the year's planned spend so far.
  const annualTotalCents = useMemo(
    () => MONTHS.reduce((sum, m) => sum + (monthlyBudgets[m] ?? 0), 0),
    [monthlyBudgets]
  );

  // Single string (one Text child) so the summary reads as one line and stays
  // easy to assert on. Only surface the annual total once something is set.
  const summaryText =
    isLoading || !capsAreCurrent
      ? 'Set a spending cap for each month'
      : setCount > 0
        ? `${setCount} of 12 months set · ${formatBudgetCurrency(annualTotalCents)} planned for ${selectedYear}`
        : `${setCount} of 12 months set`;

  return (
    <AppBackground>
    <SafeAreaView edges={[]} testID="budget-settings-screen">
      <ScreenHeader
        // "Settings", not "Budget Settings": this is the app's ONE settings
        // screen now. The More tab kept only the overflow tabs when Preferences,
        // AI, Notifications, Data sharing and Symply apps moved here, so a title
        // that scopes itself to the budget would undersell what it holds.
        title="Settings"
        showBackButton
        onBackPress={() => {
          if (navigation.canGoBack()) {
            navigation.goBack();
            return;
          }
          navigation.navigate('BudgetMain');
        }}
        showNotificationBell={false}
        showAvatar={false}
        showPropertySwitcher={false}
      />

      <ScrollView {...keyboardDismissScrollProps} style={[screenScrollViewStyle.scroll, styles.flex]} contentContainerStyle={styles.content}>
        {/* SYNC & SHARING used to open this screen — Device Sync, Backup &
            Restore, Households, Invite & Household and Export. It lives on
            Profile now (`@features/budget/components/BudgetSyncSharingSection`):
            those five answer "which copies of this budget exist and who holds
            them", which is an account-and-device question, while everything
            left here shapes the budget itself. Do not re-add them alongside
            MANAGE BUDGET — one section, one home. */}

        {/* Everything that shapes the budget itself, under one heading — the
            month caps open the section and set the ceiling, the rows beneath
            them decide how it is split and where the leftover goes. */}
        <Typography
          variant="caption1"
          weight="semibold"
          style={[styles.groupLabel, styles.groupLabelTight]}
          testID="budget-settings-manage-section"
        >
          MANAGE BUDGET
        </Typography>

        {/* The caps themselves live on their own screen — Settings opened onto a
            wall of twelve months, which pushed every row that actually routes
            somewhere below the fold. Same summary line, now as this row's
            subtitle. */}
        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('BudgetMonthlyCaps')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Monthly budget"
          testID="budget-settings-monthly-caps-link"
        >
          <IconBackgroundChip name="calendar-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Monthly Budget
            </Typography>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="budget-settings-summary"
            >
              {summaryText}
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />


        {/* Move this month's leftover budget forward or into savings. */}
        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('BudgetTransfer')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Budget transfer"
          testID="budget-settings-transfer-link"
        >
          <IconBackgroundChip name="swap-horizontal-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Budget Transfer
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Move leftover to next month, a savings goal, or TFSA/RRSP
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        {/* Spending Categories used to sit here as "Categories". It is under
            PREFERENCES now: the rows in this group each set a NUMBER (the month
            ceiling, a transfer, a per-category cap), while the category list is
            the vocabulary the whole app records spending in — a preference, like
            the currency it records it in. One row, one home: do not re-add it
            here. */}

        {/* Per-category caps within the monthly budget (e.g. Groceries, Alcohol,
            Coffee), as a dollar amount or a percent of the total. */}
        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('BudgetSubBudgets')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Sub-budgets"
          testID="budget-settings-sub-budgets-link"
        >
          <IconBackgroundChip name="pie-chart-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Sub-budgets
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Cap categories by amount or % of the total
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        {/* Secondary navigation links, kept at the bottom so the month grid and
            manage cards stay the focus of the screen. Everything that moves data
            in or out of Budget sits under one heading, the way MANAGE BUDGET
            gathers the rows that shape it. */}
        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        <Typography
          variant="caption1"
          weight="semibold"
          style={[styles.groupLabel, styles.groupLabelTight]}
          testID="budget-settings-sharing-section"
        >
          SHARING
        </Typography>

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('SoftTransferImport')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Import a shared summary"
          testID="budget-settings-soft-transfer-link"
        >
          <IconBackgroundChip name="home-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Import a shared summary
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Bring in a property summary or profile basics
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('SoftTransferExport')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Share a summary"
          testID="budget-settings-soft-transfer-export-link"
        >
          <IconBackgroundChip name="share-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Share a summary
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              {isBudgetLocalFirst()
                ? 'Send a high-level summary to Symply House'
                : 'Export a high-level budget summary'}
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('DataSharing')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Data sharing"
          testID="budget-settings-data-sharing-link"
        >
          <IconBackgroundChip name="shield-checkmark-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Data sharing
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              View or revoke active House ↔ Budget permissions
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        {/* The long-term plan, previous years and compare-years links used to
            close this section as three bare text links. They are on the MORE
            tab now, under INSIGHTS (`@screens/main/SettingsScreen`): none of
            them configures anything — they only READ the budget over a longer
            horizon — so they never belonged among the rows that shape it. */}

        {/* PREFERENCES, AI, NOTIFICATIONS and MORE SYMPLY APPS all moved here
            off the More tab. More is the overflow-tabs hub and nothing else
            now, so this is the app's one settings screen — which is why the
            header above says "Settings" rather than "Budget Settings".
            Everything above shapes the budget; everything below shapes the app
            around it. */}
        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        <Typography
          variant="caption1"
          weight="semibold"
          style={[styles.groupLabel, styles.groupLabelTight]}
          testID="budget-settings-preferences-section"
        >
          PREFERENCES
        </Typography>

        {/* The household's spending vocabulary: add custom categories with an
            icon and colour, edit or delete them, and switch built-ins on or off.
            First in the group because it is the one preference that is about
            the budget rather than about the app around it. The testID predates
            the move (unit test + Maestro deep-link flows key on it). */}
        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('BudgetCategories')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Spending categories"
          testID="budget-settings-categories-link"
        >
          <IconBackgroundChip name="pricetags-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Spending Categories
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Add your own with an icon and colour, edit or delete them
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('Appearance')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Appearance"
          testID="budget-settings-appearance-link"
        >
          <IconBackgroundChip name="color-palette-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Appearance
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Dark mode, theme settings
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('Currency')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Currency"
          testID="budget-settings-currency-link"
        >
          <IconBackgroundChip name="cash-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Currency
            </Typography>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="budget-settings-currency-status"
            >
              {`${resolveCurrency(currency).label} (${currency})`}
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={styles.navRowSpacer} />

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('Region')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Region"
          testID="budget-settings-region-link"
        >
          <IconBackgroundChip name="location-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Region
            </Typography>
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="budget-settings-region-status"
            >
              {formatRegionLabel(taxCountry, taxRegion) ?? 'Set for accurate receipt sales tax'}
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        {/* AI — the SAME shared entry every brand shows, from the same hook
            (@components/ai/useAIAccessEntry). With a key connected it reads
            "Manage AI access", otherwise "AI assistance"; never re-derive it
            here. Hidden entirely when the hook says the brand has no AI. */}
        {aiEntry.show ? (
          <>
            <View style={[styles.divider, { backgroundColor: colors.divider }]} />

            <Typography
              variant="caption1"
              weight="semibold"
              style={[styles.groupLabel, styles.groupLabelTight]}
              testID="budget-settings-ai-section"
            >
              AI
            </Typography>

            <Card
              variant="filled"
              pressable
              onPress={() => router.push(aiEntry.route)}
              style={styles.navRow}
              accessibilityRole="button"
              accessibilityLabel={aiEntry.title}
              testID="budget-settings-ai-link"
            >
              <IconBackgroundChip name={aiEntry.icon} style={styles.navRowIcon} />
              <View style={styles.navRowText}>
                <Typography variant="body" weight="medium">
                  {aiEntry.title}
                </Typography>
                <Typography variant="footnote" color={colors.textSecondary}>
                  {aiEntry.subtitle}
                </Typography>
              </View>
              <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
            </Card>
          </>
        ) : null}

        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        <Typography
          variant="caption1"
          weight="semibold"
          style={[styles.groupLabel, styles.groupLabelTight]}
          testID="budget-settings-notifications-section"
        >
          NOTIFICATIONS
        </Typography>

        <Card
          variant="filled"
          pressable
          onPress={() => navigation.navigate('NotificationSettings')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Notification settings"
          testID="budget-settings-notification-settings-link"
        >
          <IconBackgroundChip name="notifications-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Notification Settings
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Manage push and email notifications
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        <View style={[styles.divider, { backgroundColor: colors.divider }]} />

        <Typography
          variant="caption1"
          weight="semibold"
          style={[styles.groupLabel, styles.groupLabelTight]}
          testID="budget-settings-symply-apps-section"
        >
          MORE SYMPLY APPS
        </Typography>

        {/* A root expo-router route, not a stack screen — `/symply-apps` is
            shared by every brand and sits above the tabs. */}
        <Card
          variant="filled"
          pressable
          onPress={() => router.push('/symply-apps')}
          style={styles.navRow}
          accessibilityRole="button"
          accessibilityLabel="Symply apps"
          testID="budget-settings-symply-apps-link"
        >
          <IconBackgroundChip name="apps-outline" style={styles.navRowIcon} />
          <View style={styles.navRowText}>
            <Typography variant="body" weight="medium">
              Symply apps
            </Typography>
            <Typography variant="footnote" color={colors.textSecondary}>
              Install the rest of the family and share your profile
            </Typography>
          </View>
          <Icon name="chevron-forward" size={IconSize.md} color={colors.textTertiary} />
        </Card>

        {/* The danger zone now lives on Device Sync, next to the trusted-device
            list that says who else still holds a copy — erasing this phone's
            ledger is a sync decision, not a settings footnote. */}
      </ScrollView>
    </SafeAreaView>

    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Extra clearance so Device sync actions clear the tab bar + chat FAB.
  content: { padding: 16, paddingBottom: Layout.bottomTabBarClearance + 48 },
  groupLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.xxs,
    letterSpacing: 0.8,
    opacity: 0.6,
  },
  // A group label that already sits under a divider (or opens the scroll view)
  // needs no top margin of its own.
  groupLabelTight: { marginTop: 0 },
  groupHint: {
    marginBottom: Spacing.sm,
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.xl },
  // Card owns the surface + radius; this just lays the row out and tightens the
  // default card padding a touch vertically.
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.base,
    gap: Spacing.smd,
  },
  navRowIcon: {
    width: Spacing.xxl,
    height: Spacing.xxl,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowText: { flex: 1 },
  navRowSpacer: { height: Spacing.sm },
});
