import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { seriesColor } from '@theme/chartPalette';
import { hexToRgba } from '@theme/colors';

import {
  DEFAULT_INTENSITY,
  formatDistance,
  formatDuration,
  WORKOUT_CATEGORIES,
  WORKOUT_CATEGORY_LABELS,
  WORKOUT_INTENSITY_LABELS,
  workoutTypeCategory,
  workoutTypeIcon,
  workoutTypeLabel,
  type DistanceUnit,
  type WorkoutEntry,
} from '../healthActivityStorage';

/**
 * Workout session detail — the donor's `WorkoutDetailView`, cut down to what
 * this app can actually show.
 *
 * A MODAL rather than a route, the same choice `HealthExerciseDetailScreen`
 * already made for the exercise library: the Activity tab is a browse-and-log
 * surface with its own scroll position, range window and in-progress log/edit
 * form, and a pushed screen would throw all three away on every peek. A leaf
 * component, deliberately — it never imports from `screens/`, so its small
 * date/time formatter is local rather than reused from the screen that opens
 * it (see `formatClock` below).
 *
 * HEART RATE stays a graceful empty state rather than the donor's zone chart:
 * that chart is gated on `HKWorkout` (migration.md §0.1 — needs a native
 * Xcode rebuild), and no wearable data is ingested for a manually logged
 * session. A chart with nothing in it, or a raw error, would both be lying
 * about why — this says the actual reason instead.
 */

export interface HealthWorkoutSessionDetailProps {
  entry: WorkoutEntry;
  distanceUnit: DistanceUnit;
  onClose: () => void;
  onEdit: (entry: WorkoutEntry) => void;
  onDelete: (id: string) => void;
}

/**
 * `HH:MM`, local time. Mirrors `HealthActivityScreen`'s own `formatClock`
 * verbatim — kept local rather than imported so this leaf component never
 * depends on the screen that renders it.
 */
function formatClock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-07-10` + a clock time → `Jul 10, 2026 at 12:00`, the donor's header format. */
function formatSessionDateTime(entry: WorkoutEntry): string {
  const [year, month, day] = entry.date.split('-').map(Number);
  const datePart = year && month && day ? `${MONTHS[month - 1]} ${day}, ${year}` : entry.date;
  const clock = formatClock(entry.startedAt ?? entry.loggedAt);
  return clock ? `${datePart} at ${clock}` : datePart;
}

const CATEGORY_COLOR_INDEX = new Map(
  WORKOUT_CATEGORIES.map((category, index) => [category, index] as const)
);

export function HealthWorkoutSessionDetail({
  entry,
  distanceUnit,
  onClose,
  onEdit,
  onDelete,
}: HealthWorkoutSessionDetailProps) {
  const colors = useAppColors();
  const tint = seriesColor(colors, CATEGORY_COLOR_INDEX.get(workoutTypeCategory(entry.type)) ?? 0);

  const handleDelete = () => {
    Alert.alert(
      `Delete ${workoutTypeLabel(entry.type)}?`,
      'This removes the session. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(entry.id) },
      ]
    );
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      testID="health-workout-detail"
    >
      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
          <View style={[styles.headerIcon, { backgroundColor: hexToRgba(tint, 0.14) }]}>
            <Icon name={workoutTypeIcon(entry.type)} size={22} color={tint} />
          </View>
          <View style={styles.headerText}>
            <Typography variant="headline" color={colors.textPrimary}>
              {workoutTypeLabel(entry.type)}
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              {formatSessionDateTime(entry)}
            </Typography>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close workout details"
            testID="health-workout-detail-close"
            hitSlop={8}
            style={[styles.iconButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="close" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          testID="health-workout-detail-scroll"
        >
          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <View style={styles.statsRow}>
              <StatChip
                icon="timer"
                label="Duration"
                value={formatDuration(entry.minutes)}
                color={colors.info}
                testID="health-workout-detail-duration"
              />
              {entry.calories > 0 && (
                <StatChip
                  icon="energy-burned"
                  label="Calories"
                  value={`${entry.calories} kcal`}
                  color={colors.warning}
                  testID="health-workout-detail-calories"
                />
              )}
              {entry.distanceM !== null && (
                <StatChip
                  icon="distance"
                  label="Distance"
                  value={formatDistance(entry.distanceM, distanceUnit)}
                  color={colors.primary}
                  testID="health-workout-detail-distance"
                />
              )}
              {entry.intensity !== DEFAULT_INTENSITY && (
                <StatChip
                  icon="streak"
                  label="Intensity"
                  value={WORKOUT_INTENSITY_LABELS[entry.intensity]}
                  color={colors.accent}
                  testID="health-workout-detail-intensity"
                />
              )}
            </View>
            <Typography variant="caption1" color={colors.textSecondary}>
              {WORKOUT_CATEGORY_LABELS[workoutTypeCategory(entry.type)]} · Manual entry
            </Typography>
            {entry.note.length > 0 && (
              <Typography
                variant="body"
                color={colors.textPrimary}
                testID="health-workout-detail-note"
              >
                {entry.note}
              </Typography>
            )}
          </Card>

          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              HEART RATE
            </Typography>
            <View style={styles.emptyState} testID="health-workout-detail-heart-rate-empty">
              <Icon name="heart" size={28} color={colors.textSecondary} />
              <Typography variant="body" color={colors.textSecondary}>
                No heart rate data
              </Typography>
              <Typography variant="caption1" color={colors.textSecondary}>
                Heart rate isn't recorded for manually logged sessions.
              </Typography>
            </View>
          </Card>

          <Pressable
            onPress={() => onEdit(entry)}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${workoutTypeLabel(entry.type)} workout`}
            testID="health-workout-detail-edit"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          >
            <Icon name="edit" size={18} color={colors.white} />
            <Typography variant="body" weight="semibold" color={colors.white}>
              Edit Workout
            </Typography>
          </Pressable>
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${workoutTypeLabel(entry.type)} workout`}
            testID="health-workout-detail-delete"
            style={[styles.secondaryButton, { borderColor: colors.error }]}
          >
            <Icon name="close" size={18} color={colors.error} />
            <Typography variant="body" weight="semibold" color={colors.error}>
              Delete
            </Typography>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function StatChip({
  icon,
  label,
  value,
  color,
  testID,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.statChip} testID={testID}>
      <View style={[styles.statChipIcon, { backgroundColor: hexToRgba(color, 0.14) }]}>
        <Icon name={icon} size={16} color={color} />
      </View>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <Typography variant="body" weight="semibold" color={colors.textPrimary}>
        {value}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.base,
    gap: Spacing.base,
    paddingBottom: Spacing.xxl,
  },
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.base,
  },
  statChip: {
    alignItems: 'flex-start',
    gap: 2,
    minWidth: 80,
  },
  statChipIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.xxs,
    paddingVertical: Spacing.lg,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
});
