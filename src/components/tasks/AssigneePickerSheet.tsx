/**
 * AssigneePickerSheet — pick which household member owns a task (or unassign).
 *
 * Reads members from the household store (already populated), so no extra fetch.
 * Used by TaskDetailScreen to make the "Assigned to" row actionable for the
 * Smart Task Assistant's household sharing (assign tasks → see who owns what).
 */
import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import type { HouseholdMember } from '@api/households';
import { Avatar, BottomSheet, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {IconSize, useAppColors } from '@theme';

interface AssigneePickerSheetProps {
  visible: boolean;
  members: HouseholdMember[];
  /** Currently assigned user id, or null when unassigned. */
  selectedUserId: string | null;
  onClose: () => void;
  /** userId to assign, or null to unassign. */
  onSelect: (userId: string | null) => void;
}

export function AssigneePickerSheet({
  visible,
  members,
  selectedUserId,
  onClose,
  onSelect,
}: AssigneePickerSheetProps) {
  const colors = useAppColors();
  const handlePick = (userId: string | null) => {
    onSelect(userId);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Assign task" showCloseButton>
      {/*
        A plain View, not a ScrollView.

        `BottomSheet` measures its body to size the sheet, and a ScrollView does
        not hug its content — the box resolves to 0, the frame hugs 0, and the
        rows lay out below the screen edge where the sheet's `overflow: hidden`
        clips them. The sheet then "opens" with nothing in it: on device the
        picker never appeared at all, so tapping "Assigned to" on the task
        detail sheet did nothing and a task could not be reassigned. The failure
        mode is written up in full at `ui/BottomSheet.tsx` ("sheet open,
        contents blank").

        A household's member list is a handful of rows, so it fits without
        scrolling; `maxHeight` stays as the guard for an unusually large one.
      */}
      <View style={styles.list}>
        {/* Unassigned option */}
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.borderColor }]}
          onPress={() => handlePick(null)}
          activeOpacity={0.7}
        >
          <View style={[styles.avatar, { backgroundColor: colors.borderColor }]}>
            <Typography variant="footnote" color={colors.textSecondary}>—</Typography>
          </View>
          <Typography variant="body" color={colors.textPrimary} style={styles.name}>
            Unassigned
          </Typography>
          {selectedUserId === null && (
            <Icon name="checkmark" size={IconSize.md} color={colors.primary} />
          )}
        </TouchableOpacity>

        {members.map((m) => {
          const isSelected = m.user_id === selectedUserId;
          return (
            <TouchableOpacity
              key={m.user_id}
              style={[styles.row, { borderBottomColor: colors.borderColor }]}
              onPress={() => handlePick(m.user_id)}
              activeOpacity={0.7}
            >
              <View style={styles.avatarWrap}>
                <Avatar
                  size="md"
                  user={{
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    email: m.email,
                  }}
                />
              </View>
              <View style={styles.nameBlock}>
                <Typography variant="body" color={colors.textPrimary}>
                  {m.display_name || m.email}
                </Typography>
                {m.role === 'owner' && (
                  <Typography variant="caption2" color={colors.textSecondary}>
                    Owner
                  </Typography>
                )}
              </View>
              {isSelected && (
                <Icon name="checkmark" size={IconSize.md} color={colors.primary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    maxHeight: 360,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarWrap: {
    marginRight: 12,
  },
  name: {
    flex: 1,
  },
  nameBlock: {
    flex: 1,
    gap: 1,
  },
});
