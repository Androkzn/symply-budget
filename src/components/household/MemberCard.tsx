import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';

import type { HouseholdMember } from '@api/households';
import { Card, Typography, Avatar } from '@components/ui';
import { useAppColors } from '@theme';

import { MemberStatusBadge } from './MemberStatusBadge';

interface MemberCardProps {
  member: HouseholdMember;
  isCurrentUser: boolean;
  currentUserRole: 'owner' | 'member';
  onRemove?: () => void;
  onChangeRole?: () => void;
  taskStats?: {
    assigned: number;
    completed: number;
    completionRate: number;
  };
}

export function MemberCard({
  member,
  isCurrentUser,
  currentUserRole,
  onRemove,
  onChangeRole,
  taskStats,
}: MemberCardProps) {
  const colors = useAppColors();
  const canRemove = currentUserRole === 'owner' && !isCurrentUser;
  const canChangeRole = currentUserRole === 'owner' && !isCurrentUser;

  const handleRemove = () => {
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${member.display_name || member.email} from this property?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: onRemove,
        },
      ]
    );
  };

  const handleChangeRole = () => {
    const newRole = member.role === 'owner' ? 'member' : 'owner';
    const roleName = newRole === 'owner' ? 'Owner' : 'Member';

    Alert.alert(
      'Change Role',
      `Change ${member.display_name || member.email}'s role to ${roleName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change',
          onPress: onChangeRole,
        },
      ]
    );
  };

  return (
    <Card variant="filled" style={styles.card}>
      <View style={styles.header}>
        <Avatar
          user={{
            display_name: member.display_name,
            avatar_url: member.avatar_url,
            email: member.email,
          }}
          size="md"
        />

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Typography variant="body" weight="semibold">
              {/* Their address before "No Name": a member who never set a
                  display name is still someone this household recognises by
                  the address they were invited at, and every other member
                  surface already falls back that way. */}
              {member.display_name?.trim() || member.email || 'No Name'}
            </Typography>
            {isCurrentUser && (
              <Typography
                variant="caption2"
                color={colors.primary}
                weight="semibold"
                style={styles.youBadge}
              >
                (YOU)
              </Typography>
            )}
          </View>

          <Typography variant="footnote" color={colors.textSecondary}>
            {member.email}
          </Typography>

          <View style={styles.badgeRow}>
            <MemberStatusBadge role={member.role} size="sm" />
            <Typography
              variant="caption2"
              color={colors.textTertiary}
              style={styles.joinedDate}
            >
              Joined {new Date(member.joined_at).toLocaleDateString()}
            </Typography>
          </View>
        </View>
      </View>

      {taskStats && (
        <View
          style={[
            styles.stats,
            {
              backgroundColor: colors.groupedListBackground,
              borderColor: colors.borderColor,
            },
          ]}
        >
          <View style={styles.statItem}>
            <Typography variant="title3" weight="bold">
              {taskStats.assigned}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              Assigned
            </Typography>
          </View>

          <View
            style={[styles.statDivider, { backgroundColor: colors.borderColor }]}
          />

          <View style={styles.statItem}>
            <Typography variant="title3" weight="bold">
              {taskStats.completed}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              Completed
            </Typography>
          </View>

          <View
            style={[styles.statDivider, { backgroundColor: colors.borderColor }]}
          />

          <View style={styles.statItem}>
            <Typography variant="title3" weight="bold" color={colors.primary}>
              {taskStats.completionRate}%
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              Rate
            </Typography>
          </View>
        </View>
      )}

      {(canRemove || canChangeRole) && (
        <View style={styles.actions}>
          {canChangeRole && (
            <TouchableOpacity
              onPress={handleChangeRole}
              style={[
                styles.actionButton,
                { backgroundColor: colors.groupedListBackground },
              ]}
            >
              <Typography variant="footnote" color={colors.primary}>
                Change Role
              </Typography>
            </TouchableOpacity>
          )}

          {canRemove && (
            <TouchableOpacity
              onPress={handleRemove}
              style={[
                styles.actionButton,
                { backgroundColor: colors.error + '15' },
              ]}
            >
              <Typography variant="footnote" color={colors.error}>
                Remove
              </Typography>
            </TouchableOpacity>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  info: {
    flex: 1,
    marginLeft: 12,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  youBadge: {
    marginLeft: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  joinedDate: {
    marginLeft: 8,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    marginHorizontal: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
});
