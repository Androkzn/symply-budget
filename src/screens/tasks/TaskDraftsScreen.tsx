import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp } from 'expo-router/react-navigation';
import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { taskDraftsApi, TaskDraft } from '@api/task-drafts';
import { AppBackground, ScreenFooterGlass, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, screenScrollViewStyle } from '@components/common';
import { Typography, FilterTabs, SearchBar, StatusBadge } from '@components/ui';
import type { FilterTab, StatusBadgeVariant } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { TasksStackParamList } from '@navigation/types';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useTaskDraftStore } from '@stores/taskDraftStore';
import { GradientButton as GradientButtonSizes, useAppColors } from '@theme';
import { formatMoney, useDisplayCurrency } from '@utils/money';

type TaskDraftsRouteProp = RouteProp<TasksStackParamList, 'TaskDrafts'>;
type TaskDraftsNavigationProp = NativeStackNavigationProp<TasksStackParamList, 'TaskDrafts'>;

type SeverityFilter = 'all' | 'critical' | 'major' | 'minor' | 'informational';

// Severity colors, derived from semantic design tokens.
type AppColors = ReturnType<typeof useAppColors>;
function getSeverityColors(colors: AppColors): Record<string, string> {
  return {
    critical: colors.error,
    major: colors.warning,
    minor: colors.warning,
    informational: colors.info,
  };
}

// Category icons
const CATEGORY_ICONS: Record<string, string> = {
  roof: 'home-outline',
  foundation: 'layers-outline',
  electrical: 'flash-outline',
  plumbing: 'water-outline',
  hvac: 'thermometer-outline',
  exterior: 'business-outline',
  interior: 'grid-outline',
  safety: 'shield-checkmark-outline',
  appliances: 'cube-outline',
  drainage: 'rainy-outline',
  attic: 'arrow-up-circle-outline',
  basement: 'arrow-down-circle-outline',
  garage: 'car-outline',
  insulation: 'layers-outline',
  windows_doors: 'apps-outline',
  structure: 'construct-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

// Format cost in the user's display currency
function formatCost(cents: number | null): string {
  if (!cents) return 'N/A';
  return formatMoney(cents);
}

// Format cost range
function formatCostRange(min: number | null, max: number | null): string {
  if (!min && !max) return 'Cost TBD';
  if (min && max) return `${formatCost(min)} - ${formatCost(max)}`;
  return formatCost(min || max);
}

// Get status badge variant from severity
function getSeverityBadgeVariant(severity: string): StatusBadgeVariant {
  switch (severity) {
    case 'critical':
      return 'overdue';
    case 'major':
      return 'soon';
    case 'minor':
      return 'today';
    default:
      return 'complete';
  }
}

export function TaskDraftsScreen() {
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const colors = useAppColors();
  const navigation = useNavigation<TaskDraftsNavigationProp>();
  const route = useRoute<TaskDraftsRouteProp>();
  const params = route.params || {};
  const insets = useSafeAreaInsets();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  // Consistent layout padding
  const { content: containerPadding } = useLayoutPadding();

  const {
    drafts,
    summary,
    filters,
    groupBy,
    selectedDraftIds,
    isLoading,
    isConverting,
    setDrafts,
    setSummary,
    setGroupBy,
    toggleDraftSelection,
    selectBySeverity,
    clearSelection,
    setLoading,
    setConverting,
  } = useTaskDraftStore();

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Fetch drafts
  const fetchDrafts = useCallback(async () => {
    if (!currentHousehold?.id) return;

    setLoading(true);
    try {
      const [draftsResponse, summaryResponse] = await Promise.all([
        taskDraftsApi.list(currentHousehold.id, {
          ...filters,
          report_id: params.reportId,
          severity: severityFilter === 'all' ? undefined : severityFilter,
        }),
        taskDraftsApi.getSummary(currentHousehold.id, params.reportId),
      ]);

      setDrafts(draftsResponse.drafts, draftsResponse.total);
      setSummary(summaryResponse);
    } catch (error) {
      console.error('Failed to fetch task drafts:', error);
      showToast('error', 'Failed to load task drafts');
    } finally {
      setLoading(false);
    }
  }, [currentHousehold?.id, filters, params.reportId, severityFilter]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDrafts();
    setRefreshing(false);
  }, [fetchDrafts]);

  // Handle draft press
  const handleDraftPress = useCallback(
    (draft: TaskDraft) => {
      navigation.navigate('TaskDraftDetail', { draftId: draft.id });
    },
    [navigation]
  );

  // Handle convert
  const handleConvert = useCallback(
    async (draft: TaskDraft) => {
      if (!currentHousehold?.id) return;

      setConverting(true);
      try {
        await taskDraftsApi.convert(currentHousehold.id, draft.id, {});
        showToast('success', 'Task created successfully');
        fetchDrafts();
      } catch (error) {
        console.error('Failed to convert draft:', error);
        showToast('error', 'Failed to create task');
      } finally {
        setConverting(false);
      }
    },
    [currentHousehold?.id, fetchDrafts]
  );

  // Handle bulk convert
  const handleBulkConvert = useCallback(async () => {
    if (!currentHousehold?.id || selectedDraftIds.length === 0) return;

    setConverting(true);
    try {
      const result = await taskDraftsApi.bulkConvert(currentHousehold.id, {
        draft_ids: selectedDraftIds,
      });

      if (result.success > 0) {
        showToast('success', `Created ${result.success} task${result.success > 1 ? 's' : ''}`);
      }
      if (result.failed > 0) {
        showToast('info', `${result.failed} task${result.failed > 1 ? 's' : ''} failed to create`);
      }

      clearSelection();
      fetchDrafts();
    } catch (error) {
      console.error('Failed to bulk convert:', error);
      showToast('error', 'Failed to create tasks');
    } finally {
      setConverting(false);
    }
  }, [currentHousehold?.id, selectedDraftIds, fetchDrafts, clearSelection]);

  // Filter tabs
  const filterTabs: FilterTab[] = useMemo(
    () => [
      { id: 'all', label: 'All', count: summary?.total || 0 },
      { id: 'critical', label: 'Critical', count: summary?.by_severity.critical || 0 },
      { id: 'major', label: 'Major', count: summary?.by_severity.major || 0 },
      { id: 'minor', label: 'Minor', count: summary?.by_severity.minor || 0 },
    ],
    [summary]
  );

  // Filtered drafts
  const filteredDrafts = useMemo(() => {
    let result = drafts;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(query) ||
          d.description?.toLowerCase().includes(query) ||
          d.system_category.toLowerCase().includes(query)
      );
    }

    return result;
  }, [drafts, searchQuery]);

  // Grouped drafts
  const groupedDrafts = useMemo(() => {
    if (groupBy === 'none') {
      return { all: filteredDrafts };
    }

    if (groupBy === 'severity') {
      const groups: Record<string, TaskDraft[]> = {
        critical: [],
        major: [],
        minor: [],
        informational: [],
      };
      for (const draft of filteredDrafts) {
        groups[draft.severity]?.push(draft);
      }
      return groups;
    }

    if (groupBy === 'category') {
      const groups: Record<string, TaskDraft[]> = {};
      for (const draft of filteredDrafts) {
        if (!groups[draft.system_category]) {
          groups[draft.system_category] = [];
        }
        groups[draft.system_category].push(draft);
      }
      return groups;
    }

    return { all: filteredDrafts };
  }, [filteredDrafts, groupBy]);

  // Render draft card
  const renderDraftCard = useCallback(
    (draft: TaskDraft) => {
      const isSelected = selectedDraftIds.includes(draft.id);
      const severityColors = getSeverityColors(colors);
      const severityColor = severityColors[draft.severity] || colors.textSecondary;
      const categoryIcon = CATEGORY_ICONS[draft.system_category] || 'help-circle-outline';

      return (
        <TouchableOpacity
          key={draft.id}
          style={[
            styles.draftCard,
            {
              backgroundColor: colors.card,
              borderColor: isSelected ? colors.primary : 'transparent',
              borderWidth: isSelected ? 2 : 0,
            },
          ]}
          onPress={() => handleDraftPress(draft)}
          onLongPress={() => toggleDraftSelection(draft.id)}
          activeOpacity={0.7}
        >
          {/* Severity indicator */}
          <View style={[styles.severityIndicator, { backgroundColor: severityColor }]} />

          <View style={styles.draftContent}>
            {/* Header */}
            <View style={styles.draftHeader}>
              <View style={styles.categoryBadge}>
                <Icon name={categoryIcon as any} size={14} color={colors.textSecondary} />
                <Typography variant="caption1" color="secondary" style={styles.categoryText}>
                  {draft.system_category.replace('_', ' ')}
                </Typography>
              </View>
              <StatusBadge
                variant={getSeverityBadgeVariant(draft.severity)}
                label={draft.severity.toUpperCase()}
              />
            </View>

            {/* Title */}
            <Typography variant="headline" numberOfLines={2} style={styles.draftTitle}>
              {draft.title}
            </Typography>

            {/* Description */}
            {draft.plain_language_summary && (
              <Typography variant="footnote" color="secondary" numberOfLines={2} style={styles.draftDescription}>
                {draft.plain_language_summary}
              </Typography>
            )}

            {/* Footer */}
            <View style={styles.draftFooter}>
              <View style={styles.costBadge}>
                <Typography variant="caption1" color="secondary">
                  {formatCostRange(draft.estimated_cost_min, draft.estimated_cost_max)}
                </Typography>
              </View>

              {draft.diy_possible && (
                <View style={[styles.diyBadge, { backgroundColor: colors.primary + '20' }]}>
                  <Icon name="hammer-outline" size={12} color={colors.primary} />
                  <Typography variant="caption2" color={colors.primary} style={styles.diyText}>
                    DIY
                  </Typography>
                </View>
              )}

              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: colors.primary }]}
                onPress={() => handleConvert(draft)}
                disabled={isConverting}
              >
                <Icon name="add" size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [colors, selectedDraftIds, isConverting, handleDraftPress, handleConvert, toggleDraftSelection]
  );

  // Render group section
  const renderGroupSection = useCallback(
    (groupKey: string, groupDrafts: TaskDraft[]) => {
      if (groupDrafts.length === 0) return null;

      const groupLabel =
        groupBy === 'severity'
          ? groupKey.charAt(0).toUpperCase() + groupKey.slice(1)
          : groupBy === 'category'
          ? groupKey.replace('_', ' ').toUpperCase()
          : null;

      return (
        <View key={groupKey} style={styles.groupSection}>
          {groupLabel && (
            <View style={styles.groupHeader}>
              <Typography variant="subheadline" weight="semibold">
                {groupLabel}
              </Typography>
              <Typography variant="caption1" color="secondary">
                {groupDrafts.length} issue{groupDrafts.length !== 1 ? 's' : ''}
              </Typography>
            </View>
          )}
          <View style={styles.draftsList}>
            {groupDrafts.map(renderDraftCard)}
          </View>
        </View>
      );
    },
    [groupBy, renderDraftCard]
  );

  return (
    <AppBackground>
      <View style={styles.container} testID="task-drafts-screen">
        {/* Header */}
        <ScreenHeader
        title="Task Drafts"
        showBackButton
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
      />

        {/* Summary Stats */}
        {summary && (
          <View style={[styles.summaryContainer, { paddingHorizontal: containerPadding }]}>
            <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
              <Typography variant="largeTitle" weight="bold">
                {summary.total}
              </Typography>
              <Typography variant="caption1" color="secondary">
                Issues Found
              </Typography>
            </View>
            <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
              <Typography variant="largeTitle" weight="bold">
                {formatCostRange(summary.total_cost_min, summary.total_cost_max)}
              </Typography>
              <Typography variant="caption1" color="secondary">
                Est. Total Cost
              </Typography>
            </View>
          </View>
        )}

        {/* Filters */}
        <View style={[styles.filtersContainer, { paddingHorizontal: containerPadding }]}>
          <FilterTabs
            tabs={filterTabs}
            activeTab={severityFilter}
            onTabChange={(tab) => setSeverityFilter(tab as SeverityFilter)}
          />

          {/* Group By Toggle */}
          <View style={styles.groupByContainer}>
            <Typography variant="caption1" color="secondary" style={styles.groupByLabel}>
              Group:
            </Typography>
            <TouchableOpacity
              style={[
                styles.groupByButton,
                groupBy === 'none' && { backgroundColor: colors.primary + '20' },
              ]}
              onPress={() => setGroupBy('none')}
            >
              <Typography
                variant="caption2"
                color={groupBy === 'none' ? colors.primary : colors.textSecondary}
              >
                None
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.groupByButton,
                groupBy === 'severity' && { backgroundColor: colors.primary + '20' },
              ]}
              onPress={() => setGroupBy('severity')}
            >
              <Typography
                variant="caption2"
                color={groupBy === 'severity' ? colors.primary : colors.textSecondary}
              >
                Severity
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.groupByButton,
                groupBy === 'category' && { backgroundColor: colors.primary + '20' },
              ]}
              onPress={() => setGroupBy('category')}
            >
              <Typography
                variant="caption2"
                color={groupBy === 'category' ? colors.primary : colors.textSecondary}
              >
                Category
              </Typography>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchContainer, { paddingHorizontal: containerPadding }]}>
          <SearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search issues..."
          />
        </View>

        {/* Selected Actions */}
        {selectedDraftIds.length > 0 && (
          <View style={[styles.selectionBar, { backgroundColor: colors.primary }]}>
            <Typography variant="body" color={colors.white}>
              {selectedDraftIds.length} selected
            </Typography>
            <View style={styles.selectionActions}>
              <TouchableOpacity style={styles.selectionButton} onPress={clearSelection}>
                <Typography variant="body" color={colors.white}>
                  Cancel
                </Typography>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.selectionButton, styles.selectionButtonPrimary]}
                onPress={handleBulkConvert}
                disabled={isConverting}
              >
                {isConverting ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Typography variant="body" weight="semibold" color={colors.white}>
                    Add to Tasks
                  </Typography>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Content */}
        <ScrollView
          style={[screenScrollViewStyle.scroll, styles.scrollView]}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 100 },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
        >
          {isLoading && drafts.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Typography variant="body" color="secondary" style={styles.loadingText}>
                Loading task drafts...
              </Typography>
            </View>
          ) : filteredDrafts.length === 0 ? (
            <View style={styles.emptyContainer} testID="task-drafts-empty-state">
              <Icon name="document-text-outline" size={64} color={colors.textSecondary} />
              <Typography variant="headline" color="secondary" style={styles.emptyText}>
                No task drafts found
              </Typography>
              <Typography variant="body" color="secondary" style={styles.emptySubtext}>
                {searchQuery ? 'Try a different search term' : 'Process a report to generate task drafts'}
              </Typography>
            </View>
          ) : (
            Object.entries(groupedDrafts).map(([key, groupDrafts]) =>
              renderGroupSection(key, groupDrafts)
            )
          )}
          <ScreenScrollEnd testID={screenScrollEndTestId('task-drafts-screen')} />
        </ScrollView>

        {/* Quick Actions. Shared bottom-glass scrim (tab-bar / iPad-sidebar
            recipe on the `surface` token) sits behind the pinned action so the
            footer reads as one material with the bottom nav. */}
        {summary && summary.by_severity.critical > 0 && (
          <View style={[styles.quickActions, { paddingHorizontal: containerPadding, paddingBottom: insets.bottom + 16 }]}>
            <ScreenFooterGlass />
            <TouchableOpacity
              style={[styles.quickActionButton, { backgroundColor: colors.error }]}
              onPress={() => selectBySeverity('critical')}
            >
              <Icon name="warning-outline" size={20} color={colors.white} />
              <Typography variant="body" weight="semibold" color={colors.white} style={styles.quickActionText}>
                Add All Critical ({summary.by_severity.critical})
              </Typography>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  summaryCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  filtersContainer: {
    marginTop: 16,
  },
  groupByContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  groupByLabel: {
    marginRight: 8,
  },
  groupByButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  searchContainer: {
    marginTop: 12,
    marginBottom: 8,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: 12,
  },
  selectionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  selectionButtonPrimary: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  emptyText: {
    marginTop: 16,
  },
  emptySubtext: {
    marginTop: 8,
    textAlign: 'center',
  },
  groupSection: {
    marginBottom: 24,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  draftsList: {
    gap: 12,
  },
  draftCard: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
  },
  severityIndicator: {
    width: 4,
  },
  draftContent: {
    flex: 1,
    padding: 16,
  },
  draftHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryText: {
    marginLeft: 6,
    textTransform: 'capitalize',
  },
  draftTitle: {
    marginBottom: 6,
  },
  draftDescription: {
    marginBottom: 12,
  },
  draftFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  costBadge: {
    flex: 1,
  },
  diyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 12,
  },
  diyText: {
    marginLeft: 4,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 16,
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: GradientButtonSizes.lg.paddingV,
    borderRadius: 12,
  },
  quickActionText: {
    marginLeft: 8,
  },
});

export default TaskDraftsScreen;
