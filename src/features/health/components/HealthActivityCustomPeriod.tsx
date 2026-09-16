import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet, Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import {
  formatDistance,
  formatDuration,
  summarizeActivity,
  workoutTypeIcon,
  workoutTypeLabel,
  type DistanceUnit,
  type WorkoutEntry,
} from '../healthActivityStorage';
import { formatLoggedAt, isRealDayKey, maskDayKeyInput, todayDateKey } from '../healthLocalStorage';
import { shiftDateKey } from '../healthNutritionStorage';

import { HealthStatTiles } from './HealthStatTiles';

/**
 * Custom Period — the donor's `WorkoutsCustomPeriodView` (`WorkoutsView.swift`
 * lines 685-972): pick an arbitrary `From`/`To` range over the whole workout
 * history and see its totals, rather than only the 7/30/90-day windows the
 * main Activity screen steps through.
 *
 * STANDALONE ON PURPOSE. The Activity screen is mid-edit elsewhere, so this
 * takes the full loaded history plus the one unit switch as props and owns
 * nothing else — no fetch, no store write, no navigation. The screen mounts it
 * once (the same always-mounted, `visible`-prop pattern `HealthWorkoutTypePicker`
 * already uses) and flips `visible`.
 *
 * TEXT FIELDS, NOT A NATIVE PICKER. Every date range in this app — the
 * Weight tab, and this very form's own date/time pair — is a typed
 * `YYYY-MM-DD` field that refuses bad input in words. The donor gets range
 * constraints for free from `DatePicker(in:)`; this reproduces the same
 * constraint (`from <= to <= today`) as an explicit, spoken validation instead
 * of a second date-entry idiom.
 *
 * ABSENT IS NOT ZERO still holds here: the distance tile reads `formatDistance`
 * verbatim, so a range where nothing measured a distance reads "—", never "0 km".
 */

export interface HealthActivityCustomPeriodProps {
  visible: boolean;
  onClose: () => void;
  /** The FULL loaded history (already up to 400 entries), not just the current window. */
  workouts: WorkoutEntry[];
  distanceUnit: DistanceUnit;
  /** `YYYY-MM-DD`; defaults to `todayDateKey()`. */
  today?: string;
}

const QUICK_RANGES = [7, 30, 90] as const;
const MAX_LISTED_WORKOUTS = 10;
/**
 * Safety bound on how many day-keys one custom period will enumerate.
 *
 * `from`/`to` are typed, so nothing stops someone fat-fingering a decades-wide
 * range. ~10 years is generous for a history capped at 400 workouts and keeps
 * `dayKeysInRange` from building an unbounded array off a mistyped year.
 */
const MAX_RANGE_DAYS = 3660;

export function isValidDateKey(value: string): boolean {
  // Shape AND calendar. The fields punctuate themselves now (`maskDayKeyInput`),
  // so any eight digits arrive looking like `YYYY-MM-DD` — a shape-only test
  // would wave a pasted `01/01/2026` through as `0101-20-26`.
  return isRealDayKey(value);
}

/** Calendar-day span between two day-keys — mirrors the donor's `daysBetween`. */
export function daysBetweenKeys(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Every day-key from `from` to `to`, inclusive, oldest first. */
export function dayKeysInRange(from: string, to: string): string[] {
  const span = daysBetweenKeys(from, to);
  if (span < 0) return [];
  const count = Math.min(span + 1, MAX_RANGE_DAYS);
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) keys.push(shiftDateKey(from, i));
  return keys;
}

/** Does `from`/`to` match the trailing `days`-day window ending today? */
export function quickRangeMatches(days: number, from: string, to: string, today: string): boolean {
  return to === today && from === shiftDateKey(today, -days);
}

/** `HH:MM`, 24h — the same shape the log form's own clock uses. */
function formatClock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function HealthActivityCustomPeriod({
  visible,
  onClose,
  workouts,
  distanceUnit,
  today = todayDateKey(),
}: HealthActivityCustomPeriodProps) {
  const colors = useAppColors();
  const [from, setFrom] = useState(() => shiftDateKey(today, -30));
  const [to, setTo] = useState(() => today);

  // The donor's `.sheet` builds a fresh view (and fresh `@State`) every time it
  // is presented. This component stays mounted between opens instead — the
  // same always-mounted / `visible`-toggling idiom `HealthWorkoutTypePicker`
  // uses — so the "last 30 days" default has to be restored explicitly here
  // rather than falling out of construction.
  useEffect(() => {
    if (visible) {
      setFrom(shiftDateKey(today, -30));
      setTo(today);
    }
  }, [visible, today]);

  const fromValid = isValidDateKey(from);
  const toValid = isValidDateKey(to);

  const rangeError = useMemo(() => {
    if (!fromValid || !toValid) return 'Use YYYY-MM-DD for both the start and end date.';
    if (to > today) return "The end date can't be in the future — a custom period can only look back.";
    if (from > to) return 'The start date must be on or before the end date.';
    return null;
  }, [fromValid, toValid, from, to, today]);
  const rangeValid = rangeError === null;

  // An order or future problem could be either field's "fault" — both are
  // marked so the reader is not left guessing which one to fix.
  const fromInvalid = !fromValid || (fromValid && toValid && from > to);
  const toInvalid = !toValid || (toValid && to > today) || (fromValid && toValid && from > to);

  const dayKeys = useMemo(() => (rangeValid ? dayKeysInRange(from, to) : []), [rangeValid, from, to]);
  const periodWorkouts = useMemo(
    () => (rangeValid ? workouts.filter((entry) => entry.date >= from && entry.date <= to) : []),
    [rangeValid, workouts, from, to]
  );
  // `summarizeActivity` already treats an unmeasured distance as absent rather
  // than zero — see its own doc comment — so the stats tiles inherit that for
  // free. `[]` for `steps`: this view has no step figure to show.
  const stats = useMemo(() => summarizeActivity(workouts, [], dayKeys), [workouts, dayKeys]);
  const days = rangeValid ? daysBetweenKeys(from, to) : 0;

  const selectQuickRange = (rangeDays: number) => {
    setFrom(shiftDateKey(today, -rangeDays));
    setTo(today);
  };

  const cardStyle = [styles.card, { backgroundColor: colors.backgroundSecondary }];
  const inputStyle = [
    styles.input,
    { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
  ];

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Custom Period"
      height="tall"
      showCloseButton
    >
      <ScrollView
        {...keyboardDismissScrollProps}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        testID="health-activity-custom-period-scroll"
      >
        <Card variant="filled" style={cardStyle}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            DATE RANGE
          </Typography>
          <View style={styles.fieldRow}>
            <View style={styles.fieldGroup}>
              <Typography variant="caption1" color={colors.textSecondary}>
                From
              </Typography>
              <TextInput
                value={from}
                onChangeText={(text) => setFrom(maskDayKeyInput(text))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel="Custom period start date"
                testID="health-activity-custom-period-from-input"
                style={[
                  ...inputStyle,
                  {
                    color: fromInvalid ? colors.error : colors.textPrimary,
                    borderColor: fromInvalid ? colors.error : colors.borderColor,
                  },
                ]}
              />
            </View>
            <View style={styles.fieldGroup}>
              <Typography variant="caption1" color={colors.textSecondary}>
                To
              </Typography>
              <TextInput
                value={to}
                onChangeText={(text) => setTo(maskDayKeyInput(text))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel="Custom period end date"
                testID="health-activity-custom-period-to-input"
                style={[
                  ...inputStyle,
                  {
                    color: toInvalid ? colors.error : colors.textPrimary,
                    borderColor: toInvalid ? colors.error : colors.borderColor,
                  },
                ]}
              />
            </View>
          </View>

          {rangeError ? (
            <Typography
              variant="caption1"
              color={colors.error}
              testID="health-activity-custom-period-error"
            >
              {rangeError}
            </Typography>
          ) : (
            <View style={styles.cardHead}>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-activity-custom-period-days"
              >
                {`${days} ${days === 1 ? 'day' : 'days'}`}
              </Typography>
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-activity-custom-period-count"
              >
                {`${periodWorkouts.length} ${periodWorkouts.length === 1 ? 'workout' : 'workouts'}`}
              </Typography>
            </View>
          )}
        </Card>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickRow}
        >
          {QUICK_RANGES.map((rangeDays) => {
            const active = quickRangeMatches(rangeDays, from, to, today);
            return (
              <Pressable
                key={rangeDays}
                onPress={() => selectQuickRange(rangeDays)}
                accessibilityRole="button"
                accessibilityLabel={`Show the last ${rangeDays} days`}
                accessibilityState={{ selected: active }}
                testID={`health-activity-custom-period-quick-${rangeDays}`}
                style={[
                  styles.quickChip,
                  {
                    borderColor: active ? colors.primary : colors.borderColor,
                    backgroundColor: active ? colors.primary : 'transparent',
                  },
                ]}
              >
                <Typography
                  variant="caption1"
                  weight="semibold"
                  color={active ? colors.white : colors.textSecondary}
                >
                  {`${rangeDays} Days`}
                </Typography>
              </Pressable>
            );
          })}
        </ScrollView>

        {periodWorkouts.length > 0 ? (
          <>
            <Card variant="filled" style={cardStyle} testID="health-activity-custom-period-stats">
              <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
                STATISTICS
              </Typography>
              <HealthStatTiles
                stats={[
                  {
                    label: 'Workouts',
                    value: String(stats.workouts),
                    icon: 'workouts',
                    testID: 'health-activity-custom-period-stat-workouts',
                  },
                  {
                    label: 'Calories',
                    value: `${stats.calories} kcal`,
                    icon: 'energy-burned',
                    testID: 'health-activity-custom-period-stat-calories',
                  },
                  {
                    label: 'Duration',
                    value: formatDuration(stats.minutes),
                    icon: 'timer',
                    testID: 'health-activity-custom-period-stat-duration',
                  },
                  {
                    label: 'Distance',
                    // "—" rather than "0 km" when nothing in the range measured
                    // one — see `formatDistance`'s own contract.
                    value: formatDistance(stats.distanceM, distanceUnit),
                    icon: 'distance',
                    testID: 'health-activity-custom-period-stat-distance',
                  },
                ]}
              />
            </Card>

            <Card variant="filled" style={cardStyle}>
              <View style={styles.cardHead}>
                <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
                  WORKOUTS
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {periodWorkouts.length}
                </Typography>
              </View>
              {periodWorkouts.slice(0, MAX_LISTED_WORKOUTS).map((entry) => (
                <View
                  key={entry.id}
                  style={[styles.entryRow, { borderTopColor: colors.borderColor }]}
                  testID={`health-activity-custom-period-entry-${entry.id}`}
                  accessible
                  accessibilityLabel={`${workoutTypeLabel(entry.type)}, ${formatDuration(entry.minutes)}, ${formatLoggedAt(entry.startedAt ?? entry.loggedAt)}`}
                >
                  <Icon name={workoutTypeIcon(entry.type)} size={18} color={colors.primary} />
                  <View style={styles.entryText}>
                    <Typography variant="body" color={colors.textPrimary}>
                      {workoutTypeLabel(entry.type)} · {formatDuration(entry.minutes)}
                      {entry.distanceM !== null ? ` · ${formatDistance(entry.distanceM, distanceUnit)}` : ''}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {formatLoggedAt(entry.startedAt ?? entry.loggedAt)}
                      {entry.startedAt ? ` · ${formatClock(entry.startedAt)}` : ''}
                      {entry.calories > 0 ? ` · ${entry.calories} kcal` : ''}
                    </Typography>
                  </View>
                </View>
              ))}
              {periodWorkouts.length > MAX_LISTED_WORKOUTS && (
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  style={styles.moreCaption}
                  testID="health-activity-custom-period-more"
                >
                  {`+${periodWorkouts.length - MAX_LISTED_WORKOUTS} more workouts`}
                </Typography>
              )}
            </Card>
          </>
        ) : (
          <Card variant="filled" style={[cardStyle, styles.emptyCard]} testID="health-activity-custom-period-empty">
            <Typography variant="headline" color={colors.textSecondary}>
              No workouts for selected period
            </Typography>
            <Typography variant="caption1" color={colors.textSecondary}>
              Try selecting a different date range
            </Typography>
          </Card>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    gap: Spacing.base,
    paddingBottom: Spacing.xl,
  },
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  fieldGroup: {
    flex: 1,
    gap: Spacing.xxs,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  quickRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xxs,
  },
  quickChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  entryText: {
    flex: 1,
    gap: 2,
  },
  moreCaption: {
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
});
