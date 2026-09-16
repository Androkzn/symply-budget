import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  createFood,
  deleteFood,
  DEFAULT_FOOD_UNIT,
  DEFAULT_MEAL_SLOT,
  FOOD_UNITS,
  formatMacro,
  importExternalFood,
  loadFoodSuggestions,
  loadFoods,
  logExternalFoodToDiary,
  logFoodToDiary,
  parseFoodAmount,
  parseFoodPortion,
  sanitizeDecimalInput,
  searchFoods,
  setFoodFavorite,
  updateFood,
  viewFoods,
  type ExternalFoodItem,
  type FoodDraft,
  type FoodFilter,
  type FoodItem,
  type FoodSearchOutcome,
  type FoodSuggestionReason,
  type FoodSuggestions,
} from '../healthFoodStorage';
import { MEAL_SLOT_LABELS, MEAL_SLOTS, type MealSlot } from '../healthNutritionStorage';

/**
 * Foods tab — the user's own food library (parity phase P2) and the external
 * food database (parity phase P3).
 *
 * Everything numeric on this screen is a figure the `symply-health-api` Worker
 * derived from `base_*_per_100`: the row macros come straight off the stored
 * food, and "log to today" writes the `logged` serving the `use` route answered
 * with. Nothing here multiplies a portion out — see `healthFoodStorage`.
 *
 * THE TWO RESULT LISTS ARE NOT THE SAME KIND OF THING, so they are not one list.
 * MY FOODS rows can be logged, favourited, edited and deleted. FOOD DATABASE
 * rows are lookups: they have no row of their own until **Save** or **Log**
 * imports them, and until then there is nothing to favourite or delete. The
 * donor merged both into one list behind a coloured source badge; two labelled
 * sections say the same thing without asking the user to decode a badge to know
 * which buttons will appear.
 *
 * When the database cannot be consulted — no credential on this deploy, a rate
 * limit, an outage, or the handset being offline — the section is replaced by a
 * sentence saying so. It is never a silent empty list, which would read as "no
 * such food", and it is never an error string.
 */

const FILTERS: ReadonlyArray<{ id: FoodFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'most-used', label: 'Most used' },
];

const REASON_LABELS: Record<FoodSuggestionReason, string> = {
  favorite: 'Favourite',
  frequently_used: 'Often eaten',
  recently_used: 'Recent',
  meal_type_match: 'Fits this meal',
  time_based_match: 'Usual at this time',
};

const EMPTY_FORM = {
  name: '',
  brand: '',
  portion: '100',
  unit: DEFAULT_FOOD_UNIT as string,
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
};

export function HealthFoodLibraryScreen() {
  const colors = useAppColors();

  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [filter, setFilter] = useState<FoodFilter>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchOutcome | null>(null);
  /** Which of a database food's servings the user picked, by result id. */
  const [servingChoice, setServingChoice] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<FoodSuggestions | null>(null);
  const [slot, setSlot] = useState<MealSlot>(DEFAULT_MEAL_SLOT);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const setField = useCallback((key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const hydrate = useCallback(async (nextFilter: FoodFilter) => {
    const [library, suggested] = await Promise.all([
      loadFoods(nextFilter),
      // The server owns "what time of day is it" — the picker below defaults to
      // the slot it names, rather than the device guessing from the clock.
      loadFoodSuggestions(),
    ]);
    setFoods(library);
    setSuggestions(suggested);
    if (suggested) setSlot(suggested.mealSlot);
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate(filter);
  }, [filter, hydrate]);

  // Live search against /foods/search — the user's own library plus the food
  // database. A failed request degrades to the cached library inside the store
  // and carries a sentence explaining it, so this never blanks the list and
  // never shows an empty result that reads as "no such food".
  useEffect(() => {
    let cancelled = false;
    const needle = query.trim();
    if (needle.length === 0) {
      setResults(null);
      return undefined;
    }
    void searchFoods(needle).then((outcome) => {
      if (!cancelled) setResults(outcome);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const searching = query.trim().length > 0;
  const visible = useMemo(() => results?.library ?? foods, [results, foods]);
  const external = results?.external ?? [];
  const providerNotice = results?.providerNotice ?? null;

  const parsedCalories = parseFoodAmount(form.calories);
  const parsedPortion = parseFoodPortion(form.portion);
  const canSave =
    form.name.trim().length > 0 &&
    parsedPortion !== null &&
    parsedCalories !== null &&
    parsedCalories > 0;

  const applyResult = useCallback(
    (next: { foods: FoodItem[]; message: string | null }, activeFilter: FoodFilter) => {
      setFoods(viewFoods(next.foods, activeFilter));
      setMessage(next.message);
    },
    []
  );

  const handleSave = async () => {
    if (!canSave || parsedPortion === null || parsedCalories === null) return;
    const draft: FoodDraft = {
      name: form.name,
      brand: form.brand,
      portion: parsedPortion,
      unit: form.unit,
      calories: parsedCalories,
      protein: parseFoodAmount(form.protein) ?? 0,
      carbs: parseFoodAmount(form.carbs) ?? 0,
      fat: parseFoodAmount(form.fat) ?? 0,
    };
    const result = editingId ? await updateFood(editingId, draft) : await createFood(draft);
    applyResult(result, filter);
    if (result.status !== 'rejected') {
      setForm({ ...EMPTY_FORM });
      setEditingId(null);
    }
  };

  const handleEdit = (food: FoodItem) => {
    setEditingId(food.id);
    setMessage(null);
    setForm({
      name: food.name,
      brand: food.brand ?? '',
      portion: String(food.portion),
      unit: food.unit,
      calories: String(food.serving.calories),
      protein: String(food.serving.protein),
      carbs: String(food.serving.carbs),
      fat: String(food.serving.fat),
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleDelete = (food: FoodItem) => {
    Alert.alert('Delete food', `Remove "${food.name}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteFood(food.id).then((result) => {
            applyResult(result, filter);
            if (editingId === food.id) handleCancelEdit();
            if (searching) {
              setResults((current) =>
                current
                  ? { ...current, library: current.library.filter((f) => f.id !== food.id) }
                  : null
              );
            }
          });
        },
      },
    ]);
  };

  const handleFavorite = async (food: FoodItem) => {
    applyResult(await setFoodFavorite(food.id, !food.isFavorite), filter);
  };

  const handleLog = async (food: FoodItem) => {
    const result = await logFoodToDiary(food.id, { mealSlot: slot });
    applyResult(result, filter);
    if (result.status === 'rejected') return;
    const logged = result.logged;
    setMessage(
      logged
        ? `Added ${formatMacro(logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
        : `Added to ${MEAL_SLOT_LABELS[result.mealSlot]} — it will sync when you are back online.`
    );
  };

  /* ---- food database: a hit becomes a row the user owns, then a meal ---- */

  /** The serving the user picked for this hit, or the one the server preferred. */
  const chosenServingFor = (hit: ExternalFoodItem): string | null =>
    servingChoice[hit.id] ?? hit.servingId;

  /**
   * "Save" — import only. The food joins the library and works offline from
   * then on; nothing is written to the diary.
   */
  const handleSaveExternal = async (hit: ExternalFoodItem) => {
    const result = await importExternalFood(hit, { servingId: chosenServingFor(hit) });
    if (result.status === 'saved') {
      setFoods(viewFoods(result.foods, filter));
      setMessage(
        result.created
          ? `Saved "${hit.name}" to your foods.`
          : `"${hit.name}" is already in your foods.`
      );
      return;
    }
    setMessage(result.message);
  };

  /** "Log" — import, then file it in the chosen meal. Both halves or neither. */
  const handleLogExternal = async (hit: ExternalFoodItem) => {
    const result = await logExternalFoodToDiary(hit, {
      mealSlot: slot,
      servingId: chosenServingFor(hit),
    });
    if (result.foods.length > 0) setFoods(viewFoods(result.foods, filter));
    if (result.status !== 'saved') {
      setMessage(result.message);
      return;
    }
    const logged = result.logged;
    setMessage(
      logged
        ? `Added ${formatMacro(logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}, and saved "${hit.name}" to your foods.`
        : `Added "${hit.name}" to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
    );
  };

  return (
    <HealthSectionScreen title="Foods" testID="health-food-screen" loading={loading}>
      {/* Search — the user's own library only (external lookup is P3) */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          SEARCH
        </Typography>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your foods and the food database"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search your foods and the food database"
            testID="health-food-search-input"
            style={[
              styles.input,
              styles.searchInput,
              {
                color: colors.textPrimary,
                borderColor: colors.borderColor,
                backgroundColor: colors.backgroundMain,
              },
            ]}
          />
          {searching && (
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="health-food-search-clear"
              style={[styles.iconButton, { borderColor: colors.borderColor }]}
            >
              <Icon name="close" size={18} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
        {!searching && (
          <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
            {FILTERS.map((option) => {
              const active = option.id === filter;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setFilter(option.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${option.label}`}
                  accessibilityState={{ selected: active }}
                  testID={`health-food-filter-${option.id}`}
                  style={[styles.segment, active && { backgroundColor: colors.primary }]}
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
        )}
      </Card>

      {message && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-food-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* Server-scored "what you usually eat at this time of day" */}
      {!searching && suggestions && suggestions.suggestions.length > 0 && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-food-suggestions"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            USUALLY AT {suggestions.timeOfDay.toUpperCase()}
          </Typography>
          {suggestions.suggestions.map((entry) => (
            <Pressable
              key={entry.food.id}
              onPress={() => void handleLog(entry.food)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${entry.food.name} to ${MEAL_SLOT_LABELS[slot]}`}
              testID={`health-food-suggestion-${entry.food.id}`}
              style={[styles.row, { borderTopColor: colors.borderColor }]}
            >
              <View style={styles.rowText}>
                <Typography variant="body" color={colors.textPrimary}>
                  {entry.food.name}
                </Typography>
                <Typography variant="caption1" color={colors.textSecondary}>
                  {entry.reasons.map((reason) => REASON_LABELS[reason] ?? reason).join(' · ') ||
                    'Suggested'}
                </Typography>
              </View>
              <Icon name="add" size={18} color={colors.primary} />
            </Pressable>
          ))}
        </Card>
      )}

      {/* Which meal a "log to today" lands in. The server names the default. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          LOG TO
        </Typography>
        <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
          {MEAL_SLOTS.map((option) => {
            const active = option === slot;
            return (
              <Pressable
                key={option}
                onPress={() => setSlot(option)}
                accessibilityRole="button"
                accessibilityLabel={`Log to ${MEAL_SLOT_LABELS[option]}`}
                accessibilityState={{ selected: active }}
                testID={`health-food-slot-${option}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
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
      </Card>

      {/* Create / edit. The portion and its macros go up; the per-100 basis is
          derived by the Worker, never here. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editingId ? 'EDIT FOOD' : 'ADD FOOD'}
          </Typography>
          {editingId && (
            <Pressable
              onPress={handleCancelEdit}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              testID="health-food-cancel-edit"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Cancel
              </Typography>
            </Pressable>
          )}
        </View>
        <TextInput
          value={form.name}
          onChangeText={(text) => setField('name', text)}
          placeholder="Food name"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="next"
          accessibilityLabel="Food name"
          testID="health-food-name-input"
          style={[
            styles.input,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        <TextInput
          value={form.brand}
          onChangeText={(text) => setField('brand', text)}
          placeholder="Brand (optional)"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="next"
          accessibilityLabel="Brand"
          testID="health-food-brand-input"
          style={[
            styles.input,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />
        <View style={styles.amountRow}>
          <AmountField
            label="Portion"
            value={form.portion}
            onChange={(text) => setField('portion', text)}
            accessibilityLabel="Portion size"
            testID="health-food-portion-input"
          />
          <View style={[styles.segmented, styles.unitRow, { borderColor: colors.borderColor }]}>
            {FOOD_UNITS.map((option) => {
              const active = option === form.unit;
              return (
                <Pressable
                  key={option}
                  onPress={() => setField('unit', option)}
                  accessibilityRole="button"
                  accessibilityLabel={`Measure in ${option}`}
                  accessibilityState={{ selected: active }}
                  testID={`health-food-unit-${option}`}
                  style={[styles.segment, active && { backgroundColor: colors.primary }]}
                >
                  <Typography
                    variant="caption1"
                    weight="semibold"
                    color={active ? colors.white : colors.textSecondary}
                  >
                    {option}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.amountRow}>
          <AmountField
            label="kcal"
            value={form.calories}
            onChange={(text) => setField('calories', text)}
            accessibilityLabel="Calories for this portion"
            testID="health-food-calories-input"
          />
          <AmountField
            label="P (g)"
            value={form.protein}
            onChange={(text) => setField('protein', text)}
            accessibilityLabel="Protein grams"
            testID="health-food-protein-input"
          />
          <AmountField
            label="C (g)"
            value={form.carbs}
            onChange={(text) => setField('carbs', text)}
            accessibilityLabel="Carbohydrate grams"
            testID="health-food-carbs-input"
          />
          <AmountField
            label="F (g)"
            value={form.fat}
            onChange={(text) => setField('fat', text)}
            accessibilityLabel="Fat grams"
            testID="health-food-fat-input"
          />
        </View>
        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? 'Save changes' : 'Add food to library'}
          accessibilityState={{ disabled: !canSave }}
          testID="health-food-save-button"
          style={[
            styles.primaryButton,
            { backgroundColor: canSave ? colors.primary : colors.borderColor },
          ]}
        >
          <Icon name="add" size={18} color={colors.white} />
          <Typography variant="body" weight="semibold" color={colors.white}>
            {editingId ? 'Save changes' : 'Add to library'}
          </Typography>
        </Pressable>
      </Card>

      {/* The external food database. Only while searching: with no query there
          is nothing to look up, and an empty card would imply there was. */}
      {searching && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-food-database"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            FOOD DATABASE
          </Typography>
          {providerNotice ? (
            // Never a raw error, never a silent empty list: the one state the
            // database can be in that is not "here are the results".
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              accessibilityLabel={providerNotice}
              testID="health-food-database-notice"
            >
              {providerNotice}
            </Typography>
          ) : external.length === 0 ? (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="health-food-database-empty"
            >
              Nothing in the food database matches that.
            </Typography>
          ) : (
            external.map((hit) => {
              const chosenId = chosenServingFor(hit);
              const chosen = hit.servings.find((option) => option.id === chosenId);
              const shown = chosen ?? {
                description: hit.servingDescription ?? `${formatMacro(hit.portion)} ${hit.unit}`,
                macros: hit.serving,
              };
              return (
                <View
                  key={hit.id}
                  testID={`health-food-external-${hit.providerFoodId}`}
                  style={[styles.externalRow, { borderTopColor: colors.borderColor }]}
                >
                  <View style={styles.externalRowMain}>
                    <View style={styles.rowText}>
                      <Typography variant="body" color={colors.textPrimary}>
                        {hit.brand ? `${hit.name} · ${hit.brand}` : hit.name}
                      </Typography>
                      <Typography
                        variant="caption1"
                        color={colors.textSecondary}
                        testID={`health-food-external-macros-${hit.providerFoodId}`}
                      >
                        {shown.description} · {formatMacro(shown.macros.calories)} kcal ·{' '}
                        {formatMacro(shown.macros.protein)}P / {formatMacro(shown.macros.carbs)}C /{' '}
                        {formatMacro(shown.macros.fat)}F
                      </Typography>
                      <Typography variant="caption1" color={colors.textSecondary}>
                        {formatMacro(hit.per100.calories)} kcal / 100 {hit.unit === 'ml' ? 'ml' : 'g'}
                      </Typography>
                    </View>
                    <View style={styles.rowActions}>
                      <Pressable
                        onPress={() => void handleSaveExternal(hit)}
                        accessibilityRole="button"
                        accessibilityLabel={`Save ${hit.name} to your foods`}
                        testID={`health-food-external-save-${hit.providerFoodId}`}
                        hitSlop={8}
                      >
                        <Typography variant="caption1" weight="semibold" color={colors.primary}>
                          Save
                        </Typography>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleLogExternal(hit)}
                        accessibilityRole="button"
                        accessibilityLabel={`Log ${hit.name} to ${MEAL_SLOT_LABELS[slot]}`}
                        testID={`health-food-external-log-${hit.providerFoodId}`}
                        style={[styles.logButton, { backgroundColor: colors.primary }]}
                      >
                        <Typography variant="caption1" weight="semibold" color={colors.white}>
                          Log
                        </Typography>
                      </Pressable>
                    </View>
                  </View>
                  {/* The provider's own serving list. One serving is not a
                      choice, so the picker only appears when there is one. */}
                  {hit.servings.length > 1 && (
                    <View style={styles.servingRow}>
                      {hit.servings.map((option) => {
                        const active = option.id === chosenId;
                        return (
                          <Pressable
                            key={option.id}
                            onPress={() =>
                              setServingChoice((current) => ({ ...current, [hit.id]: option.id }))
                            }
                            accessibilityRole="button"
                            accessibilityLabel={`Use serving ${option.description} for ${hit.name}`}
                            accessibilityState={{ selected: active }}
                            testID={`health-food-external-serving-${hit.providerFoodId}-${option.id}`}
                            style={[
                              styles.servingChip,
                              {
                                borderColor: active ? colors.primary : colors.borderColor,
                                // The unselected fill is the card's own surface,
                                // which reads as transparent without hard-coding
                                // a literal that would not follow the theme.
                                backgroundColor: active
                                  ? colors.primary
                                  : colors.backgroundSecondary,
                              },
                            ]}
                          >
                            <Typography
                              variant="caption1"
                              color={active ? colors.white : colors.textSecondary}
                            >
                              {option.description}
                            </Typography>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>
      )}

      {/* The library (or the search results when a query is active) */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        {/* One label in both states. It used to flip to RESULTS while
            searching, which stopped saying anything the moment a second
            results card appeared above it — the useful distinction now is
            whose foods these are, not that a search happened. */}
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          MY FOODS
        </Typography>
        {visible.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID={searching ? 'health-food-search-empty' : 'health-food-empty'}
          >
            {searching
              ? 'No food in your library matches that.'
              : 'No foods yet. Add one above and it will be one tap away next time.'}
          </Typography>
        ) : (
          visible.map((food) => (
            <View
              key={food.id}
              testID={`health-food-row-${food.id}`}
              style={[styles.row, { borderTopColor: colors.borderColor }]}
            >
              <View style={styles.rowText}>
                <Typography variant="body" color={colors.textPrimary}>
                  {food.brand ? `${food.name} · ${food.brand}` : food.name}
                </Typography>
                <Typography
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`health-food-macros-${food.id}`}
                >
                  {formatMacro(food.portion)} {food.unit} · {formatMacro(food.serving.calories)} kcal
                  {' · '}
                  {formatMacro(food.serving.protein)}P / {formatMacro(food.serving.carbs)}C /{' '}
                  {formatMacro(food.serving.fat)}F
                </Typography>
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  onPress={() => void handleFavorite(food)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    food.isFavorite ? `Unfavourite ${food.name}` : `Favourite ${food.name}`
                  }
                  accessibilityState={{ selected: food.isFavorite }}
                  testID={`health-food-favorite-${food.id}`}
                  hitSlop={8}
                >
                  <Icon
                    name={food.isFavorite ? 'star' : 'star-outline'}
                    size={18}
                    color={food.isFavorite ? colors.primary : colors.textSecondary}
                  />
                </Pressable>
                <Pressable
                  onPress={() => handleEdit(food)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${food.name}`}
                  testID={`health-food-edit-${food.id}`}
                  hitSlop={8}
                >
                  <Icon name="create-outline" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(food)}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${food.name}`}
                  testID={`health-food-delete-${food.id}`}
                  hitSlop={8}
                >
                  <Icon name="close" size={18} color={colors.textSecondary} />
                </Pressable>
                <Pressable
                  onPress={() => void handleLog(food)}
                  accessibilityRole="button"
                  accessibilityLabel={`Log ${food.name} to ${MEAL_SLOT_LABELS[slot]}`}
                  testID={`health-food-log-${food.id}`}
                  style={[styles.logButton, { backgroundColor: colors.primary }]}
                >
                  <Typography variant="caption1" weight="semibold" color={colors.white}>
                    Log
                  </Typography>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>
    </HealthSectionScreen>
  );
}

/** Small labelled numeric field — the portion + macro row shares four of them. */
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
        onChangeText={(text) => onChange(sanitizeDecimalInput(text))}
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitRow: {
    flex: 2,
    alignSelf: 'flex-end',
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
  amountField: {
    flex: 1,
    gap: Spacing.xxs,
  },
  amountInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  externalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  externalRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  servingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  servingChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
  },
  logButton: {
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
