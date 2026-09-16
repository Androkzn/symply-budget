import React, { useMemo } from 'react';
import { StyleSheet, View, Animated, Alert } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';

import type { MaintenanceSubtask } from '@api/tasks';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import {CornerRadius, IconSize, LegacyTextVariant, Spacing, useAppColors } from '@theme';

interface SubtaskItemProps {
  subtask: MaintenanceSubtask;
  onToggle: (subtaskId: string, isCompleted: boolean) => void;
  onEdit: (subtask: MaintenanceSubtask) => void;
  onDelete: (subtaskId: string) => void;
  disabled?: boolean;
}

export function SubtaskItem({
  subtask,
  onToggle,
  onEdit,
  onDelete,
  disabled = false,
}: SubtaskItemProps) {
  const colors = useAppColors();  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginBottom: Spacing.sm,
        },
        itemRow: {
          flexDirection: 'row',
          alignItems: 'center',
          padding: Spacing.smd + Spacing.xs,
          borderRadius: CornerRadius.md,
          gap: Spacing.md,
        },
        checkbox: {
          width: Spacing.xl,
          height: Spacing.xl,
          borderRadius: Spacing.xs + Spacing.xxs,
          borderWidth: Spacing.xxs,
          alignItems: 'center',
          justifyContent: 'center',
        },
        content: {
          flex: 1,
        },
        title: {
          fontSize: LegacyTextVariant.callout.size,
          lineHeight: LegacyTextVariant.callout.lineHeight,
        },
        titleCompleted: {
          textDecorationLine: 'line-through',
        },
        description: {
          marginTop: Spacing.xs,
          lineHeight: LegacyTextVariant.footnote.lineHeight,
        },
        reminderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: Spacing.xxs,
          marginTop: Spacing.xs + Spacing.xxs,
        },
        menuButton: {
          padding: Spacing.xs,
        },
      }),
    []
  );
  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    console.log('[SubtaskItem] handlePress called', { subtaskId: subtask.id, disabled });
    if (disabled) return;

    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.97,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true,
      }),
    ]).start();

    onToggle(subtask.id, subtask.is_completed);
  };

  const handleLongPress = () => {
    console.log('[SubtaskItem] handleLongPress called', { subtaskId: subtask.id, disabled });
    if (disabled) return;

    Alert.alert(
      subtask.title,
      'Choose an action',
      [
        {
          text: 'Edit',
          onPress: () => onEdit(subtask),
        },
        {
          text: 'Delete',
          onPress: () => {
            Alert.alert(
              'Delete Subtask',
              'Are you sure you want to delete this subtask?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => onDelete(subtask.id),
                },
              ]
            );
          },
          style: 'destructive',
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        style={[styles.itemRow, { backgroundColor: colors.backgroundSecondary }]}
        onPress={handlePress}
        onLongPress={handleLongPress}
        disabled={disabled}
        activeOpacity={0.7}
        testID={`subtask-item-${subtask.id}`}
      >
        <View
          testID={`subtask-checkbox-${subtask.id}`}
          style={[
            styles.checkbox,
            {
              borderColor: subtask.is_completed ? colors.primary : colors.borderColor,
              backgroundColor: subtask.is_completed ? colors.primary : 'transparent',
            },
          ]}
        >
          {subtask.is_completed && (
            <Icon name="checkmark" size={IconSize.sm} color={colors.backgroundSecondary} />
          )}
        </View>

        <View style={styles.content}>
          <Typography
            variant="body"
            color={subtask.is_completed ? colors.textTertiary : colors.textPrimary}
            style={[styles.title, subtask.is_completed && styles.titleCompleted]}
          >
            {subtask.title}
          </Typography>

          {subtask.description && (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              style={styles.description}
              numberOfLines={2}
            >
              {subtask.description}
            </Typography>
          )}

          {subtask.reminder_enabled && subtask.reminder_date && (
            <View style={styles.reminderRow}>
              <Icon name="notifications" size={12} color={colors.textTertiary} />
              <Typography variant="caption2" color={colors.textTertiary}>
                Reminder set
              </Typography>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.menuButton}
          onPress={handleLongPress}
          disabled={disabled}
          hitSlop={{ top: Spacing.smd, bottom: Spacing.smd, left: Spacing.smd, right: Spacing.smd }}
          activeOpacity={0.7}
        >
          <Icon name="ellipsis-vertical" size={IconSize.md} color={colors.textTertiary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}
