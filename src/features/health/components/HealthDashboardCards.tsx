import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  formatDuration,
  WORKOUT_TYPE_ICONS,
  WORKOUT_TYPE_LABELS,
  type WorkoutEntry,
} from '../healthActivityStorage';
import { formatWeightValue, type WeightEntry } from '../healthLocalStorage';
import { MEAL_SLOT_ICONS, MEAL_SLOT_LABELS, type MealEntry } from '../healthNutritionStorage';

/**
 * Home dashboard primitives — the donor's Dashboard "Calorie Balance" ring,
 * "Quick Stats" grid and workout list rebuilt as three reusable pieces.
 *
 * The donor's dashboard is a fixed catalogue of nine widget types; these three
 * cover the ones that carry real data in this app (rings for the day's goals,
 * a tappable stat grid, and a feed of what was actually logged). The rest of
 * the donor catalogue is either dead code there (`deskHero` renders nothing) or
 * depends on surfaces this app has not built.
 */

/* ------------------------------------------------------------------ */
/* Rings — the day's goals                                             */
/* ------------------------------------------------------------------ */

export interface HealthDayRing {
  key: string;
  label: string;
  value: number;
  target: number;
  /** Unit suffix shown under the value and spoken in the label (e.g. `kcal`). */
  suffix?: string;
  /** Arc colour. Assigned by the caller in a fixed order, never cycled. */
  color?: string;
  /** Tab this goal belongs to; the ring becomes a link when set. */
  route?: string;
  testID: string;
}

interface HealthDayRingsProps {
  rings: HealthDayRing[];
  onOpen?: (route: string) => void;
  size?: number;
}

/**
 * A row of goal rings for today.
 *
 * Each ring is directly labelled, so identity never rests on colour alone, and
 * carries the headline figure in its accessibility label — a ring is otherwise
 * completely opaque to a screen reader.
 */
export function HealthDayRings({ rings, onOpen, size = 92 }: HealthDayRingsProps) {
  const colors = useAppColors();

  return (
    <View style={styles.ringRow}>
      {rings.map((ring) => {
        const target = ring.target > 0 ? ring.target : 0;
        const progress = target > 0 ? ring.value / target : 0;
        const suffix = ring.suffix ? ` ${ring.suffix}` : '';
        const label =
          target > 0
            ? `${ring.label}: ${ring.value}${suffix} of ${target}${suffix}`
            : `${ring.label}: ${ring.value}${suffix}, no goal set`;

        return (
          <Pressable
            key={ring.key}
            onPress={ring.route && onOpen ? () => onOpen(ring.route as string) : undefined}
            disabled={!ring.route || !onOpen}
            accessibilityRole={ring.route ? 'button' : undefined}
            accessibilityLabel={label}
            testID={ring.testID}
            style={styles.ringCell}
          >
            <ProgressRing
              progress={progress}
              size={size}
              stroke={10}
              color={ring.color}
              showPercent={false}
            >
              <Typography variant="headline" weight="bold" color={colors.textPrimary}>
                {ring.value}
              </Typography>
              {ring.suffix ? (
                <Typography variant="caption1" color={colors.textSecondary}>
                  {ring.suffix}
                </Typography>
              ) : null}
            </ProgressRing>
            <Typography variant="caption1" weight="medium" color={colors.textPrimary}>
              {ring.label}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {target > 0 ? `of ${target}${suffix}` : 'no goal set'}
            </Typography>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* At-a-glance cards                                                   */
/* ------------------------------------------------------------------ */

export interface HealthGlanceCard {
  key: string;
  icon: string;
  label: string;
  /** Headline figure, already formatted (`—` when nothing is logged). */
  value: string;
  /** Secondary line, e.g. `of 8 cups`. */
  caption?: string;
  /** Destination tab — every card is a way into its own surface. */
  route: string;
  testID: string;
}

interface HealthDashboardCardsProps {
  cards: HealthGlanceCard[];
  onOpen: (route: string) => void;
}

/**
 * The donor's "Quick Stats" grid: one tile per domain, each a link into the tab
 * that owns it. Keeps an unpinned tab reachable even when the shell hides it.
 */
export function HealthDashboardCards({ cards, onOpen }: HealthDashboardCardsProps) {
  const colors = useAppColors();

  return (
    <View style={styles.cardGrid}>
      {cards.map((card) => (
        <Pressable
          key={card.key}
          onPress={() => onOpen(card.route)}
          accessibilityRole="button"
          accessibilityLabel={`${card.label}: ${card.value}${
            card.caption ? `, ${card.caption}` : ''
          }`}
          testID={card.testID}
          style={[styles.glanceCard, { backgroundColor: colors.backgroundMain }]}
        >
          <View style={styles.glanceHead}>
            <Icon name={card.icon} size={16} color={colors.primary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {card.label}
            </Typography>
          </View>
          <Typography variant="headline" weight="semibold" color={colors.textPrimary}>
            {card.value}
          </Typography>
          {card.caption ? (
            <Typography variant="caption1" color={colors.textSecondary}>
              {card.caption}
            </Typography>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity feed                                                */
/* ------------------------------------------------------------------ */

export interface HealthActivityItem {
  id: string;
  icon: string;
  title: string;
  detail: string;
  /** ISO timestamp the entry was logged at — the feed's sort key. */
  at: string;
  route: string;
}

export interface RecentActivityInput {
  meals?: MealEntry[];
  workouts?: WorkoutEntry[];
  weights?: WeightEntry[];
}

/**
 * The most recent things the user actually logged, newest-first.
 *
 * Only sources carrying a REAL timestamp are folded in. Habits are day-keyed
 * with no time of day, so inventing one would order the feed by a stamp that
 * does not exist; they get their own at-a-glance card instead.
 */
export function buildRecentActivity(
  { meals = [], workouts = [], weights = [] }: RecentActivityInput,
  limit = 5,
): HealthActivityItem[] {
  const items: HealthActivityItem[] = [
    ...meals.map((meal) => ({
      id: `meal-${meal.id}`,
      icon: MEAL_SLOT_ICONS[meal.slot] ?? 'meals',
      title: meal.name,
      detail: `${Math.round(meal.calories)} kcal · ${MEAL_SLOT_LABELS[meal.slot] ?? 'Meal'}`,
      at: meal.loggedAt,
      route: '/health-nutrition',
    })),
    ...workouts.map((workout) => ({
      id: `workout-${workout.id}`,
      icon: WORKOUT_TYPE_ICONS[workout.type] ?? 'workouts',
      title: WORKOUT_TYPE_LABELS[workout.type] ?? 'Workout',
      detail: `${formatDuration(workout.minutes)} · ${Math.round(workout.calories)} kcal`,
      at: workout.loggedAt,
      route: '/health-activity',
    })),
    ...weights.map((entry) => ({
      id: `weight-${entry.id}`,
      icon: 'weight',
      title: `Weight ${formatWeightValue(entry.value)} ${entry.unit}`,
      detail: 'Logged on Home',
      at: entry.loggedAt,
      route: '/health-trends',
    })),
  ];

  return items
    .filter((item) => typeof item.at === 'string' && item.at.length > 0)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, Math.max(0, limit));
}

interface HealthActivityFeedProps {
  items: HealthActivityItem[];
  onOpen: (route: string) => void;
  /** Relative-time formatter (the screens already own one). */
  formatAt: (iso: string) => string;
  testID: string;
  emptyLabel: string;
}

export function HealthActivityFeed({
  items,
  onOpen,
  formatAt,
  testID,
  emptyLabel,
}: HealthActivityFeedProps) {
  const colors = useAppColors();

  if (items.length === 0) {
    // Say so in words — an empty feed drawn as blank rows reads as a bug.
    return (
      <Typography variant="body" color={colors.textSecondary} testID={`${testID}-empty`}>
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <View testID={testID}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onOpen(item.route)}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.detail}, ${formatAt(item.at)}`}
          testID={`${testID}-item-${item.id}`}
          style={[styles.feedRow, { borderTopColor: colors.borderColor }]}
        >
          <Icon name={item.icon} size={18} color={colors.primary} />
          <View style={styles.feedText}>
            <Typography variant="body" color={colors.textPrimary}>
              {item.title}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {item.detail}
            </Typography>
          </View>
          <Typography variant="caption1" color={colors.textSecondary}>
            {formatAt(item.at)}
          </Typography>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ringRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    gap: Spacing.sm,
  },
  ringCell: {
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  glanceCard: {
    flexGrow: 1,
    flexBasis: '44%',
    minWidth: 130,
    borderRadius: CornerRadius.sm,
    padding: Spacing.sm,
    gap: Spacing.xxs,
  },
  glanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  feedText: {
    flex: 1,
    gap: 2,
  },
});
