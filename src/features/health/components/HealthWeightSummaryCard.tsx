import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { formatWeightValue, type WeightUnit } from '../healthLocalStorage';

/**
 * Symply Health — Weight Summary card.
 *
 * Restyle of the donor's `currentWeightCard` (`WeightTabView.swift` lines
 * 226–311): a titled card with four equal stat tiles (Current · Change · Avg ·
 * Trend), each a small colored icon-circle over a bold value and a caption.
 * The donor renders this glassmorphic blue/purple; here it follows this
 * screen's own `Card variant="filled"` + uppercase-footnote convention (see
 * the HISTORY / window-navigator cards in `HealthWeightScreen.tsx`) and pulls
 * every color from `useAppColors()` — never a hardcoded hex.
 *
 * Ported verbatim from the donor's own classification
 * (`WeightTabViewModel.selectedWeekTrend` / `selectedWeekTrendColor`, lines
 * ~605–648): the Change and Trend tiles share one color, keyed off the same
 * three-way band on the signed change — a weight INCREASE reads `error` (red)
 * here, a decrease reads `success` (green), and "Stable" reads the donor's
 * plain `blue`, not a neutral gray.
 */

export interface HealthWeightSummaryCardProps {
  unit: WeightUnit;
  current: number | null;
  change: number | null;
  average: number | null;
  testID?: string;
}

type TrendKind = 'gaining' | 'losing' | 'stable' | 'unknown';

/** Donor's `selectedWeekTrend` — ±0.2 band; the boundary itself reads Stable. */
function trendKindFor(change: number | null): TrendKind {
  if (change === null) return 'unknown';
  if (change > 0.2) return 'gaining';
  if (change < -0.2) return 'losing';
  return 'stable';
}

const TREND_LABEL: Record<TrendKind, string> = {
  gaining: 'Gaining',
  losing: 'Losing',
  stable: 'Stable',
  unknown: '—',
};

const TREND_ICON: Record<TrendKind, string> = {
  gaining: 'trending-up',
  losing: 'trending-down',
  stable: 'remove',
  unknown: 'remove',
};

function withUnit(value: number | null, unit: WeightUnit): string {
  return value === null ? '—' : `${formatWeightValue(value)} ${unit}`;
}

function signedWithUnit(value: number | null, unit: WeightUnit): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${formatWeightValue(rounded)} ${unit}`;
}

export function HealthWeightSummaryCard({
  unit,
  current,
  change,
  average,
  testID = 'health-weight-summary',
}: HealthWeightSummaryCardProps) {
  const colors = useAppColors();
  const trendKind = trendKindFor(change);
  const trendColor =
    trendKind === 'unknown'
      ? colors.textSecondary
      : trendKind === 'gaining'
        ? colors.error
        : trendKind === 'losing'
          ? colors.success
          : colors.blue;

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]} testID={testID}>
      <View style={styles.head}>
        <Icon name="weight" size={16} color={colors.textSecondary} />
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          WEIGHT SUMMARY
        </Typography>
      </View>

      <View style={styles.row}>
        <StatTile
          icon="weight"
          color={colors.primary}
          value={withUnit(current, unit)}
          label="Current"
          testID={`${testID}-current`}
        />
        <StatTile
          icon="swap-vertical"
          color={trendColor}
          value={signedWithUnit(change, unit)}
          label="Change"
          testID={`${testID}-change`}
        />
        <StatTile
          icon="trends"
          color={colors.purple}
          value={withUnit(average, unit)}
          label="Avg"
          testID={`${testID}-average`}
        />
        <StatTile
          icon={TREND_ICON[trendKind]}
          color={trendColor}
          value={TREND_LABEL[trendKind]}
          label="Trend"
          testID={`${testID}-trend`}
        />
      </View>
    </Card>
  );
}

function StatTile({
  icon,
  color,
  value,
  label,
  testID,
}: {
  icon: string;
  color: string;
  value: string;
  label: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.tile} testID={testID}>
      <View style={[styles.iconCircle, { backgroundColor: `${color}26` }]}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <Typography
        variant="callout"
        weight="bold"
        color={colors.textPrimary}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        style={styles.value}
        testID={`${testID}-value`}
      >
        {value}
      </Typography>
      <Typography variant="caption2" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    textAlign: 'center',
  },
});

export default HealthWeightSummaryCard;
