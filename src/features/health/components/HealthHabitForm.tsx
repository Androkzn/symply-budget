import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, TimePickerSheet, Toggle, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  HABIT_CATEGORIES,
  HABIT_FREQUENCY_OPTIONS,
  HABIT_ICON_CHOICES,
  HABIT_TIME_OPTIONS,
  HABIT_WEEKDAYS,
  HABIT_WEEKDAYS_ALL,
  HABIT_WEEKDAYS_WEEKDAY_SET,
  HABIT_WEEKDAYS_WEEKEND_SET,
  normalizeReminderTime,
  type HabitDraft,
  type HabitFrequency,
  type HabitTimeOfDay,
} from '../healthHabitsStorage';

/**
 * The one habit editor — used by BOTH "create a custom habit" on the Habits tab
 * and "Edit" on the habit detail screen.
 *
 * Two copies of this form is how the create and edit paths drift: the donor has
 * exactly that problem (`AddHabitView` and `EditHabitSheet` each carry their own
 * 24-icon grid and their own custom-day selector, and the edit sheet silently
 * omits `targetDuration`). One component, two callers.
 *
 * A default reminder time is offered rather than demanded: enabling the toggle
 * with no time set picks 09:00, because a reminder switched on with no time is
 * a switch that does nothing.
 */

const DEFAULT_REMINDER_TIME = '09:00';

export interface HealthHabitFormProps {
  /** Seeds every control. Omitted fields fall back to the donor's defaults. */
  initial?: HabitDraft;
  submitLabel: string;
  onSubmit: (draft: HabitDraft) => void;
  onCancel?: () => void;
  /** Prefix for every testID this form renders. */
  testIDPrefix: string;
  busy?: boolean;
}

/** 24h 'HH:MM' → "9:00 AM" for display; unparseable input reads as "Not set". */
export function formatReminderTime(value: string | null | undefined): string {
  const normalized = normalizeReminderTime(value);
  if (!normalized) return 'Not set';
  const [hour, minute] = normalized.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function HealthHabitForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  testIDPrefix,
  busy = false,
}: HealthHabitFormProps) {
  const colors = useAppColors();

  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'goals');
  const [category, setCategory] = useState(initial?.category ?? 'custom');
  const [timeOfDay, setTimeOfDay] = useState<HabitTimeOfDay>(initial?.timeOfDay ?? 'anytime');
  const [frequency, setFrequency] = useState<HabitFrequency>(initial?.frequency ?? 'daily');
  const [customDays, setCustomDays] = useState<number[]>(
    initial?.customDays && initial.customDays.length > 0
      ? [...initial.customDays]
      : [...HABIT_WEEKDAYS_ALL],
  );
  const [reminderEnabled, setReminderEnabled] = useState(initial?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useState<string | null>(
    normalizeReminderTime(initial?.reminderTime),
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [pickingTime, setPickingTime] = useState(false);

  const canSubmit = name.trim().length > 0 && !busy;
  const dayIsSelected = useMemo(() => new Set(customDays), [customDays]);

  const toggleDay = (day: number) => {
    // The last remaining day cannot be removed — a "custom" schedule with no
    // days is a habit that is never due, which reads as a bug, not a choice.
    setCustomDays((current) =>
      current.includes(day)
        ? current.length > 1
          ? current.filter((d) => d !== day)
          : current
        : [...current, day].sort((a, b) => a - b),
    );
  };

  const handleReminderToggle = (next: boolean) => {
    setReminderEnabled(next);
    if (next && !reminderTime) setReminderTime(DEFAULT_REMINDER_TIME);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: name.trim(),
      icon,
      category,
      timeOfDay,
      frequency,
      customDays: frequency === 'custom' ? customDays : null,
      reminderEnabled,
      reminderTime: reminderEnabled ? (reminderTime ?? DEFAULT_REMINDER_TIME) : reminderTime,
      notes: notes.trim().length > 0 ? notes.trim() : null,
    });
  };

  return (
    <Card
      variant="filled"
      style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
      testID={`${testIDPrefix}-form`}
    >
      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        NAME
      </Typography>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Walk after lunch"
        placeholderTextColor={colors.textSecondary}
        returnKeyType="done"
        testID={`${testIDPrefix}-name`}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />

      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        ICON
      </Typography>
      <View style={styles.wrap}>
        {HABIT_ICON_CHOICES.map((choice) => {
          const selected = icon === choice;
          return (
            <Pressable
              key={choice}
              onPress={() => setIcon(choice)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Icon ${choice}`}
              testID={`${testIDPrefix}-icon-${choice}`}
              style={[
                styles.iconTile,
                {
                  borderColor: selected ? colors.primary : colors.borderColor,
                  backgroundColor: selected ? colors.backgroundMain : 'transparent',
                },
              ]}
            >
              <Icon name={choice} size={22} active={selected} color={selected ? colors.primary : colors.textSecondary} />
            </Pressable>
          );
        })}
      </View>

      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        CATEGORY
      </Typography>
      <View style={styles.wrap}>
        {HABIT_CATEGORIES.map((option) => {
          const selected = category === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setCategory(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={`${testIDPrefix}-category-${option.value}`}
              style={[
                styles.chip,
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

      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        TIME OF DAY
      </Typography>
      <View style={styles.wrap}>
        {HABIT_TIME_OPTIONS.map((option) => {
          const selected = timeOfDay === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setTimeOfDay(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={`${testIDPrefix}-time-${option.value}`}
              style={[
                styles.chip,
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

      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        SCHEDULE
      </Typography>
      <View style={styles.wrap}>
        {HABIT_FREQUENCY_OPTIONS.map((option) => {
          const selected = frequency === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setFrequency(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={`${testIDPrefix}-frequency-${option.value}`}
              style={[
                styles.chip,
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

      {frequency === 'custom' ? (
        <View style={styles.section} testID={`${testIDPrefix}-custom-days`}>
          <View style={styles.dayRow}>
            {HABIT_WEEKDAYS.map((day) => {
              const selected = dayIsSelected.has(day.value);
              return (
                <Pressable
                  key={day.value}
                  onPress={() => toggleDay(day.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={day.label}
                  testID={`${testIDPrefix}-day-${day.value}`}
                  style={[
                    styles.day,
                    {
                      backgroundColor: selected ? colors.primary : 'transparent',
                      borderColor: selected ? colors.primary : colors.borderColor,
                    },
                  ]}
                >
                  <Typography
                    variant="caption1"
                    weight="medium"
                    color={selected ? colors.white : colors.textSecondary}
                  >
                    {day.letter}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.wrap}>
            {[
              { label: 'Weekdays', days: HABIT_WEEKDAYS_WEEKDAY_SET },
              { label: 'Weekends', days: HABIT_WEEKDAYS_WEEKEND_SET },
              { label: 'Every day', days: HABIT_WEEKDAYS_ALL },
            ].map((preset) => (
              <Pressable
                key={preset.label}
                onPress={() => setCustomDays([...preset.days])}
                accessibilityRole="button"
                accessibilityLabel={`Select ${preset.label}`}
                testID={`${testIDPrefix}-dayset-${preset.label.toLowerCase().replace(' ', '-')}`}
                style={[styles.chip, { borderColor: colors.borderColor }]}
              >
                <Typography variant="caption2" color={colors.textSecondary}>
                  {preset.label}
                </Typography>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Reminder — scheduled by the Worker, not this device */}
      <View style={styles.reminderRow}>
        <View style={styles.reminderText}>
          <Typography variant="body" weight="medium" color={colors.textPrimary}>
            Reminder
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            {reminderEnabled
              ? `${formatReminderTime(reminderTime)} · sent by Symply, so it works on every device`
              : 'Off'}
          </Typography>
        </View>
        <Toggle
          value={reminderEnabled}
          onValueChange={handleReminderToggle}
          accessibilityLabel="Habit reminder"
          testID={`${testIDPrefix}-reminder-toggle`}
        />
      </View>
      {reminderEnabled ? (
        <Pressable
          onPress={() => setPickingTime(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose reminder time"
          testID={`${testIDPrefix}-reminder-time`}
          style={[styles.timeButton, { borderColor: colors.borderColor }]}
        >
          <Icon name="reminders" size={18} color={colors.primary} />
          <Typography variant="body" color={colors.textPrimary}>
            {formatReminderTime(reminderTime)}
          </Typography>
        </Pressable>
      ) : null}

      <Typography variant="footnote" color={colors.textSecondary} style={styles.label}>
        NOTES
      </Typography>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional"
        placeholderTextColor={colors.textSecondary}
        multiline
        testID={`${testIDPrefix}-notes`}
        style={[
          styles.input,
          styles.notes,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />

      <View style={styles.actions}>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            testID={`${testIDPrefix}-cancel`}
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Typography variant="body" color={colors.textSecondary}>
              Cancel
            </Typography>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel={submitLabel}
          accessibilityState={{ disabled: !canSubmit }}
          testID={`${testIDPrefix}-submit`}
          style={[
            styles.primaryButton,
            { backgroundColor: canSubmit ? colors.primary : colors.borderColor },
          ]}
        >
          <Typography variant="body" weight="medium" color={colors.white}>
            {submitLabel}
          </Typography>
        </Pressable>
      </View>

      <TimePickerSheet
        visible={pickingTime}
        title="Reminder time"
        value={reminderTime ?? DEFAULT_REMINDER_TIME}
        onConfirm={(value) => {
          setReminderTime(normalizeReminderTime(value) ?? DEFAULT_REMINDER_TIME);
          setPickingTime(false);
        }}
        onClose={() => setPickingTime(false)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  label: {
    letterSpacing: 0.6,
    paddingTop: Spacing.xs,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
  },
  notes: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  section: {
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: CornerRadius.xxl,
    borderWidth: 1,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  day: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xs,
  },
  reminderText: {
    flex: 1,
    gap: 2,
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    flex: 2,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
