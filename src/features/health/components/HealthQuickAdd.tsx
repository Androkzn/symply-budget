import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import {
  formatMacro,
  parseFoodPortion,
  sanitizeDecimalInput,
  type FoodItem,
  type FoodSuggestion,
  type FoodSuggestionReason,
} from '../healthFoodStorage';
import {
  MEAL_SLOT_LABELS,
  parseCaloriesInput,
  sanitizeAmountInput,
  type MealSlot,
} from '../healthNutritionStorage';

import { MACRO_SERIES } from './HealthMacroBreakdown';

/**
 * Symply Health — quick add (donor `AddNutritionEntrySheet`'s Library tab, its
 * suggestion chips and its "quick calories" escape hatch, on one surface).
 *
 * Three ways in, in the order the donor ranked them:
 *  1. SUGGESTED — `/foods/suggestions`, which the server already scores by time
 *     of day, meal slot, usage and favourite. The reasons it sends are shown as
 *     written, so the user can see WHY a food was offered.
 *  2. FAVOURITES / RECENT — the user's own library.
 *  3. CALORIES ONLY — a bare number for the meal you cannot look up. Always
 *     available, so an empty library never blocks logging.
 *
 * RULE 1 — every nutrition figure here is a SERVER figure. A row shows
 * `food.serving`, which the Worker derived from the stored per-100 basis. When a
 * different portion is asked for, this component does NOT scale those numbers:
 * it sends the portion and lets `/custom-foods/:id/use` answer with the derived
 * serving. Until that answer arrives the row says the figures are for the food's
 * own portion rather than showing a locally-multiplied number the server would
 * disagree with.
 */

export type QuickAddTab = 'suggested' | 'favorites' | 'recent';

const TABS: Array<{ key: QuickAddTab; label: string }> = [
  { key: 'suggested', label: 'Suggested' },
  { key: 'favorites', label: 'Favourites' },
  { key: 'recent', label: 'Recent' },
];

/** The server's reason codes, in the user's words. */
const REASON_LABELS: Record<FoodSuggestionReason, string> = {
  favorite: 'Favourite',
  frequently_used: 'Often logged',
  recently_used: 'Logged recently',
  meal_type_match: 'Usual for this meal',
  time_based_match: 'Usual at this time',
};

export function reasonLabel(reasons: FoodSuggestionReason[]): string | null {
  for (const reason of reasons) {
    const label = REASON_LABELS[reason];
    if (label) return label;
  }
  return null;
}

export interface HealthQuickAddProps {
  slot: MealSlot;
  suggestions: FoodSuggestion[];
  /** The suggestions call did not answer (offline) — say so, don't fake a list. */
  suggestionsUnavailable?: boolean;
  favorites: FoodItem[];
  recents: FoodItem[];
  loading?: boolean;
  /** Food currently being logged — its Add button locks while in flight. */
  busyFoodId?: string | null;
  onLogFood: (food: FoodItem, portion: number) => void;
  onLogCalories: (name: string, calories: number) => void;
  /** Hide the "QUICK ADD" heading — set when a parent card already labels it. */
  hideHeading?: boolean;
}

export function HealthQuickAdd({
  slot,
  suggestions,
  suggestionsUnavailable = false,
  favorites,
  recents,
  loading = false,
  busyFoodId = null,
  onLogFood,
  onLogCalories,
  hideHeading = false,
}: HealthQuickAddProps) {
  const colors = useAppColors();
  const [tab, setTab] = useState<QuickAddTab>('suggested');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [portion, setPortion] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickCalories, setQuickCalories] = useState('');

  const rows = useMemo(() => {
    if (tab === 'favorites') return favorites.map((food) => ({ food, reason: null as string | null }));
    if (tab === 'recent') return recents.map((food) => ({ food, reason: null as string | null }));
    return suggestions.map((entry) => ({ food: entry.food, reason: reasonLabel(entry.reasons) }));
  }, [tab, suggestions, favorites, recents]);

  const select = (food: FoodItem) => {
    if (selectedId === food.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(food.id);
    // Seeded with the food's OWN portion, so "Add" with no edit logs exactly the
    // serving the row is showing.
    setPortion(String(food.portion));
  };

  const parsedCalories = parseCaloriesInput(quickCalories);
  const canQuickLog = parsedCalories !== null && parsedCalories > 0;

  return (
    <View style={styles.wrap} testID="health-quick-add">
      {hideHeading ? null : (
        <Typography variant="footnote" color={colors.textSecondary} style={styles.heading}>
          QUICK ADD
        </Typography>
      )}

      <View style={[styles.tabs, { borderColor: colors.borderColor }]}>
        {TABS.map((option) => {
          const active = option.key === tab;
          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setTab(option.key);
                setSelectedId(null);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Show ${option.label.toLowerCase()} foods`}
              accessibilityState={{ selected: active }}
              testID={`health-quick-add-tab-${option.key}`}
              style={[styles.tab, active && { backgroundColor: colors.primary }]}
            >
              <Typography
                variant="caption1"
                weight="semibold"
                color={active ? colors.white : colors.textSecondary}
              >
                {option.label}
              </Typography>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID="health-quick-add-loading"
        >
          Loading your food library…
        </Typography>
      ) : rows.length === 0 ? (
        <Typography
          variant="footnote"
          color={colors.textSecondary}
          testID="health-quick-add-empty"
          accessibilityLabel={emptyCopy(tab, suggestionsUnavailable)}
        >
          {emptyCopy(tab, suggestionsUnavailable)}
        </Typography>
      ) : (
        rows.map(({ food, reason }) => {
          const selected = selectedId === food.id;
          const busy = busyFoodId === food.id;
          const parsedPortion = parseFoodPortion(portion);
          const canLog = selected && parsedPortion !== null && !busy;
          const portionChanged = parsedPortion !== null && parsedPortion !== food.portion;

          return (
            <View
              key={food.id}
              style={[styles.foodRow, { borderTopColor: colors.borderColor }]}
              testID={`health-quick-add-row-${food.id}`}
            >
              <Pressable
                onPress={() => select(food)}
                accessibilityRole="button"
                accessibilityLabel={`${food.name}, ${food.serving.calories} kilocalories per ${food.portion} ${food.unit}`}
                accessibilityState={{ selected }}
                testID={`health-quick-add-food-${food.id}`}
                style={styles.foodHead}
              >
                <View style={styles.foodText}>
                  <Typography variant="body" color={colors.textPrimary} numberOfLines={1}>
                    {food.name}
                    {food.brand ? ` · ${food.brand}` : ''}
                  </Typography>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {formatMacro(food.serving.calories)} kcal per {formatMacro(food.portion)}{' '}
                    {food.unit}
                  </Typography>
                  <View style={styles.pills}>
                    {MACRO_SERIES.map((series) => (
                      <View key={series.key} style={styles.pill}>
                        <View style={[styles.pillDot, { backgroundColor: series.color }]} />
                        <Typography variant="caption1" color={colors.textSecondary}>
                          {series.short} {formatMacro(food.serving[series.key])}g
                        </Typography>
                      </View>
                    ))}
                  </View>
                  {reason ? (
                    <Typography
                      variant="caption1"
                      color={colors.primary}
                      testID={`health-quick-add-reason-${food.id}`}
                    >
                      {reason}
                    </Typography>
                  ) : null}
                </View>
                <Icon
                  name={selected ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textSecondary}
                />
              </Pressable>

              {selected ? (
                <View style={styles.portionRow}>
                  <View style={styles.portionField}>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      Portion ({food.unit})
                    </Typography>
                    <TextInput
                      value={portion}
                      onChangeText={(text) => setPortion(sanitizeDecimalInput(text))}
                      placeholder={String(food.portion)}
                      placeholderTextColor={colors.textSecondary}
                      keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                      returnKeyType="done"
                      accessibilityLabel={`Portion of ${food.name} in ${food.unit}`}
                      testID={`health-quick-add-portion-${food.id}`}
                      style={[
                        styles.input,
                        {
                          color: colors.textPrimary,
                          borderColor: colors.borderColor,
                          backgroundColor: colors.backgroundMain,
                        },
                      ]}
                    />
                  </View>
                  <Pressable
                    onPress={() => parsedPortion !== null && onLogFood(food, parsedPortion)}
                    disabled={!canLog}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${food.name} to ${MEAL_SLOT_LABELS[slot]}`}
                    accessibilityState={{ disabled: !canLog }}
                    testID={`health-quick-add-log-${food.id}`}
                    style={[
                      styles.addButton,
                      { backgroundColor: canLog ? colors.primary : colors.borderColor },
                    ]}
                  >
                    <Typography variant="footnote" weight="semibold" color={colors.white}>
                      Add to {MEAL_SLOT_LABELS[slot]}
                    </Typography>
                  </Pressable>
                </View>
              ) : null}

              {selected && portionChanged ? (
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`health-quick-add-portion-note-${food.id}`}
                >
                  The figures above are for {formatMacro(food.portion)} {food.unit}. Your portion is
                  worked out when you add it.
                </Typography>
              ) : null}
            </View>
          );
        })
      )}

      {/* The always-available path: a number, no library needed. */}
      <View style={[styles.quickRow, { borderTopColor: colors.borderColor }]}>
        <Typography variant="caption1" color={colors.textSecondary}>
          Or log calories only
        </Typography>
        <View style={styles.quickFields}>
          <TextInput
            value={quickName}
            onChangeText={setQuickName}
            placeholder="Name (optional)"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="Name for the calories-only entry"
            testID="health-quick-add-calories-name"
            style={[
              styles.input,
              styles.quickName,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <TextInput
            value={quickCalories}
            onChangeText={(text) => setQuickCalories(sanitizeAmountInput(text))}
            placeholder="kcal"
            placeholderTextColor={colors.textSecondary}
            keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
            returnKeyType="done"
            accessibilityLabel="Calories for the calories-only entry"
            testID="health-quick-add-calories-input"
            style={[
              styles.input,
              styles.quickCalories,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          <Pressable
            onPress={() => {
              if (parsedCalories === null || parsedCalories <= 0) return;
              onLogCalories(quickName, parsedCalories);
              setQuickName('');
              setQuickCalories('');
            }}
            disabled={!canQuickLog}
            accessibilityRole="button"
            accessibilityLabel={`Log calories to ${MEAL_SLOT_LABELS[slot]}`}
            accessibilityState={{ disabled: !canQuickLog }}
            testID="health-quick-add-calories-button"
            style={[
              styles.quickButton,
              { backgroundColor: canQuickLog ? colors.primary : colors.borderColor },
            ]}
          >
            <Icon name="add" size={18} color={colors.white} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Honest empty copy — each tab is empty for a different reason. */
export function emptyCopy(tab: QuickAddTab, suggestionsUnavailable: boolean): string {
  if (tab === 'favorites') return 'Star a food in your library and it shows up here.';
  if (tab === 'recent') return 'Foods you log will appear here for a fast repeat.';
  if (suggestionsUnavailable) {
    return 'Suggestions need a connection. Your favourites and recents still work.';
  }
  return 'Log a few meals and suggestions for this time of day appear here.';
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  heading: {
    letterSpacing: 0.6,
  },
  tabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foodRow: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  foodHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  foodText: {
    flex: 1,
    gap: 2,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  portionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  portionField: {
    flex: 1,
    gap: Spacing.xxs,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  addButton: {
    height: 42,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickRow: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  quickFields: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quickName: {
    flex: 2,
  },
  quickCalories: {
    flex: 1,
  },
  quickButton: {
    width: 42,
    height: 42,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
