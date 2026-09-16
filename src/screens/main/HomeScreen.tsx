/**
 * HomeScreen — the "Today" dashboard.
 *
 * A glanceable status surface, not a launcher grid: a row of stat pills
 * (overdue / due this week / budget left / garbage), the few tasks that are
 * actually up next, and conditional "needs attention" cards that appear only
 * when there's something to act on. Navigation to full features lives in the
 * tab bar + More, so Home answers "what about my home needs me today?" instead
 * of duplicating those destinations.
 */
import { useRouter } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, RefreshControl, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import type { InsightCta } from '@/types/aihousekeeper';
import type { Task } from '@api/tasks';
import { brandId } from '@brand';
import { AdaptiveModal, AppBackground, ErrorBoundary, PermissionCard, ScreenHeader, ScreenScrollEnd, screenScrollEndTestId, SettingsGearButton } from '@components/common';
import {
  HomeAttentionCards,
  HomeMiraBrief,
  HomeProjectsHomeCard,
  HomeStatusStrip,
  HouseholdMovementFeed,
} from '@components/home';
import type { HomeStatItem } from '@components/home';
import { AdaptiveContainer } from '@components/layout';
import { AddTaskSheet, TaskCardItem, TaskDetailBottomSheet } from '@components/tasks';
import { Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { getNotificationBenefit } from '@config/brandContent';
import { useData } from '@contexts/DataContext';
import { useAihousekeeperPersona } from '@hooks/useAihousekeeperPersona';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useGarbageSummary } from '@hooks/useGarbageSummary';
import { useHomeDashboard } from '@hooks/useHomeDashboard';
import { useHomeInsight } from '@hooks/useHomeInsight';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { refreshMovementFeed } from '@hooks/useMovementFeed';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useWeather } from '@hooks/useWeather';
import { AppliancesScreen } from '@screens/appliances';
import { GarbageScheduleScreen } from '@screens/garbage';
import { navigateToBudget } from '@services/navigation';
import { widgetSync } from '@services/widget-sync';
import { useHouseholdStore } from '@stores/householdStore';
import { useMemberStore } from '@stores/memberStore';
import { useSettingsStore } from '@stores/settingsStore';
import { useTaskStore } from '@stores/taskStore';
import { CornerRadius, IconSize, Layout, Spacing, useAppColors } from '@theme';
import { formatMoneyUnits, useDisplayCurrency } from '@utils/money';
import { logMovementFeed } from '@utils/movementFeedDebug';

const UP_NEXT_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (local) timestamp of a date — comparisons ignore the time of day. */
function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Compact money for a pill: "$340", "CA$1.2k", "-$80". Input is whole units. */
function formatMoney(value: number): string {
  return formatMoneyUnits(value, { abbreviate: true });
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen() {  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();
  const router = useRouter();

  const { state: pushState, busy: pushBusy, request: requestPush } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable',
  );

  const handleInsightAction = useCallback(
    (cta: InsightCta) => {
      if (cta.route === '/budget') {
        const screen =
          cta.params?.screen === 'BudgetSettings' ? 'BudgetSettings' : 'BudgetMain';
        const activeView = cta.params?.activeView;
        const subTab = cta.params?.subTab;
        const extra =
          activeView === 'savings'
            ? {
                activeView: 'savings' as const,
                ...(subTab ? { subTab } : {}),
              }
            : subTab
              ? { subTab }
              : undefined;
        navigateToBudget(screen, extra);
        return;
      }
      router.push({ pathname: cta.route, params: cta.params });
    },
    [router]
  );

  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);
  const { upcomingTasks, maintenanceTasks } = useTaskStore();
  const { refreshActivePropertyData } = useData();
  const garbageSummary = useGarbageSummary(currentHousehold?.id);
  const weather = useWeather(currentHousehold?.id);
  const dashboard = useHomeDashboard(currentHousehold?.id);
  const { persona, name: assistantName } = useAihousekeeperPersona();
  const { insight: homeInsight } = useHomeInsight(currentHousehold?.id);

  // Mirror the freshest Mira insight into the Home Screen widget (iOS) so it
  // shows live content the moment the app loads it, ahead of its own refresh.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !homeInsight) return;
    widgetSync.setHomeInsight(homeInsight);
  }, [homeInsight]);

  const isSyncing = useSettingsStore((state) => state.isSyncing);
  const syncError = useSettingsStore((state) => state.syncError);
  const ownerPendingJoinRequests = useMemberStore((state) => state.ownerPendingJoinRequests);

  const { content: contentPadding } = useLayoutPadding();

  const [showAddTask, setShowAddTask] = useState(false);
  const [showGarbageModal, setShowGarbageModal] = useState(false);
  const [showAppliancesModal, setShowAppliancesModal] = useState(false);
  const [taskDetailTaskId, setTaskDetailTaskId] = useState<string | null>(null);
  const [taskDetailHouseholdId, setTaskDetailHouseholdId] = useState<string | null>(null);
  const [isRefreshingHome, setIsRefreshingHome] = useState(false);

  const refetchDashboard = useCallback(async () => {
    setIsRefreshingHome(true);
    try {
      await refreshActivePropertyData();
      await refreshMovementFeed('home-pull');
    } finally {
      setIsRefreshingHome(false);
    }
  }, [refreshActivePropertyData]);

  // Refresh on arrival, so Home is current the moment it is looked at. The
  // recurring poll used to live here too — it now runs app-wide in
  // `app/_layout.tsx`, because a member off this screen was receiving nothing
  // at all whenever push could not deliver.
  useFocusEffect(
    useCallback(() => {
      logMovementFeed('HomeScreen focused — refreshing Movement Feed');
      void refreshMovementFeed('home-focus');
    }, [])
  );

  // Re-sync tasks whenever Home regains focus. Tasks created, edited, or
  // completed on other screens/devices — and quick tasks the backend enriches
  // asynchronously — only mutate the store when the change originates locally.
  // Without this, Home kept showing whatever the one-time startup load fetched.
  // refreshActivePropertyData() re-fetches tasks/reports for the active property
  // (or all properties in multi-property mode) without reloading the household list.
  useFocusEffect(
    useCallback(() => {
      void refreshActivePropertyData();
    }, [refreshActivePropertyData])
  );

  // De-duplicated, active, not-yet-completed-one-time tasks across all sources.
  const activeTasks = useMemo<Task[]>(() => {
    const all = [...(upcomingTasks || []), ...(maintenanceTasks || [])];
    const unique = all.filter((task, index, self) => index === self.findIndex((t) => t.id === task.id));
    return unique.filter(
      (task) => task.is_active && !(task.frequency === 'one_time' && task.last_completed_at)
    );
  }, [upcomingTasks, maintenanceTasks]);

  // Mirror the current task list into the Home Screen widget (iOS) so its
  // urgent-task section updates from the app — not only from the widget's own
  // 15-minute-token fetch. A slim snake_case snapshot keeps the payload small;
  // the widget itself filters to overdue/due-soon and caps the count.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const snapshot = activeTasks.slice(0, 40).map((task) => ({
      id: task.id,
      title: task.title,
      next_due_date: task.next_due_date ?? null,
      priority_severity: task.priority_severity ?? null,
      system_category: task.system_category ?? null,
      is_active: task.is_active ?? true,
    }));
    widgetSync.setTasks(snapshot);
  }, [activeTasks]);

  // Counts for the status strip + the top few tasks for "Up Next".
  const { overdueCount, dueThisWeekCount, upNext } = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = today + 7 * DAY_MS;
    let overdue = 0;
    let week = 0;
    for (const task of activeTasks) {
      if (!task.next_due_date) continue;
      const due = startOfDay(new Date(task.next_due_date));
      if (due < today) overdue += 1;
      else if (due <= weekEnd) week += 1;
    }
    const sorted = [...activeTasks].sort((a, b) => {
      if (!a.next_due_date) return 1;
      if (!b.next_due_date) return -1;
      return new Date(a.next_due_date).getTime() - new Date(b.next_due_date).getTime();
    });
    return { overdueCount: overdue, dueThisWeekCount: week, upNext: sorted.slice(0, UP_NEXT_LIMIT) };
  }, [activeTasks]);

  // Stat pills — only the ones with real data show up.
  const statusItems = useMemo<HomeStatItem[]>(() => {
    const items: HomeStatItem[] = [
      {
        key: 'overdue',
        value: String(overdueCount),
        label: 'Overdue',
        icon: 'alert-circle',
        tint: overdueCount > 0 ? colors.error : undefined,
        onPress: () => router.push('/tasks'),
      },
      {
        key: 'week',
        value: String(dueThisWeekCount),
        label: 'This week',
        icon: 'calendar',
        onPress: () => router.push('/tasks'),
      },
    ];

    if (dashboard.budgetRemaining !== null) {
      items.push({
        key: 'budget',
        // budgetRemaining is in cents (matches the Budget screen) — convert to
        // dollars before the compact formatter, else $2,500 renders as "$250k".
        value: formatMoney(dashboard.budgetRemaining / 100),
        label: 'Left this mo.',
        icon: 'wallet',
        tint: dashboard.budgetRemaining < 0 ? colors.error : undefined,
        onPress: () => navigateToBudget(),
      });
    }

    if (garbageSummary.badge) {
      if (!garbageSummary.hasSchedule) {
        items.push({
          key: 'garbage',
          value: 'Set up',
          label: 'Garbage',
          icon: 'trash',
          onPress: () => setShowGarbageModal(true),
        });
      } else {
        const [day, ...rest] = garbageSummary.badge.split(' ');
        items.push({
          key: 'garbage',
          value: day,
          label: rest.join(' ') || 'Garbage',
          icon: 'trash',
          onPress: () => setShowGarbageModal(true),
        });
      }
    }

    if (weather) {
      items.push({
        key: 'weather',
        value: weather.value,
        label: weather.label,
        icon: weather.icon as HomeStatItem['icon'],
      });
    }

    return items;
  }, [overdueCount, dueThisWeekCount, dashboard.budgetRemaining, garbageSummary, weather, colors.error, router]);

  const renderTaskCard = (task: Task) => (
    <TaskCardItem
      key={task.id}
      task={task}
      testID="home-task-card"
      householdId={
        (task as { _householdId?: string })._householdId ??
        (task as { household_id?: string }).household_id
      }
      householdName={(task as { _householdName?: string })._householdName}
      onPress={() => {
        setTaskDetailTaskId(task.id);
        setTaskDetailHouseholdId(
          (task as { _householdId?: string })._householdId ??
            (task as { household_id?: string }).household_id ??
            currentHousehold?.id ??
            null
        );
      }}
    />
  );

  return (
    <AppBackground opacity={0.5}>
      <View style={styles.container} testID="home-screen">
        <ScreenHeader
          rightElement={<SettingsGearButton />}
          onNotificationPress={() => router.push('/notifications')}
          onProfilePress={() => router.push('/profile')}
        />

        {isSyncing && (
          <View style={[styles.syncPill, { backgroundColor: colors.surfaceSelected }]}>
            <ActivityIndicator size="small" color={colors.blue} />
            <Typography variant="caption1" color={colors.blue}>
              Syncing…
            </Typography>
          </View>
        )}
        {syncError && !isSyncing && (
          <View style={[styles.syncPill, { backgroundColor: colors.destructiveSubtle }]}>
            <Typography variant="caption1" color={colors.error}>
              {syncError}
            </Typography>
          </View>
        )}

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          testID="home-screen-scroll"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshingHome}
              onRefresh={() => void refetchDashboard()}
              tintColor={colors.primary}
              testID="home-refresh-control"
            />
          }
        >
          <View style={[styles.mainContent, { paddingHorizontal: contentPadding }]}>
            <AdaptiveContainer width="reading">
              {notificationBanner.visible ? (
                <PermissionCard
                  state={pushState}
                  icon="notifications"
                  title="Notifications"
                  copy={{
                    'not-requested': { body: getNotificationBenefit(brandId) },
                    denied: {
                      body: "That's a fine choice — everything still works without them. If you change your mind, notifications live in Settings.",
                    },
                  }}
                  onRequest={() => void requestPush()}
                  onOpenSettings={() => void Linking.openSettings()}
                  onDismiss={notificationBanner.dismiss}
                  busy={pushBusy}
                  layout="compact"
                  testID="home-notification-permission-card"
                />
              ) : null}

              <HomeMiraBrief
                name={assistantName}
                persona={persona}
                greeting={greetingForNow()}
                insight={homeInsight}
                onOpenAssistant={() => router.push('/mira')}
                onAction={handleInsightAction}
              />

              <HomeStatusStrip items={statusItems} />

              {/* Up Next — the few tasks that matter, not the whole list */}
              <View
                testID="home-up-next-section"
                style={[styles.section, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
              >
                <View style={styles.sectionHeader}>
                  <TouchableOpacity
                    style={[styles.addTaskChip, { backgroundColor: colors.primary + '18' }]}
                    onPress={() => setShowAddTask(true)}
                    testID="home-up-next-add-task"
                  >
                    <Icon name="add" size={IconSize.sm} color={colors.primary} />
                    <Typography variant="footnote" weight="semibold" color={colors.primary}>
                      Task
                    </Typography>
                  </TouchableOpacity>

                  <View style={styles.sectionTitleWrap} pointerEvents="none">
                    <Typography variant="headline" weight="bold" color={colors.textPrimary}>
                      Up Next
                    </Typography>
                  </View>

                  <TouchableOpacity
                    style={styles.viewAll}
                    onPress={() => router.push('/tasks')}
                    testID="home-up-next-view-all"
                    accessibilityLabel="View all tasks"
                  >
                    <Typography variant="subheadline" color={colors.primary}>
                      View all
                    </Typography>
                    <Icon name="chevron-forward" size={IconSize.sm} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                {upNext.length > 0 ? (
                  upNext.map(renderTaskCard)
                ) : (
                  <View style={styles.emptyState} testID="home-up-next-empty">
                    <Icon
                      name="checkmark-done-circle"
                      size={28}
                      color={colors.success}
                      style={styles.emptyEmoji}
                    />
                    <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
                      You're all caught up
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary} style={styles.emptyCopy}>
                      Nothing needs your attention right now.
                    </Typography>
                  </View>
                )}
              </View>

              <ErrorBoundary>
                <HomeAttentionCards
                  draftsTotal={dashboard.draftsTotal}
                  draftsCritical={dashboard.draftsCritical}
                  warrantiesExpiring={dashboard.warrantiesExpiring}
                  quotesPending={dashboard.quotesPending}
                  projectsActive={dashboard.projectsActive}
                  onDrafts={() => router.push('/reports')}
                  onWarranties={() => setShowAppliancesModal(true)}
                  onQuotes={() => router.push('/contractors')}
                  onProjects={() => router.push('/contractors')}
                />
              </ErrorBoundary>

              <ErrorBoundary>
                <HomeProjectsHomeCard />
              </ErrorBoundary>

              <HouseholdMovementFeed joinRequests={ownerPendingJoinRequests} />
            </AdaptiveContainer>
            <ScreenScrollEnd testID={screenScrollEndTestId('home-screen')} />
          </View>
        </ScrollView>

        <AddTaskSheet visible={showAddTask} onClose={() => setShowAddTask(false)} />

        <TaskDetailBottomSheet
          visible={!!taskDetailTaskId}
          taskId={taskDetailTaskId}
          householdId={taskDetailHouseholdId}
          onClose={() => {
            setTaskDetailTaskId(null);
            setTaskDetailHouseholdId(null);
          }}
        />

        <AdaptiveModal visible={showGarbageModal} onClose={() => setShowGarbageModal(false)}>
          <GarbageScheduleScreen onClose={() => setShowGarbageModal(false)} />
        </AdaptiveModal>

        <AdaptiveModal visible={showAppliancesModal} onClose={() => setShowAppliancesModal(false)}>
          <AppliancesScreen onClose={() => setShowAppliancesModal(false)} />
        </AdaptiveModal>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  syncPill: {
    position: 'absolute',
    top: 60,
    right: Spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + Spacing.xxs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + Spacing.xxs,
    borderRadius: CornerRadius.md,
    zIndex: 100,
  },
  scrollContent: {
    // Clearance so the last card never rests under the floating tab bar. The
    // add-task button now lives in the "Up Next" header, so no extra FAB room.
    paddingBottom: Layout.bottomTabBarClearance,
    backgroundColor: 'transparent',
  },
  mainContent: {
    marginTop: Spacing.base,
  },
  section: {
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.base,
    marginBottom: Spacing.base,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    position: 'relative',
  },
  // Absolutely centered so "Up Next" sits dead-center of the row regardless of
  // the flanking "+ Task" and "View all" button widths. pointerEvents=none keeps
  // the buttons tappable underneath.
  sectionTitleWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTaskChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: CornerRadius.full,
  },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
  },
  emptyEmoji: {
    marginBottom: Spacing.xs,
  },
  emptyCopy: {
    marginTop: Spacing.xxs,
    textAlign: 'center',
  },
});
