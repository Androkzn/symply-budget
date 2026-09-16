
import { useRouter } from 'expo-router';
import { useIsFocused, useFocusEffect } from "expo-router/react-navigation";
import React, { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, RefreshControl, useWindowDimensions } from 'react-native';

import { householdSpacesApi, type HouseholdSpace } from '@api/household-spaces';
import { tasksApi, Task } from '@api/tasks';
import { AppBackground, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import { AdaptiveContainer, SplitView } from '@components/layout';
import { TaskCompletionModal } from '@components/maintenance';
import {
  AddTaskSheet,
  TaskBoardColumn,
  TaskCardItem,
  TaskFilterControls,
  TaskSummaryBar,
  type SummaryKind,
} from '@components/tasks';
import { GradientButton, Typography, SearchBar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useFeature } from '@hooks/useFeature';
import { useHouseholdMembers } from '@hooks/useHouseholdMembers';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useQuickSpeech } from '@hooks/useQuickSpeech';
import { useTaskBoardData } from '@hooks/useTaskBoardData';
import { TaskDetailStackHost } from '@navigation/TaskDetailStackHost';
import type { TasksStackScreenProps } from '@navigation/types';
import { navigateAfterInteractions } from '@services/nav-when-ready';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useSpaceStore } from '@stores/spaceStore';
import { useTaskBoardStore } from '@stores/taskBoardStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, EmptyState, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

export function TasksScreen({ navigation }: TasksStackScreenProps<'TasksMain'>) {  const colors = useAppColors();
  const router = useRouter();
  const { isTablet, shouldUseSplitView } = useDeviceType();
  const { width: windowWidth } = useWindowDimensions();
  const { isLoading: isDataLoading } = useData();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const syncSpacesToStore = useSpaceStore((state) => state.setSpaces);
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: members = [] } = useHouseholdMembers(currentHousehold?.id);

  const { content: containerPadding } = useLayoutPadding();

  const {
    upcomingTasks,
    setUpcomingTasks,
    maintenanceTasks,
    setMaintenanceTasks,
    updateMaintenanceTask,
    isLoading,
    setLoading,
    error,
    setError,
    pendingTaskNavigation,
    setPendingTaskNavigation,
  } = useTaskStore();

  const { viewMode, groupBy, filters, toggleMineOnly, toggleDueTodayOnly, toggleStatus } =
    useTaskBoardStore();

  const smartTaskAssistant = useFeature('smartTaskAssistant');

  const [searchQuery, setSearchQuery] = useState('');
  const [spaces, setSpaces] = useState<HouseholdSpace[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTaskForCompletion, setSelectedTaskForCompletion] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showAddTaskSheet, setShowAddTaskSheet] = useState(false);
  const isFocused = useIsFocused();
  const pendingNavScheduledRef = useRef(false);

  const {
    isAvailable: isSearchMicAvailable,
    isListening: isSearchListening,
    transcript: searchTranscript,
    error: searchMicError,
    start: startSearchSpeech,
    stop: stopSearchSpeech,
    reset: resetSearchSpeech,
  } = useQuickSpeech();

  useEffect(() => {
    if (isSearchListening && searchTranscript) setSearchQuery(searchTranscript);
  }, [isSearchListening, searchTranscript]);

  const handleSearchMicPress = useCallback(async () => {
    if (isSearchListening) {
      await stopSearchSpeech();
      return;
    }
    resetSearchSpeech();
    await startSearchSpeech();
  }, [isSearchListening, startSearchSpeech, stopSearchSpeech, resetSearchSpeech]);

  // When we land on Tasks tab with a pending task (from Home card tap), open task detail.
  // Do NOT return cleanup — effect re-runs when isFocused flips and would cancel the timeout.
  useEffect(() => {
    if (!isFocused || !pendingTaskNavigation) return;
    if (pendingNavScheduledRef.current) return;
    const taskId = pendingTaskNavigation;
    pendingNavScheduledRef.current = true;
    navigateAfterInteractions(() => {
      pendingNavScheduledRef.current = false;
      if (shouldUseSplitView) {
        setSelectedTaskId(taskId);
      } else {
        navigation.navigate('TaskDetailFlow', {
          screen: 'TaskDetail',
          params: { taskId, householdId: currentHousehold?.id },
        });
      }
      setPendingTaskNavigation(null);
    });
  }, [
    isFocused,
    pendingTaskNavigation,
    navigation,
    setPendingTaskNavigation,
    shouldUseSplitView,
    currentHousehold?.id,
  ]);

  // Combine upcoming + maintenance tasks, de-duped by id. These are the raw
  // tasks the board filters/groups over.
  const allTasks = useMemo(() => {
    const combined = [...(upcomingTasks || []), ...(maintenanceTasks || [])];
    return combined.filter(
      (task, index, self) => index === self.findIndex((t) => t.id === task.id)
    );
  }, [upcomingTasks, maintenanceTasks]);

  const { sections, summary } = useTaskBoardData({
    tasks: allTasks,
    members,
    spaces,
    currentUserId,
    filters,
    groupBy,
    search: searchQuery,
  });

  // List view hides empty sections; board view keeps all status columns.
  const visibleSections = useMemo(
    () => (viewMode === 'board' ? sections : sections.filter((s) => s.tasks.length > 0)),
    [sections, viewMode]
  );

  const activeSummaryKinds = useMemo<SummaryKind[]>(() => {
    const kinds: SummaryKind[] = [];
    if (filters.statuses.includes('overdue')) kinds.push('overdue');
    if (filters.dueTodayOnly) kinds.push('dueToday');
    if (filters.mineOnly) kinds.push('mine');
    if (filters.statuses.includes('blocked')) kinds.push('blocked');
    return kinds;
  }, [filters]);

  const handleSummarySelect = useCallback(
    (kind: SummaryKind) => {
      if (kind === 'overdue') toggleStatus('overdue');
      else if (kind === 'blocked') toggleStatus('blocked');
      else if (kind === 'mine') toggleMineOnly();
      else if (kind === 'dueToday') toggleDueTodayOnly();
    },
    [toggleStatus, toggleMineOnly, toggleDueTodayOnly]
  );

  const loadData = useCallback(async () => {
    if (!currentHousehold) return;
    try {
      setLoading(true);
      setError(null);
      const [upcomingRes, maintenanceRes, spacesRes] = await Promise.all([
        tasksApi.getUpcoming(currentHousehold.id, 365),
        tasksApi.list(currentHousehold.id, { limit: 100 }),
        householdSpacesApi.list(currentHousehold.id).catch(() => ({ spaces: [] })),
      ]);
      setUpcomingTasks(upcomingRes.tasks);
      setMaintenanceTasks(maintenanceRes.tasks);
      setSpaces(spacesRes.spaces || []);
      syncSpacesToStore(spacesRes.spaces || []);
      // Members load via useHouseholdMembers (RQ) for assignee filter / grouping.
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tasks';
      setError(message);
      showToast('error', message);
    } finally {
      setLoading(false);
    }
  }, [currentHousehold, setUpcomingTasks, setMaintenanceTasks, setLoading, setError, syncSpacesToStore]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Poll while any quick-captured task is still being AI-enriched.
  const pendingEnrichmentTasks = useMemo(
    () =>
      allTasks.filter(
        (t) => t.enrichment_status === 'pending' || t.enrichment_status === 'enriching'
      ),
    [allTasks]
  );
  const hasPendingEnrichment = pendingEnrichmentTasks.length > 0;

  // Trace enrichment progress: which tasks are still analyzing after each load.
  useEffect(() => {
    if (hasPendingEnrichment) {
      console.log('[TasksScreen] enrichment pending', {
        count: pendingEnrichmentTasks.length,
        tasks: pendingEnrichmentTasks.map((t) => ({
          id: t.id.slice(0, 8),
          title: t.title,
          status: t.enrichment_status,
          due: t.next_due_date ?? null,
          assignee: t.assigned_to?.display_name ?? null,
        })),
      });
    }
  }, [pendingEnrichmentTasks, hasPendingEnrichment]);

  useEffect(() => {
    if (!isFocused || !hasPendingEnrichment || !currentHousehold) return;
    console.log('[TasksScreen] polling every 3s for enrichment to finish');
    const interval = setInterval(() => {
      console.log('[TasksScreen] poll tick → reloading tasks');
      loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, [isFocused, hasPendingEnrichment, currentHousehold, loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleTaskPress = (task: Task) => {
    if (shouldUseSplitView) {
      setSelectedTaskId(task.id);
      return;
    }
    navigation.navigate('TaskDetailFlow', {
      screen: 'TaskDetail',
      params: { taskId: task.id, householdId: currentHousehold?.id },
    });
  };
  const handleQuickComplete = (task: Task) => setSelectedTaskForCompletion(task);

  const handleCompleteTask = async (data: { notes: string; photos: string[] }) => {
    if (!currentHousehold || !selectedTaskForCompletion) return;
    try {
      let photoKeys: string[] = [];
      if (data.photos && data.photos.length > 0) {
        const { uploadTaskPhotos } = await import('@utils/photoUpload');
        const uploadResults = await uploadTaskPhotos(currentHousehold.id, data.photos);
        photoKeys = uploadResults.map((r) => r.photo_key);
      }
      const result = await tasksApi.complete(currentHousehold.id, selectedTaskForCompletion.id, {
        notes: data.notes || undefined,
        photo_keys: photoKeys.length > 0 ? photoKeys : undefined,
      });
      updateMaintenanceTask(selectedTaskForCompletion.id, result.task);
      showToast('success', 'Task completed!');
      setSelectedTaskForCompletion(null);
    } catch (err) {
      throw err; // Let modal handle error
    }
  };

  // Board column width: a touch under half-screen on phones (peek next column),
  // fixed comfortable width on tablets.
  const columnWidth = isTablet ? 320 : Math.min(Math.max(windowWidth * 0.78, 280), 340);

  if (isDataLoading) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            rightElement={<SettingsGearButton />}
            onNotificationPress={() => router.push('/notifications')}
            onProfilePress={() => router.push('/profile')}
          />
          <View style={styles.noHouseholdContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" align="center" style={styles.emptyText} color={colors.textSecondary}>
              Loading...
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  if (!currentHousehold) {
    return (
      <AppBackground opacity={0.5}>
        <View style={styles.container}>
          <ScreenHeader
            rightElement={<SettingsGearButton />}
            onNotificationPress={() => router.push('/notifications')}
            onProfilePress={() => router.push('/profile')}
          />
          <View style={styles.noHouseholdContainer}>
            <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
              No Home Selected
            </Typography>
            <Typography variant="body" align="center" style={styles.emptyText} color={colors.textSecondary}>
              Create or select a home to view tasks
            </Typography>
          </View>
        </View>
      </AppBackground>
    );
  }

  // When the household has NO tasks at all, the summary/filters/search are just
  // noise (four "0" cards, nothing to filter or search) — hide them and let the
  // empty state carry the screen. Filter-induced empties keep the controls so
  // the user can clear them.
  const hasAnyTasks = allTasks.length > 0;

  const renderHeaderControls = () => (
    <>
      <View style={styles.topActionRow}>
        {hasAnyTasks && smartTaskAssistant && (
          <TouchableOpacity
            style={[
              styles.plannerButton,
              { borderColor: colors.borderColor, backgroundColor: colors.card },
            ]}
            onPress={() => navigation.navigate('TimeBudgetPlanner')}
            activeOpacity={0.8}
          >
            <Icon name="flash-outline" size={IconSize.md} color={colors.primary} />
            <Typography variant="footnote" weight="semibold" color={colors.primary}>
              What can I do right now?
            </Typography>
          </TouchableOpacity>
        )}

        <GradientButton
          title="Add Task"
          onPress={() => setShowAddTaskSheet(true)}
          size="sm"
          icon={<Icon name="add" size={IconSize.md} color={colors.white} />}
          testID="tasks-add-fab"
          style={styles.addTaskButton}
        />
      </View>

      {hasAnyTasks && (
        <>
          <View style={styles.summaryContainer}>
            <TaskSummaryBar
              summary={summary}
              activeKinds={activeSummaryKinds}
              onSelect={handleSummarySelect}
            />
          </View>

          <View style={styles.controlsContainer}>
            <TaskFilterControls members={members} spaces={spaces} />
          </View>

          <View style={styles.searchContainer}>
            <SearchBar
              testID="tasks-search-bar"
              inputTestID="tasks-search-input"
              micTestID="tasks-search-mic"
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search tasks..."
              showMic={isSearchMicAvailable}
              onMicPress={handleSearchMicPress}
              isListening={isSearchListening}
              micError={searchMicError}
            />
          </View>
        </>
      )}

      {error && (
        <View style={[styles.errorContainer, { backgroundColor: colors.destructiveSubtle }]}>
          <Typography variant="subheadline" color={colors.error}>
            {error}
          </Typography>
          <TouchableOpacity onPress={loadData}>
            <Typography variant="subheadline" color={colors.error} weight="semibold">
              Retry
            </Typography>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  const isEmpty = !isLoading && visibleSections.every((s) => s.tasks.length === 0);

  const renderEmptyState = () => (
    <View style={styles.emptyStateContainer}>
      <View style={[styles.emptyIconCircle, { backgroundColor: `${colors.primary}1A` }]}>
        <Icon name="checkmark-done-outline" size={34} color={colors.primary} />
      </View>
      <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
        No tasks here
      </Typography>
      <Typography
        variant="body"
        align="center"
        color={colors.textSecondary}
        style={styles.emptyText}
      >
        {hasAnyTasks
          ? 'Try clearing filters or add a new task.'
          : 'Add your first task to get started.'}
      </Typography>
    </View>
  );

  const renderTasksMaster = () =>
    viewMode === 'board' ? (
      <View style={styles.boardWrap}>
        <View style={styles.boardHeader}>{renderHeaderControls()}</View>
        {isLoading && allTasks.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : !hasAnyTasks ? (
          renderEmptyState()
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.boardColumns}
            style={styles.board}
          >
            {visibleSections.map((section) => (
              <TaskBoardColumn
                key={section.key}
                section={section}
                width={columnWidth}
                onTaskPress={handleTaskPress}
                onTaskMenu={handleQuickComplete}
              />
            ))}
          </ScrollView>
        )}
      </View>
    ) : (
      <ScrollView
        {...keyboardDismissScrollProps}
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {renderHeaderControls()}

        {isLoading && allTasks.length === 0 && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Typography variant="body" color={colors.textSecondary} style={styles.loadingText}>
              Loading tasks...
            </Typography>
          </View>
        )}

        {isEmpty && renderEmptyState()}

        {visibleSections.map((section) => (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <View
                style={[styles.sectionRail, { backgroundColor: section.color ?? colors.primary }]}
              />
              {section.icon ? (
                <Icon
                  name={section.icon}
                  size={17}
                  color={section.color ?? colors.textSecondary}
                />
              ) : null}
              <Typography variant="subheadline" weight="bold" color={colors.textPrimary} style={styles.sectionTitle}>
                {section.emoji ? `${section.emoji} ` : ''}
                {section.title}
              </Typography>
              <View
                style={[
                  styles.sectionCount,
                  { backgroundColor: `${section.color ?? colors.primary}1F` },
                ]}
              >
                <Typography variant="caption2" weight="bold" color={section.color ?? colors.primary}>
                  {section.tasks.length}
                </Typography>
              </View>
            </View>
            <View style={[styles.sectionCards, { backgroundColor: colors.backgroundSecondary }]}>
              {section.tasks.map((task) => (
                <TaskCardItem
                  key={task.id}
                  task={task}
                  onPress={() => handleTaskPress(task)}
                  onMenuPress={() => handleQuickComplete(task)}
                />
              ))}
            </View>
          </View>
        ))}
        <ScreenScrollEnd testID={screenScrollEndTestId('tasks-screen')} />
      </ScrollView>
    );

  const renderDetailPanel = () => {
    if (!selectedTaskId || !currentHousehold) {
      return (
        <View style={styles.detailPlaceholder}>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            Select a task
          </Typography>
          <Typography variant="body" color={colors.textSecondary} style={styles.detailPlaceholderText}>
            Tap a task from the list to view details and edit.
          </Typography>
        </View>
      );
    }

    return (
      <TaskDetailStackHost
        key={selectedTaskId}
        initialTask={{ taskId: selectedTaskId, householdId: currentHousehold.id }}
      />
    );
  };

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="tasks-screen">
        <ScreenHeader
          rightElement={<SettingsGearButton />}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />

        <AdaptiveContainer maxWidth={isTablet ? 1400 : undefined} padding={containerPadding}>
          {shouldUseSplitView ? (
            <SplitView
              master={renderTasksMaster()}
              detail={renderDetailPanel()}
              masterRatio={0.42}
              masterMinWidth={360}
              masterMaxWidth={520}
            />
          ) : (
            renderTasksMaster()
          )}
        </AdaptiveContainer>

        {selectedTaskForCompletion && (
          <TaskCompletionModal
            visible={!!selectedTaskForCompletion}
            taskTitle={selectedTaskForCompletion.title}
            onClose={() => setSelectedTaskForCompletion(null)}
            onComplete={handleCompleteTask}
          />
        )}

        <AddTaskSheet
          visible={showAddTaskSheet}
          onClose={() => setShowAddTaskSheet(false)}
          onCopyExisting={() => navigation.navigate('CopyFromExistingTasks')}
          onAddFromTemplates={() => navigation.navigate('TaskTemplates')}
        />
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  content: {
    paddingTop: Spacing.md,
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  plannerButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: Spacing.smd,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  addTaskButton: {
    flexShrink: 0,
  },
  summaryContainer: {
    marginBottom: Spacing.md,
  },
  controlsContainer: {
    marginBottom: Spacing.md,
  },
  searchContainer: {
    marginBottom: Spacing.base,
  },
  errorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.base,
  },
  loadingContainer: {
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Spacing.md,
  },
  emptyStateContainer: {
    paddingVertical: EmptyState.blockPaddingVertical,
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyIconCircle: {
    width: EmptyState.iconSize,
    height: EmptyState.iconSize,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  // ===== List view sections =====
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.smd,
    paddingHorizontal: Spacing.xxs,
  },
  sectionRail: {
    width: Spacing.xs,
    height: 18,
    borderRadius: Spacing.xxs,
  },
  sectionTitle: {
    flex: 1,
  },
  sectionCount: {
    minWidth: Spacing.xl,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: Spacing.smd,
    alignItems: 'center',
  },
  sectionCards: {
    borderRadius: CornerRadius.lg,
    padding: Spacing.sm,
  },
  // ===== Board view =====
  boardWrap: {
    flex: 1,
  },
  boardHeader: {
    paddingTop: Spacing.md,
  },
  board: {
    flex: 1,
  },
  boardColumns: {
    gap: Spacing.md,
    paddingBottom: Layout.bottomTabBarClearance,
    paddingRight: Spacing.md,
  },
  emptyText: {
    marginTop: Spacing.sm,
  },
  noHouseholdContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  detailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  detailPlaceholderText: {
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
});
