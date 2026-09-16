import React, { useEffect, useMemo } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';


import type { OwnerJoinRequest } from '@api/households';
import type { NotificationHistoryItem } from '@api/notifications';
import { Avatar, Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { navigateToHouseholdMembers } from '@services/navigation';
import { routeNotificationTap } from '@services/notificationRouting';
import { useMemberStore } from '@stores/memberStore';
import { useNotificationStore } from '@stores/notificationStore';
import { useAppColors } from '@theme';
import { getApiErrorMessage } from '@utils/apiError';
import { logMovementFeed } from '@utils/movementFeedDebug';

function parseNotificationData(
  item: NotificationHistoryItem
): Record<string, unknown> | null {
  if (!item.data) return null;
  try {
    return typeof item.data === 'string' ? JSON.parse(item.data) : (item.data as Record<string, unknown>);
  } catch {
    return null;
  }
}

interface HouseholdMovementFeedProps {
  joinRequests: OwnerJoinRequest[];
}

export function HouseholdMovementFeed({ joinRequests }: HouseholdMovementFeedProps) {
  const colors = useAppColors();  const notifications = useNotificationStore((s) => s.notifications);
  const approveJoinRequest = useMemberStore((s) => s.approveJoinRequest);
  const denyJoinRequest = useMemberStore((s) => s.denyJoinRequest);

  const activityItems = useMemo(() => {
    return notifications
      .filter((n) => {
        if (n.type !== 'household_update' || n.read_at) return false;
        const data = parseNotificationData(n);
        // Join requests use actionable cards above; never duplicate as activity rows.
        if (data?.updateType === 'join_request_received') {
          return false;
        }
        return true;
      })
      .slice(0, 8);
  }, [notifications]);

  useEffect(() => {
    logMovementFeed('HouseholdMovementFeed render', {
      joinRequestCount: joinRequests.length,
      activityCount: activityItems.length,
      visible: joinRequests.length > 0 || activityItems.length > 0,
    });
  }, [joinRequests.length, activityItems.length, joinRequests, activityItems]);

  if (joinRequests.length === 0 && activityItems.length === 0) {
    return null;
  }

  const handleApprove = async (request: OwnerJoinRequest) => {
    const who = request.display_name || request.email || 'This person';
    try {
      await approveJoinRequest(request.household_id, request.id);
      Alert.alert('Member added', `${who} has been added to ${request.household_name}.`);
    } catch (error) {
      Alert.alert(
        'Unable to approve',
        getApiErrorMessage(error, 'This join request could not be approved.')
      );
    }
  };

  const handleDeny = (request: OwnerJoinRequest) => {
    const who = request.display_name || request.email || 'This person';
    Alert.alert('Decline Request', `Decline ${who}'s request to join ${request.household_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => {
          void denyJoinRequest(request.household_id, request.id).catch((error) => {
            Alert.alert(
              'Unable to decline',
              getApiErrorMessage(error, 'This join request could not be declined.')
            );
          });
        },
      },
    ]);
  };

  const handleActivityTap = async (item: NotificationHistoryItem) => {
    const data = parseNotificationData(item);
    if (!data) return;
    await useNotificationStore.getState().markAsRead(item.id);
    routeNotificationTap(data);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Icon name="pulse" size={18} color={colors.primary} />
        <Typography variant="headline" weight="semibold">
          Movement
        </Typography>
      </View>

      {joinRequests.map((request) => (
        <Card
          key={request.id}
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        >
          <View style={styles.row}>
            <Avatar
              user={{
                display_name: request.display_name,
                avatar_url: request.avatar_url,
                email: request.email,
              }}
              size="md"
            />
            <View style={styles.body}>
              <Typography variant="subheadline" weight="semibold">
                {request.display_name || request.email}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Wants to join {request.household_name}
              </Typography>
            </View>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.error + '15' }]}
              onPress={() => handleDeny(request)}
            >
              <Typography variant="footnote" color={colors.error} weight="medium">
                Decline
              </Typography>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.primary + '20' }]}
              onPress={() => void handleApprove(request)}
            >
              <Typography variant="footnote" color={colors.primary} weight="medium">
                Approve
              </Typography>
            </TouchableOpacity>
          </View>
        </Card>
      ))}

      {activityItems.map((item) => {
        const data = parseNotificationData(item);
        const updateType =
          data && typeof data.updateType === 'string' ? data.updateType : undefined;
        const householdId =
          data && typeof data.householdId === 'string' ? data.householdId : undefined;

        return (
          <TouchableOpacity
            key={item.id}
            activeOpacity={0.85}
            onPress={() => void handleActivityTap(item)}
          >
            <Card
              variant="filled"
              style={[styles.activityCard, { backgroundColor: colors.backgroundSecondary }]}
            >
              <View style={styles.activityRow}>
                <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                <View style={styles.body}>
                  <Typography variant="subheadline" weight="semibold">
                    {item.title}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {item.body}
                  </Typography>
                </View>
                {householdId && updateType === 'join_request_received' ? (
                  <TouchableOpacity
                    onPress={() => navigateToHouseholdMembers(householdId)}
                    hitSlop={8}
                  >
                    <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </Card>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  card: {
    padding: 14,
    marginBottom: 10,
  },
  activityCard: {
    padding: 14,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
