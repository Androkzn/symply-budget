import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { HealthChallengeTodayEntry } from '@api/health';
import { Card, ProgressBar, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors, type AppColors } from '@theme';

import {
  challengeDisplayColor,
  challengeDisplayIcon,
  challengePercent,
  isEmojiIcon,
  loadChallengeProgressToday,
} from '../healthChallengesStorage';

/**
 * "Today's Challenges" card — donor `ChallengeProgressHeader.swift`, on the
 * Nutrition tab (the donor's own placement for this specific card — distinct
 * from the Dashboard tab's weekly `HealthFoodChallengesWidget`, which reads
 * the SAME backend for a different donor screen, `WeeklyChallengeChartView`).
 *
 * Per-challenge: a progress ring with the category glyph (or a checkmark once
 * complete), the challenge's own name, "Xg left" / "Complete", a linear
 * progress bar, and "Xg / Yg (Z%)" — the layout in the screenshot this card
 * was built from. Shows the challenge's own `name` verbatim (never a
 * category-derived label), matching how `HealthFoodChallengesWidget` already
 * renders it on the Dashboard tab — one convention, not two.
 *
 * SELF-CONTAINED: fetches today's progress (`loadChallengeProgressToday`,
 * offline-cached via `healthChallengesStorage`) and renders nothing when
 * there is no applicable challenge today, mirroring the donor's
 * `if total > 0`. Drop-in — no data needs to be wired from the host screen.
 * Refreshes on every screen focus so a challenge created, edited or completed
 * on the manage screen (`HealthChallengesScreen`) is reflected the moment the
 * member comes back.
 */

export interface HealthTodayChallengesCardProps {
  /** Opens the manage/create screen. Omit to hide the count's tap affordance. */
  onManage?: () => void;
  testID?: string;
}

export function HealthTodayChallengesCard({
  onManage,
  testID = 'health-today-challenges-card',
}: HealthTodayChallengesCardProps) {
  const colors = useAppColors();
  const [challenges, setChallenges] = useState<HealthChallengeTodayEntry[]>([]);
  const [counts, setCounts] = useState({ completed: 0, total: 0 });
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadChallengeProgressToday()
        .then((result) => {
          if (cancelled) return;
          setChallenges(result?.challenges ?? []);
          setCounts({
            completed: result?.completed_count ?? 0,
            total: result?.total_count ?? 0,
          });
        })
        .catch(() => {
          if (!cancelled) {
            setChallenges([]);
            setCounts({ completed: 0, total: 0 });
          }
        })
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Donor: the card renders nothing until there is at least one applicable
  // challenge today — no empty-state card competing with the calories card above it.
  if (!loaded || challenges.length === 0) return null;

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={testID}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="flag" size={16} color={colors.primary} />
          <Typography variant="subheadline" weight="semibold" color={colors.textPrimary}>
            Today&apos;s Challenges
          </Typography>
        </View>
        <Pressable
          onPress={onManage}
          disabled={!onManage}
          accessibilityRole={onManage ? 'button' : undefined}
          accessibilityLabel={`${counts.completed} of ${counts.total} challenges complete`}
          testID={`${testID}-count`}
        >
          <Typography variant="footnote" weight="bold" color={colors.primary}>
            {`${counts.completed}/${counts.total}`}
          </Typography>
        </Pressable>
      </View>

      <View style={styles.rows}>
        {challenges.map((row) => (
          <ChallengeRow key={row.id} row={row} colors={colors} />
        ))}
      </View>
    </Card>
  );
}

/** Emoji icons render as text; icon-kit slugs render through `<Icon>` — same rule `HealthFoodChallengesWidget` uses. */
function ChallengeGlyph({ icon, color }: { icon: string; color: string }) {
  if (isEmojiIcon(icon)) {
    return <Typography variant="body">{icon}</Typography>;
  }
  return <Icon name={icon} size={20} color={color} />;
}

function ChallengeRow({ row, colors }: { row: HealthChallengeTodayEntry; colors: AppColors }) {
  const fraction = Math.max(0, Math.min(1, row.progress_percentage));
  const tone = row.today_completed ? colors.success : challengeDisplayColor(row);
  const remainingText = row.today_completed
    ? 'Complete'
    : `${Math.round(row.remaining_grams)}g left`;
  const amountText = `${Math.round(row.consumed_grams)}g / ${Math.round(row.target_grams)}g`;
  const percent = challengePercent(row.progress_percentage);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${row.name}, ${amountText}, ${percent} percent complete`}
      testID="health-today-challenges-row"
    >
      <ProgressRing progress={fraction} size={48} stroke={4} color={tone} showPercent={false}>
        {row.today_completed ? (
          <Icon name="checkmark" size={18} color={colors.success} />
        ) : (
          <ChallengeGlyph icon={challengeDisplayIcon(row)} color={tone} />
        )}
      </ProgressRing>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Typography
            variant="subheadline"
            weight="semibold"
            color={colors.textPrimary}
            numberOfLines={1}
            style={styles.rowName}
          >
            {row.name}
          </Typography>
          <Typography
            variant="caption1"
            weight="medium"
            color={row.today_completed ? colors.success : colors.warning}
          >
            {remainingText}
          </Typography>
        </View>

        <ProgressBar progress={fraction} height={8} color={tone} />

        <View style={styles.rowBottom}>
          <Typography variant="caption1" weight="bold" color={colors.textPrimary}>
            {amountText}
          </Typography>
          <Typography variant="caption2" weight="semibold" color={tone}>
            {`${percent}%`}
          </Typography>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    borderRadius: CornerRadius.lg,
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  rows: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.xs,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  rowName: {
    flex: 1,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
