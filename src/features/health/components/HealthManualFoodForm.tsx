import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { DEFAULT_FOOD_UNIT, FOOD_UNITS, parseFoodPortion, sanitizeDecimalInput } from '../healthFoodStorage';
import {
  addMealEntry,
  MEAL_SLOT_ICONS,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  parseCaloriesInput,
  parseMacroInput,
  sanitizeAmountInput,
  type MealSlot,
} from '../healthNutritionStorage';

import { MACRO_SERIES } from './HealthMacroBreakdown';

/**
 * Manual entry (donor `ManualFoodEntrySheet`, reached from the Quick Add
 * grid's plain "+" button).
 *
 * Fields and defaults mirror the donor exactly: "Food name", a Portion +
 * Unit pair defaulting to 100 g, a Meal picker, a read-only "Calculated
 * Nutrition" line (just the portion + unit — the donor does no on-device
 * scaling here either), then four Nutrition fields — Calories (flame),
 * Protein / Carbohydrates / Fat (a coloured dot each). The donor's dots are
 * literal red/blue/green/yellow; this app uses its OWN macro palette
 * (`MACRO_SERIES`, already validated for contrast against both themes) so a
 * protein figure reads the same colour here as it does on the Nutrition tab's
 * own macro split — restyled, not re-skinned.
 *
 * `isValid` is the donor's own rule: a name and a positive calorie figure.
 * Everything else — protein/carbs/fat, portion, unit — defaults to 0 / 100 / g
 * exactly as the donor's `emptyEntry` does, so an empty macro is a real "not
 * logged" rather than a blocked save.
 *
 * This writes STRAIGHT to the diary via `addMealEntry` — the same call
 * `HealthNutritionScreen`'s own manual-add card makes. It does not touch the
 * food library (`createFood`); the donor's Manual button does not either —
 * that is what the Library tab's own "+" is for.
 */

export interface HealthManualFoodFormProps {
  /** Meal slot preselected when the form opens — e.g. the slot in view. */
  initialSlot?: MealSlot;
  /** Day to log against. Defaults to today. */
  date?: string;
  onCancel?: () => void;
  /** Fires once the entry has actually been written. */
  onSaved: (result: { name: string; slot: MealSlot }) => void;
  testID?: string;
}

const MACRO_ROWS: ReadonlyArray<{
  key: 'protein' | 'carbs' | 'fat';
  label: string;
}> = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbohydrates' },
  { key: 'fat', label: 'Fat' },
];

export function HealthManualFoodForm({
  initialSlot = 'snacks',
  date,
  onCancel,
  onSaved,
  testID = 'health-manual-food-form',
}: HealthManualFoodFormProps) {
  const colors = useAppColors();
  const [name, setName] = useState('');
  const [portion, setPortion] = useState('100');
  const [unit, setUnit] = useState<string>(DEFAULT_FOOD_UNIT);
  const [slot, setSlot] = useState<MealSlot>(initialSlot);
  const [calories, setCalories] = useState('');
  const [macros, setMacros] = useState<Record<'protein' | 'carbs' | 'fat', string>>({
    protein: '',
    carbs: '',
    fat: '',
  });
  const [saving, setSaving] = useState(false);

  const parsedPortion = parseFoodPortion(portion);
  const parsedCalories = parseCaloriesInput(calories);
  const canSave =
    name.trim().length > 0 && parsedPortion !== null && parsedCalories !== null && parsedCalories > 0 &&
    !saving;

  const handleSave = async () => {
    if (!canSave || parsedPortion === null || parsedCalories === null) return;
    setSaving(true);
    const trimmed = name.trim();
    await addMealEntry({
      name: trimmed,
      slot,
      calories: parsedCalories,
      protein: parseMacroInput(macros.protein) ?? 0,
      carbs: parseMacroInput(macros.carbs) ?? 0,
      fat: parseMacroInput(macros.fat) ?? 0,
      date,
      portion: parsedPortion,
      unit,
    });
    setSaving(false);
    setName('');
    setPortion('100');
    setUnit(DEFAULT_FOOD_UNIT);
    setCalories('');
    setMacros({ protein: '', carbs: '', fat: '' });
    onSaved({ name: trimmed, slot });
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        {name.trim().length > 0 ? name.trim().toUpperCase() : 'ADD FOOD'}
      </Typography>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Food name"
        placeholderTextColor={colors.textSecondary}
        returnKeyType="next"
        accessibilityLabel="Food name"
        testID={`${testID}-name`}
        style={[
          styles.input,
          { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
        ]}
      />

      <View style={styles.amountRow}>
        <View style={styles.portionField}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Portion
          </Typography>
          <TextInput
            value={portion}
            onChangeText={(text) => setPortion(sanitizeDecimalInput(text))}
            placeholder="100"
            placeholderTextColor={colors.textSecondary}
            keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
            returnKeyType="done"
            accessibilityLabel="Portion size"
            testID={`${testID}-portion`}
            style={[
              styles.amountInput,
              { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
            ]}
          />
        </View>
        <View style={styles.unitField}>
          <Typography variant="caption1" color={colors.textSecondary}>
            Unit
          </Typography>
          <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
            {FOOD_UNITS.map((option) => {
              const active = option === unit;
              return (
                <Pressable
                  key={option}
                  onPress={() => setUnit(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Measure in ${option}`}
                  accessibilityState={{ selected: active }}
                  testID={`${testID}-unit-${option}`}
                  style={[styles.segment, active && { backgroundColor: colors.primary }]}
                >
                  <Typography variant="caption1" weight="semibold" color={active ? colors.white : colors.textSecondary}>
                    {option}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <Typography variant="caption1" color={colors.textSecondary}>
        Meal
      </Typography>
      <View style={styles.chipRow}>
        {MEAL_SLOTS.map((option) => {
          const active = option === slot;
          return (
            <Pressable
              key={option}
              onPress={() => setSlot(option)}
              accessibilityRole="button"
              accessibilityLabel={`Log as ${MEAL_SLOT_LABELS[option]}`}
              accessibilityState={{ selected: active }}
              testID={`${testID}-slot-${option}`}
              style={[
                styles.chip,
                { borderColor: active ? colors.primary : colors.borderColor, backgroundColor: active ? colors.primary : 'transparent' },
              ]}
            >
              <Icon name={MEAL_SLOT_ICONS[option]} size={14} color={active ? colors.white : colors.textSecondary} />
              <Typography variant="caption1" weight="semibold" color={active ? colors.white : colors.textSecondary}>
                {MEAL_SLOT_LABELS[option]}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.previewRow, { borderColor: colors.borderColor }]}>
        <Typography variant="footnote" color={colors.textSecondary} testID={`${testID}-preview`}>
          Calculated nutrition for {portion || '0'} {unit}
        </Typography>
      </View>

      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        NUTRITION
      </Typography>

      <View style={styles.nutritionRow}>
        <Icon name="flame" size={16} color={colors.primary} />
        <Typography variant="body" color={colors.textPrimary} style={styles.nutritionLabel}>
          Calories
        </Typography>
        <TextInput
          value={calories}
          onChangeText={(text) => setCalories(sanitizeAmountInput(text))}
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
          keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
          returnKeyType="done"
          accessibilityLabel="Calories"
          testID={`${testID}-calories`}
          style={[
            styles.macroInput,
            { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
          ]}
        />
        <Typography variant="caption1" color={colors.textSecondary}>
          kcal
        </Typography>
      </View>

      {MACRO_ROWS.map((row) => {
        const series = MACRO_SERIES.find((entry) => entry.key === row.key);
        return (
          <View key={row.key} style={styles.nutritionRow}>
            <View style={[styles.macroDot, { backgroundColor: series?.color ?? colors.primary }]} />
            <Typography variant="body" color={colors.textPrimary} style={styles.nutritionLabel}>
              {row.label}
            </Typography>
            <TextInput
              value={macros[row.key]}
              onChangeText={(text) => setMacros((current) => ({ ...current, [row.key]: sanitizeAmountInput(text) }))}
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
              returnKeyType="done"
              accessibilityLabel={`${row.label} grams`}
              testID={`${testID}-${row.key}`}
              style={[
                styles.macroInput,
                { color: colors.textPrimary, borderColor: colors.borderColor, backgroundColor: colors.backgroundMain },
              ]}
            />
            <Typography variant="caption1" color={colors.textSecondary}>
              g
            </Typography>
          </View>
        );
      })}

      <View style={styles.formActions}>
        {onCancel ? (
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            testID={`${testID}-cancel`}
            style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
          >
            <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
              Cancel
            </Typography>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={`Add to ${MEAL_SLOT_LABELS[slot]}`}
          accessibilityState={{ disabled: !canSave }}
          testID={`${testID}-save`}
          style={[styles.primaryButton, { backgroundColor: canSave ? colors.primary : colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {saving ? 'Adding…' : `Add to ${MEAL_SLOT_LABELS[slot]}`}
          </Typography>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  portionField: {
    flex: 1,
    gap: Spacing.xxs,
  },
  unitField: {
    flex: 2,
    gap: Spacing.xxs,
  },
  amountInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  previewRow: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nutritionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nutritionLabel: {
    flex: 1,
  },
  macroDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  macroInput: {
    width: 84,
    height: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 15,
    textAlign: 'right',
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 46,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 46,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
