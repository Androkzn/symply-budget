import { Image } from 'expo-image';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { householdsApi, type HouseholdMember } from '@api/households';
import { Card, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Spacing, CornerRadius, useAppColors } from '@theme';

interface Props {
  householdId: string;
  /** Navigate to the full members-management screen (invite, roles, removal). */
  onManage: () => void;
}

export function PropertyMembersTab({ householdId, onManage }: Props) {  const colors = useAppColors();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await householdsApi.get(householdId);
      setMembers(res.members ?? []);
    } catch (error) {
      console.error('[PropertyMembersTab] load error:', error);
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.manageButton, { backgroundColor: colors.primary }]}
        onPress={onManage}
        activeOpacity={0.85}
        testID="property-members-manage-button"
      >
        <Typography variant="body" weight="semibold" color={colors.white}>
          Manage members & invites
        </Typography>
      </TouchableOpacity>

      <View style={styles.list}>
        {members.map((m) => {
          const name = m.display_name || m.email;
          const initial = (name || '?').charAt(0).toUpperCase();
          return (
            <Card
              key={m.id}
              variant="filled"
              style={[styles.row, { backgroundColor: colors.backgroundSecondary }]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.groupedListBackground }]}>
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={styles.avatarImg} contentFit="cover" />
                ) : (
                  <Typography variant="body" weight="semibold" color={colors.textSecondary}>
                    {initial}
                  </Typography>
                )}
              </View>
              <View style={styles.rowMain}>
                <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                  {name}
                </Typography>
                {!!m.display_name && (
                  <Typography variant="caption2" color={colors.textTertiary}>
                    {m.email}
                  </Typography>
                )}
              </View>
              <View
                style={[
                  styles.roleBadge,
                  {
                    backgroundColor:
                      m.role === 'owner' ? colors.primary + '22' : colors.groupedListBackground,
                  },
                ]}
              >
                <Typography
                  variant="caption2"
                  weight="semibold"
                  color={m.role === 'owner' ? colors.primary : colors.textSecondary}
                >
                  {m.role}
                </Typography>
              </View>
            </Card>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.base },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  manageButton: {
    paddingVertical: Spacing.base,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
  },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.base,
    borderRadius: CornerRadius.md,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  rowMain: { flex: 1, gap: Spacing.xxs },
  roleBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.full,
  },
});
