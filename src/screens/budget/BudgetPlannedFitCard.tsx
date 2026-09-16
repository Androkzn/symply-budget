import React, { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { budgetApi, type BudgetItem, type MonthlyOverview } from '@api/budget';
import { Card, Typography } from '@components/ui';
import { useTheme } from '@contexts/ThemeContext';
import { navigateToTask } from '@services/navigation';
import { useBudgetStore } from '@stores/budgetStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';

import {
  buildAllocationSegments,
  buildPlannedFitRows,
  filterPlannedForWeek,
  isCurrentMonthView,
  planAffordability,
  plannedItemsFromOverview,
  priorityLabel,
  type AffordabilityPlanResult,
  type BudgetPriority,
} from './budgetAffordabilityChartUtils';
import {
  budgetPriorityColor as priorityColor,
  formatBudgetCurrency as formatCurrency,
} from './budgetFormat';

type FitWindow =
  | 'week'
  | 'month'
  | 'next_month'
  | 'quarter'
  | 'year'
  | 'next_year'
  | 'anytime';

interface Props {
  overview: MonthlyOverview;
  year: number;
  month: number;
  /** Opens the planned-spending edit form (wired to navigation by the screen). */
  onEditItem?: (itemId: string) => void;
}

export function BudgetPlannedFitCard({ overview, year, month, onEditItem }: Props) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const { currentHousehold } = useHouseholdStore();
  const markInsightsDirty = useBudgetStore((s) => s.markInsightsDirty);
  const [window, setWindow] = useState<FitWindow>('month');
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), [overview, year, month]);

  const plannedItems = useMemo(
    () => plannedItemsFromOverview(overview.items),
    [overview.items]
  );

  const weekAvailable = isCurrentMonthView(year, month, now);

  const monthPlan = overview.affordability;

  // The forward + quarter/year plans are computed by the backend (the client
  // only holds THIS month's items, so a cross-month fit can't be derived
  // locally). Absent against an older API response → those windows aren't offered.
  const yearPlan = overview.yearAffordability;
  const yearAvailable = !!yearPlan;
  const quarterPlan = overview.quarterAffordability;
  const quarterAvailable = !!quarterPlan;
  const nextMonthPlan = overview.nextMonthAffordability;
  const nextMonthAvailable = !!nextMonthPlan;
  const nextYearPlan = overview.nextYearAffordability;
  const nextYearAvailable = !!nextYearPlan;

  const weekPlan = useMemo(() => {
    const pool = Math.max(0, overview.remainingBudget);
    const weekItems = filterPlannedForWeek(plannedItems, now);
    return planAffordability(weekItems, pool, now);
  }, [plannedItems, overview.remainingBudget, now]);

  // "Anytime" (When possible) — the undated wishlist, ranked against the year's
  // pool (undated items aren't tied to any month). Derived locally since the
  // client already holds every undated item in `overview.items`.
  const anytimeItems = useMemo(() => plannedItems.filter((i) => !i.target_date), [plannedItems]);
  const anytimePlan = useMemo(() => {
    const pool = Math.max(0, yearPlan?.remaining_budget ?? overview.remainingBudget);
    return planAffordability(anytimeItems, pool, now);
  }, [anytimeItems, yearPlan, overview.remainingBudget, now]);
  const anytimeAvailable = anytimeItems.length > 0;

  const isAvailable: Record<FitWindow, boolean> = {
    week: weekAvailable,
    month: true,
    next_month: nextMonthAvailable,
    quarter: quarterAvailable,
    year: yearAvailable,
    next_year: nextYearAvailable,
    anytime: anytimeAvailable,
  };

  // Resolve the effective window: fall back to month whenever the requested
  // window isn't currently available (e.g. week while viewing a past month).
  const activeWindow: FitWindow = isAvailable[window] ? window : 'month';

  const planByWindow: Record<FitWindow, AffordabilityPlanResult> = {
    week: weekPlan,
    month: monthPlan,
    next_month: nextMonthPlan ?? monthPlan,
    quarter: quarterPlan ?? monthPlan,
    year: yearPlan ?? monthPlan,
    next_year: nextYearPlan ?? monthPlan,
    anytime: anytimePlan,
  };
  const plan = planByWindow[activeWindow];

  const windows: { key: FitWindow; label: string; available: boolean }[] = [
    { key: 'week', label: 'This week', available: weekAvailable },
    { key: 'month', label: 'This month', available: true },
    ...(nextMonthAvailable ? [{ key: 'next_month' as const, label: 'Next month', available: true }] : []),
    ...(quarterAvailable ? [{ key: 'quarter' as const, label: 'This quarter', available: true }] : []),
    ...(yearAvailable ? [{ key: 'year' as const, label: 'This year', available: true }] : []),
    ...(nextYearAvailable ? [{ key: 'next_year' as const, label: 'Next year', available: true }] : []),
    ...(anytimeAvailable ? [{ key: 'anytime' as const, label: 'Anytime', available: true }] : []),
  ];

  const segments = useMemo(() => buildAllocationSegments(plan), [plan]);
  const rows = useMemo(() => buildPlannedFitRows(plan), [plan]);
  const freeBudget = Math.max(0, plan.remaining_budget - plan.used_budget);
  const fitShare =
    plan.remaining_budget > 0 ? Math.round((plan.used_budget / plan.remaining_budget) * 100) : 0;

  // Full BudgetItem behind each fit row — needed to edit / duplicate / delete
  // straight from the dashboard instead of the separate Planned tab.
  const itemsById = useMemo(
    () => new Map(overview.items.map((item) => [item.id, item])),
    [overview.items]
  );

  const handleDuplicate = useCallback(
    async (item: BudgetItem) => {
      if (!currentHousehold?.id) return;
      setBusyId(item.id);
      try {
        await budgetApi.createItem(currentHousehold.id, {
          title: item.title,
          description: item.description ?? undefined,
          category_id: item.category_id ?? undefined,
          timeframe: item.timeframe,
          priority: item.priority,
          estimated_cost_min: item.estimated_cost_min ?? undefined,
          estimated_cost_max: item.estimated_cost_max ?? undefined,
          is_recurring: item.is_recurring,
          ...(item.recurrence_frequency
            ? {
                recurrence_frequency: item.recurrence_frequency as
                  | 'monthly'
                  | 'quarterly'
                  | 'yearly',
              }
            : {}),
          ...(item.target_date ? { target_date: item.target_date } : {}),
        });
        // Bumps dataRevision → the dashboard reloads the overview and this card
        // re-renders with the fresh plan.
        markInsightsDirty(currentHousehold.id);
      } catch (error) {
        console.error('Error duplicating planned spending:', error);
        Alert.alert('Error', 'Could not duplicate this planned spending.');
      } finally {
        setBusyId(null);
      }
    },
    [currentHousehold?.id, markInsightsDirty]
  );

  const confirmDelete = useCallback(
    (item: BudgetItem) => {
      if (!currentHousehold?.id) return;
      Alert.alert('Delete planned spending', `Delete "${item.title}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(item.id);
            try {
              await budgetApi.deleteItem(currentHousehold.id, item.id);
              markInsightsDirty(currentHousehold.id);
            } catch (error) {
              console.error('Error deleting budget item:', error);
              Alert.alert('Error', 'Could not delete this item.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [currentHousehold?.id, markInsightsDirty]
  );

  const canEdit = !!onEditItem;

  const openItemMenu = useCallback(
    (item: BudgetItem) => {
      const linkedTaskId =
        item.source_type === 'task' && item.source_id ? item.source_id : null;

      const actions: { label: string; run: () => void; destructive?: boolean }[] = [];
      if (linkedTaskId) {
        actions.push({ label: 'Open task', run: () => navigateToTask(linkedTaskId) });
      }
      if (canEdit) {
        actions.push({ label: 'Edit', run: () => onEditItem(item.id) });
        actions.push({
          label: 'Duplicate',
          run: () => {
            void handleDuplicate(item);
          },
        });
        actions.push({ label: 'Delete', run: () => confirmDelete(item), destructive: true });
      }

      if (actions.length === 0) return;

      const options = [...actions.map((a) => a.label), 'Cancel'];
      const cancelButtonIndex = options.length - 1;
      const destructiveButtonIndex = actions.findIndex((a) => a.destructive);

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { title: item.title, options, cancelButtonIndex, destructiveButtonIndex },
          (index) => {
            if (index >= 0 && index < actions.length) actions[index].run();
          }
        );
      } else {
        Alert.alert(item.title, undefined, [
          ...actions.map((a) => ({
            text: a.label,
            onPress: a.run,
            style: a.destructive ? ('destructive' as const) : undefined,
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ]);
      }
    },
    [canEdit, confirmDelete, handleDuplicate, onEditItem]
  );

  // Render whenever ANY offered window has something to show. Undated ("Anytime")
  // items live in `plannedItems`, so they're covered by the first check.
  const planHasItems = (p?: AffordabilityPlanResult) =>
    !!p && p.affordable.length + p.deferred.length > 0;
  if (
    plannedItems.length === 0 &&
    !planHasItems(yearPlan) &&
    !planHasItems(quarterPlan) &&
    !planHasItems(nextMonthPlan) &&
    !planHasItems(nextYearPlan)
  ) {
    return null;
  }

  return (
    <Card variant="filled" style={styles.card} testID="budget-planned-fit">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Typography variant="title3" weight="semibold">
            Planned spending fit
          </Typography>
          <Typography variant="caption1" color={colors.textSecondary}>
            High-priority items fill your remaining budget first
          </Typography>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.windowScroll}
        contentContainerStyle={styles.windowToggle}
      >
        {windows.map((w) => {
          const isActive = activeWindow === w.key;
          return (
            <TouchableOpacity
              key={w.key}
              style={[
                styles.windowChip,
                isActive && { backgroundColor: theme.pastel.teal },
                { borderColor: theme.pastel.teal },
                !w.available && styles.windowChipDisabled,
              ]}
              onPress={() => w.available && setWindow(w.key)}
              disabled={!w.available}
              testID={`budget-planned-fit-${w.key}`}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={
                  !w.available
                    ? colors.textTertiary
                    : isActive
                      ? colors.white
                      : theme.pastel.teal
                }
              >
                {w.label}
              </Typography>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <>
          <View style={styles.summaryRow}>
            <SummaryStat label="Remaining" value={formatCurrency(plan.remaining_budget)} />
            <SummaryStat
              label="Fits"
              value={formatCurrency(plan.used_budget)}
              valueColor={colors.success}
            />
            <SummaryStat label="Still free" value={formatCurrency(freeBudget)} />
          </View>

          <View style={[styles.allocationTrack, { backgroundColor: colors.borderColor }]}>
            {segments.map((segment) => (
              <View
                key={segment.id}
                style={[
                  styles.allocationSegment,
                  {
                    flex: Math.max(segment.share, 0.02),
                    backgroundColor: priorityColor(colors, segment.priority),
                  },
                ]}
                accessibilityLabel={`${segment.title} ${formatCurrency(segment.amount)}`}
              />
            ))}
            {freeBudget > 0 && (
              <View
                style={[
                  styles.allocationSegment,
                  {
                    flex: freeBudget / Math.max(plan.remaining_budget, 1),
                    backgroundColor: colors.borderColor,
                  },
                ]}
              />
            )}
          </View>

          <Typography variant="caption2" color={colors.textSecondary} style={styles.allocationCaption}>
            {fitShare}% of remaining budget allocated to planned items that fit
          </Typography>

          <View style={styles.legendRow}>
            {(['critical', 'high', 'medium', 'low'] as BudgetPriority[]).map((priority) => (
              <View key={priority} style={styles.legendItem}>
                <View
                  style={[styles.legendDot, { backgroundColor: priorityColor(colors, priority) }]}
                />
                <Typography variant="caption2" color={colors.textSecondary}>
                  {priorityLabel(priority)}
                </Typography>
              </View>
            ))}
          </View>

          {rows.length === 0 ? (
            <Typography variant="body" color={colors.textSecondary}>
              No planned items in this window.
            </Typography>
          ) : (
            <>
              {canEdit ? (
                <Typography variant="caption2" color={colors.textTertiary} style={styles.listHint}>
                  Tap an item to edit · long-press for more
                </Typography>
              ) : null}
              <View style={styles.list}>
                {rows.map((row) => {
                  const item = itemsById.get(row.id);
                  const interactive = !!item && canEdit;
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.listRow, busyId === row.id && styles.listRowBusy]}
                      activeOpacity={interactive ? 0.6 : 1}
                      disabled={!interactive || busyId === row.id}
                      onPress={interactive && item ? () => openItemMenu(item) : undefined}
                      onLongPress={interactive && item ? () => openItemMenu(item) : undefined}
                      testID="budget-planned-fit-row"
                      accessibilityRole={interactive ? 'button' : undefined}
                      accessibilityLabel={`${row.title}, ${formatCurrency(row.estimatedCost)}`}
                      accessibilityHint={
                        interactive ? 'Long press to edit, duplicate, or delete' : undefined
                      }
                    >
                      <View style={styles.listLeft}>
                        <View
                          style={[
                            styles.priorityPill,
                            {
                              backgroundColor: `${priorityColor(colors, row.priority)}22`,
                              borderColor: priorityColor(colors, row.priority),
                            },
                          ]}
                        >
                          <Typography
                            variant="caption2"
                            weight="semibold"
                            color={priorityColor(colors, row.priority)}
                          >
                            {priorityLabel(row.priority)}
                          </Typography>
                        </View>
                        <View style={styles.listText}>
                          <Typography variant="body" weight="medium" numberOfLines={1}>
                            {row.title}
                          </Typography>
                          {!!row.reason && (
                            <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
                              {row.reason}
                            </Typography>
                          )}
                        </View>
                      </View>
                      <View style={styles.listRight}>
                        <Typography variant="subheadline" weight="semibold">
                          {formatCurrency(row.estimatedCost)}
                        </Typography>
                        <Typography
                          variant="caption2"
                          weight="semibold"
                          color={row.fits ? colors.success : colors.error}
                        >
                          {row.fits ? 'Fits' : "Won't fit"}
                        </Typography>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
      </>
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.summaryStat}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="subheadline" weight="semibold" color={valueColor ?? colors.textPrimary}>
        {value}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    marginBottom: 16,
  },
  header: {
    marginBottom: 12,
  },
  headerText: {
    gap: 2,
  },
  windowScroll: {
    marginBottom: 16,
  },
  windowToggle: {
    flexDirection: 'row',
    gap: 8,
  },
  windowChip: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  windowChipDisabled: {
    opacity: 0.45,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  summaryStat: {
    flex: 1,
    gap: 2,
  },
  allocationTrack: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 999,
    overflow: 'hidden',
  },
  allocationSegment: {
    height: '100%',
    minWidth: 4,
  },
  allocationCaption: {
    marginTop: 8,
    marginBottom: 12,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  listHint: {
    marginBottom: 10,
  },
  list: {
    gap: 10,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  listRowBusy: {
    opacity: 0.5,
  },
  listLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  listText: {
    flex: 1,
    gap: 2,
  },
  priorityPill: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
    borderRadius: 9,
    borderWidth: 1,
  },
  listRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
});
