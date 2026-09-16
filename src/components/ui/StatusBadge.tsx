import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppColors, type AppColors } from '@theme';

import { Typography } from './Typography';

export type StatusBadgeVariant = 'soon' | 'overdue' | 'pastDue' | 'complete' | 'today';

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  count?: number;
  label?: string;
}

const DEFAULT_LABELS: Record<StatusBadgeVariant, string> = {
  soon: 'Soon',
  overdue: 'Overdue',
  pastDue: 'Past Due',
  complete: 'Complete',
  today: 'Today',
};

// Theme-aware badge colors. Each variant maps to a status token pair so the
// text/background stay in the same family across light/dark/clean skins.
function getBadgeColors(
  colors: AppColors,
  variant: StatusBadgeVariant
): { text: string; background: string } {
  switch (variant) {
    case 'overdue':
      return { text: colors.statusOverdue, background: colors.statusOverdueBg };
    case 'pastDue':
      return { text: colors.statusPastDue, background: colors.statusPastDueBg };
    case 'complete':
      return { text: colors.statusComplete, background: colors.statusCompleteBg };
    case 'soon':
    case 'today':
    default:
      return { text: colors.statusSoon, background: colors.statusSoonBg };
  }
}

export function StatusBadge({ variant, count, label }: StatusBadgeProps) {
  const appColors = useAppColors();
  const colors = getBadgeColors(appColors, variant);
  const displayLabel = label || DEFAULT_LABELS[variant];
  const displayText = count && count > 1 ? `${count} ${displayLabel}` : displayLabel;

  return (
    <View style={[styles.badge, { backgroundColor: colors.background }]}>
      <Typography
        variant="caption2"
        weight="semibold"
        style={{ color: colors.text }}
      >
        {displayText}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
});
