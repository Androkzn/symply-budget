import React from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';

import type { Task } from '@api/tasks';
import { Card, Typography, Button } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { BackButtonChrome, CornerRadius, IconSize, Spacing, useAppColors } from '@theme';
import { getSystemCategoryIcon } from '@utils/categoryIcons';

interface TaskCardProps {
  task: Task;
  onPress?: () => void;
  onComplete?: () => void;
  onFindContractors?: () => void;
  showFindContractors?: boolean;
}

const FREQUENCY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom',
};

export function TaskCard({
  task,
  onPress,
  onComplete,
  onFindContractors,
  showFindContractors = true,
}: TaskCardProps) {  const colors = useAppColors();

  const iconName = getSystemCategoryIcon(task.system_category);

  const frequencyLabel =
    task.frequency === 'custom' && task.custom_interval_days
      ? `Every ${task.custom_interval_days} days`
      : FREQUENCY_LABELS[task.frequency];

  const isOverdue = task.next_due_date
    ? new Date(task.next_due_date) < new Date()
    : false;

  const isDueSoon = task.next_due_date
    ? new Date(task.next_due_date) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    : false;

  const formatDueDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const content = (
    <Card
      variant="outlined"
      style={[styles.card, !task.is_active && styles.inactiveCard]}
    >
      <View style={styles.header}>
        <View
          style={[styles.iconContainer, { backgroundColor: colors.backgroundSecondary }]}
        >
          <Icon name={iconName} size={IconSize.md} color={colors.textPrimary} />
        </View>
        <View style={styles.headerContent}>
          <Typography variant="headline" weight="semibold" numberOfLines={1}>
            {task.title}
          </Typography>
          <View style={styles.badges}>
            <View style={[styles.badge, { backgroundColor: colors.backgroundSecondary }]}>
              <Typography variant="caption2" color={colors.textSecondary}>
                {frequencyLabel}
              </Typography>
            </View>
            {!task.is_active && (
              <View style={[styles.badge, { backgroundColor: colors.destructiveSubtle }]}>
                <Typography variant="caption2" color={colors.destructive}>
                  Inactive
                </Typography>
              </View>
            )}
          </View>
        </View>
      </View>

      {task.description && (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          numberOfLines={2}
          style={styles.description}
        >
          {task.description}
        </Typography>
      )}

      <View style={styles.footer}>
        <View style={styles.dueInfo}>
          {task.next_due_date ? (
            <>
              <Typography
                variant="caption1"
                color={
                  isOverdue
                    ? colors.destructive
                    : isDueSoon
                      ? colors.warning
                      : colors.textSecondary
                }
                weight={isOverdue || isDueSoon ? 'semibold' : 'regular'}
              >
                {isOverdue ? 'Overdue: ' : 'Due: '}
                {formatDueDate(task.next_due_date)}
              </Typography>
            </>
          ) : (
            <Typography variant="caption1" color={colors.textTertiary}>
              No due date set
            </Typography>
          )}
          {task.assigned_to && (
            <Typography
              variant="caption1"
              color={colors.textTertiary}
              style={styles.assignee}
            >
              {task.assigned_to.display_name || 'Assigned'}
            </Typography>
          )}
        </View>

        {onComplete && task.is_active && (
          <Button
            title="Complete"
            variant="outline"
            size="sm"
            onPress={onComplete}
          />
        )}
      </View>

      {/* Find Contractors Button */}
      {showFindContractors && task.is_active && onFindContractors && (
        <TouchableOpacity
          style={[
            styles.findContractorsButton,
            { backgroundColor: colors.primary + '15' },
          ]}
          onPress={onFindContractors}
          hitSlop={{ top: Spacing.sm, bottom: Spacing.sm, left: Spacing.sm, right: Spacing.sm }}
        >
          <Icon name="search" size={IconSize.sm} color={colors.primary} />
          <Typography variant="caption1" color={colors.primary}>
            Find Contractors
          </Typography>
        </TouchableOpacity>
      )}
    </Card>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>;
  }

  return content;
}

const iconCol = BackButtonChrome.md.size + Spacing.md;

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
  },
  inactiveCard: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconContainer: {
    width: BackButtonChrome.md.size,
    height: BackButtonChrome.md.size,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  headerContent: {
    flex: 1,
  },
  badges: {
    flexDirection: 'row',
    marginTop: Spacing.xs,
    gap: Spacing.sm,
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: CornerRadius.xs,
  },
  description: {
    marginTop: Spacing.md,
    marginLeft: iconCol,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginLeft: iconCol,
  },
  dueInfo: {
    flex: 1,
  },
  assignee: {
    marginTop: Spacing.xxs,
  },
  findContractorsButton: {
    marginTop: Spacing.md,
    marginLeft: iconCol,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
});
