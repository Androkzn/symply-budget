import { useEffect } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import { brandId } from '@brand';
import { PermissionCard } from '@components/common';
import { Button } from '@components/ui';
import { getNotificationBenefit } from '@config/brandContent';
import { InboxIcon, RemindersIcon, useBrandIconState } from '@features/kaizen/brand/iconset';
import { handleKaizenDeepLink } from '@features/kaizen/services/deepLinks';
import { useKaizenStore } from '@features/kaizen/stores/kaizenStore';
import { useNotificationStore } from '@features/kaizen/stores/notificationStore';
import { useAppColors } from '@features/kaizen/theme/appColors';
import { useDismissiblePermissionBanner } from '@hooks/useDismissiblePermissionBanner';
import { useNotificationPermission } from '@hooks/useNotificationPermission';

import { EmptyState, KaizenScreen, Section, kaizenStyles } from './common';

export function NotificationsScreen() {
  const colors = useAppColors();  const appColors = useAppColors();
  const iconState = useBrandIconState(false);
  const unreadCount = useNotificationStore(state => state.unreadCount);
  const inbox = useNotificationStore(state => state.inbox);
  const initialize = useNotificationStore(state => state.initialize);
  const refreshInbox = useNotificationStore(state => state.refreshInbox);
  const markRead = useNotificationStore(state => state.markRead);
  const markAllRead = useNotificationStore(state => state.markAllRead);
  const clearAll = useNotificationStore(state => state.clearAll);
  const scheduleDailyReminders = useKaizenStore(state => state.scheduleDailyReminders);
  const {
    state: pushState,
    busy: pushBusy,
    request: requestPush,
    refresh: refreshPushState,
  } = useNotificationPermission();
  const notificationBanner = useDismissiblePermissionBanner(
    pushState !== 'granted' && pushState !== 'unavailable'
  );

  useEffect(() => {
    void refreshInbox();
  }, [refreshInbox]);

  return (
    <KaizenScreen
      title="Notifications"
      subtitle="Reminders and updates from Kaizen."
      showBackButton
      showHeaderActions={false}
      headerTitle="Notifications"
    >
      <Section title="Status">
        <View style={[kaizenStyles.row, { borderBottomColor: colors.borderColor }]}>
          <InboxIcon size={22} state={iconState} color={colors.primary} />
          <Text style={[kaizenStyles.rowText, { color: colors.textPrimary }]}>Unread</Text>
          <Text style={{ color: colors.textSecondary }}>{unreadCount}</Text>
        </View>
        {notificationBanner.visible ? (
          <View style={{ padding: 16 }}>
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
              onRequest={() =>
                void (async () => {
                  await requestPush();
                  await initialize();
                  await scheduleDailyReminders();
                  await refreshInbox();
                  await refreshPushState();
                })()
              }
              onOpenSettings={() => void Linking.openSettings()}
              onDismiss={notificationBanner.dismiss}
              busy={pushBusy}
              layout="compact"
              testID="kaizen-notifications-permission-card"
            />
          </View>
        ) : null}
        <View style={{ padding: 16, gap: 12 }}>
          {unreadCount > 0 ? (
            <Button title="Mark all read" variant="secondary" onPress={markAllRead} />
          ) : null}
          {inbox.length > 0 ? (
            <Button title="Clear inbox" variant="outline" onPress={clearAll} />
          ) : null}
        </View>
      </Section>
      <Section title="Inbox">
        {inbox.length === 0 ? (
          <EmptyState>
            No notifications yet. Enable reminders and they will appear here when scheduled or
            delivered.
          </EmptyState>
        ) : (
          inbox.map(item => (
            <Pressable
              key={item.id}
              onPress={() => {
                markRead(item.id);
                const destination = item.data?.destination;
                if (destination === 'today') handleKaizenDeepLink('kaizen://today');
                if (destination === 'career') handleKaizenDeepLink('kaizen://career');
                if (destination === 'coach') handleKaizenDeepLink('kaizen://coach');
                if (destination === 'gtd') handleKaizenDeepLink('kaizen://gtd');
              }}
              style={[
                kaizenStyles.row,
                { alignItems: 'flex-start', borderBottomColor: colors.borderColor },
                !item.read && { backgroundColor: appColors.surfaceSelected },
              ]}
            >
              <RemindersIcon
                size={22}
                state={iconState}
                color={item.read ? colors.textTertiary : colors.primary}
              />
              <View style={kaizenStyles.rowText}>
                <Text
                  style={{
                    color: colors.textPrimary,
                    fontWeight: item.read ? '500' : '700',
                  }}
                >
                  {item.title}
                </Text>
                <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                  {item.body}
                </Text>
                  <Text style={[kaizenStyles.detail, { color: colors.textSecondary }]}>
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
              </View>
              {!item.read ? (
                <Text style={{ color: colors.primary, fontWeight: '700' }}>New</Text>
              ) : null}
            </Pressable>
          ))
        )}
      </Section>
    </KaizenScreen>
  );
}
