import React, { useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';

import { HealthHabitForm, HealthHabitStats, HealthStatTiles } from '../components';
import {
  categoryIcon,
  categoryLabel,
  habitCompletionRate,
  habitHistory,
  isDoneOn,
  longestStreakOf,
  scheduleSummary,
  streakOf,
  timeOfDayLabel,
  type Habit,
  type HabitDraft,
} from '../healthHabitsStorage';
import { todayDateKey } from '../healthLocalStorage';

/**
 * Habit detail — the donor's `HabitDetailView` (528 lines).
 *
 * A MODAL rather than a route, matching `HealthExerciseDetailScreen`: the Habits
 * tab is a browse-and-tick surface, and a sheet keeps its date, its time-of-day
 * filter and its scroll position alive behind it. A pushed tab route would also
 * have to carry a habit id through the tab pool, where every other entry is a
 * standalone section — a "Habit detail" row in the More hub with no habit chosen
 * is a tab that cannot mean anything.
 *
 * Sections, in the donor's order: header, statistics, history, actions, notes.
 * Edit reuses `HealthHabitForm` — the same component the create flow uses, so
 * the two cannot drift (the donor's do: its edit sheet quietly drops
 * `targetDuration`).
 */

/** How many days the history strip shows — 4 weeks, so a weekly pattern reads. */
const HISTORY_DAYS = 28;
/** The window the completion rate is measured over (the donor's own 30). */
const RATE_WINDOW_DAYS = 30;

export interface HealthHabitDetailScreenProps {
  habit: Habit;
  onClose: () => void;
  onToggle: (habit: Habit, date: string) => void;
  onSave: (habit: Habit, draft: HabitDraft) => void;
  onArchive: (habit: Habit, archived: boolean) => void;
  onDelete: (habit: Habit) => void;
}

export function HealthHabitDetailScreen({
  habit,
  onClose,
  onToggle,
  onSave,
  onArchive,
  onDelete,
}: HealthHabitDetailScreenProps) {
  const colors = useAppColors();
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  // Matches the Trends tab's own derivation, so a chart is the same width
  // wherever it is drawn.
  const chartWidth = Math.max(240, width - 2 * Spacing.lg - 2 * Spacing.base);

  const today = todayDateKey();
  const doneToday = isDoneOn(habit, today);
  const current = useMemo(() => streakOf(habit.days, today), [habit.days, today]);
  const best = useMemo(() => longestStreakOf(habit.days), [habit.days]);
  const rate = useMemo(
    () => habitCompletionRate(habit, RATE_WINDOW_DAYS, today),
    [habit, today],
  );
  const history = useMemo(() => habitHistory(habit, HISTORY_DAYS, today), [habit, today]);

  const confirmDelete = () => {
    Alert.alert('Delete habit', `Remove "${habit.name}" and its history?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(habit) },
    ]);
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      testID="health-habit-detail"
    >
      <View style={[styles.container, { backgroundColor: colors.backgroundMain }]}>
        <View style={[styles.header, { borderBottomColor: colors.borderColor }]}>
          <Typography variant="title3" weight="bold" color={colors.textPrimary} style={styles.title}>
            {habit.name}
          </Typography>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close habit detail"
            testID="health-habit-detail-close"
            hitSlop={8}
          >
            <Icon name="close" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
          {...keyboardDismissScrollProps}
          testID="health-habit-detail-scroll"
        >
          {/* Header card — identity and schedule in words */}
          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <View style={styles.identityRow}>
              <View style={[styles.identityIcon, { backgroundColor: colors.backgroundMain }]}>
                <Icon name={habit.icon || categoryIcon(habit.category)} size={28} active />
              </View>
              <View style={styles.identityText}>
                <Typography variant="body" weight="medium" color={colors.textPrimary}>
                  {categoryLabel(habit.category)} · {timeOfDayLabel(habit.timeOfDay)}
                </Typography>
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID="health-habit-detail-schedule"
                >
                  {scheduleSummary(habit)}
                </Typography>
                <Typography variant="caption2" color={colors.textSecondary}>
                  {habit.reminderEnabled && habit.reminderTime
                    ? `Reminder at ${habit.reminderTime}`
                    : 'No reminder'}
                </Typography>
              </View>
            </View>
            {habit.archived ? (
              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-habit-detail-archived"
              >
                Archived — it keeps its history and does not count towards today.
              </Typography>
            ) : null}
          </Card>

          {/* Statistics — the donor's four figures */}
          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              STATISTICS
            </Typography>
            <HealthStatTiles
              stats={[
                {
                  label: 'Current',
                  value: current > 0 ? `${current} d` : '—',
                  icon: 'streak',
                  testID: 'health-habit-detail-current',
                },
                {
                  label: 'Best',
                  value: best > 0 ? `${best} d` : '—',
                  icon: 'progress-compare',
                  testID: 'health-habit-detail-best',
                },
                {
                  label: 'Total',
                  value: String(habit.days.length),
                  icon: 'complete',
                  testID: 'health-habit-detail-total',
                },
              ]}
            />
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID="health-habit-detail-rate"
            >
              {rate.expected === 0
                ? 'Not scheduled yet in this window.'
                : `${Math.round(rate.rate * 100)}% of the ${rate.expected} scheduled ${
                    rate.expected === 1 ? 'day' : 'days'
                  } in the last ${RATE_WINDOW_DAYS} — days this habit is not due are not counted against it.`}
            </Typography>
          </Card>

          {/*
            Completion-rate chart — the donor's `HabitStatisticsView`, scoped to
            THIS habit by passing a one-element list. The Trends tab renders the
            same component over every habit; one component, two scopes, so the
            two readings can never disagree about what "due" or "done" means.
          */}
          <HealthHabitStats
            habits={[habit]}
            today={today}
            width={chartWidth}
            testID="health-habit-detail-stats"
          />

          {/* History — 28 days, unscheduled days shown as unfilled, not missed */}
          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              LAST {HISTORY_DAYS} DAYS
            </Typography>
            <View
              style={styles.historyGrid}
              accessible
              accessibilityLabel={`${history.filter((d) => d.done).length} of the last ${HISTORY_DAYS} days completed`}
              testID="health-habit-detail-history"
            >
              {history.map((entry) => (
                <View
                  key={entry.date}
                  style={[
                    styles.historyCell,
                    {
                      backgroundColor: entry.done
                        ? colors.primary
                        : entry.scheduled
                          ? colors.borderColor
                          : 'transparent',
                      borderColor: colors.borderColor,
                    },
                  ]}
                />
              ))}
            </View>
            <Typography variant="caption2" color={colors.textSecondary}>
              Filled = done · grey = scheduled and missed · outline = not scheduled
            </Typography>
          </Card>

          {/* Actions */}
          <Card
            variant="filled"
            style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          >
            <Pressable
              onPress={() => onToggle(habit, today)}
              accessibilityRole="button"
              accessibilityLabel={doneToday ? 'Mark as not done today' : 'Mark as complete today'}
              testID="health-habit-detail-toggle"
              style={[
                styles.primaryButton,
                {
                  backgroundColor: doneToday ? colors.backgroundMain : colors.primary,
                  borderColor: colors.primary,
                },
              ]}
            >
              <Icon
                name={doneToday ? 'checkmark' : 'add'}
                size={18}
                color={doneToday ? colors.primary : colors.white}
              />
              <Typography
                variant="body"
                weight="medium"
                color={doneToday ? colors.primary : colors.white}
              >
                {doneToday ? 'Completed today' : 'Mark as complete'}
              </Typography>
            </Pressable>

            <View style={styles.actionRow}>
              <Pressable
                onPress={() => setEditing((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={editing ? 'Close editor' : 'Edit habit'}
                testID="health-habit-detail-edit"
                style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
              >
                <Icon name="edit" size={16} color={colors.textSecondary} />
                <Typography variant="caption1" color={colors.textSecondary}>
                  {editing ? 'Close' : 'Edit'}
                </Typography>
              </Pressable>
              <Pressable
                onPress={() => onArchive(habit, !habit.archived)}
                accessibilityRole="button"
                accessibilityLabel={habit.archived ? 'Unarchive habit' : 'Archive habit'}
                testID="health-habit-detail-archive"
                style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
              >
                {/* `history` ships only in the health kit and `skipped` only in
                    budget's, so under any other brand each falls through to
                    Ionicons — where neither is a real glyph and the button
                    renders a literal "?" beside its label. Name an explicit
                    fallback, per the note in components/ui/Icon.tsx. */}
                <Icon
                  name={habit.archived ? 'history' : 'skipped'}
                  fallbackIonicon={habit.archived ? 'arrow-undo' : 'archive-outline'}
                  size={16}
                  color={colors.textSecondary}
                />
                <Typography variant="caption1" color={colors.textSecondary}>
                  {habit.archived ? 'Unarchive' : 'Archive'}
                </Typography>
              </Pressable>
              <Pressable
                onPress={confirmDelete}
                accessibilityRole="button"
                accessibilityLabel="Delete habit"
                testID="health-habit-detail-delete"
                style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
              >
                <Icon name="delete" size={16} color={colors.error} />
                <Typography variant="caption1" color={colors.error}>
                  Delete
                </Typography>
              </Pressable>
            </View>
          </Card>

          {editing ? (
            <HealthHabitForm
              testIDPrefix="health-habit-edit"
              submitLabel="Save changes"
              initial={{
                name: habit.name,
                icon: habit.icon,
                category: habit.category,
                timeOfDay: habit.timeOfDay,
                frequency: habit.frequency,
                customDays: habit.customDays,
                reminderEnabled: habit.reminderEnabled,
                reminderTime: habit.reminderTime,
                notes: habit.notes,
              }}
              onSubmit={(draft) => {
                setEditing(false);
                onSave(habit, draft);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : habit.notes ? (
            <Card
              variant="filled"
              style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
            >
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionLabel}
              >
                NOTES
              </Typography>
              <Typography variant="body" color={colors.textPrimary} testID="health-habit-detail-notes">
                {habit.notes}
              </Typography>
            </Card>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
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
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  identityIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  historyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  historyCell: {
    width: 22,
    height: 22,
    borderRadius: CornerRadius.xs,
    borderWidth: 1,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 40,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
});
