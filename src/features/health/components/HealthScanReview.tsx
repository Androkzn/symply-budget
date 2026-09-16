import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { HealthMealDataSource, HealthMealPhotoDraft, HealthMealPhotoFood } from '@api/healthAi';
import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { parseFoodAmount, sanitizeDecimalInput } from '../healthFoodStorage';
import {
  fromWireMealType,
  logScannedFoodsToDiary,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  parseCaloriesInput,
  parseMacroInput,
  sanitizeAmountInput,
  scanLoggedMessage,
  type MealSlot,
  type ScannedFoodEntry,
} from '../healthNutritionStorage';

/**
 * The review step for an AI meal-photo / kitchen-scale scan (donor
 * `FoodImageAnalysis` / `ScaleFoodAnalysis`, the backend folding the scale
 * reading into the meal-photo path).
 *
 * `HealthScanScreen` used to hand back a draft and dead-end: "Adding these to
 * your diary is not built yet — add them from the Nutrition tab using the
 * figures above." This is what closes that gap. Every figure a scan produced
 * stays EDITABLE here — a scan is a reading, not a fact — and nothing is
 * written until Save, which files every checked row in ONE request via
 * `POST /nutrition/entries/bulk` (`logScannedFoodsToDiary`). A dropped
 * connection during that request cannot leave the meal half-logged the way N
 * separate creates could.
 *
 * One meal slot applies to the whole scan, matching the donor: a scan reads
 * one plate, and a plate is one meal.
 */

/** The donor's provenance ladder, in the words a member can act on. */
const SOURCE_LABEL: Record<string, string> = {
  nutrition_label: 'From the label',
  package_description: 'From the packaging',
  product_database: 'Known product',
  brand_lookup: 'From brand data',
  estimation: 'Estimated',
};

/**
 * A rung the ladder does not name.
 *
 * The Worker CASTS `data_source` to the enum rather than validating it, so a
 * model that answers its own word (e.g. "visual_guess") reaches this screen
 * intact. Looking that up would otherwise yield `undefined`, which draws an
 * EMPTY chip — and an empty chip reads as "no caveat" on exactly the row that
 * has not been vouched for.
 */
const UNKNOWN_SOURCE_LABEL = 'Source not stated';

export function sourceLabelFor(source: HealthMealDataSource | null): string | null {
  if (source === null) return null;
  return SOURCE_LABEL[source] ?? UNKNOWN_SOURCE_LABEL;
}

interface ScanRow {
  key: string;
  included: boolean;
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  portion: string;
  unit: string;
  source: HealthMealDataSource | null;
}

function rowsFromDraft(foods: HealthMealPhotoFood[]): ScanRow[] {
  return foods.map((food, index) => ({
    key: `${food.food_name}-${index}`,
    // A row with no calorie figure is left unchecked rather than defaulting
    // it to included-with-zero — see `logScannedFoodsToDiary`.
    included: food.calories != null,
    name: food.food_name,
    calories: food.calories != null ? String(Math.round(food.calories)) : '',
    protein: food.proteins != null ? String(Math.round(food.proteins)) : '',
    carbs: food.carbohydrates != null ? String(Math.round(food.carbohydrates)) : '',
    fat: food.fats != null ? String(Math.round(food.fats)) : '',
    portion: food.portion != null ? String(food.portion) : '',
    unit: food.unit ?? 'g',
    source: food.data_source ?? null,
  }));
}

export interface HealthScanReviewProps {
  draft: HealthMealPhotoDraft;
  /** Day the reviewed foods are filed against. Defaults to today. */
  date?: string;
  onDiscard: () => void;
  /** Called once the bulk write actually landed, with the confirmation copy. */
  onSaved: (message: string) => void;
  testID?: string;
}

export function HealthScanReview({
  draft,
  date,
  onDiscard,
  onSaved,
  testID = 'health-scan-review',
}: HealthScanReviewProps) {
  const colors = useAppColors();
  const [slot, setSlot] = useState<MealSlot>(
    draft.meal_type ? fromWireMealType(draft.meal_type) : 'snacks'
  );
  const [rows, setRows] = useState<ScanRow[]>(() => rowsFromDraft(draft.foods));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const patchRow = (key: string, patch: Partial<ScanRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const includedCount = useMemo(
    () =>
      rows.filter((row) => {
        if (!row.included) return false;
        const calories = parseCaloriesInput(row.calories);
        return calories !== null && calories > 0;
      }).length,
    [rows]
  );
  const canSave = includedCount > 0 && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    const entries: ScannedFoodEntry[] = [];
    for (const row of rows) {
      if (!row.included) continue;
      const calories = parseCaloriesInput(row.calories);
      if (calories === null || calories <= 0) continue;
      const portion = parseFoodAmount(row.portion);
      entries.push({
        name: row.name,
        slot,
        calories,
        protein: parseMacroInput(row.protein) ?? 0,
        carbs: parseMacroInput(row.carbs) ?? 0,
        fat: parseMacroInput(row.fat) ?? 0,
        ...(portion !== null && portion > 0 ? { portion, unit: row.unit } : {}),
      });
    }
    const result = await logScannedFoodsToDiary(entries, date);
    setSaving(false);
    if (result.status !== 'logged') {
      setMessage(result.message);
      return;
    }
    onSaved(scanLoggedMessage(result.logged, slot));
  };

  return (
    <View style={styles.wrap} testID={testID}>
      <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
        WHAT IS ON THE PLATE
      </Typography>
      <Typography variant="caption1" color={colors.textSecondary}>
        Nothing is saved yet. Check every figure, pick a meal, and keep only what belongs.
      </Typography>

      {draft.scale_reading?.detected === true && draft.scale_reading.value !== null && (
        <Typography variant="body" color={colors.textPrimary} testID={`${testID}-scale`}>
          Scale reading: {draft.scale_reading.value} {draft.scale_reading.unit ?? 'g'}
        </Typography>
      )}

      <Typography variant="caption1" color={colors.textSecondary}>
        Add to
      </Typography>
      <View style={styles.chipRow}>
        {MEAL_SLOTS.map((option) => {
          const active = option === slot;
          return (
            <Pressable
              key={option}
              onPress={() => setSlot(option)}
              accessibilityRole="button"
              accessibilityLabel={`Add these foods to ${MEAL_SLOT_LABELS[option]}`}
              accessibilityState={{ selected: active }}
              testID={`${testID}-slot-${option}`}
              style={[
                styles.chip,
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
                {MEAL_SLOT_LABELS[option]}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      {rows.map((row, index) => {
        const source = sourceLabelFor(row.source);
        const vouched = source !== null && source !== SOURCE_LABEL.estimation && source !== UNKNOWN_SOURCE_LABEL;
        return (
          <View
            key={row.key}
            testID={`${testID}-food-${index}`}
            style={[styles.foodRow, { borderTopColor: colors.borderColor }]}
          >
            <View style={styles.foodHead}>
              <Pressable
                onPress={() => patchRow(row.key, { included: !row.included })}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityLabel={`Include ${row.name || 'this food'}`}
                accessibilityState={{ checked: row.included }}
                testID={`${testID}-food-${index}-toggle`}
                style={[
                  styles.checkbox,
                  {
                    borderColor: row.included ? colors.primary : colors.borderColor,
                    backgroundColor: row.included ? colors.primary : 'transparent',
                  },
                ]}
              >
                {row.included ? <Icon name="checkmark" size={14} color={colors.white} /> : null}
              </Pressable>
              <TextInput
                value={row.name}
                onChangeText={(text) => patchRow(row.key, { name: text })}
                placeholder="Food name"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel={`Name for food ${index + 1}`}
                testID={`${testID}-food-${index}-name`}
                style={[
                  styles.nameInput,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                    backgroundColor: colors.backgroundMain,
                  },
                ]}
              />
            </View>

            {source !== null ? (
              <Typography
                variant="caption2"
                color={vouched ? colors.textSecondary : colors.error}
                testID={`${testID}-food-${index}-source`}
              >
                {source}
              </Typography>
            ) : null}

            <View style={styles.amountRow}>
              <AmountField
                label="kcal"
                value={row.calories}
                onChange={(text) => patchRow(row.key, { calories: sanitizeAmountInput(text) })}
                accessibilityLabel={`Calories for ${row.name || 'this food'}`}
                testID={`${testID}-food-${index}-calories`}
              />
              <AmountField
                label="P (g)"
                value={row.protein}
                onChange={(text) => patchRow(row.key, { protein: sanitizeAmountInput(text) })}
                accessibilityLabel={`Protein grams for ${row.name || 'this food'}`}
                testID={`${testID}-food-${index}-protein`}
              />
              <AmountField
                label="C (g)"
                value={row.carbs}
                onChange={(text) => patchRow(row.key, { carbs: sanitizeAmountInput(text) })}
                accessibilityLabel={`Carb grams for ${row.name || 'this food'}`}
                testID={`${testID}-food-${index}-carbs`}
              />
              <AmountField
                label="F (g)"
                value={row.fat}
                onChange={(text) => patchRow(row.key, { fat: sanitizeAmountInput(text) })}
                accessibilityLabel={`Fat grams for ${row.name || 'this food'}`}
                testID={`${testID}-food-${index}-fat`}
              />
              <AmountField
                label={`Portion (${row.unit})`}
                value={row.portion}
                onChange={(text) => patchRow(row.key, { portion: sanitizeDecimalInput(text) })}
                accessibilityLabel={`Portion for ${row.name || 'this food'}`}
                testID={`${testID}-food-${index}-portion`}
              />
            </View>
          </View>
        );
      })}

      <Typography variant="body" color={colors.textPrimary} testID={`${testID}-total`}>
        {draft.total_calories == null
          ? 'Total not known — at least one item has no calorie figure.'
          : `Total ${draft.total_calories} kcal`}
      </Typography>

      {message !== null ? (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID={`${testID}-message`}
          accessibilityLabel={message}
        >
          {message}
        </Typography>
      ) : null}

      <View style={styles.formActions}>
        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={`Add ${includedCount} ${includedCount === 1 ? 'food' : 'foods'} to ${MEAL_SLOT_LABELS[slot]}`}
          accessibilityState={{ disabled: !canSave }}
          testID={`${testID}-save`}
          style={[styles.primaryButton, { backgroundColor: canSave ? colors.primary : colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.white}>
            {saving ? 'Adding…' : `Add ${includedCount || ''} to ${MEAL_SLOT_LABELS[slot]}`}
          </Typography>
        </Pressable>
        <Pressable
          onPress={onDiscard}
          accessibilityRole="button"
          accessibilityLabel="Discard this scan"
          testID={`${testID}-discard`}
          style={[styles.secondaryButton, { borderColor: colors.borderColor }]}
        >
          <Typography variant="footnote" weight="semibold" color={colors.textSecondary}>
            Discard
          </Typography>
        </Pressable>
      </View>
    </View>
  );
}

function AmountField({
  label,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.amountField}>
      <Typography variant="caption1" color={colors.textSecondary}>
        {label}
      </Typography>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
        returnKeyType="done"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={[
          styles.amountInput,
          {
            color: colors.textPrimary,
            borderColor: colors.borderColor,
            backgroundColor: colors.backgroundMain,
          },
        ]}
      />
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  foodRow: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  foodHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: CornerRadius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  amountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  amountField: {
    flexGrow: 1,
    flexBasis: 70,
    gap: Spacing.xxs,
  },
  amountInput: {
    height: 40,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 15,
  },
  formActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
