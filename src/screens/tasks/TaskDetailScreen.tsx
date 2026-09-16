import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, RouteProp, useFocusEffect } from 'expo-router/react-navigation';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { StyleSheet, View, Alert, Platform, TextInput, Image, ScrollView as RNScrollView } from 'react-native';
import { ScrollView, TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import type { Edge } from 'react-native-safe-area-context';

import { householdSpacesApi } from '@api/household-spaces';
import type { QuoteWithDetails } from '@api/quotes';
import { tasksApi, Task, MaintenanceCompletion, TIME_EFFORT_LABELS } from '@api/tasks';
import { AppBackground, SafeAreaView, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SheetHeader } from '@components/common';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { TaskCompletionModal } from '@components/maintenance';
import { AssigneePickerSheet } from '@components/tasks/AssigneePickerSheet';
import { PurchaseSuggestionChip } from '@components/tasks/PurchaseSuggestionChip';
import { SubtaskList } from '@components/tasks/SubtaskList';
import { TaskActivityFeed } from '@components/tasks/TaskActivityFeed';
import { WorkflowStageIndicator } from '@components/tasks/WorkflowStageIndicator';
import { Typography, Card, Avatar } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useTaskDetailSheetOnBack } from '@contexts/index';
import { isFullBudget } from '@features/budget';
import {
  toMemberFacingError,
  type MemberFacingError,
} from '@features/house/local/memberFacingError';
import { useHouseholdMembers } from '@hooks/useHouseholdMembers';
import type { TaskDetailStackParamList, TasksStackParamList } from '@navigation/types';
import { navigateToFloorPlanPicker } from '@services/navigation';
import { showToast } from '@services/toastManager';
import { useHouseholdStore } from '@stores/householdStore';
import { useSpaceStore } from '@stores/spaceStore';
import { useTaskStore } from '@stores/taskStore';
import { ButtonMetrics, CornerRadius, Elevation, hexToRgba, IconSize, Layout, scaledFont, Spacing, useAppColors } from '@theme';
import { getSystemCategoryIcon } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { getFloorLabel } from '@utils/spaceLabels';

type TaskDetailRouteProp = RouteProp<TaskDetailStackParamList, 'TaskDetail'>;
type TaskDetailNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<TaskDetailStackParamList, 'TaskDetail'>,
  NativeStackNavigationProp<TasksStackParamList>
>;

const FREQUENCY_LABELS: Record<string, string> = {
  one_time: 'One Time',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom',
};

export function TaskDetailScreen() {  const colors = useAppColors();
  const navigation = useNavigation<TaskDetailNavigationProp>();
  const route = useRoute<TaskDetailRouteProp>();
  const { taskId, householdId: paramHouseholdId } = route.params;
  const sheetOnBack = useTaskDetailSheetOnBack();
  const inSheet = !!sheetOnBack;
  const wrapSurface = (node: React.ReactNode) =>
    inSheet ? (
      <View style={[styles.sheetSurface, { backgroundColor: colors.backgroundMain }]}>{node}</View>
    ) : (
      <AppBackground opacity={0.5}>{node}</AppBackground>
    );
  const handleBack = useCallback(() => {
    console.log('[TaskDetail] handleBack called');
    if (sheetOnBack) sheetOnBack();
    else navigation.goBack();
  }, [sheetOnBack, navigation]);

  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  // Assignee picker members via RQ (fallback to household store if cold).
  const storeMembers = useHouseholdStore((state) => state.currentHouseholdMembers);
  const effectiveHouseholdId = paramHouseholdId ?? currentHousehold?.id ?? null;
  const { data: fetchedMembers = [] } = useHouseholdMembers(
    effectiveHouseholdId ?? undefined
  );
  const spaces = useSpaceStore((state) => state.spaces);
  const setSpaces = useSpaceStore((state) => state.setSpaces);
  const householdMembers = fetchedMembers.length > 0 ? fetchedMembers : storeMembers;
  const { updateMaintenanceTask, removeMaintenanceTask } = useTaskStore();
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [showBlockerInput, setShowBlockerInput] = useState(false);
  const [blockerReason, setBlockerReason] = useState('');
  const [blockerSubmitting, setBlockerSubmitting] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  
  const [task, setTask] = useState<Task | null>(null);
  const [completions, setCompletions] = useState<MaintenanceCompletion[]>([]);
  const [quotes, setQuotes] = useState<QuoteWithDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  /** Member-facing reason the quotes list is empty, when there is one (DoD H7). */
  const [quotesNotice, setQuotesNotice] = useState<MemberFacingError | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadTask = useCallback(async (opts?: { silent?: boolean }) => {
    if (!effectiveHouseholdId) {
      console.log('[TaskDetail] No household ID');
      setIsLoading(false);
      if (sheetOnBack) setLoadError(true);
      return;
    }
    console.log('[TaskDetail] Loading task:', { taskId, effectiveHouseholdId });
    setLoadError(false);
    try {
      // Silent refreshes (e.g. on screen re-focus after Edit) skip the spinner
      // so the data updates in place without a flicker.
      if (!opts?.silent) setIsLoading(true);
      const [taskRes, historyRes] = await Promise.all([
        tasksApi.get(effectiveHouseholdId, taskId),
        tasksApi.getHistory(effectiveHouseholdId, taskId, { limit: 10 }),
      ]);
      console.log('[TaskDetail] Task loaded successfully');
      setTask(taskRes.task);
      setCompletions(historyRes.completions);
    } catch (error) {
      console.error('[TaskDetail] Failed to load task:', error);
      showToast('error', 'Failed to load task');
      if (sheetOnBack) {
        setLoadError(true);
      } else {
        handleBack();
      }
    } finally {
      setIsLoading(false);
    }
  }, [effectiveHouseholdId, taskId, handleBack, sheetOnBack]);

  useEffect(() => {
    loadTask();
  }, [loadTask]);

  // Load household spaces so the essentials chip can show the space name.
  useEffect(() => {
    if (!effectiveHouseholdId || spaces.length > 0) return;
    householdSpacesApi
      .list(effectiveHouseholdId)
      .then(({ spaces: loadedSpaces }) => setSpaces(loadedSpaces))
      .catch(() => {});
  }, [effectiveHouseholdId, spaces.length, setSpaces]);

  // Re-fetch when the screen regains focus (e.g. returning from the Edit screen)
  // so the detail never shows stale data after an in-app edit. The mount load
  // above already covers the first focus, so skip that one to avoid a double-load.
  const didInitialLoadRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didInitialLoadRef.current) {
        didInitialLoadRef.current = true;
        return;
      }
      loadTask({ silent: true });
    }, [loadTask])
  );

  // Load quotes if task needs contractor
  useEffect(() => {
    const loadQuotes = async () => {
      if (!effectiveHouseholdId || !task || !task.needs_contractor) return;

      try {
        setIsLoadingQuotes(true);
        setQuotesNotice(null);
        const result = await tasksApi.getTaskQuotes(effectiveHouseholdId, taskId);
        setQuotes(result.quotes || []);
      } catch (error) {
        /**
         * DoD H7, positive half. This was `console.error` and nothing else: the
         * Contractor Workflow card simply showed no quotes, which is
         * indistinguishable from "no contractor has replied yet". On a
         * local-first build the truth is that quotes arrive through servers this
         * household keeps its data off, and `unsupportedCopy.ts` says so along
         * with what still works (save what a contractor sends you as a note or
         * a document).
         *
         * Rendered in place rather than as an Alert because this runs on mount:
         * a modal firing at the member the instant a task opens is a worse
         * answer than a line in the card that caused it.
         */
        console.error('Failed to load quotes:', error);
        setQuotesNotice(toMemberFacingError(error, 'We couldn’t load quotes for this task.'));
      } finally {
        setIsLoadingQuotes(false);
      }
    };

    loadQuotes();
  }, [effectiveHouseholdId, task, taskId]);

  const handleComplete = async (data: { notes: string; photos: string[] }) => {
    if (!effectiveHouseholdId || !task) return;

    try {
      // Upload photos to R2 first
      let photoKeys: string[] = [];
      if (data.photos && data.photos.length > 0) {
        const { uploadTaskPhotos } = await import('@utils/photoUpload');
        const uploadResults = await uploadTaskPhotos(effectiveHouseholdId, data.photos);
        photoKeys = uploadResults.map(r => r.photo_key);
      }

      const result = await tasksApi.complete(effectiveHouseholdId, taskId, {
        notes: data.notes || undefined,
        photo_keys: photoKeys.length > 0 ? photoKeys : undefined,
      });

      // Reflect the completion in the shared store so the Tasks list/board and
      // Home tiles show the new status immediately (their focus-refetch also
      // runs once we pop back to them).
      updateMaintenanceTask(taskId, result.task);

      // Close the completion modal and the detail screen, then surface the
      // confirmation toast. Order matters: the toast host lives at the app root
      // and can't paint over the still-open sheet/modal, so we dismiss those
      // first and let it land on the underlying Tasks screen.
      setShowCompletionModal(false);
      handleBack();
      showToast('success', 'Task completed!');
    } catch (error) {
      throw error; // Let modal handle error display
    }
  };

  const handleEdit = () => {
    if (!task) return;
    // Push on the nested detail stack — navigate() can resolve to the parent
    // Tasks stack's ScheduleTask modal on iPhone and break touch/scroll.
    navigation.push('ScheduleTask', { taskId, task });
  };

  const handleFindContractors = async () => {
    console.log('[TaskDetail] handleFindContractors called');
    if (!task || !effectiveHouseholdId) return;

    try {
      // Fetch subtasks if not already loaded
      let subtaskTitles: string[] = [];
      if (task.subtasks && task.subtasks.length > 0) {
        subtaskTitles = task.subtasks.map(st => st.title);
      } else {
        // Try to fetch subtasks
        try {
          const subtasks = await tasksApi.listSubtasks(effectiveHouseholdId, task.id);
          subtaskTitles = subtasks.map(st => st.title);
        } catch (error) {
          console.log('[TaskDetail] No subtasks or failed to load:', error);
          // Continue without subtasks - they're optional
        }
      }

      // Build enhanced params for contractor search
      const params: Record<string, string> = {
        screen: 'ContractorSearch',
        problemTitle: task.title,
        problemDescription: task.description || task.title,
        systemCategory: task.system_category || 'other',
        sourceType: 'task' as const,
        sourceId: task.id,
        // Full property address for location-aware search
        propertyAddress: currentHousehold?.address_line1 || '',
      };

      // Add contractor category if available
      if (task.contractor_category) {
        params.contractorCategory = task.contractor_category;
      }

      // Add priority/severity if available
      if (task.priority_severity) {
        // Map priority to severity
        const severityMap: Record<string, 'critical' | 'major' | 'minor' | 'informational'> = {
          critical: 'critical',
          high: 'major',
          medium: 'minor',
          low: 'informational',
          nice_to_have: 'informational',
        };
        params.severity = severityMap[task.priority_severity] || 'informational';

        // Convert priority to urgency score (1-10)
        const urgencyMap: Record<string, number> = {
          critical: 10,
          high: 8,
          medium: 5,
          low: 3,
          nice_to_have: 1,
        };
        params.urgencyScore = String(urgencyMap[task.priority_severity] || 5);
      }

      // Add subtasks if available
      if (subtaskTitles.length > 0) {
        params.subtasks = JSON.stringify(subtaskTitles);
      }

      // Navigate to contractor search with all metadata
      navigation.getParent()?.navigate('contractors', {
        screen: 'ContractorSearch',
        params,
      });
    } catch (error) {
      console.error('[TaskDetail] Error preparing contractor search:', error);
      showToast('error', 'Failed to prepare contractor search');
    }
  };

  const handleDelete = () => {
    console.log('[TaskDetail] handleDelete called');
    Alert.alert(
      'Delete Task',
      'Are you sure you want to delete this task? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!effectiveHouseholdId) return;

            try {
              setIsDeleting(true);
              await tasksApi.delete(effectiveHouseholdId, taskId);
              removeMaintenanceTask(taskId);
              showToast('success', 'Task deleted');
              handleBack();
            } catch {
              showToast('error', 'Failed to delete task');
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleActive = async () => {
    console.log('[TaskDetail] handleToggleActive called');
    if (!effectiveHouseholdId || !task) return;

    try {
      const result = await tasksApi.update(effectiveHouseholdId, taskId, {
        is_active: !task.is_active,
      });
      setTask(result.task);
      updateMaintenanceTask(taskId, result.task);
      showToast('success', task.is_active ? 'Task paused' : 'Task activated');
    } catch {
      showToast('error', 'Failed to update task');
    }
  };

  const handleAssign = async (userId: string | null) => {
    if (!effectiveHouseholdId || !task) return;
    try {
      const result = await tasksApi.update(effectiveHouseholdId, taskId, {
        assigned_to: userId,
      });
      setTask(result.task);
      updateMaintenanceTask(taskId, result.task);
      showToast('success', userId ? 'Task assigned' : 'Task unassigned');
    } catch {
      showToast('error', 'Failed to assign task');
    }
  };

  const handleReportBlocker = async () => {
    const reason = blockerReason.trim();
    if (!effectiveHouseholdId || !task || !reason || blockerSubmitting) return;
    setBlockerSubmitting(true);
    try {
      const result = await tasksApi.reportBlocker(effectiveHouseholdId, taskId, reason);
      setTask(result.task);
      updateMaintenanceTask(taskId, result.task);
      setBlockerReason('');
      setShowBlockerInput(false);
      setActivityRefreshKey((k) => k + 1);
      showToast('success', 'Task marked blocked');
    } catch {
      showToast('error', 'Failed to report blocker');
    } finally {
      setBlockerSubmitting(false);
    }
  };

  const handleResolveBlocker = async () => {
    if (!effectiveHouseholdId || !task) return;
    try {
      const result = await tasksApi.resolveBlocker(effectiveHouseholdId, taskId);
      setTask(result.task);
      updateMaintenanceTask(taskId, result.task);
      setActivityRefreshKey((k) => k + 1);
      showToast('success', 'Blocker resolved');
    } catch {
      showToast('error', 'Failed to resolve blocker');
    }
  };

  // Contractor-related handlers
  const handleRequestQuotes = () => {
    if (!task || !task.contractor_category) return;
    navigation.navigate('ContractorSelection', {
      taskId: task.id,
      category: task.contractor_category,
    });
  };

  const handleViewQuotes = () => {
    if (!task) return;
    navigation.navigate('QuoteManagement', {
      taskId: task.id,
      taskType: 'maintenance',
    });
  };

  const handleCompareQuotes = () => {
    if (!task) return;
    const receivedQuotes = quotes.filter(q => q.status === 'received');
    if (receivedQuotes.length < 2) {
      showToast('info', 'Need at least 2 quotes to compare');
      return;
    }
    navigation.navigate('QuoteComparison', {
      taskId: task.id,
      quoteIds: receivedQuotes.map(q => q.id),
    });
  };

  const handleScheduleWork = () => {
    if (!task || !task.selected_quote_id) return;
    const selectedQuote = quotes.find(q => q.id === task.selected_quote_id);
    if (!selectedQuote) return;
    navigation.navigate('ScheduleWork', {
      taskId: task.id,
      quoteId: selectedQuote.id,
      contractorId: selectedQuote.contractor.id,
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getDueStatus = () => {
    if (!task?.next_due_date) return null;
    
    const dueDate = new Date(task.next_due_date);
    const now = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      const overdueDays = Math.abs(diffDays);
      return {
        label: `${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} overdue`,
        color: colors.error,
      };
    }
    if (diffDays === 0) {
      return { label: 'Due today', color: colors.warning };
    }
    if (diffDays <= 7) {
      return {
        label: `Due in ${diffDays} ${diffDays === 1 ? 'day' : 'days'}`,
        color: colors.warning,
      };
    }
    return { label: `Due ${formatDate(task.next_due_date)}`, color: colors.textSecondary };
  };

  if (loadError) {
    return wrapSurface(
      <SafeAreaView edges={inSheet ? ['bottom'] : ['top']} style={{ flex: 1, backgroundColor: colors.backgroundMain }}>
        <View style={styles.loadingContainer}>
          <Typography variant="body" color={colors.textSecondary} style={{ marginBottom: Spacing.base, textAlign: 'center' }}>
            Failed to load task
          </Typography>
          <View style={{ flexDirection: 'row', gap: Spacing.md, justifyContent: 'center' }}>
              <GHTouchableOpacity onPress={() => loadTask()} style={[styles.retryButton, { borderColor: colors.primary }]} activeOpacity={0.7}>
                <Typography variant="subheadline" color={colors.primary}>Retry</Typography>
              </GHTouchableOpacity>
              <GHTouchableOpacity onPress={handleBack} style={[styles.retryButton, { borderColor: colors.borderColor }]} activeOpacity={0.7}>
              <Typography variant="subheadline" color={colors.textSecondary}>Back</Typography>
            </GHTouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return wrapSurface(
      <SafeAreaView edges={inSheet ? ['bottom'] : ['top']} style={{ flex: 1, backgroundColor: colors.backgroundMain }}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!task) {
    return wrapSurface(
      <SafeAreaView edges={inSheet ? ['bottom'] : ['top']} style={{ flex: 1, backgroundColor: colors.backgroundMain }}>
        <View style={styles.loadingContainer}>
          <Typography variant="body" color={colors.textSecondary}>
            Task not found
          </Typography>
        </View>
      </SafeAreaView>
    );
  }

  const iconName = getSystemCategoryIcon(task.system_category);

  const frequencyLabel =
    task.frequency === 'custom' && task.custom_interval_days
      ? `Every ${task.custom_interval_days} days`
      : FREQUENCY_LABELS[task.frequency];

  const dueStatus = getDueStatus();

  // ===== Essentials, surfaced as compact chips right under the title. Keeps the
  // "what / when / who / how urgent" glanceable and drops the low-signal rows
  // (frequency for one-off tasks, last-completed) that made the screen busy. =====
  const isRecurring = task.frequency !== 'one_time';
  const priorityMeta =
    task.priority_severity === 'critical'
      ? { label: 'Critical', color: colors.error }
      : task.priority_severity === 'urgent'
        ? { label: 'Urgent', color: colors.error }
        : task.priority_severity === 'high'
          ? { label: 'High priority', color: colors.warning }
          : null;
  const effortLabel = task.time_effort ? TIME_EFFORT_LABELS[task.time_effort] : null;
  const assigneeMember = task.assigned_to?.id
    ? fetchedMembers.find((m) => m.user_id === task.assigned_to?.id)
    : undefined;
  const taskSpace = task.space_id
    ? spaces.find((space) => space.id === task.space_id)
    : undefined;

  const safeAreaEdges: Edge[] = inSheet ? ['bottom'] : [];
  const surfaceBg = colors.backgroundMain;
  const editAction = (
    <GHTouchableOpacity onPress={handleEdit} activeOpacity={0.7} testID="task-detail-edit">
      <Typography variant="body" weight="semibold" color={colors.primary}>
        Edit
      </Typography>
    </GHTouchableOpacity>
  );

  return wrapSurface(
    <SafeAreaView edges={safeAreaEdges} style={{ flex: 1, backgroundColor: surfaceBg }}>
      <View style={[styles.container, { backgroundColor: surfaceBg }]} testID="task-detail-screen">
          {inSheet ? (
            <SheetHeader
              title="Task Details"
              leftVariant="close"
              onLeftPress={handleBack}
              leftTestID="task-detail-close"
              rightElement={editAction}
              TouchableComponent={GHTouchableOpacity}
              constrainWidth
              testID="task-detail-header"
              style={{ backgroundColor: surfaceBg }}
            />
          ) : (
            <ScreenHeader
              title="Task Details"
              showBackButton
              onBackPress={handleBack}
              showNotificationBell={false}
              showAvatar={false}
              rightElement={editAction}
            />
          )}

          <ScrollView
            style={[styles.scrollView, !inSheet && { backgroundColor: 'transparent' }]}
            contentContainerStyle={[
              styles.content,
              // Full-screen presentation sits under the floating tab bar, so the
              // last card (Completion History) needs clearance to scroll clear of
              // it. In a bottom sheet the safe-area bottom edge already covers this.
              { paddingBottom: inSheet ? Spacing.xxl + Spacing.sm : Layout.bottomTabBarClearance + Spacing.base },
            ]}
            showsVerticalScrollIndicator={false}
            {...keyboardDismissScrollProps}
          >
            {/* Task Info Card */}
            <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}>
              <View style={styles.taskHeader}>
                <View style={[styles.iconContainer, { backgroundColor: colors.backgroundMain }]}>
                  <Icon name={iconName} size={IconSize.lg} color={colors.textPrimary} />
                </View>
                <View style={styles.taskHeaderContent}>
                  <Typography variant="title3" weight="bold">
                    {task.title}
                  </Typography>
                  {/* Assigned to — avatar + name, tap to change */}
                  <GHTouchableOpacity
                    onPress={() => setShowAssigneePicker(true)}
                    activeOpacity={0.7}
                    testID="task-detail-assignee"
                    style={styles.assignedToRow}
                  >
                    <Typography variant="footnote" color={colors.textSecondary}>
                      Assigned to:
                    </Typography>
                    {task.assigned_to ? (
                      <>
                        <Avatar
                          size="sm"
                          user={{
                            display_name: task.assigned_to.display_name,
                            avatar_url: assigneeMember?.avatar_url ?? undefined,
                          }}
                        />
                        <Typography variant="footnote" weight="medium" color={colors.textPrimary}>
                          {task.assigned_to.display_name || 'Unknown'}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="footnote" weight="medium" color={colors.primary}>
                        Assign
                      </Typography>
                    )}
                  </GHTouchableOpacity>
                </View>
                {!task.is_active && (
                  <View style={[styles.inactiveBadge, { backgroundColor: colors.destructiveSubtle }]}>
                    <Typography variant="caption2" color={colors.error}>Paused</Typography>
                  </View>
                )}
              </View>

              {task.enrichment_status === 'needs_clarification' && (
                <GHTouchableOpacity
                  onPress={handleEdit}
                  activeOpacity={0.7}
                  style={[styles.clarificationBanner, { backgroundColor: colors.cardSubtle }]}
                >
                  <View style={styles.bannerHeading}>
                    <Icon name="help-circle" size={IconSize.md} color={colors.textPrimary} />
                    <Typography variant="subheadline" weight="semibold" color={colors.textPrimary} style={styles.bannerHeadingText}>
                      {task.clarification_question || "I couldn't tell what this task is — tap to add detail"}
                    </Typography>
                  </View>
                  <Typography variant="footnote" color={colors.textSecondary} style={styles.clarificationHint}>
                    Tap Edit and replace the title with what you actually meant.
                  </Typography>
                </GHTouchableOpacity>
              )}

              {/* Essentials — the at-a-glance facts, right under the title */}
              <View style={styles.chipRow}>
                {dueStatus && (
                  <View style={[styles.chip, { backgroundColor: hexToRgba(dueStatus.color, 0.12) }]}>
                    <Icon name="time-outline" size={IconSize.sm} color={dueStatus.color} />
                    <Typography variant="footnote" weight="medium" color={dueStatus.color}>
                      {dueStatus.label}
                    </Typography>
                  </View>
                )}
                {priorityMeta && (
                  <View style={[styles.chip, { backgroundColor: hexToRgba(priorityMeta.color, 0.12) }]}>
                    <Icon name="flag" size={IconSize.sm} color={priorityMeta.color} />
                    <Typography variant="footnote" weight="medium" color={priorityMeta.color}>
                      {priorityMeta.label}
                    </Typography>
                  </View>
                )}
                {effortLabel && (
                  <View style={[styles.chip, { backgroundColor: colors.pillBackground }]}>
                    <Icon name="stopwatch-outline" size={IconSize.sm} color={colors.textSecondary} />
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {effortLabel}
                    </Typography>
                  </View>
                )}
                {taskSpace && (
                  <View style={[styles.chip, { backgroundColor: colors.pillBackground }]}>
                    <Icon name="location-outline" size={IconSize.sm} color={colors.textSecondary} />
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {taskSpace.name}
                      {getFloorLabel(taskSpace.floor_level)
                        ? ` · ${getFloorLabel(taskSpace.floor_level)}`
                        : ''}
                    </Typography>
                  </View>
                )}
                {isRecurring && (
                  <View style={[styles.chip, { backgroundColor: colors.pillBackground }]}>
                    <Icon name="repeat" size={IconSize.sm} color={colors.textSecondary} />
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {frequencyLabel}
                    </Typography>
                  </View>
                )}
              </View>

              {task.description && (
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  style={styles.description}
                >
                  {task.description}
                </Typography>
              )}

              <GHTouchableOpacity
                onPress={() => navigateToFloorPlanPicker(taskId)}
                activeOpacity={0.7}
                style={[styles.locationRow, { backgroundColor: colors.cardSubtle }]}
              >
                <Icon name="map-outline" size={IconSize.md} color={colors.primary} />
                <View style={styles.locationText}>
                  <Typography variant="subheadline" weight="medium">
                    {taskSpace ? `Located in ${taskSpace.name}` : 'Add to floor plan'}
                  </Typography>
                  <Typography variant="footnote" color={colors.textSecondary}>
                    Place or view this task on your floor plan
                  </Typography>
                </View>
                <Icon name="chevron-forward" size={IconSize.sm} color={colors.textSecondary} />
              </GHTouchableOpacity>

              {!!task.photos?.length && (
                <RNScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.taskPhotoRow}
                >
                  {task.photos.map((photo, index) => (
                    <View key={photo.id} style={styles.taskPhotoWrap}>
                      {/*
                        A photo taken on ANOTHER device arrives here as a
                        descriptor, never a URL: the bytes are H6-sealed in R2
                        and `photo_key` is the synthetic `lf-blob/<blobId>` form,
                        so `photo_url` signed from it points at an object the
                        Worker never wrote. Rendering the URL is why a peer's
                        task photos came through as grey boxes while the row
                        itself had synced perfectly. `TaskFormPhotos` already
                        made this choice on the edit side; this is the read side.
                      */}
                      {photo.blob ? (
                        <HouseBlobImage
                          descriptor={photo.blob}
                          householdId={effectiveHouseholdId ?? undefined}
                          width={120}
                          height={90}
                          accessibilityLabel={`Task photo ${index + 1}`}
                          style={styles.taskPhoto}
                          testID={`task-detail-photo-blob-${index}`}
                        />
                      ) : (
                        <Image
                          source={{ uri: photo.photo_url }}
                          style={[styles.taskPhoto, { backgroundColor: colors.mediaImagePlaceholder }]}
                        />
                      )}
                      {photo.id === task.cover_photo_id && (
                        <View style={[styles.taskPhotoCoverBadge, { backgroundColor: colors.primary }]}>
                          <Typography variant="caption2" color={colors.backgroundSecondary}>
                            Cover
                          </Typography>
                        </View>
                      )}
                    </View>
                  ))}
                </RNScrollView>
              )}

              {/* Action Buttons - use RNGH touchables so onPress fires inside Modal+ScrollView */}
              <View style={styles.actionButtons}>
                {/* Contractor CTA — only for tasks the AI flagged as needing a pro
                    (no point offering one for a return, an errand, etc.). */}
                {task.is_active && task.needs_contractor && (
                  <GHTouchableOpacity
                    style={[styles.findContractorsButton, { backgroundColor: hexToRgba(colors.primary, 0.08) }]}
                    onPress={handleFindContractors}
                    activeOpacity={0.7}
                    testID="task-detail-find-contractors"
                  >
                    <Icon name="search" size={IconSize.md} color={colors.primary} />
                    <Typography variant="subheadline" color={colors.primary}>
                      Find a Contractor
                    </Typography>
                  </GHTouchableOpacity>
                )}

                {/* Complete · Pause · Delete — one equal-width row. */}
                <View style={styles.actionRow}>
                  {task.is_active && (
                    <View style={styles.actionSecondaryButtonSlot} testID="task-detail-mark-complete-slot">
                      <GHTouchableOpacity
                        style={[styles.actionPrimaryButton, { backgroundColor: colors.primary }]}
                        onPress={() => setShowCompletionModal(true)}
                        activeOpacity={0.8}
                        testID="task-detail-mark-complete"
                      >
                        <Typography variant="subheadline" color={colors.white} weight="semibold" align="center">
                          Complete
                        </Typography>
                      </GHTouchableOpacity>
                    </View>
                  )}
                  <View style={styles.actionSecondaryButtonSlot} testID="task-detail-pause-slot">
                    <GHTouchableOpacity
                      style={[styles.actionSecondaryButton, { borderColor: colors.borderColor }]}
                      onPress={handleToggleActive}
                      activeOpacity={0.7}
                      testID="task-detail-pause"
                    >
                      <Typography variant="subheadline" color={colors.primary} align="center">
                        {task.is_active ? 'Pause' : 'Resume'}
                      </Typography>
                    </GHTouchableOpacity>
                  </View>
                  <View style={styles.actionSecondaryButtonSlot} testID="task-detail-delete-slot">
                    <GHTouchableOpacity
                      style={[styles.actionSecondaryButton, { borderColor: colors.error }]}
                      onPress={handleDelete}
                      activeOpacity={0.7}
                      disabled={isDeleting}
                      testID="task-detail-delete"
                    >
                      {isDeleting ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <Typography variant="subheadline" color={colors.error} align="center">
                          Delete
                        </Typography>
                      )}
                    </GHTouchableOpacity>
                  </View>
                </View>
              </View>
            </Card>

            {/* Optional "add to planned spending" suggestion for purchase tasks. */}
            {isFullBudget() && effectiveHouseholdId && (
              <PurchaseSuggestionChip
                task={task}
                householdId={effectiveHouseholdId}
                onTaskUpdated={setTask}
              />
            )}

            {/* Subtasks Section */}
            <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}>
              <SubtaskList
                subtasks={task.subtasks || []}
                taskId={task.id}
                householdId={currentHousehold?.id ?? ''}
                onUpdate={loadTask}
              />
            </Card>

            {/* Blocker Section */}
            <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]} testID="task-detail-blocker-section">
              {task.blocked ? (
                <View>
                  <View style={[styles.blockerBanner, { backgroundColor: colors.destructiveSubtle }]}>
                    <View style={styles.bannerHeading}>
                      <Icon name="remove-circle" size={IconSize.md} color={colors.error} />
                      <Typography variant="subheadline" weight="semibold" color={colors.error}>
                        Blocked
                      </Typography>
                    </View>
                    {!!task.blocker_reason && (
                      <Typography variant="footnote" color={colors.textPrimary} style={styles.blockerReason}>
                        {task.blocker_reason}
                      </Typography>
                    )}
                  </View>
                  <GHTouchableOpacity
                    onPress={handleResolveBlocker}
                    style={[styles.blockerActionBtn, { borderColor: colors.borderColor }]}
                  >
                    <Typography variant="subheadline" weight="semibold" color={colors.primary}>
                      Resolve blocker
                    </Typography>
                  </GHTouchableOpacity>
                </View>
              ) : showBlockerInput ? (
                <View>
                  <TextInput
                    value={blockerReason}
                    onChangeText={setBlockerReason}
                    placeholder="What's blocking this task?"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.blockerInput, { color: colors.textPrimary, borderColor: colors.borderColor }]}
                    multiline
                    autoFocus
                  />
                  <View style={styles.blockerButtonRow}>
                    <GHTouchableOpacity
                      onPress={() => { setShowBlockerInput(false); setBlockerReason(''); }}
                      style={[styles.blockerActionBtn, { borderColor: colors.borderColor }]}
                    >
                      <Typography variant="subheadline" color={colors.textSecondary}>Cancel</Typography>
                    </GHTouchableOpacity>
                    <GHTouchableOpacity
                      onPress={handleReportBlocker}
                      disabled={!blockerReason.trim() || blockerSubmitting}
                      style={[styles.blockerActionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    >
                      <Typography variant="subheadline" weight="semibold" color={colors.white}>
                        {blockerSubmitting ? 'Saving…' : 'Mark blocked'}
                      </Typography>
                    </GHTouchableOpacity>
                  </View>
                </View>
              ) : (
                <GHTouchableOpacity
                  onPress={() => setShowBlockerInput(true)}
                  style={[styles.blockerActionBtn, styles.blockerReportBtn, { borderColor: colors.borderColor }]}
                  testID="task-detail-report-blocker"
                >
                  <Icon name="remove-circle" size={IconSize.md} color={colors.textSecondary} />
                  <Typography variant="subheadline" weight="medium" color={colors.textSecondary}>
                    Report a blocker
                  </Typography>
                </GHTouchableOpacity>
              )}
            </Card>

            {/* Activity Feed */}
            {effectiveHouseholdId && (
              <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}>
                <TaskActivityFeed
                  householdId={effectiveHouseholdId}
                  taskId={task.id}
                  refreshKey={activityRefreshKey}
                />
              </Card>
            )}

            {/* Contractor Section */}
            {task.needs_contractor && (
              <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary, shadowColor: colors.black }]}>
                <View style={[styles.contractorHeader, styles.bannerHeading]}>
                  <Icon name="construct" size={IconSize.md} color={colors.textPrimary} />
                  <Typography variant="headline" weight="semibold">
                    Contractor Workflow
                  </Typography>
                </View>

                {/* Workflow Stage Indicator */}
                <View style={styles.workflowSection}>
                  <WorkflowStageIndicator
                    currentStage={task.workflow_stage || 'planning'}
                  />
                </View>

                {/* Contractor Info */}
                <View style={styles.contractorInfo}>
                  {task.selected_quote_id && quotes.length > 0 && (() => {
                    const selectedQuote = quotes.find(q => q.id === task.selected_quote_id);
                    if (selectedQuote) {
                      return (
                        <View style={[styles.selectedContractor, { backgroundColor: colors.surfaceSelected }]}>
                          <Typography variant="subheadline" color={colors.textSecondary}>
                            Selected Contractor
                          </Typography>
                          <Typography variant="title3" weight="semibold">
                            {selectedQuote.contractor.name}
                          </Typography>
                          {selectedQuote.contractor.company_name && (
                            <Typography variant="footnote" color={colors.textSecondary}>
                              {selectedQuote.contractor.company_name}
                            </Typography>
                          )}
                          <Typography variant="body" color={colors.primary} style={{ marginTop: Spacing.xs }}>
                            ${selectedQuote.amount_cents ? (selectedQuote.amount_cents / 100).toFixed(2) : '0.00'}
                          </Typography>
                        </View>
                      );
                    }
                    return null;
                  })()}

                  {task.scheduled_work_date && (
                    <View style={[styles.scheduledWork, { backgroundColor: hexToRgba(colors.success, 0.08) }]}>
                      <Typography variant="subheadline" color={colors.textSecondary}>
                        Scheduled Work
                      </Typography>
                      <View style={styles.scheduledLine}>
                        <Icon name="calendar" size={IconSize.sm} color={colors.textPrimary} />
                        <Typography variant="body" weight="medium">
                          {formatDate(task.scheduled_work_date)}
                        </Typography>
                      </View>
                      {task.scheduled_work_time_start && (
                        <View style={styles.scheduledLine}>
                          <Icon name="time" size={IconSize.sm} color={colors.textSecondary} />
                          <Typography variant="footnote" color={colors.textSecondary}>
                            {task.scheduled_work_time_start}
                            {task.scheduled_work_time_end && ` - ${task.scheduled_work_time_end}`}
                          </Typography>
                        </View>
                      )}
                    </View>
                  )}

                  {!task.selected_quote_id && quotes.length > 0 && (
                    <View style={[styles.quoteSummary, { backgroundColor: hexToRgba(colors.warning, 0.08) }]}>
                      <Typography variant="subheadline" color={colors.textSecondary}>
                        Quotes
                      </Typography>
                      <Typography variant="body">
                        {quotes.filter(q => q.status === 'received').length} received, {' '}
                        {quotes.filter(q => q.status === 'requested').length} pending
                      </Typography>
                    </View>
                  )}
                </View>

                {/* Action Buttons Based on Workflow Stage - RNGH touchables for Modal+ScrollView */}
                <View style={styles.contractorActions}>
                  {task.workflow_stage === 'planning' && (
                    <GHTouchableOpacity
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                      onPress={handleRequestQuotes}
                      activeOpacity={0.8}
                    >
                      <Typography variant="subheadline" color={colors.white} weight="semibold">
                        Request Quotes from Contractors
                      </Typography>
                    </GHTouchableOpacity>
                  )}

                  {task.workflow_stage === 'getting_quotes' && (
                    <>
                      <GHTouchableOpacity
                        style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                        onPress={handleViewQuotes}
                        activeOpacity={0.8}
                      >
                        <Typography variant="subheadline" color={colors.white} weight="semibold">
                          View Quotes ({quotes.length})
                        </Typography>
                      </GHTouchableOpacity>
                      {quotes.filter(q => q.status === 'received').length >= 2 && (
                        <GHTouchableOpacity
                          style={[styles.primaryButton, { backgroundColor: colors.backgroundSecondary, marginTop: Spacing.sm, borderWidth: 1, borderColor: colors.borderColor }]}
                          onPress={handleCompareQuotes}
                          activeOpacity={0.8}
                        >
                          <Typography variant="subheadline" color={colors.textPrimary} weight="semibold">
                            Compare with AI
                          </Typography>
                        </GHTouchableOpacity>
                      )}
                    </>
                  )}

                  {task.workflow_stage === 'comparing_quotes' && (
                    <GHTouchableOpacity
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                      onPress={handleViewQuotes}
                      activeOpacity={0.8}
                    >
                      <Typography variant="subheadline" color={colors.white} weight="semibold">
                        View Quote Comparison
                      </Typography>
                    </GHTouchableOpacity>
                  )}

                  {task.workflow_stage === 'quote_selected' && (
                    <GHTouchableOpacity
                      style={[styles.primaryButton, { backgroundColor: colors.primary }]}
                      onPress={handleScheduleWork}
                      activeOpacity={0.8}
                    >
                      <Typography variant="subheadline" color={colors.white} weight="semibold">
                        Schedule Work with Contractor
                      </Typography>
                    </GHTouchableOpacity>
                  )}

                  {(task.workflow_stage === 'scheduled' || task.workflow_stage === 'in_progress') && task.scheduled_work_date && (
                    <GHTouchableOpacity
                      style={[styles.findContractorsButton, { backgroundColor: hexToRgba(colors.primary, 0.08) }]}
                      onPress={handleScheduleWork}
                      activeOpacity={0.7}
                    >
                      <Icon name="calendar" size={IconSize.md} color={colors.primary} />
                      <Typography variant="subheadline" color={colors.primary}>
                        Reschedule Work
                      </Typography>
                    </GHTouchableOpacity>
                  )}

                  {/* Always show "View All Quotes" link if quotes exist */}
                  {quotes.length > 0 && task.workflow_stage !== 'planning' && (
                    <GHTouchableOpacity
                      style={styles.viewAllQuotesLink}
                      onPress={handleViewQuotes}
                      activeOpacity={0.7}
                    >
                      <Typography variant="footnote" color={colors.primary}>
                        View All Quotes
                      </Typography>
                      <Icon name="chevron-forward" size={IconSize.sm} color={colors.primary} />
                    </GHTouchableOpacity>
                  )}
                </View>

                {isLoadingQuotes && (
                  <View style={{ paddingVertical: Spacing.base, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Typography variant="caption1" color={colors.textSecondary} style={{ marginTop: Spacing.sm }}>
                      Loading quotes...
                    </Typography>
                  </View>
                )}

                {/*
                  Why the quotes list is empty, in the member's language. `title`
                  and `message` come from `unsupportedCopy.ts` for a P4 feature
                  and from the server envelope for a real failure — never from
                  `.method`, which is the identifier the h7-p4 flows forbid.
                */}
                {!isLoadingQuotes && quotesNotice && (
                  <View
                    style={{ paddingVertical: Spacing.base }}
                    testID="task-detail-quotes-notice">
                    <Typography variant="subheadline" weight="semibold">
                      {quotesNotice.title}
                    </Typography>
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      style={{ marginTop: Spacing.xs }}>
                      {quotesNotice.message}
                    </Typography>
                  </View>
                )}
              </Card>
            )}

            {/* Completion History */}
            <View style={styles.historySection}>
              <Typography variant="headline" weight="semibold" style={styles.sectionTitle}>
                Completion History
              </Typography>
              
              {completions.length === 0 ? (
                <Card variant="outlined" style={styles.emptyHistory}>
                  <Typography variant="body" color={colors.textSecondary} align="center">
                    No completions yet
                  </Typography>
                </Card>
              ) : (
                completions.map((completion) => (
                  <Card 
                    key={completion.id} 
                    variant="outlined" 
                    style={styles.completionCard}
                  >
                    <View style={styles.completionHeader}>
                      <View>
                        <Typography variant="subheadline" weight="medium">
                          {formatDate(completion.completed_at)}
                        </Typography>
                        <Typography variant="caption1" color={colors.textSecondary}>
                          {formatTime(completion.completed_at)}
                        </Typography>
                      </View>
                      {completion.completed_by?.display_name && (
                        <Typography variant="caption1" color={colors.textSecondary}>
                          by {completion.completed_by.display_name}
                        </Typography>
                      )}
                    </View>
                    {completion.notes && (
                      <Typography 
                        variant="footnote" 
                        color={colors.textSecondary}
                        style={styles.completionNotes}
                      >
                        {completion.notes}
                      </Typography>
                    )}
                    {completion.photo_keys && completion.photo_keys.length > 0 && (
                      <View style={styles.completionPhotos}>
                        <Icon name="camera" size={IconSize.sm} color={colors.primary} />
                        <Typography variant="caption2" color={colors.primary}>
                          {completion.photo_keys.length} photo(s)
                        </Typography>
                      </View>
                    )}
                  </Card>
                ))
              )}
            </View>
            <ScreenScrollEnd testID={screenScrollEndTestId('task-detail-screen')} />
          </ScrollView>
        </View>

        {/* Completion Modal */}
        <TaskCompletionModal
          visible={showCompletionModal}
          taskTitle={task.title}
          onClose={() => setShowCompletionModal(false)}
          onComplete={handleComplete}
        />

        <AssigneePickerSheet
          visible={showAssigneePicker}
          members={householdMembers}
          selectedUserId={task.assigned_to?.id ?? null}
          onClose={() => setShowAssigneePicker(false)}
          onSelect={handleAssign}
        />
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl + Spacing.sm,
    maxWidth: Layout.readingMaxWidth,
    width: '100%',
    alignSelf: 'center',
  },
  blockerBanner: {
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  blockerReason: {
    marginTop: Spacing.xxs,
  },
  blockerInput: {
    borderWidth: 1,
    borderRadius: CornerRadius.md,
    padding: Spacing.md,
    ...scaledFont('labelRegular'),
    minHeight: 60,
    marginBottom: Spacing.md,
  },
  blockerButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.smd,
  },
  blockerActionBtn: {
    paddingVertical: Spacing.smd,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  card: {
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.base,
    borderRadius: CornerRadius.lg,
    marginBottom: Spacing.base,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: Elevation.card,
      },
    }),
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  taskHeaderContent: {
    flex: 1,
    minWidth: 0,
  },
  inactiveBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
  },
  description: {
    marginTop: Spacing.base,
    lineHeight: 22,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.smd,
    marginTop: Spacing.base,
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  locationText: {
    flex: 1,
    gap: 2,
  },
  taskPhotoRow: {
    gap: Spacing.smd,
    marginTop: Spacing.base,
    paddingRight: Spacing.xs,
  },
  taskPhotoWrap: {
    width: 120,
    height: 90,
  },
  taskPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: CornerRadius.sm,
  },
  taskPhotoCoverBadge: {
    position: 'absolute',
    left: Spacing.xs + Spacing.xxs,
    bottom: Spacing.xs + Spacing.xxs,
    paddingHorizontal: Spacing.xs + Spacing.xxs,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.sm,
  },
  clarificationBanner: {
    marginTop: Spacing.base,
    padding: Spacing.md,
    borderRadius: CornerRadius.md,
  },
  clarificationHint: {
    marginTop: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  assignedToRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  actionButtons: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
    width: '100%',
    alignSelf: 'stretch',
  },
  primaryButton: {
    paddingVertical: Spacing.base,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignSelf: 'stretch',
    width: '100%',
  },
  actionSecondaryButtonSlot: {
    flex: 1,
    flexBasis: 0,
  },
  /** Filled primary in the equal-width action row (Complete). Compact height. */
  actionPrimaryButton: {
    minHeight: 34,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  /** Equal-width row actions (Pause / Delete). flexBasis:0 prevents shrink-to-label width. */
  actionSecondaryButton: {
    minHeight: 34,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  /** Inline retry/back buttons on the error state — not in a flex row. */
  retryButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: CornerRadius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  findContractorsButton: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.base,
    borderRadius: ButtonMetrics.primaryCornerRadius,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  historySection: {
    marginTop: Spacing.sm,
  },
  sheetSurface: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: Spacing.md,
  },
  emptyHistory: {
    padding: Spacing.xl,
  },
  completionCard: {
    padding: Spacing.base,
    marginBottom: Spacing.md,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  completionNotes: {
    marginTop: Spacing.sm,
  },
  contractorHeader: {
    marginBottom: Spacing.base,
  },
  /** Icon + text heading row used by the clarification / blocker / workflow banners. */
  bannerHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  bannerHeadingText: {
    flex: 1,
  },
  blockerReportBtn: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  scheduledLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xxs,
  },
  viewAllQuotesLink: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxs,
  },
  completionPhotos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  workflowSection: {
    marginBottom: Spacing.lg,
  },
  contractorInfo: {
    marginBottom: Spacing.base,
  },
  selectedContractor: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.md,
  },
  scheduledWork: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
    marginBottom: Spacing.md,
  },
  quoteSummary: {
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  contractorActions: {
    marginTop: Spacing.sm,
  },
});

export default TaskDetailScreen;
