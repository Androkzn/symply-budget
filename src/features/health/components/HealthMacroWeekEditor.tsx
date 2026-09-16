import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon, Toggle, Typography } from '@components/ui';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  copyMacroDayToAll,
  MACRO_DIFFERENCE_TOLERANCE,
  MACRO_WEEK_DAYS,
  macroSplit,
  parseWholeNumber,
  sanitizeWholeNumber,
  seedMacroWeek,
  weekdayIndexOf,
  type MacroDayTargets,
  type MacroWeek,
} from '../healthGoalsStorage';
import { todayDateKey } from '../healthLocalStorage';

import { HealthGoalMacroBar } from './HealthGoalMacroBar';

export interface HealthMacroWeekEditorProps {
  week: MacroWeek;
  onChange: (week: MacroWeek) => void;
  /** What every day starts from the moment the switch is turned on. */
  flatTargets: MacroDayTargets;
  /** The calorie target in force each weekday (Monday-first) — for the live kcal readout below. */
  caloriesByDay: number[];
  testIDPrefix: string;
}

/**
 * The per-weekday macro split — protein/carbs/fat sibling of the per-weekday
 * calorie plan (`CalorieWeek`), both here and in the donor's `goal_history`.
 *
 * Shared by the onboarding nutrition step and the in-app Goals screen, same
 * reasoning `HealthGoalMacroBar` gives for being shared: one visual/behavioural
 * definition rather than two screens quietly drifting apart.
 *
 * DELIBERATELY NOT a 7-row × 3-field grid (21 always-visible inputs). A member
 * edits ONE day at a time via a chip row — Monday-first, defaulting to today —
 * with a "use this split for every day" shortcut for the common case of
 * mostly-the-same-except-two-days. Turning the switch on seeds every day from
 * `flatTargets` (`seedMacroWeek`, same "start from where you already are"
 * behaviour `seedCalorieWeek` already has for calories), so there is never an
 * empty day staring back at the member.
 */
export function HealthMacroWeekEditor({
  week,
  onChange,
  flatTargets,
  caloriesByDay,
  testIDPrefix,
}: HealthMacroWeekEditorProps) {
  const colors = useAppColors();
  const [selectedDay, setSelectedDay] = useState(() => weekdayIndexOf(todayDateKey()));

  const day: MacroDayTargets = week.days[selectedDay] ?? { protein: null, carbs: null, fat: null };
  const dayCalories = caloriesByDay[selectedDay] ?? 0;
  const split = macroSplit({
    calories: dayCalories,
    protein: day.protein ?? 0,
    carbs: day.carbs ?? 0,
    fat: day.fat ?? 0,
  });
  const hasDayMacros = day.protein !== null || day.carbs !== null || day.fat !== null;

  const updateDayField = (field: keyof MacroDayTargets, text: string) => {
    const parsed = parseWholeNumber(sanitizeWholeNumber(text));
    const days = week.days.map((candidate, index) =>
      index === selectedDay ? { ...candidate, [field]: parsed } : candidate
    );
    onChange({ ...week, days });
  };

  return (
    <View style={styles.container} testID={testIDPrefix}>
      <View style={styles.toggleRow}>
        <View style={styles.toggleCopy}>
          <Typography variant="footnote" weight="semibold" color={colors.textPrimary}>
            Custom nutrition distribution per week day
          </Typography>
          <Typography variant="caption2" color={colors.textSecondary}>
            Different protein/carbs/fat targets for training days vs rest days.
          </Typography>
        </View>
        <Toggle
          value={week.usePerDay}
          onValueChange={(on) =>
            onChange(
              on
                ? seedMacroWeek({ ...week, usePerDay: true }, flatTargets)
                : { ...week, usePerDay: false }
            )
          }
          accessibilityLabel="Use a different macro split per weekday"
          testID={`${testIDPrefix}-toggle`}
        />
      </View>

      {week.usePerDay && (
        <View style={styles.body} testID={`${testIDPrefix}-body`}>
          <View style={styles.dayRow}>
            {MACRO_WEEK_DAYS.map((dayMeta, index) => {
              const isSelected = index === selectedDay;
              return (
                <Pressable
                  key={dayMeta.short}
                  onPress={() => setSelectedDay(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${dayMeta.label}'s macro split`}
                  accessibilityState={{ selected: isSelected }}
                  testID={`${testIDPrefix}-day-${dayMeta.short.toLowerCase()}`}
                  hitSlop={4}
                  style={[
                    styles.dayChip,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.backgroundMain,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  <Typography
                    variant="caption2"
                    weight="semibold"
                    color={isSelected ? colors.white : colors.textSecondary}
                  >
                    {dayMeta.short}
                  </Typography>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.fieldsRow}>
            <MacroGramField
              label="Protein (g)"
              value={day.protein}
              onChange={(text) => updateDayField('protein', text)}
              testID={`${testIDPrefix}-protein-input`}
            />
            <MacroGramField
              label="Carbs (g)"
              value={day.carbs}
              onChange={(text) => updateDayField('carbs', text)}
              testID={`${testIDPrefix}-carbs-input`}
            />
            <MacroGramField
              label="Fat (g)"
              value={day.fat}
              onChange={(text) => updateDayField('fat', text)}
              testID={`${testIDPrefix}-fat-input`}
            />
          </View>

          <Pressable
            onPress={() => onChange(copyMacroDayToAll(week, selectedDay))}
            accessibilityRole="button"
            accessibilityLabel={`Use ${MACRO_WEEK_DAYS[selectedDay].label}'s split for every day`}
            testID={`${testIDPrefix}-copy-all`}
            hitSlop={6}
            style={styles.copyRow}
          >
            <Icon name="refresh" size={13} color={colors.primary} />
            <Typography variant="caption1" weight="semibold" color={colors.primary}>
              Use {MACRO_WEEK_DAYS[selectedDay].short}&apos;s split for every day
            </Typography>
          </Pressable>

          {hasDayMacros && (
            <View style={styles.calc}>
              <HealthGoalMacroBar split={split} testID={`${testIDPrefix}-bar`} />
              <Typography
                variant="caption2"
                color={
                  Math.abs(split.difference) > MACRO_DIFFERENCE_TOLERANCE
                    ? colors.warning
                    : colors.textSecondary
                }
                testID={`${testIDPrefix}-difference`}
              >
                {MACRO_WEEK_DAYS[selectedDay].label}:{' '}
                {Math.abs(split.difference) <= MACRO_DIFFERENCE_TOLERANCE
                  ? `${split.total.toLocaleString()} kcal, matching this day's ${dayCalories.toLocaleString()} kcal target.`
                  : split.difference > 0
                    ? `${split.total.toLocaleString()} kcal — ${split.difference.toLocaleString()} kcal more than this day's ${dayCalories.toLocaleString()} kcal target.`
                    : `${split.total.toLocaleString()} kcal — ${Math.abs(split.difference).toLocaleString()} kcal less than this day's ${dayCalories.toLocaleString()} kcal target.`}
              </Typography>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Own prop is `onChange`, not `onChangeText` — deliberately, matching
 * `OnboardingNumberField`'s convention. `findAllByProps` in tests matches
 * this wrapper AND the real `TextInput` it renders (both carry the same
 * `testID`); keeping the wrapper's callback prop under a DIFFERENT name is
 * what lets a test's `.find(n => typeof n.props.onChangeText === 'function')`
 * land on the real input rather than the wrapper (whose own `value` prop is
 * still the raw `number | null`, not the stringified one below).
 */
function MacroGramField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: number | null;
  onChange: (text: string) => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Typography variant="caption2" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value === null ? '' : String(value)}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        keyboardType="number-pad"
        autoCorrect={false}
        accessibilityLabel={label}
        testID={testID}
        style={[
          styles.input,
          { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  toggleCopy: { flex: 1, gap: 2 },
  body: { gap: Spacing.sm },
  dayRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  dayChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  field: { flex: 1, gap: 2 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  calc: { gap: Spacing.xs },
});
