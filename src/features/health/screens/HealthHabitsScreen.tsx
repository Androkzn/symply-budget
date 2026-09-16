import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressRing, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthHabitForm, HealthSectionScreen, HealthStatTiles } from '../components';
import {
  addHabit,
  addHabitFromTemplate,
  categoryIcon,
  completionCounts,
  completionRate,
  deleteHabit,
  HABIT_TIME_OPTIONS,
  habitTemplateCategories,
  isDoneOn,
  isScheduledOn,
  lastDaysStatus,
  loadHabits,
  longestStreakOf,
  scheduleSummary,
  searchHabitTemplates,
  setHabitArchived,
  streakOf,
  toggleHabitToday,
  updateHabit,
  type Habit,
  type HabitDraft,
  type HabitTimeOfDay,
} from '../healthHabitsStorage';
import { todayDateKey } from '../healthLocalStorage';
import { shiftDateKey } from '../healthNutritionStorage';

import { HealthHabitDetailScreen } from './HealthHabitDetailScreen';

const STRIP_DAYS = 7;

/**
 * Habits tab — the donor's `HealthyHabitsView`.
 *
 * What this carries beyond the previous "a name and a tick": a date selector
 * (so a forgotten day can still be ticked), a schedule-aware completion ring,
 * a WORKING time-of-day filter, the 19-preset library, per-habit schedules and
 * reminders, archive, and a detail screen.
 *
 * A habit still stores the DAYS it was completed on rather than a counter,
 * which is what keeps streaks recomputable after an untick or a skipped day.
 *
 * TWO DONOR DEFECTS DELIBERATELY NOT REPRODUCED:
 *  1. Its time-of-day chips bind a `@State` the grid never reads, so they filter
 *     nothing. Here the filter is the single source the list derives from.
 *  2. Its completion ring counts every habit against every day, so a
 *     weekdays-only habit makes a perfect Sunday read as a miss. Here only
 *     habits SCHEDULED on the shown day are counted — see `completionRate`.
 */
export function HealthHabitsScreen() {
  const colors = useAppColors();

  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayDateKey());
  const [timeFilter, setTimeFilter] = useState<HabitTimeOfDay | null>(null);
  const [draft, setDraft] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [customForm, setCustomForm] = useState(false);
  const [search, setSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string | null>(null);
  const [openHabitId, setOpenHabitId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const hydrate = useCallback(async () => {
    setHabits(await loadHabits());
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const today = todayDateKey();
  const active = useMemo(() => habits.filter((h) => !h.archived), [habits]);
  const archived = useMemo(() => habits.filter((h) => h.archived), [habits]);

  /**
   * Habits shown for the selected day.
   *
   * A habit that is NOT scheduled on this day is hidden rather than shown
   * unticked — offering a Sunday tick on a weekdays-only habit invites a
   * completion the streak maths would then have to explain away.
   */
  const visible = useMemo(
    () =>
      active
        .filter((h) => isScheduledOn(h, date))
        .filter((h) =>
          timeFilter === null ? true : h.timeOfDay === timeFilter || h.timeOfDay === 'anytime',
        ),
    [active, date, timeFilter],
  );

  const counts = useMemo(() => completionCounts(active, date), [active, date]);
  const rate = useMemo(() => completionRate(active, date), [active, date]);
  const bestStreak = useMemo(
    () => active.reduce((best, habit) => Math.max(best, streakOf(habit.days, today)), 0),
    [active, today],
  );
  const openHabit = useMemo(
    () => habits.find((h) => h.id === openHabitId) ?? null,
    [habits, openHabitId],
  );

  const canGoForward = date < today;
  const dayLabel =
    date === today
      ? 'Today'
      : date === shiftDateKey(today, -1)
        ? 'Yesterday'
        : new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          });

  const templates = useMemo(
    () => searchHabitTemplates(search, templateCategory),
    [search, templateCategory],
  );
  const templateCategories = useMemo(() => habitTemplateCategories(), []);
  const takenTemplateIds = useMemo(
    () => new Set(habits.map((h) => h.templateId).filter(Boolean) as string[]),
    [habits],
  );

  const handleToggle = async (id: string) => {
    setHabits(await toggleHabitToday(id, date));
  };

  const handleQuickAdd = async () => {
    if (draft.trim().length === 0) return;
    setHabits(await addHabit(draft));
    setDraft('');
  };

  /** The actual delete side effect, with NO confirmation of its own. */
  const performDelete = (habit: Habit) => {
    void deleteHabit(habit.id).then((next) => {
      setHabits(next);
      setOpenHabitId(null);
    });
  };

  /**
   * Confirm-then-delete, for callers that have not already asked — the
   * archived list's inline delete button. `HealthHabitDetailScreen` has its
   * OWN confirmation (`confirmDelete`) before it calls `onDelete`, so it is
   * wired to `performDelete` directly: routing it through this function too
   * used to stack a SECOND, identically-worded "Delete habit" Alert on top of
   * the one the member had just answered.
   */
  const handleDelete = (habit: Habit) => {
    Alert.alert('Delete habit', `Remove "${habit.name}" and its history?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => performDelete(habit) },
    ]);
  };

  const handleSave = async (habit: Habit, patch: HabitDraft) => {
    setHabits(await updateHabit(habit.id, patch));
  };

  const handleArchive = async (habit: Habit, archivedNext: boolean) => {
    setHabits(await setHabitArchived(habit.id, archivedNext));
    if (archivedNext) setOpenHabitId(null);
  };

  const renderHabit = (habit: Habit) => {
    const done = isDoneOn(habit, date);
    const streak = streakOf(habit.days, today);
    const strip = lastDaysStatus(habit, STRIP_DAYS, date);
    return (
      <Card
        key={habit.id}
        variant="filled"
        style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        testID={`health-habit-${habit.id}`}
      >
        <View style={styles.habitRow}>
          <Pressable
            onPress={() => void handleToggle(habit.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done, selected: done }}
            accessibilityLabel={`${habit.name}, ${done ? 'done' : 'not done'}`}
            testID={`health-habit-toggle-${habit.id}`}
            style={[
              styles.checkbox,
              {
                borderColor: done ? colors.primary : colors.borderColor,
                backgroundColor: done ? colors.primary : 'transparent',
              },
            ]}
          >
            {done ? <Icon name="checkmark" size={18} color={colors.white} /> : null}
          </Pressable>

          <Pressable
            onPress={() => setOpenHabitId(habit.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${habit.name}`}
            testID={`health-habit-open-${habit.id}`}
            style={styles.habitText}
          >
            <View style={styles.habitTitleRow}>
              <Icon name={habit.icon || categoryIcon(habit.category)} size={18} />
              <Typography variant="body" weight="medium" color={colors.textPrimary}>
                {habit.name}
              </Typography>
            </View>
            <Typography
              variant="caption1"
              color={colors.textSecondary}
              testID={`health-habit-streak-${habit.id}`}
            >
              {scheduleSummary(habit)}
              {streak > 0 ? ` · ${streak} day streak` : ''}
            </Typography>
          </Pressable>

          {habit.reminderEnabled && habit.reminderTime ? (
            <View
              accessible
              accessibilityLabel={`Reminder at ${habit.reminderTime}`}
              testID={`health-habit-reminder-${habit.id}`}
            >
              <Icon name="reminders" size={16} color={colors.primary} />
            </View>
          ) : null}
          <Pressable
            onPress={() => setOpenHabitId(habit.id)}
            accessibilityRole="button"
            accessibilityLabel={`Details for ${habit.name}`}
            testID={`health-habit-chevron-${habit.id}`}
            hitSlop={8}
          >
            <Icon name="chevron-forward" size={16} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View
          style={styles.strip}
          accessible
          accessibilityLabel={`${strip.filter(Boolean).length} of the last ${STRIP_DAYS} days completed`}
        >
          {strip.map((filled, index) => (
            <View
              // Fixed-length strip of anonymous day slots — index IS the identity.
              key={index}
              style={[
                styles.dot,
                { backgroundColor: filled ? colors.primary : colors.borderColor },
              ]}
            />
          ))}
        </View>
      </Card>
    );
  };

  return (
    <HealthSectionScreen title="Habits" testID="health-habits-screen" loading={loading}>
      {/* Date selector — a forgotten day can still be ticked, never a future one */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.dateRow}>
          <Pressable
            onPress={() => setDate((d) => shiftDateKey(d, -1))}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            testID="health-habits-prev-day"
            style={[styles.navButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="chevron-back" size={18} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.dateCenter}>
            <Typography
              variant="body"
              weight="medium"
              color={colors.textPrimary}
              testID="health-habits-day-label"
            >
              {dayLabel}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              {date}
            </Typography>
          </View>
          <Pressable
            onPress={() => canGoForward && setDate((d) => shiftDateKey(d, 1))}
            disabled={!canGoForward}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            accessibilityState={{ disabled: !canGoForward }}
            testID="health-habits-next-day"
            style={[
              styles.navButton,
              { borderColor: colors.borderColor, opacity: canGoForward ? 1 : 0.35 },
            ]}
          >
            <Icon name="chevron-forward" size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
        {date !== today ? (
          <Pressable
            onPress={() => setDate(today)}
            accessibilityRole="button"
            accessibilityLabel="Back to today"
            testID="health-habits-back-to-today"
            hitSlop={8}
          >
            <Typography variant="caption1" color={colors.primary}>
              Back to today
            </Typography>
          </Pressable>
        ) : null}
      </Card>

      {/* Daily summary — only habits SCHEDULED on this day are counted */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.summaryRow}>
          <ProgressRing
            progress={rate}
            size={96}
            stroke={10}
            showPercent={false}
            color={colors.primary}
            testID="health-habits-ring"
          >
            <Typography
              variant="title3"
              weight="bold"
              color={colors.textPrimary}
              testID="health-habits-done-today"
            >
              {counts.done}/{counts.total}
            </Typography>
            <Typography variant="caption2" color={colors.textSecondary}>
              done
            </Typography>
          </ProgressRing>
          <View style={styles.summarySide}>
            <HealthStatTiles
              stats={[
                {
                  label: 'Completion',
                  value: `${Math.round(rate * 100)}%`,
                  icon: 'score-gauge',
                  testID: 'health-habits-completion',
                },
                {
                  label: 'Best streak',
                  value: bestStreak > 0 ? `${bestStreak} d` : '—',
                  icon: 'streak',
                  testID: 'health-habits-best-streak',
                },
              ]}
            />
            <Typography
              variant="caption2"
              color={colors.textSecondary}
              testID="health-habits-scheduled-note"
            >
              {counts.total === active.length
                ? 'Every habit is due on this day.'
                : `${counts.total} of ${active.length} habits are scheduled for this day.`}
            </Typography>
          </View>
        </View>
      </Card>

      {/* Time-of-day filter — unlike the donor's, this one actually filters */}
      <View style={styles.filterRow}>
        {[{ value: null, label: 'All' }, ...HABIT_TIME_OPTIONS].map((option) => {
          const selected = timeFilter === (option.value as HabitTimeOfDay | null);
          return (
            <Pressable
              key={option.label}
              onPress={() => setTimeFilter(option.value as HabitTimeOfDay | null)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${option.label} habits`}
              testID={`health-habits-filter-${option.label.toLowerCase()}`}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected ? colors.primary : 'transparent',
                  borderColor: selected ? colors.primary : colors.borderColor,
                },
              ]}
            >
              <Typography
                variant="caption1"
                color={selected ? colors.white : colors.textSecondary}
              >
                {option.label}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        >
          <Typography variant="body" color={colors.textSecondary} testID="health-habits-empty">
            {active.length === 0
              ? 'No habits yet. Add one from the library below.'
              : timeFilter !== null
                ? 'No habits in this part of the day.'
                : 'Nothing is scheduled for this day.'}
          </Typography>
        </Card>
      ) : (
        visible.map(renderHabit)
      )}

      {/* Archived — reachable, because archive has to be reversible */}
      {archived.length > 0 ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
        >
          <Pressable
            onPress={() => setShowArchived((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showArchived ? 'Hide archived habits' : 'Show archived habits'}
            testID="health-habits-archived-toggle"
            style={styles.rowBetween}
          >
            <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
              ARCHIVED ({archived.length})
            </Typography>
            <Icon
              name={showArchived ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
          {showArchived
            ? archived.map((habit) => (
                <View key={habit.id} style={styles.archivedRow}>
                  <Typography variant="body" color={colors.textSecondary} style={styles.flex}>
                    {habit.name}
                  </Typography>
                  <Typography variant="caption2" color={colors.textSecondary}>
                    best {longestStreakOf(habit.days)} d
                  </Typography>
                  <Pressable
                    onPress={() => void handleArchive(habit, false)}
                    accessibilityRole="button"
                    accessibilityLabel={`Unarchive ${habit.name}`}
                    testID={`health-habit-unarchive-${habit.id}`}
                    hitSlop={8}
                  >
                    <Icon name="history" size={16} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(habit)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${habit.name}`}
                    testID={`health-habit-delete-${habit.id}`}
                    hitSlop={8}
                  >
                    <Icon name="close" size={16} color={colors.textSecondary} />
                  </Pressable>
                </View>
              ))
            : null}
        </Card>
      ) : null}

      {/* Add — a quick name row, the preset library, or the full custom form */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          ADD A HABIT
        </Typography>
        <View style={styles.addRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="e.g. Walk after lunch"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            onSubmitEditing={() => void handleQuickAdd()}
            testID="health-habit-name-input"
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <Pressable
            onPress={() => void handleQuickAdd()}
            disabled={draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Add habit"
            accessibilityState={{ disabled: draft.trim().length === 0 }}
            testID="health-habit-add-button"
            style={[
              styles.addButton,
              {
                backgroundColor: draft.trim().length > 0 ? colors.primary : colors.borderColor,
              },
            ]}
          >
            <Icon name="add" size={22} color={colors.white} />
          </Pressable>
        </View>

        <View style={styles.addRow}>
          <Pressable
            onPress={() => {
              setBrowsing((v) => !v);
              setCustomForm(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Browse the habit library"
            testID="health-habits-browse-library"
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="search" size={16} color={colors.textSecondary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {browsing ? 'Hide library' : 'Browse library'}
            </Typography>
          </Pressable>
          <Pressable
            onPress={() => {
              setCustomForm((v) => !v);
              setBrowsing(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Create a custom habit"
            testID="health-habits-create-custom"
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Icon name="edit" size={16} color={colors.textSecondary} />
            <Typography variant="caption1" color={colors.textSecondary}>
              {customForm ? 'Cancel' : 'Custom habit'}
            </Typography>
          </Pressable>
        </View>
      </Card>

      {/* Preset library — the donor's 19 templates, searchable and faceted */}
      {browsing ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-habits-library"
        >
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search habits"
            placeholderTextColor={colors.textSecondary}
            testID="health-habits-library-search"
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <View style={styles.filterRow}>
            {[{ value: null, label: 'All' }, ...templateCategories].map((option) => {
              const selected = templateCategory === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setTemplateCategory(option.value as string | null)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option.label} presets`}
                  testID={`health-habits-library-category-${option.label.toLowerCase()}`}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: selected ? colors.primary : 'transparent',
                      borderColor: selected ? colors.primary : colors.borderColor,
                    },
                  ]}
                >
                  <Typography
                    variant="caption2"
                    color={selected ? colors.white : colors.textSecondary}
                  >
                    {option.label}
                  </Typography>
                </Pressable>
              );
            })}
          </View>

          {templates.length === 0 ? (
            <Typography
              variant="body"
              color={colors.textSecondary}
              testID="health-habits-library-empty"
            >
              Nothing matches that. Try a different word, or create a custom habit.
            </Typography>
          ) : (
            templates.map((template) => {
              const already = takenTemplateIds.has(template.id);
              return (
                <Pressable
                  key={template.id}
                  onPress={() => {
                    if (already) return;
                    void addHabitFromTemplate(template).then(setHabits);
                  }}
                  disabled={already}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${template.name}`}
                  accessibilityState={{ disabled: already }}
                  testID={`health-habit-template-${template.id}`}
                  style={styles.templateRow}
                >
                  <View style={[styles.templateIcon, { backgroundColor: colors.backgroundMain }]}>
                    <Icon name={template.icon} size={20} />
                  </View>
                  <View style={styles.flex}>
                    <Typography variant="body" weight="medium" color={colors.textPrimary}>
                      {template.name}
                    </Typography>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {template.description}
                    </Typography>
                  </View>
                  <Icon
                    name={already ? 'checkmark' : 'add'}
                    size={18}
                    color={already ? colors.textSecondary : colors.primary}
                  />
                </Pressable>
              );
            })
          )}
        </Card>
      ) : null}

      {customForm ? (
        <HealthHabitForm
          testIDPrefix="health-habit-create"
          submitLabel="Add habit"
          onSubmit={(next) => {
            setCustomForm(false);
            void addHabit(next.name ?? '', next.icon ?? 'goals', next).then(setHabits);
          }}
          onCancel={() => setCustomForm(false)}
        />
      ) : null}

      {openHabit ? (
        <HealthHabitDetailScreen
          habit={openHabit}
          onClose={() => setOpenHabitId(null)}
          onToggle={(habit, when) => void toggleHabitToday(habit.id, when).then(setHabits)}
          onSave={(habit, patch) => void handleSave(habit, patch)}
          onArchive={(habit, next) => void handleArchive(habit, next)}
          onDelete={performDelete}
        />
      ) : null}
    </HealthSectionScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  flex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  dateCenter: {
    flex: 1,
    alignItems: 'center',
  },
  navButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  summarySide: {
    flex: 1,
    gap: Spacing.xs,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  habitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitText: {
    flex: 1,
    gap: 2,
  },
  strip: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  dot: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  templateIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
