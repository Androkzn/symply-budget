/**
 * HomeStatusStrip — a compact row of glanceable stat pills at the top of Home.
 *
 * Each pill shows one number + label (Overdue, This week, Budget left, Garbage)
 * and deep-links to the relevant screen on tap. This is the "at a glance" layer
 * of the Today dashboard — status, not navigation shortcuts.
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, IconSize, Spacing, useAppColors } from '@theme';

export interface HomeStatItem {
  key: string;
  /** Big value, e.g. "3", "$340", "Tue". */
  value: string;
  /** Small caption beneath the value. */
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Accent applied to the icon + value when this stat is "hot". */
  tint?: string;
  onPress?: () => void;
}

export function HomeStatusStrip({ items }: { items: HomeStatItem[] }) {  const colors = useAppColors();

  if (items.length === 0) return null;

  return (
    <View style={styles.row}>
      {items.map((item) => {
        const accent = item.tint ?? colors.textPrimary;
        // Icons default to the main brand green; a "hot" tint (overdue /
        // over-budget) still wins so the semantic warning colour carries through.
        const iconColor = item.tint ?? colors.primary;
        return (
          <TouchableOpacity
            key={item.key}
            style={[styles.pill, { backgroundColor: colors.backgroundSecondary, borderColor: colors.divider }]}
            onPress={item.onPress}
            activeOpacity={0.7}
            disabled={!item.onPress}
            testID={`home-stat-${item.key}`}
          >
            <Icon name={item.icon} size={IconSize.sm} color={iconColor} />
            <Typography variant="title3" weight="bold" color={accent} numberOfLines={1} style={styles.value}>
              {item.value}
            </Typography>
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              numberOfLines={1}
              style={styles.label}
            >
              {item.label}
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
    marginBottom: Spacing.base,
  },
  pill: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    borderRadius: CornerRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xxs,
  },
  value: {
    marginTop: Spacing.xxs,
  },
  label: {
    textAlign: 'center',
  },
});
