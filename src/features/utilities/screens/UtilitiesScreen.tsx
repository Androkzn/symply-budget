import { useRouter } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Linking } from 'react-native';

import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId } from '@components/common';
import { Typography, Card, GradientButton, IconBackgroundChip } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { utilitiesApi, type DashboardOverview, type UtilityBill, type ProviderKey } from '@features/utilities/api/utilities';
import { ProviderLogo } from '@features/utilities/components/ProviderLogo';
import { PROVIDER_META, getBillTypeIonicon, type IoniconName } from '@features/utilities/providers/bill-providers';
import { hasProviderLogo } from '@features/utilities/providers/provider-logos';
import type { UtilitiesStackScreenProps } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, Layout, Spacing, Shadow, hexToRgba, useAppColors, type AppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';
import { isHouseholdInGreaterVancouver, isPropertyAssessmentSupported } from '@utils/region-gating';

// Coerce anything the API might hand us (undefined / null / NaN) into a real,
// finite number so the dashboard never renders "$NaN" / "NaN%".
function toFinite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Format currency from cents in the user's display currency (Settings →
// Currency). Defensive against missing/NaN amounts so the dashboard never
// renders "$NaN".
function formatCurrency(cents: number | null | undefined): string {
  return formatMoney(toFinite(cents), { decimals: 2 });
}

// Format date
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Get days until due
function getDaysUntilDue(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Soft elevation shared by every tappable tile on this screen, keyed off the
// theme's shadow token so it adapts to light/dark/clean skins.
function useCardShadow(colors: AppColors) {
  return {
    backgroundColor: colors.cardBackground,
    shadowColor: colors.shadowLight,
    shadowOffset: { width: Shadow.light.offsetX, height: Shadow.light.offsetY },
    shadowOpacity: 1,
    shadowRadius: Shadow.light.radius,
    elevation: 2,
  } as const;
}

interface UpcomingBillCardProps {
  bill: UtilityBill;
  onPress: () => void;
}

function UpcomingBillCard({ bill, onPress }: UpcomingBillCardProps) {
  const colors = useAppColors();
  const cardShadow = useCardShadow(colors);
  const isPaid = bill.paid_date !== null;
  const daysUntilDue = getDaysUntilDue(bill.due_date);
  const isOverdue = !isPaid && daysUntilDue < 0;
  const isUrgent = !isPaid && daysUntilDue <= 3 && daysUntilDue >= 0;

  // The brand logo is a wordmark, so its title is redundant. Only fall back to
  // a text title (the provider or, failing that, the bill type) when we can
  // only show a generic fallback icon.
  const hasLogo = hasProviderLogo(undefined, bill.provider);
  const title = bill.provider || bill.bill_type.charAt(0).toUpperCase() + bill.bill_type.slice(1);

  return (
    <TouchableOpacity
      style={[styles.billCard, cardShadow]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.billCardHeader}>
        <View style={styles.billCardLeft}>
          <ProviderLogo
            providerName={bill.provider}
            fallbackIcon={getBillTypeIonicon(bill.bill_type)}
            size={40}
            logoWidth={84}
          />
          <View style={styles.billCardInfo}>
            {!hasLogo && (
              <Typography variant="body" weight="semibold" numberOfLines={1}>
                {title}
              </Typography>
            )}
            <Typography variant="caption1" color={isPaid ? colors.success : colors.textSecondary}>
              {isPaid ? `Paid ${formatDate(bill.paid_date!)}` : `Due ${formatDate(bill.due_date)}`}
            </Typography>
          </View>
        </View>
        <View style={styles.billCardRight}>
          <Typography variant="title3" weight="bold" color={colors.textPrimary}>
            {formatCurrency(bill.amount)}
          </Typography>
          {isOverdue && (
            <View style={[styles.statusBadge, { backgroundColor: hexToRgba(colors.error, 0.1) }]}>
              <Typography variant="caption2" weight="semibold" color={colors.error}>
                Overdue
              </Typography>
            </View>
          )}
          {isUrgent && !isOverdue && (
            <View style={[styles.statusBadge, { backgroundColor: hexToRgba(colors.warning, 0.1) }]}>
              <Typography variant="caption2" weight="semibold" color={colors.warning}>
                {daysUntilDue} day{daysUntilDue !== 1 ? 's' : ''}
              </Typography>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function TypePill({ icon, label, amount }: { icon: IoniconName; label: string; amount: number }) {
  const colors = useAppColors();
  return (
    <View style={styles.typePill}>
      <IconBackgroundChip
        name={icon}
        size={18}
        backgroundColor={hexToRgba(colors.primary, 0.08)}
        style={styles.typePillIcon}
      />
      <Typography variant="body" weight="bold" color={colors.textPrimary}>
        {formatCurrency(amount)}
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
    </View>
  );
}

interface QuickActionProps {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

function QuickAction({ icon, label, onPress, disabled, testID }: QuickActionProps) {
  const colors = useAppColors();
  const cardShadow = useCardShadow(colors);
  return (
    <TouchableOpacity
      style={[styles.actionCard, cardShadow, disabled && styles.actionCardDisabled]}
      onPress={onPress}
      testID={testID}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <IconBackgroundChip
        name={icon}
        size={24}
        color={disabled ? colors.textTertiary : colors.textPrimary}
        backgroundColor={hexToRgba(colors.primary, 0.08)}
        style={styles.actionIconCircle}
      />
      <Typography
        variant="callout"
        weight="semibold"
        color={disabled ? colors.textTertiary : colors.textPrimary}
      >
        {label}
      </Typography>
    </TouchableOpacity>
  );
}

export function UtilitiesScreen({ navigation }: UtilitiesStackScreenProps<'UtilitiesMain'>) {
  const colors = useAppColors();
  // Re-render every amount on this screen when Settings → Currency changes.
  useDisplayCurrency();
  const cardShadow = useCardShadow(colors);
  const router = useRouter();
  const { currentHousehold } = useHouseholdStore();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Providers the user has tapped OFF the "Overview" readout. Empty set = every
  // provider selected, so the Overview tile opens on the full monthly total and
  // shrinks live as providers are unselected.
  const [excludedProviders, setExcludedProviders] = useState<Set<ProviderKey>>(new Set());

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      setError(null);
      const data = await utilitiesApi.getDashboard(currentHousehold.id);
      setOverview(data);
    } catch (err) {
      console.error('Error loading utilities dashboard:', err);
      setError('Failed to load utilities data');
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  // Refetch when returning to the screen (e.g. after adding/importing bills)
  // so newly created bills show up. Skip the first focus — the mount effect
  // above already loaded — and refresh quietly in the background afterwards.
  const hasFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedRef.current) {
        hasFocusedRef.current = true;
        return;
      }
      loadData();
    }, [loadData])
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleBack = () => {
    if (router.canGoBack()) router.back();
  };

  const handleBillPress = (bill: UtilityBill) => {
    navigation.navigate('UtilityDetail', { billId: bill.id });
  };

  const handleAddBill = () => {
    navigation.navigate('AddUtilityBill');
  };

  const handleViewBills = () => {
    navigation.navigate('UtilityBills');
  };

  const handleViewPropertyTax = () => {
    navigation.navigate('PropertyTax');
  };

  // Tapping a provider tile adds/removes it from the live "Overview" sum.
  const toggleProvider = (key: ProviderKey) => {
    setExcludedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Tapping the "Overview" tile clears the filter — everything selected again.
  const resetProviderSelection = () => setExcludedProviders(new Set());

  const handlePortalPress = (url: string) => {
    Linking.openURL(url).catch((err) => console.error('Failed to open portal:', err));
  };

  // Two different gates. The municipality portal and its due dates really are
  // Greater-Vancouver-only, but property tax exists in every province — gating
  // the entry point on Vancouver hid the feature from most of the country.
  const isGva = isHouseholdInGreaterVancouver(currentHousehold);
  const canUsePropertyTax = isPropertyAssessmentSupported(currentHousehold);

  // Shared header so the title ("Utilities") shows on every state, including
  // loading / error / empty, and back always returns to where we came from.
  const header = (
    <ScreenHeader
      title="Utilities"
      showBackButton={router.canGoBack()}
      onBackPress={handleBack}
      onNotificationPress={() => router.push('/notifications')}
    />
  );

  if (isLoading) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <View style={styles.loadingContainer} testID="utilities-screen">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </AppBackground>
    );
  }

  if (error) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <View style={styles.errorContainer} testID="utilities-screen">
          <Typography variant="body" color={colors.error}>
            {error}
          </Typography>
          <GradientButton onPress={loadData} style={styles.retryButton} title="Retry" />
        </View>
      </AppBackground>
    );
  }

  if (!overview) {
    return (
      <AppBackground opacity={0.5}>
        {header}
        <View style={styles.emptyContainer} testID="utilities-screen">
          <Icon name="receipt-outline" size={56} color={colors.textTertiary} style={styles.emptyIcon} />
          <Typography variant="headline" weight="semibold" style={styles.emptyTitle}>
            No utilities yet
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.emptyText}>
            Add your first utility bill to start tracking spending
          </Typography>
          <GradientButton
            onPress={handleAddBill}
            style={styles.emptyButton}
            title="Add Bill"
            fullWidth
          />
        </View>
      </AppBackground>
    );
  }

  const total = toFinite(overview.currentMonthTotal);
  const prevTotal = toFinite(overview.prevMonthTotal);
  const change = toFinite(overview.change);
  const changePercent = toFinite(overview.changePercent);
  const isIncrease = change > 0;
  const hasComparison = total > 0 || prevTotal > 0;
  const changeColor = isIncrease ? colors.error : colors.success;
  // A month-over-month percentage is only meaningful when BOTH months have real
  // spend. With $0 this month (no bills logged yet) or $0 last month, the ratio
  // collapses to a misleading "100.0%", so we hide the % chip and let the caption
  // ("$X less than last month") carry the comparison instead.
  const showChangePercent = total > 0 && prevTotal > 0;
  // The hero summarizes the latest month with activity (the backend's single
  // source of truth), which may not be the current calendar month — so use its
  // label ("This month" / "June 2026") instead of assuming "this month".
  const periodLabel = overview.periodLabel ?? 'This month';
  const changeCaption = hasComparison
    ? `${formatCurrency(Math.abs(change))} ${isIncrease ? 'more' : 'less'} than the previous month`
    : `No bills logged for ${periodLabel.toLowerCase()} yet`;

  // The "Overview" tile is a synthetic aggregate, not a real provider — the
  // backend doesn't return a summary for it, so roll up the real providers'
  // average monthly spend here. Without this it always fell through to
  // "No bills yet" even when other providers had bills.
  //
  // It's also a LIVE readout: its "$X/mo" sums only the providers the user has
  // left selected (tap a provider tile to toggle it), defaulting to all.
  const realProviderSummaries = (overview.byProvider ?? []).filter((p) => p.providerKey !== 'overview');
  const billedProviders = realProviderSummaries.filter((p) => p.billCount > 0);
  const hasAnyProviderBills = billedProviders.length > 0;
  const selectedBilledProviders = billedProviders.filter((p) => !excludedProviders.has(p.providerKey));
  const overviewAvgMonthly = selectedBilledProviders.reduce((sum, p) => sum + toFinite(p.avgMonthlyAmount), 0);
  const selectedProviderCount = selectedBilledProviders.length;
  const allProvidersSelected = selectedProviderCount === billedProviders.length;

  return (
    <AppBackground opacity={0.5}>
      {header}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        testID="utilities-screen"
      >
        {/* This-month hero: big total + a change chip instead of three cramped columns */}
        <Card variant="elevated" style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Typography variant="caption2" weight="semibold" color={colors.textSecondary} style={styles.overline}>
              {periodLabel.toUpperCase()}
            </Typography>
            {showChangePercent && (
              <View style={[styles.changeChip, { backgroundColor: hexToRgba(changeColor, 0.1) }]}>
                <Icon name={isIncrease ? 'arrow-up' : 'arrow-down'} size={14} color={changeColor} />
                <Typography variant="caption2" weight="bold" color={changeColor}>
                  {Math.abs(changePercent).toFixed(1)}%
                </Typography>
              </View>
            )}
          </View>
          <Typography variant="largeTitle" weight="bold" color={colors.textPrimary}>
            {formatCurrency(total)}
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary} style={styles.heroCaption}>
            {changeCaption}
          </Typography>
        </Card>

        {/* Monthly breakdown by utility type (prorated) */}
        {overview.currentMonthByType && hasComparison && (
          <Card variant="elevated" style={styles.breakdownCard}>
            <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.breakdownTitle}>
              By utility
            </Typography>
            <View style={styles.typeBreakdownRow}>
              <TypePill
                icon={getBillTypeIonicon('electricity')}
                label="Electricity"
                amount={overview.currentMonthByType.electricity}
              />
              <View style={[styles.typeDivider, { backgroundColor: colors.divider }]} />
              <TypePill icon={getBillTypeIonicon('gas')} label="Gas" amount={overview.currentMonthByType.gas} />
              <View style={[styles.typeDivider, { backgroundColor: colors.divider }]} />
              <TypePill
                icon={getBillTypeIonicon('water')}
                label="Water"
                amount={overview.currentMonthByType.water}
              />
            </View>
          </Card>
        )}

        {/* Provider dashboards — tap a provider to add/remove it from the live
            "Overview" total; tap "Overview" to select everything again. */}
        <View style={styles.section}>
          <Typography variant="title3" weight="bold" color={colors.textPrimary} style={styles.sectionTitle}>
            Your utilities
          </Typography>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.providerScrollContent}
          >
            {(['overview', 'bc_hydro', 'fortisbc', 'city_of_surrey'] as ProviderKey[]).map((key) => {
              const meta = PROVIDER_META[key];
              const isOverview = key === 'overview';
              const summary = isOverview ? undefined : overview.byProvider?.find((p) => p.providerKey === key);
              const hasBills = isOverview ? hasAnyProviderBills : !!summary && summary.billCount > 0;
              // Overview shows the live sum of the selected providers; the rest
              // show their own average and toggle their membership in that sum.
              const isSelected = isOverview ? allProvidersSelected : hasBills && !excludedProviders.has(key);
              const monthlyLabel = isOverview
                ? `${formatCurrency(overviewAvgMonthly)}/mo`
                : summary
                ? `${formatCurrency(summary.avgMonthlyAmount)}/mo`
                : '';
              // Brand logos are wordmarks — they already name the service, so
              // only show the text label when we fall back to a generic icon.
              const hasLogo = hasProviderLogo(key);
              // The Overview tile only takes on the "active" border once the user
              // has filtered (a partial selection), to flag that its total is a
              // subset. Provider tiles show the border whenever they're selected.
              const showActiveBorder = isOverview ? hasBills && !allProvidersSelected : isSelected;
              const isDimmed = !isOverview && hasBills && !isSelected;
              const onPress = !hasBills
                ? undefined
                : isOverview
                ? resetProviderSelection
                : () => toggleProvider(key);
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.providerCard,
                    cardShadow,
                    showActiveBorder && { borderColor: colors.primary },
                    isDimmed && styles.providerCardDimmed,
                  ]}
                  onPress={onPress}
                  disabled={!onPress}
                  activeOpacity={0.8}
                  testID={`utilities-provider-${key}`}
                >
                  {/* Selection tick — real providers with bills only. */}
                  {!isOverview && hasBills && (
                    <View
                      style={[
                        styles.providerCheck,
                        { borderColor: isSelected ? colors.primary : colors.borderColor },
                        isSelected && { backgroundColor: colors.primary },
                      ]}
                    >
                      {isSelected && <Icon name="checkmark" size={12} color={colors.white} />}
                    </View>
                  )}
                  <ProviderLogo providerKey={key} fallbackIcon={meta.ionicon} size={48} logoWidth={108} />
                  {!hasLogo && (
                    <Typography variant="callout" weight="semibold" color={colors.textPrimary} numberOfLines={1}>
                      {meta.label}
                    </Typography>
                  )}
                  <Typography variant="caption1" weight="semibold" color={hasBills ? colors.primary : colors.textTertiary}>
                    {hasBills ? monthlyLabel : 'No bills yet'}
                  </Typography>
                  {isOverview && hasBills && !allProvidersSelected && (
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {selectedProviderCount} of {billedProviders.length} selected
                    </Typography>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* AI / rule-based insights */}
        {overview.insights && overview.insights.length > 0 && (
          <View style={styles.section}>
            <Typography variant="title3" weight="bold" color={colors.textPrimary} style={styles.sectionTitle}>
              Insights
            </Typography>
            {overview.insights.slice(0, 3).map((insight) => (
              <Card key={insight.id} variant="elevated" style={styles.insightCard}>
                <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                  {insight.title}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {insight.body}
                </Typography>
              </Card>
            ))}
          </View>
        )}

        {/* Upcoming Payments */}
        {overview.upcomingBills && overview.upcomingBills.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Typography variant="title3" weight="bold" color={colors.textPrimary}>
                Upcoming payments
              </Typography>
              <TouchableOpacity onPress={handleViewBills}>
                <Typography variant="callout" weight="semibold" color={colors.primary}>
                  View all
                </Typography>
              </TouchableOpacity>
            </View>
            {overview.upcomingBills.map((bill) => (
              <UpcomingBillCard key={bill.id} bill={bill} onPress={() => handleBillPress(bill)} />
            ))}
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.section}>
          <Typography variant="title3" weight="bold" color={colors.textPrimary} style={styles.sectionTitle}>
            Quick actions
          </Typography>
          <View style={styles.actionsGrid}>
            <QuickAction
              icon="camera-outline"
              label="Add Bills"
              onPress={handleAddBill}
              testID="utilities-action-scan-bill"
            />
            <QuickAction
              icon="receipt-outline"
              label="View Bills"
              onPress={handleViewBills}
              testID="utilities-action-view-bills"
            />
            <QuickAction
              icon="business-outline"
              label="Property Tax"
              onPress={handleViewPropertyTax}
              disabled={!canUsePropertyTax}
              testID="utilities-action-property-tax"
            />
            <QuickAction
              icon="stats-chart-outline"
              label="Analytics"
              onPress={() => navigation.navigate('UtilityCharts')}
              testID="utilities-action-analytics"
            />
          </View>
        </View>

        {/* Municipality Portal Links */}
        {isGva && overview.municipality && (
          <Card variant="elevated" style={styles.portalCard}>
            <Typography variant="callout" weight="semibold" color={colors.textPrimary} style={styles.portalTitle}>
              {overview.municipality.municipality_name} Portal
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary} style={styles.portalText}>
              Pay property taxes and utilities online
            </Typography>
            {overview.municipality.portal_url && (
              <GradientButton
                onPress={() => handlePortalPress(overview.municipality!.portal_url!)}
                style={styles.portalButton}
                title="Open Portal"
                fullWidth
              />
            )}
          </Card>
        )}
        <ScreenScrollEnd testID={screenScrollEndTestId('utilities-screen')} />
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  retryButton: {
    marginTop: Spacing.base,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyIcon: {
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    marginBottom: Spacing.sm,
  },
  emptyText: {
    marginBottom: Spacing.xl,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: Spacing.sm,
  },
  heroCard: {
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overline: {
    letterSpacing: 1,
  },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
  },
  heroCaption: {
    marginTop: Spacing.xxs,
  },
  breakdownCard: {
    padding: Spacing.base,
    marginBottom: Spacing.lg,
  },
  breakdownTitle: {
    marginBottom: Spacing.md,
  },
  typeBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: Spacing.xs,
  },
  typePill: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  typePillIcon: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  billCard: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.md,
  },
  billCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  billCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  billCardInfo: {
    flex: 1,
  },
  billCardRight: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  actionCard: {
    width: '47%',
    flexGrow: 1,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  actionCardDisabled: {
    opacity: 0.55,
  },
  actionIconCircle: {
    width: 52,
    height: 52,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerScrollContent: {
    gap: Spacing.md,
    paddingRight: Spacing.base,
  },
  providerCard: {
    width: 140,
    minHeight: 132,
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    justifyContent: 'center',
    gap: Spacing.sm,
    // Transparent by default so toggling the selected border never shifts layout.
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  providerCardDimmed: {
    opacity: 0.5,
  },
  providerCheck: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: 20,
    height: 20,
    borderRadius: CornerRadius.full,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  insightCard: {
    padding: Spacing.base,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  portalCard: {
    padding: Spacing.lg,
  },
  portalTitle: {
    marginBottom: Spacing.xs,
  },
  portalText: {
    marginBottom: Spacing.base,
  },
  portalButton: {
    marginTop: Spacing.sm,
  },
});
