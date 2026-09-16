import { useRouter } from 'expo-router';
import { useFocusEffect } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState, useRef } from 'react';
import { StyleSheet, View, FlatList, RefreshControl, Linking, Animated, Alert } from 'react-native';
import { Swipeable, TouchableOpacity } from 'react-native-gesture-handler';

import { NotificationHistoryItem } from '@api/notifications';
import type { RecurringReminder, RecurringReminderFrequency } from '@api/recurringReminders';
import {
  SafeAreaView,
  AppBackground,
  PermissionCard,
  ScreenHeader,
  ScreenScrollEnd,
  screenScrollEndTestId,
  
  FrequencyPickerSheet,
} from '@components/common';
import { AdaptiveContainer } from '@components/layout';
import { Card, FilterTabs, Typography, type FilterTab } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import { useData } from '@contexts/DataContext';
import { useTheme } from '@contexts/ThemeContext';
import { useDeviceType } from '@hooks/useDeviceType';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import {
  useNotificationHistory,
  useUnreadNotifications,
  useInvalidateNotificationHistory,
} from '@hooks/useNotificationHistory';
import { useNotificationPermission } from '@hooks/useNotificationPermission';
import { useRecurringReminders } from '@hooks/useRecurringReminders';
import type { MainTabScreenProps } from '@navigation/types';
import { routeNotificationTap } from '@services/notificationRouting';
import { useNotificationStore } from '@stores/notificationStore';
import { ButtonMetrics, Layout, CornerRadius, Spacing, useAppColors } from '@theme';
import { SESSION_EXPIRED_MESSAGE, isSessionExpiredError } from '@utils/apiError';
import type { IoniconName } from '@utils/categoryIcons';
import {
  isNotificationVisibleForBrand,
  notificationsBannerBlurb,
} from '@utils/notificationVisibility';

const NOTIFICATION_ICONS: Record<string, IoniconName> = {
  task_reminder: 'alarm',
  task_overdue: 'warning',
  task_assigned: 'document-text',
  task_completed: 'checkmark-circle',
  household_update: 'home',
  report_ready: 'document-text',
  weekly_summary: 'bar-chart',
  garbage_collection: 'trash',
  garbage_missed: 'trash',
  budget_alert: 'cash',
  budget_digest: 'bar-chart',
  budget_encouragement: 'sparkles',
  ai_key_shared: 'key',
  ai_disconnected: 'alert-circle',
  default: 'notifications',
};

const SWIPE_ACTION_WIDTH = 76;

/**
 * Every write on this screen fails the same way when the session dies: the
 * request 401s, the interceptor has already failed to refresh it, and the app
 * is on its way to the login screen. Telling the member to "try again" there
 * sends them into a loop that can never succeed — say what actually happened.
 */
function writeFailureMessage(error: unknown, fallback: string): string {
  return isSessionExpiredError(error) ? SESSION_EXPIRED_MESSAGE : fallback;
}

/**
 * The "Active" tab is a single list of everything still waiting on the member,
 * from both sources: pending recurring reminders (the "keep nagging until it's
 * done" engine) and notifications they haven't read yet. Reminders sort first —
 * they carry an action — then unread notifications, newest first.
 */
type ActiveItem =
  | { kind: 'reminder'; id: string; reminder: RecurringReminder }
  | { kind: 'notification'; id: string; notification: NotificationHistoryItem };

export function NotificationsScreen({ navigation }: Partial<MainTabScreenProps<'Notifications'>>) {
  const { theme } = useTheme();
  const colors = useAppColors();
  const router = useRouter();
  const { isTablet, isLandscape, columns } = useDeviceType();
  const {
    data: historyPage,
    isLoading,
    isFetching,
    refetch,
    loadMore,
  } = useNotificationHistory();
  const invalidateHistory = useInvalidateNotificationHistory();
  const notifications = useMemo(() => historyPage?.notifications ?? [], [historyPage?.notifications]);
  const hasMore = historyPage?.hasMore ?? false;
  const {
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteAllNotifications,
  } = useNotificationStore();
  const { refreshActivePropertyData } = useData();
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  // "Active" tab — everything still waiting on the member: pending recurring
  // reminders (mortgage statement upload, etc.) AND notifications they haven't
  // read yet. History is the full log, read and unread alike, so a notification
  // is never *only* in Active — reading it just drops it out of this tab.
  //
  // Unread comes from its own `unread_only` query rather than being filtered out
  // of the history page: history paginates 20 at a time, so anything past the
  // first page would go missing here and the tab count would disagree with the
  // bell badge (which the server counts across every row).
  const {
    reminders: activeReminders,
    frequencyOptions,
    isLoading: isLoadingReminders,
    refetch: refetchReminders,
    complete: completeReminder,
    setFrequency: setReminderFrequency,
  } = useRecurringReminders();
  const {
    data: unreadPage,
    isLoading: isLoadingUnread,
    refetch: refetchUnread,
  } = useUnreadNotifications();
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [completingReminderId, setCompletingReminderId] = useState<string | null>(null);
  const [frequencyPickerReminder, setFrequencyPickerReminder] = useState<RecurringReminder | null>(null);

  // Handle navigation with both React Navigation and Expo Router
  const handleGoBack = useCallback(() => {
    if (navigation?.goBack) {
      navigation.goBack();
    } else {
      router.back();
    }
  }, [navigation, router]);
  const [refreshing, setRefreshing] = useState(false);
  const {
    state: pushState,
    busy: pushBusy,
    request: requestPush,
    refresh: refreshPushState,
  } = useNotificationPermission();

  // Consistent layout padding
  const { content: containerPadding, cardGap } = useLayoutPadding();

  // Child apps (Budget/Kaizen/Health) must never show House-domain notifications
  // (task/garbage/AI-Housekeeper). The backend now gates their generation to the
  // House Worker; this hides any legacy rows still in a child app's cloned D1.
  const visibleNotifications = useMemo(
    () => notifications.filter((n) => isNotificationVisibleForBrand(n.type)),
    [notifications],
  );

  const unreadNotifications = useMemo(
    () =>
      (unreadPage?.notifications ?? []).filter(
        (n) => !n.read_at && isNotificationVisibleForBrand(n.type),
      ),
    [unreadPage],
  );

  const activeItems = useMemo<ActiveItem[]>(
    () => [
      ...activeReminders.map((reminder) => ({
        kind: 'reminder' as const,
        id: `reminder:${reminder.id}`,
        reminder,
      })),
      ...unreadNotifications.map((notification) => ({
        kind: 'notification' as const,
        id: `notification:${notification.id}`,
        notification,
      })),
    ],
    [activeReminders, unreadNotifications],
  );

  const refreshNotifications = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchUnread(), refetchReminders()]);
    } catch (error) {
      console.error('Failed to load notifications:', error);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchUnread, refetchReminders]);

  useFocusEffect(
    useCallback(() => {
      void refreshPushState();
      void refreshNotifications();
    }, [refreshPushState, refreshNotifications])
  );

  const handleRefresh = () => {
    void refreshNotifications();
  };

  const handleLoadMore = () => {
    if (!isLoading && !isFetching && hasMore) {
      void loadMore();
    }
  };

  const handleMarkAsRead = useCallback(
    async (notification: NotificationHistoryItem) => {
      if (notification.read_at) return;

      try {
        await markAsRead(notification.id);
        await invalidateHistory();
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    },
    [markAsRead, invalidateHistory]
  );

  const handleDeleteNotification = useCallback(
    async (notification: NotificationHistoryItem) => {
      if (deletingId) return;

      setDeletingId(notification.id);
      try {
        await deleteNotification(notification.id);
        await invalidateHistory();
      } catch (error) {
        console.error('Failed to delete notification:', error);
        Alert.alert(
          'Error',
          writeFailureMessage(error, 'Could not delete notification. Please try again.')
        );
      } finally {
        setDeletingId(null);
        swipeableRefs.current.get(notification.id)?.close();
      }
    },
    [deletingId, deleteNotification, invalidateHistory]
  );

  /**
   * Navigate FIRST, then do the read bookkeeping behind it.
   *
   * A tap is a request to go somewhere, and marking read is four sequential
   * round trips before that could happen: the read POST, the badge refresh
   * inside the store, then an invalidation of BOTH notification queries, each
   * refetching because both are mounted here. Awaiting all of it left the
   * member on an unchanged screen for as long as the network took — while the
   * row they tapped vanished out of Active, since it had just become read. A
   * tap that removes what you tapped and goes nowhere reads as a dead button,
   * which is exactly how "tapping the invite notification does nothing" was
   * reported.
   *
   * Nothing below needs to finish before the destination renders, and this
   * screen is usually gone by then — `markAsRead` writes to the store and the
   * server, neither of which cares whether this component still exists.
   */
  const handleNotificationTap = (notification: NotificationHistoryItem) => {
    if (notification.data) {
      try {
        const data =
          typeof notification.data === 'string'
            ? JSON.parse(notification.data)
            : notification.data;

        routeNotificationTap(data, {
          beforeNavigate: handleGoBack,
          refreshHouseholdData: refreshActivePropertyData,
        });
      } catch (e) {
        console.error('Failed to parse notification data:', e);
      }
    }
    void handleMarkAsRead(notification);
  };

  // Tapping an Active reminder resolves through the exact same routing a
  // tapped push notification uses — same action, whichever entry point.
  const handleReminderTap = useCallback(
    (reminder: RecurringReminder) => {
      if (!reminder.data) return;
      try {
        routeNotificationTap(JSON.parse(reminder.data), { beforeNavigate: handleGoBack });
      } catch (e) {
        console.error('Failed to parse reminder data:', e);
      }
    },
    [handleGoBack]
  );

  const handleMarkReminderDone = useCallback(
    async (reminder: RecurringReminder) => {
      if (completingReminderId) return;
      setCompletingReminderId(reminder.id);
      try {
        await completeReminder(reminder.id);
      } catch (error) {
        console.error('Failed to mark reminder done:', error);
        Alert.alert(
          'Error',
          writeFailureMessage(error, 'Could not mark this as done. Please try again.')
        );
      } finally {
        setCompletingReminderId(null);
      }
    },
    [completingReminderId, completeReminder]
  );

  const handleFrequencySelect = useCallback(
    async (frequency: RecurringReminderFrequency) => {
      if (!frequencyPickerReminder) return;
      try {
        await setReminderFrequency(frequencyPickerReminder.id, frequency);
      } catch (error) {
        console.error('Failed to update reminder frequency:', error);
        Alert.alert(
          'Error',
          writeFailureMessage(
            error,
            'Could not update how often you get reminded. Please try again.'
          )
        );
      }
    },
    [frequencyPickerReminder, setReminderFrequency]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    if (isMarkingAllRead) return;

    setIsMarkingAllRead(true);
    try {
      await markAllAsRead();
      await invalidateHistory();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
      Alert.alert(
        'Error',
        writeFailureMessage(error, 'Could not mark notifications as read. Please try again.')
      );
    } finally {
      setIsMarkingAllRead(false);
    }
  }, [isMarkingAllRead, markAllAsRead, invalidateHistory]);

  const handleClearAll = useCallback(() => {
    if (isClearingAll || visibleNotifications.length === 0) return;

    Alert.alert(
      'Clear All Notifications',
      'Delete all notifications from your history? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setIsClearingAll(true);
            try {
              await deleteAllNotifications();
              await invalidateHistory();
            } catch (error) {
              console.error('Failed to clear notifications:', error);
              Alert.alert(
                'Error',
                writeFailureMessage(error, 'Could not clear notifications. Please try again.')
              );
            } finally {
              setIsClearingAll(false);
            }
          },
        },
      ]
    );
  }, [isClearingAll, deleteAllNotifications, invalidateHistory, visibleNotifications.length]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatNextNudge = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isSameDay = date.toDateString() === now.toDateString();
    if (isSameDay) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    notification: NotificationHistoryItem
  ) => {
    const isDeleting = deletingId === notification.id;

    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [SWIPE_ACTION_WIDTH, 0],
    });

    return (
      <Animated.View
        style={[
          styles.swipeActionsRow,
          { width: SWIPE_ACTION_WIDTH, transform: [{ translateX }] },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.swipeAction,
            { backgroundColor: colors.error },
            isDeleting && styles.swipeActionDisabled,
          ]}
          onPress={() => handleDeleteNotification(notification)}
          disabled={isDeleting}
          activeOpacity={0.85}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Icon name="trash-outline" size={22} color={colors.white} />
          )}
          <Typography
            variant="caption1"
            weight="semibold"
            color={colors.white}
            style={styles.swipeActionLabel}
          >
            {isDeleting ? 'Deleting' : 'Delete'}
          </Typography>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderNotification = ({ item }: { item: NotificationHistoryItem }) => {
    const icon = NOTIFICATION_ICONS[item.type] || NOTIFICATION_ICONS.default;
    const isUnread = !item.read_at;

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) swipeableRefs.current.set(item.id, ref);
          else swipeableRefs.current.delete(item.id);
        }}
        renderRightActions={(progress) => renderRightActions(progress, item)}
        overshootRight={false}
        friction={2}
      >
        <TouchableOpacity onPress={() => handleNotificationTap(item)} activeOpacity={0.7} testID="notification-row">
          <Card
            variant="outlined"
            style={[
              styles.notificationCard,
              isUnread && { backgroundColor: colors.surfaceSelected },
            ]}
          >
            <View style={styles.notificationContent}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: colors.groupedListBackground },
                ]}
              >
                <Icon name={icon} size={24} color={colors.accent} />
              </View>
              <View style={styles.textContainer}>
                <View style={styles.titleRow}>
                  <Typography
                    variant="headline"
                    weight={isUnread ? 'semibold' : 'regular'}
                    numberOfLines={1}
                    style={styles.title}
                    color={colors.textPrimary}
                  >
                    {item.title}
                  </Typography>
                  {isUnread && (
                    <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} />
                  )}
                </View>
                <Typography
                  variant="body"
                  color={colors.textSecondary}
                  numberOfLines={2}
                >
                  {item.body}
                </Typography>
                <Typography
                  variant="caption1"
                  color={colors.textTertiary}
                  style={styles.timestamp}
                >
                  {formatTime(item.sent_at)}
                </Typography>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer} testID="notifications-empty-state">
      <View style={styles.emptyIcon}>
        <Icon name="notifications" size={40} color={colors.textSecondary} />
      </View>
      <Typography
        variant="title3"
        weight="semibold"
        align="center"
        color={colors.textPrimary}
      >
        No Notifications
      </Typography>
      <Typography
        variant="body"
        color={colors.textSecondary}
        align="center"
        style={styles.emptyText}
      >
        You're all caught up! New notifications will appear here.
      </Typography>
    </View>
  );

  const renderActiveReminder = (item: RecurringReminder) => {
    const icon = NOTIFICATION_ICONS[item.type] || NOTIFICATION_ICONS.default;
    const isCompleting = completingReminderId === item.id;

    return (
      <Card variant="outlined" style={styles.notificationCard} testID="active-reminder-row">
        <TouchableOpacity onPress={() => handleReminderTap(item)} activeOpacity={0.7}>
          <View style={styles.notificationContent}>
            <View style={[styles.iconContainer, { backgroundColor: colors.groupedListBackground }]}>
              <Icon name={icon} size={24} color={colors.accent} />
            </View>
            <View style={styles.textContainer}>
              <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                {item.title}
              </Typography>
              <Typography variant="body" color={colors.textSecondary} numberOfLines={2}>
                {item.body}
              </Typography>
              <Typography variant="caption1" color={colors.textTertiary} style={styles.timestamp}>
                Next reminder: {formatNextNudge(item.next_nudge_at)}
                {item.nudge_count > 0 ? ` · nudged ${item.nudge_count}×` : ''}
              </Typography>
            </View>
          </View>
        </TouchableOpacity>
        <View style={styles.reminderActions}>
          <TouchableOpacity
            style={[
              styles.reminderActionButton,
              // NOT groupedListBackground: on the "clean" skin that token and the
              // card's own background are both palette.clean.surface, so the
              // secondary action rendered as bare text with no button around it.
              { backgroundColor: colors.secondaryButtonBackground, borderColor: colors.borderColor },
            ]}
            onPress={() => setFrequencyPickerReminder(item)}
            activeOpacity={0.7}
            testID="active-reminder-frequency"
          >
            <Icon name="time-outline" size={16} color={colors.textSecondary} />
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary} style={styles.reminderActionLabel}>
              Remind me
            </Typography>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.reminderActionButton,
              { backgroundColor: colors.success, borderColor: colors.success },
            ]}
            onPress={() => handleMarkReminderDone(item)}
            disabled={isCompleting}
            activeOpacity={0.7}
            testID="active-reminder-complete"
          >
            {isCompleting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Icon name="checkmark" size={16} color={colors.white} />
                <Typography variant="footnote" weight="semibold" color={colors.white} style={styles.reminderActionLabel}>
                  Mark done
                </Typography>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  const renderActiveItem = ({ item }: { item: ActiveItem }) =>
    item.kind === 'reminder'
      ? renderActiveReminder(item.reminder)
      : renderNotification({ item: item.notification });

  const renderActiveEmpty = () => (
    <View style={styles.emptyContainer} testID="active-reminders-empty-state">
      <View style={styles.emptyIcon}>
        <Icon name="checkmark-circle" size={40} color={colors.textSecondary} />
      </View>
      <Typography variant="title3" weight="semibold" align="center" color={colors.textPrimary}>
        Nothing pending
      </Typography>
      <Typography variant="body" color={colors.textSecondary} align="center" style={styles.emptyText}>
        You're all caught up — new notifications and reminders you haven't resolved yet will
        show up here.
      </Typography>
    </View>
  );

  const renderFooter = () => (
    <>
      {hasMore && visibleNotifications.length > 0 ? (
        <View style={styles.footer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : null}
      <ScreenScrollEnd testID={screenScrollEndTestId('notifications-screen')} />
    </>
  );

  const renderPushBanner = () => {
    // Deliberately never dismissible — a difference from the ambient Home/tab
    // cards, since this screen IS the Notifications hub: if push is off, that
    // fact belongs here every time, not something to wave away for a session.
    if (pushState === 'granted' || pushState === 'unavailable') return null;

    return (
      <View style={styles.pushBanner}>
        <PermissionCard
          state={pushState}
          icon="notifications"
          title="Notifications"
          copy={{
            'not-requested': { body: notificationsBannerBlurb() },
            denied: {
              body: 'Nothing can reach this device until notifications are allowed again in Settings.',
            },
          }}
          onRequest={() => void requestPush()}
          onOpenSettings={() => void Linking.openSettings()}
          busy={pushBusy}
          layout="compact"
          testID="notifications-permission-card"
        />
      </View>
    );
  };

  // Unread comes from the dedicated unread query, not the loaded history page —
  // page 1 can be entirely read while older unread rows still exist.
  const hasUnread = unreadNotifications.length > 0;
  const hasNotifications = visibleNotifications.length > 0;

  const headerToolbarStyle = useMemo(
    () => ({
      backgroundColor: theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.78)',
      borderColor: theme.dark ? 'rgba(255,255,255,0.14)' : 'rgba(60,60,67,0.1)',
    }),
    [theme.dark]
  );

  // "Clear all" wipes the whole history, so it only belongs on the History tab;
  // Active gets "mark all read", which is exactly how a member empties it.
  const renderHeaderToolbar = (scope: 'active' | 'history') => {
    const showClearAll = scope === 'history' && hasNotifications;
    if (!hasUnread && !showClearAll) return null;

    return (
      <View style={[styles.headerToolbar, headerToolbarStyle]}>
        {hasUnread ? (
          <TouchableOpacity
            onPress={handleMarkAllAsRead}
            style={styles.headerToolbarButton}
            disabled={isMarkingAllRead}
            accessibilityRole="button"
            accessibilityLabel="Mark all notifications as read"
            activeOpacity={0.7}
          >
            {isMarkingAllRead ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="checkmark-done" size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
        ) : null}
        {hasUnread && showClearAll ? (
          <View style={[styles.headerToolbarDivider, { backgroundColor: colors.divider }]} />
        ) : null}
        {showClearAll ? (
          <TouchableOpacity
            onPress={handleClearAll}
            style={styles.headerToolbarButton}
            disabled={isClearingAll}
            accessibilityRole="button"
            accessibilityLabel="Clear all notifications"
            activeOpacity={0.7}
          >
            {isClearingAll ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Icon name="trash-outline" size={20} color={colors.error} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const notificationTabs: FilterTab[] = useMemo(
    () => [
      { id: 'active', label: 'Active', count: activeItems.length },
      { id: 'history', label: 'History' },
    ],
    [activeItems.length]
  );

  const renderTabBar = () => (
    <View style={styles.tabBarWrapper} testID="notifications-tab-bar">
      <FilterTabs
        tabs={notificationTabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'active' | 'history')}
        showActiveIndicator={false}
      />
    </View>
  );

  // FlatList's numColumns can't change on an already-mounted instance ("Changing
  // numColumns on the fly is not supported") — isTablet/isLandscape/columns can
  // all shift after mount (rotation, Split View/Stage Manager resize), so each
  // grid gets a `key` tied to its own effective column count to force a fresh
  // mount instead of an in-place prop change. The two `history` variants also
  // need DISTINCT keys from each other, since without one React would treat
  // swapping between them (same JSX position, same `FlatList` type) as an
  // update to the same instance too.
  const activeRemindersNumColumns = isTablet && isLandscape ? Math.min(columns, 2) : 1;
  const historyGridNumColumns = Math.min(columns, 2);

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={[]}>
        <View style={styles.container} testID="notifications-screen">
          <ScreenHeader
            title="Notifications"
            showBackButton
            onBackPress={handleGoBack}
            showNotificationBell={false}
            showAvatar={false}
            rightElement={renderHeaderToolbar(activeTab)}
          />

          {renderTabBar()}
          {renderPushBanner()}

          {activeTab === 'active' ? (
            (isLoadingReminders || isLoadingUnread) && activeItems.length === 0 ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <AdaptiveContainer maxWidth={isTablet ? 1400 : undefined} padding={containerPadding}>
                <FlatList
                  key={`active-reminders-${activeRemindersNumColumns}`}
                  data={activeItems}
                  keyExtractor={(item) => item.id}
                  renderItem={renderActiveItem}
                  numColumns={activeRemindersNumColumns}
                  columnWrapperStyle={isTablet && isLandscape ? styles.columnWrapper : undefined}
                  contentContainerStyle={[styles.listContent, { gap: cardGap }]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
                  ListEmptyComponent={renderActiveEmpty}
                  ListFooterComponent={<ScreenScrollEnd testID={screenScrollEndTestId('notifications-active-screen')} />}
                />
              </AdaptiveContainer>
            )
          ) : isLoading && visibleNotifications.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <AdaptiveContainer maxWidth={isTablet ? 1400 : undefined} padding={containerPadding}>
              {isTablet && isLandscape ? (
                <FlatList
                  key={`notifications-grid-${historyGridNumColumns}`}
                  data={visibleNotifications}
                  keyExtractor={(item) => item.id}
                  renderItem={renderNotification}
                  numColumns={historyGridNumColumns}
                  columnWrapperStyle={styles.columnWrapper}
                  contentContainerStyle={[styles.listContent, { gap: cardGap }]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                  }
                  ListEmptyComponent={renderEmpty}
                  ListFooterComponent={renderFooter}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.5}
                />
              ) : (
                <FlatList
                  key="notifications-list-1"
                  data={visibleNotifications}
                  keyExtractor={(item) => item.id}
                  renderItem={renderNotification}
                  contentContainerStyle={[styles.listContent, { gap: cardGap }]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                  }
                  ListEmptyComponent={renderEmpty}
                  ListFooterComponent={renderFooter}
                  onEndReached={handleLoadMore}
                  onEndReachedThreshold={0.5}
                />
              )}
            </AdaptiveContainer>
          )}
        </View>
      </SafeAreaView>

      <FrequencyPickerSheet
        visible={frequencyPickerReminder !== null}
        onClose={() => setFrequencyPickerReminder(null)}
        options={frequencyOptions}
        selectedId={frequencyPickerReminder?.frequency}
        onSelect={handleFrequencySelect}
      />
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerSide: {
    width: 88,
    justifyContent: 'center',
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: CornerRadius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xxs,
    paddingVertical: Spacing.xxs,
  },
  tabBarWrapper: {
    marginHorizontal: 16,
    marginBottom: Spacing.sm,
  },
  reminderActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  /**
   * Two equal halves filling the card's width — `flexBasis: 0` + `minWidth: 0`
   * so the split comes from the row, not from how wide each label happens to
   * measure (which left both buttons hugging their text at the card's left
   * edge). `borderWidth` lives here, with the color set per button, so the
   * outlined secondary and the filled primary stay the same height.
   */
  reminderActionButton: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: ButtonMetrics.minTapTarget,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderRadius: CornerRadius.lg,
  },
  reminderActionLabel: {
    marginLeft: Spacing.xs,
  },
  headerToolbarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerToolbarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    opacity: 0.6,
  },
  listContent: {
    paddingTop: 0,
    // Floating tab bar clearance — required for tab-root scrollables.
    // See documents/Design and UX/DesignSystem.md §3.
    paddingBottom: Layout.bottomTabBarClearance,
    flexGrow: 1,
    backgroundColor: 'transparent',
  },
  columnWrapper: {
    gap: 16,
  },
  notificationCard: {
    padding: 16,
  },
  notificationContent: {
    flexDirection: 'row',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  timestamp: {
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyText: {
    marginTop: 8,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  pushBanner: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  swipeActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: Spacing.sm,
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    borderRadius: CornerRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  swipeActionDisabled: {
    opacity: 0.6,
  },
  swipeActionLabel: {
    marginTop: Spacing.xs,
  },
});
