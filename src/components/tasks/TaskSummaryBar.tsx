import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View, TouchableOpacity, Platform } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import type { BoardSummary } from '@hooks/useTaskBoardData';
import { CornerRadius, Elevation, IconSize, Shadow, Spacing, useAppColors } from '@theme';

export type SummaryKind = 'overdue' | 'dueToday' | 'mine' | 'blocked';

interface TaskSummaryBarProps {
  summary: BoardSummary;
  activeKinds?: SummaryKind[];
  onSelect: (kind: SummaryKind) => void;
}

interface StatDef {
  kind: SummaryKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  value: number;
}

/**
 * A row of tappable stat tiles (Overdue / Due today / Mine / Blocked).
 * Tapping one applies the matching quick-filter; the active tile is highlighted.
 * Colors, spacing and radii all resolve from the design-token surface.
 */
export function TaskSummaryBar({ summary, activeKinds = [], onSelect }: TaskSummaryBarProps) {
  const colors = useAppColors();

  const stats: StatDef[] = [
    { kind: 'overdue', label: 'Overdue', icon: 'alarm-outline', color: colors.error, value: summary.overdue },
    { kind: 'dueToday', label: 'Due today', icon: 'today-outline', color: colors.warning, value: summary.dueToday },
    { kind: 'mine', label: 'Mine', icon: 'person-outline', color: colors.primary, value: summary.mine },
    { kind: 'blocked', label: 'Blocked', icon: 'ban-outline', color: colors.purple, value: summary.blocked },
  ];

  const cardShadow = Platform.select({
    ios: {
      shadowColor: colors.shadowLight,
      shadowOffset: { width: Shadow.light.offsetX, height: Shadow.light.offsetY },
      shadowOpacity: 1,
      shadowRadius: Shadow.light.radius,
    },
    android: { elevation: Elevation.card },
  });

  return (
    <View style={styles.row}>
      {stats.map((s) => {
        const active = activeKinds.includes(s.kind);
        const hasValue = s.value > 0;
        return (
          <TouchableOpacity
            key={s.kind}
            testID={`task-summary-${s.kind}`}
            activeOpacity={0.85}
            onPress={() => onSelect(s.kind)}
            style={[
              styles.card,
              cardShadow,
              {
                backgroundColor: active ? `${s.color}1A` : colors.card,
                borderColor: active ? s.color : colors.borderColor,
              },
            ]}
          >
            <View style={styles.topRow}>
              <View style={[styles.iconChip, { backgroundColor: `${s.color}1F` }]}>
                <Icon name={s.icon} size={IconSize.md} color={s.color} />
              </View>
              <Typography
                variant="title2"
                weight="bold"
                color={hasValue ? s.color : colors.textTertiary}
              >
                {s.value}
              </Typography>
            </View>
            <Typography
              variant="caption1"
              weight="medium"
              color={colors.textSecondary}
              numberOfLines={1}
            >
              {s.label}
            </Typography>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  card: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingHorizontal: Spacing.smd,
    paddingVertical: Spacing.smd,
    borderRadius: CornerRadius.lg,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  iconChip: {
    width: 28,
    height: 28,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
