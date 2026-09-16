import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { hexToRgba } from '@theme/colors';

/**
 * Compact summary tiles + macro/goal bars shared by the Health section tabs.
 *
 * Kept in one place so Nutrition, Activity and Trends read as one app: same
 * tile height, same label ramp, same bar geometry.
 */

export interface HealthStat {
  label: string;
  value: string;
  /** Brand icon-kit name (falls back to an Ionicons glyph automatically). */
  icon?: string;
  /**
   * Tints a circular badge behind `icon` (donor `summaryStatItem` look) —
   * optional so existing callers (Nutrition, Trends) that don't pass one keep
   * today's plain layout untouched.
   */
  color?: string;
  testID?: string;
}

export function HealthStatTiles({ stats }: { stats: HealthStat[] }) {
  const colors = useAppColors();

  return (
    <View style={styles.grid}>
      {stats.map((stat) => (
        <View
          key={stat.label}
          style={[styles.tile, { backgroundColor: colors.backgroundMain }]}
          testID={stat.testID}
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
        >
          {stat.color ? (
            <>
              {stat.icon && (
                <View style={[styles.badge, { backgroundColor: hexToRgba(stat.color, 0.14) }]}>
                  <Icon name={stat.icon} size={18} color={stat.color} />
                </View>
              )}
              <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                {stat.value}
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                {stat.label}
              </Typography>
            </>
          ) : (
            <>
              <View style={styles.tileHead}>
                {stat.icon ? (
                  <Icon name={stat.icon} size={14} color={colors.textSecondary} />
                ) : null}
                <Typography variant="caption1" color={colors.textSecondary}>
                  {stat.label}
                </Typography>
              </View>
              <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
                {stat.value}
              </Typography>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

export interface GoalBarProps {
  label: string;
  value: number;
  target: number;
  /** Unit suffix shown after the value (e.g. `g`, `min`). */
  suffix?: string;
  color?: string;
  testID?: string;
}

/**
 * A labelled progress bar for "x of y" goals (macros, minutes, steps).
 *
 * Copy is `{value}{suffix} ({percent}%)` — grams plus the share of the goal,
 * matching the donor's own `macroProgressBar` (`"\(Int(value))g
 * (\(percentage)%)"`) rather than the earlier `value / target` readout, which
 * made the reader do the division the donor already did for them.
 */
export function HealthGoalBar({ label, value, target, suffix = '', color, testID }: GoalBarProps) {
  const colors = useAppColors();
  const safeTarget = target > 0 ? target : 1;
  const fraction = Math.max(0, Math.min(1, value / safeTarget));
  // Omitted (not `0%`) when there is no real target to be a percentage OF.
  const percent = target > 0 ? Math.round((value / safeTarget) * 100) : null;
  // Over goal reads identically to "right on goal" otherwise — the fill
  // clamps at the same 100% width either way. The calorie ring right next to
  // this on Home already flips to `colors.error` past budget; this matches
  // that language instead of contradicting it on the same screen.
  const over = percent !== null && percent > 100;
  const tint = over ? colors.error : (color ?? colors.primary);

  return (
    <View
      style={styles.goal}
      testID={testID}
      accessible
      accessibilityLabel={`${label}: ${Math.round(value)} of ${Math.round(target)}${suffix}`}
    >
      <View style={styles.goalHead}>
        <Typography variant="footnote" color={colors.textSecondary}>
          {label}
        </Typography>
        <Typography variant="footnote" weight="medium" color={over ? colors.error : colors.textPrimary}>
          {Math.round(value)}
          {suffix}
          {percent !== null ? ` (${percent}%)` : ''}
        </Typography>
      </View>
      <View style={[styles.track, { backgroundColor: colors.borderColor }]}>
        <View style={[styles.fill, { backgroundColor: tint, width: `${fraction * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderRadius: CornerRadius.sm,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xxs,
  },
  goal: {
    gap: Spacing.xs,
  },
  goalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
});
