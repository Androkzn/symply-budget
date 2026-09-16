import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View, TouchableOpacity, RefreshControl, Alert } from 'react-native';

import {
  budgetApi,
  type BudgetOverview,
  type TimelineSummary,
  type TimelineItem,
} from '@api/budget';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { Typography, GradientButton } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTheme } from '@contexts/ThemeContext';
import type { BudgetStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { CornerRadius, IconSize, Layout, Opacity, Spacing, useAppColors } from '@theme';
import { resolveCategoryIcon } from '@utils/budgetCategoryIcon';

import {
  budgetPriorityColor,
  formatBudgetCurrency as formatCurrency,
  formatBudgetCurrencyRange as formatCurrencyRange,
} from './budgetFormat';
import { parseLocalYMD } from './budgetItemFormUtils';

/** Apply an alpha channel to a solid `#RRGGBB` color. */
function withAlpha(hex: string, alpha: number): string {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const r = parseInt(sanitized.substring(0, 2), 16);
  const g = parseInt(sanitized.substring(2, 4), 16);
  const b = parseInt(sanitized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface TimelineCardProps {
  summary: TimelineSummary;
  onItemPress: (item: TimelineItem) => void;
  isExpanded: boolean;
  onToggle: () => void;
}

function TimelineCard({ summary, onItemPress, isExpanded, onToggle }: TimelineCardProps) {
  const { theme } = useTheme();
  const colors = useAppColors();

  const hasItems = summary.itemCount > 0;

  return (
    <View style={[styles.timelineCard, { backgroundColor: colors.backgroundSecondary }]}>
      <TouchableOpacity
        style={styles.timelineHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        testID={`budget-timeline-section-${summary.timeframe}`}
      >
        <View style={styles.timelineHeaderLeft}>
          <Typography variant="headline" weight="semibold">
            {summary.label}
          </Typography>
          <Typography variant="footnote" color={colors.textSecondary}>
            {summary.itemCount} item{summary.itemCount !== 1 ? 's' : ''}
          </Typography>
        </View>
        <View style={styles.timelineHeaderRight}>
          <Typography variant="title3" weight="bold" color={theme.pastel.teal}>
            {formatCurrencyRange(summary.totalEstimatedMin, summary.totalEstimatedMax)}
          </Typography>
          <Icon
            name={isExpanded ? 'chevron-down' : 'chevron-forward'}
            size={Spacing.base}
            color={colors.textSecondary}
          />
        </View>
      </TouchableOpacity>

      {isExpanded && hasItems && (
        <View style={styles.timelineItems}>
          {summary.items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.itemRow, { borderTopColor: colors.borderColor }]}
              onPress={() => onItemPress(item)}
              activeOpacity={0.7}
              testID={`budget-timeline-item-${item.id}`}
            >
              <View style={[styles.priorityDot, { backgroundColor: budgetPriorityColor(colors, item.priority) }]} />
              <View style={styles.itemContent}>
                <Typography variant="body" weight="medium" numberOfLines={1}>
                  {item.title}
                </Typography>
                {item.category && (
                  <View style={styles.itemCategoryRow}>
                    <Icon
                      name={resolveCategoryIcon(item.category)}
                      size={14}
                      color={item.category.color ?? colors.textSecondary}
                    />
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {item.category.name}
                    </Typography>
                  </View>
                )}
              </View>
              <Typography variant="subheadline" weight="semibold">
                {formatCurrencyRange(item.estimatedCostMin, item.estimatedCostMax)}
              </Typography>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isExpanded && !hasItems && (
        <View style={styles.emptyItems}>
          <Typography variant="body" color={colors.textSecondary}>
            No items planned for this timeframe
          </Typography>
        </View>
      )}
    </View>
  );
}

interface CategoryBreakdownProps {
  categories: BudgetOverview['categories'];
}

function CategoryBreakdown({ categories }: CategoryBreakdownProps) {
  const colors = useAppColors();
  const { theme } = useTheme();

  const filteredCategories = categories.filter((c) => c.itemCount > 0 || c.totalSpent > 0);

  if (filteredCategories.length === 0) return null;

  return (
    <View style={[styles.categorySection, { backgroundColor: colors.backgroundSecondary }]}>
      <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
        By Category
      </Typography>
      {filteredCategories.map((cat) => (
        <View key={cat.category.id} style={styles.categoryRow}>
          <View style={styles.categoryLeft}>
            <View
              style={[
                styles.categoryIcon,
                { backgroundColor: `${cat.category.color || theme.pastel.teal}22` },
              ]}
            >
              <Icon
                name={resolveCategoryIcon(cat.category)}
                size={IconSize.md}
                color={cat.category.color || theme.pastel.teal}
              />
            </View>
            <Typography variant="body" weight="medium">
              {cat.category.name}
            </Typography>
          </View>
          <View style={styles.categoryRight}>
            <Typography variant="subheadline" weight="semibold">
              {formatCurrency(cat.totalEstimated)}
            </Typography>
            {cat.totalSpent > 0 && (
              <Typography variant="caption1" color={colors.textSecondary}>
                {formatCurrency(cat.totalSpent)} spent
              </Typography>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

export function BudgetTimelineScreen() {
  const { theme } = useTheme();
  const colors = useAppColors();
  const navigation = useNavigation<NativeStackNavigationProp<BudgetStackParamList>>();
  const { currentHousehold } = useHouseholdStore();
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedTimeframes, setExpandedTimeframes] = useState<Set<string>>(
    new Set(['immediate', '1_month', '3_months'])
  );
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentHousehold?.id) return;

    try {
      setError(null);
      const data = await budgetApi.getTimeline(currentHousehold.id);
      setOverview(data);
    } catch (err) {
      console.error('Error loading budget timeline:', err);
      setError('Failed to load budget data');
    }
  }, [currentHousehold?.id]);

  useEffect(() => {
    setIsLoading(true);
    loadData().finally(() => setIsLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    setIsRefreshing(false);
  };

  const handleSync = async () => {
    if (!currentHousehold?.id) return;

    try {
      const result = await budgetApi.syncFromTasks(currentHousehold.id);
      if (result.created > 0) {
        await loadData();
      }
    } catch (err) {
      console.error('Error syncing:', err);
    }
  };

  const toggleTimeframe = (timeframe: string) => {
    setExpandedTimeframes((prev) => {
      const next = new Set(prev);
      if (next.has(timeframe)) {
        next.delete(timeframe);
      } else {
        next.add(timeframe);
      }
      return next;
    });
  };

  const handleItemPress = (item: TimelineItem) => {
    // Show item details in alert for now. Amounts are in cents → use the cents-aware
    // formatter; targetDate is a 'YYYY-MM-DD' string → parse in local time so it
    // doesn't display a day early west of UTC.
    const amount = item.actualCost || item.estimatedCostMax || item.estimatedCostMin || 0;
    const date = item.targetDate ? parseLocalYMD(item.targetDate).toLocaleDateString() : 'No date';
    Alert.alert(
      item.title,
      `${item.description || 'No description'}\n\nAmount: ${formatCurrency(amount)}\nDate: ${date}`,
      [{ text: 'OK' }]
    );
  };

  const header = (
    <ScreenHeader
      title="Budget & Timeline"
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
    />
  );

  if (isLoading) {
    return (
      // The ScreenHeader owns the top safe-area inset itself; adding a `top`
      // edge here would double-count it and leave a gap above the header.
      <AppBackground>
        <SafeAreaView edges={[]}>
          {header}
          <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundMain }]}>
            <ActivityIndicator size="large" color={theme.pastel.teal} />
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
    <SafeAreaView edges={[]}>
      {header}
      <ScrollView
        style={[styles.container, { backgroundColor: colors.backgroundMain }]}
        contentContainerStyle={styles.content}
        testID="budget-timeline-screen"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.pastel.teal}
          />
        }
      >
        {/* Subtitle */}
        <Typography variant="body" color={colors.textSecondary} style={styles.subtitle}>
          Plan your home maintenance expenses
        </Typography>

        {/* Summary Card */}
        {overview && (
          <View style={[styles.summaryCard, { backgroundColor: theme.pastel.teal }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Typography
                  variant="caption1"
                  style={[styles.summaryLabel, { color: withAlpha(colors.white, Opacity.onColorLabel) }]}
                >
                  Total Planned
                </Typography>
                <Typography variant="title2" weight="bold" color={colors.white}>
                  {formatCurrencyRange(overview.totalPlanned.min, overview.totalPlanned.max)}
                </Typography>
              </View>
              <View
                style={[styles.summaryDivider, { backgroundColor: withAlpha(colors.white, Opacity.onColorDivider) }]}
              />
              <View style={styles.summaryItem}>
                <Typography
                  variant="caption1"
                  style={[styles.summaryLabel, { color: withAlpha(colors.white, Opacity.onColorLabel) }]}
                >
                  Total Spent
                </Typography>
                <Typography variant="title2" weight="bold" color={colors.white}>
                  {formatCurrency(overview.totalSpent)}
                </Typography>
              </View>
            </View>
          </View>
        )}

        {/* Sync Button */}
        <TouchableOpacity style={styles.syncButton} onPress={handleSync} testID="budget-timeline-sync">
          <Icon name="refresh" size={16} color={theme.pastel.teal} />
          <Typography variant="footnote" color={theme.pastel.teal}>
            Sync from Action Items
          </Typography>
        </TouchableOpacity>

        {/* Timeline Sections */}
        {overview?.timeline.map((summary) => (
          <TimelineCard
            key={summary.timeframe}
            summary={summary}
            isExpanded={expandedTimeframes.has(summary.timeframe)}
            onToggle={() => toggleTimeframe(summary.timeframe)}
            onItemPress={handleItemPress}
          />
        ))}

        {/* Category Breakdown */}
        {overview && <CategoryBreakdown categories={overview.categories} />}

        {/* Add Item Button */}
        <GradientButton
          title="Add Budget Item"
          variant="blue"
          onPress={() => navigation.navigate('BudgetItemForm')}
          style={styles.addButton}
          fullWidth
          testID="budget-timeline-add-item"
        />

        {error && (
          <View style={styles.errorContainer}>
            <Typography variant="body" color={colors.error}>
              {error}
            </Typography>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: Layout.bottomTabBarClearance,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.base,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth * 2,
    height: 40,
  },
  summaryLabel: {
    marginBottom: Spacing.xs,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    alignSelf: 'flex-end',
    marginBottom: Spacing.md,
    padding: Spacing.sm,
  },
  timelineCard: {
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.base,
  },
  timelineHeaderLeft: {
    flex: 1,
  },
  timelineHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  timelineItems: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    paddingLeft: Spacing.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  priorityDot: {
    width: Spacing.sm,
    height: Spacing.sm,
    borderRadius: Spacing.xs,
    marginRight: Spacing.md,
  },
  itemContent: {
    flex: 1,
  },
  itemCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  emptyItems: {
    padding: Spacing.base,
    alignItems: 'center',
  },
  categorySection: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.base,
    marginTop: Spacing.sm,
    marginBottom: Spacing.base,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.smd,
  },
  categoryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.smd,
  },
  categoryRight: {
    alignItems: 'flex-end',
  },
  addButton: {
    marginTop: Spacing.sm,
  },
  errorContainer: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    alignItems: 'center',
  },
});
