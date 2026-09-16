import React from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Typography } from '@components/ui';
import { AppBarChart } from '@components/ui/AppBarChart';
import { Icon } from '@components/ui/Icon';
import { Spacing, useAppColors } from '@theme';

import {
  challengeDisplayColor,
  challengeDisplayIcon,
  challengePercent,
  dailyMaxPercentBars,
  isChallengeOnTrack,
  isEmojiIcon,
  type ChallengeWeeklyOverviewEntry,
} from '../healthChallengesStorage';

/**
 * Symply Health — Dashboard "Food Challenges" (donor `WeeklyChallengeChartWidget`).
 *
 * The donor's period selector and chart-type toggle are confirmed decorative
 * for this widget too (the chart always reads from the same
 * `weeklyProgressData`, whatever period is "selected"), so — as with Weekly
 * Trends — this ships the always-on weekly view rather than porting controls
 * that do nothing in the app they came from.
 */
export interface HealthFoodChallengesWidgetProps {
  overview: ChallengeWeeklyOverviewEntry[];
  /** Local `YYYY-MM-DD` — used to suppress future days and score the status badge. */
  todayKey: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Pencil icon + (when empty) the "Add Challenge" button. */
  onManage: () => void;
  testID?: string;
}

function ChallengeGlyph({
  icon,
  color,
  size = 14,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  if (isEmojiIcon(icon)) {
    return <Typography variant="caption1">{icon}</Typography>;
  }
  return <Icon name={icon} size={size} color={color} />;
}

function ChallengeDetailRow({
  entry,
  todayKey,
  testID,
}: {
  entry: ChallengeWeeklyOverviewEntry;
  todayKey: string;
  testID: string;
}) {
  const colors = useAppColors();
  const color = challengeDisplayColor(entry.challenge);
  const onTrack = isChallengeOnTrack(entry.weeklyProgressFraction, todayKey);
  const pct = challengePercent(entry.weeklyProgressFraction);
  const fraction = Math.max(0, Math.min(1, entry.weeklyProgressFraction));

  return (
    <View style={[styles.detailRow, { backgroundColor: colors.backgroundMain }]} testID={testID}>
      <View style={styles.detailHead}>
        <ChallengeGlyph icon={challengeDisplayIcon(entry.challenge)} color={color} size={16} />
        <Typography
          variant="body"
          weight="medium"
          color={colors.textPrimary}
          style={styles.detailName}
          numberOfLines={1}
        >
          {entry.challenge.name}
        </Typography>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: (onTrack ? colors.success : colors.warning) + '1F' },
          ]}
          testID={`${testID}-status`}
        >
          <Icon
            name={onTrack ? 'arrow-up' : 'arrow-down'}
            size={10}
            color={onTrack ? colors.success : colors.warning}
          />
          <Typography
            variant="caption2"
            weight="semibold"
            color={onTrack ? colors.success : colors.warning}
          >
            {onTrack ? 'On track' : 'Behind'}
          </Typography>
        </View>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: colors.borderColor }]}>
        <View style={[styles.progressFill, { backgroundColor: color, width: `${fraction * 100}%` }]} />
      </View>

      <View style={styles.detailFoot}>
        <Typography variant="caption1" color={colors.textSecondary} testID={`${testID}-grams`}>
          {Math.round(entry.weeklyTotalGrams)}g / {Math.round(entry.weeklyTargetGrams)}g
        </Typography>
        <Typography variant="caption1" weight="semibold" color={color} testID={`${testID}-percent`}>
          {pct}%
        </Typography>
      </View>
    </View>
  );
}

export function HealthFoodChallengesWidget({
  overview,
  todayKey,
  expanded,
  onToggleExpanded,
  onManage,
  testID = 'health-food-challenges',
}: HealthFoodChallengesWidgetProps) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, width - 2 * Spacing.lg - 2 * Spacing.base);

  const pencilButton = (
    <Pressable
      onPress={onManage}
      accessibilityRole="button"
      accessibilityLabel="Manage food challenges"
      testID={`${testID}-edit`}
      hitSlop={8}
      style={styles.pencilButton}
    >
      <Icon name="pencil" size={18} color={colors.success} />
    </Pressable>
  );

  if (overview.length === 0) {
    return (
      <View style={styles.emptyWrap} testID={`${testID}-empty`}>
        <View style={styles.emptyHead}>
          <Icon name="flag-outline" size={28} color={colors.textSecondary} />
          {pencilButton}
        </View>
        <Typography variant="body" weight="medium" color={colors.textPrimary}>
          No Challenges Set
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary} align="center">
          Set food goals like &quot;500g vegetables daily&quot; and track your progress here.
        </Typography>
        <Pressable
          onPress={onManage}
          accessibilityRole="button"
          testID={`${testID}-add`}
          style={[styles.addButton, { backgroundColor: colors.success }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            Add Challenge
          </Typography>
        </Pressable>
      </View>
    );
  }

  const bars = dailyMaxPercentBars(overview, todayKey);

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.headRow}>
        <View style={styles.legendRow}>
          {overview.map((entry) => (
            <View key={entry.challenge.id} style={styles.legendChip} testID={`${testID}-chip-${entry.challenge.id}`}>
              <ChallengeGlyph icon={challengeDisplayIcon(entry.challenge)} color={challengeDisplayColor(entry.challenge)} />
              <Typography
                variant="caption2"
                color={challengeDisplayColor(entry.challenge)}
                numberOfLines={1}
              >
                {entry.challenge.name}
              </Typography>
            </View>
          ))}
        </View>
        {pencilButton}
      </View>

      <View testID={`${testID}-chart`}>
        <AppBarChart data={bars} width={chartWidth} height={120} axisMax={100} formatValue={(v) => `${Math.round(v)}%`} />
      </View>

      <View style={[styles.detailsHeader, { borderTopColor: colors.borderColor }]}>
        <Pressable
          onPress={onToggleExpanded}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          testID={`${testID}-details-toggle`}
          style={styles.detailsToggleRow}
        >
          <Typography variant="footnote" weight="medium" color={colors.textSecondary}>
            Challenge Details
          </Typography>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.detailsList} testID={`${testID}-details-list`}>
          {overview.map((entry) => (
            <ChallengeDetailRow
              key={entry.challenge.id}
              entry={entry}
              todayKey={todayKey}
              testID={`${testID}-detail-${entry.challenge.id}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  legendRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    maxWidth: 130,
  },
  pencilButton: {
    padding: Spacing.xxs,
  },
  detailsHeader: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.xs,
  },
  detailsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  detailsList: {
    gap: Spacing.sm,
  },
  detailRow: {
    borderRadius: 10,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  detailName: {
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: 8,
    borderRadius: 4,
  },
  detailFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyWrap: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  emptyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  addButton: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: 9999,
  },
});
