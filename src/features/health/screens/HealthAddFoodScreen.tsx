import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, Spacing, useAppColors } from '@theme';

import { HealthManualFoodForm, HealthSectionScreen } from '../components';
import { MACRO_SERIES } from '../components/HealthMacroBreakdown';
import {
  DEFAULT_MEAL_SLOT,
  formatMacro,
  importExternalFood,
  loadFoodSuggestions,
  loadFoods,
  loadRecipes,
  logExternalFoodToDiary,
  logFoodToDiary,
  logRecipeToDiary,
  scaleRecipe,
  searchFoods,
  SCALE_OFFLINE_MESSAGE,
  type ExternalFoodItem,
  type FoodItem,
  type FoodSearchOutcome,
  type RecipeItem,
  type ScaledRecipe,
} from '../healthFoodStorage';
import { isMealSlot, MEAL_SLOT_LABELS, MEAL_SLOTS, type MealSlot } from '../healthNutritionStorage';

/**
 * Add Food (donor `AddNutritionEntrySheet`) — the single unified surface the
 * donor reaches every logging path through: a 5-icon Quick Add rail above a
 * Search / Library / Recipes segmented control, exactly the donor's own
 * `scanButtonsSection` → `tabPickerSection` → `tabContentSection` stack
 * (`NutritionView.swift`).
 *
 * ── WHERE EACH TAB'S DATA COMES FROM ─────────────────────────────────────────
 *
 * Nothing here re-implements a fetch: Search calls `searchFoods` (library +
 * external database, exactly what `HealthFoodLibraryScreen`'s own search box
 * calls); Library calls `loadFoods('most-used')`; Recipes calls
 * `loadRecipes('all')`. Logging a library food, an external hit or a recipe
 * goes through the same `logFoodToDiary` / `logExternalFoodToDiary` /
 * `logRecipeToDiary` those screens use — this screen adds no new write path.
 *
 * ── WHAT "+" DOES ON EACH TAB ─────────────────────────────────────────────────
 *
 * The donor's Library "+" opens a full create-food sheet (name, brand,
 * portion, macros) and its Recipes "+" opens a multi-ingredient recipe
 * builder. Both of those forms already exist, in full, on
 * `HealthFoodLibraryScreen` and `HealthRecipesScreen` — duplicating them here
 * would be a second copy of the same validation and the same write path to
 * keep in sync. Instead both "+" buttons hand off to those screens, so there
 * is exactly one place either form is maintained. The MANUAL quick-add button
 * is different: the donor opens the same detail sheet a search result opens,
 * pre-filled empty, which is a DIARY write, not a library write — that is
 * `HealthManualFoodForm`, built for this screen.
 *
 * ── DIVERGENCES FROM THE RECIPE-ROW SCREENSHOT ───────────────────────────────
 *
 * The donor's `AddFoodRecipeRow` prints a per-serving figure, a per-100g
 * figure and a prep time. This app's `RecipeItem` only carries `totals` (the
 * whole batch) — no stored per-serving/per-100g field and no prep-time column
 * — because the anti-recompute rule (`healthFoodStorage.ts`) forbids dividing
 * `totals` by `servings` on the device to invent one; the one place a
 * per-serving figure is allowed to appear is `/recipes/:id/scale`'s own
 * answer, which is what expanding a row asks for. Prep time simply is not a
 * backend column yet. The list row therefore shows `{servings} servings ·
 * {totals} kcal total`, matching `HealthRecipesScreen`'s own row exactly.
 */

type AddFoodTab = 'search' | 'library' | 'recipes';

const TABS: ReadonlyArray<{ key: AddFoodTab; label: string }> = [
  { key: 'search', label: 'Search' },
  { key: 'library', label: 'Library' },
  { key: 'recipes', label: 'Recipes' },
];

type QuickAddKey = 'barcode' | 'label' | 'photo' | 'scale' | 'manual';

const QUICK_ADD_ACTIONS: ReadonlyArray<{
  key: QuickAddKey;
  label: string;
  icon: string;
  ai: boolean;
}> = [
  { key: 'barcode', label: 'Barcode', icon: 'barcode-outline', ai: false },
  { key: 'label', label: 'Label', icon: 'reader-outline', ai: false },
  { key: 'photo', label: 'Photo', icon: 'camera-outline', ai: true },
  { key: 'scale', label: 'Scale', icon: 'scale-outline', ai: true },
  { key: 'manual', label: 'Manual', icon: 'add-circle-outline', ai: false },
];

const COMING_SOON_MESSAGE =
  'Barcode scanning is coming soon to Symply Health. Try Label or Photo for now.';

export function HealthAddFoodScreen() {
  const colors = useAppColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ slot?: string }>();
  const requestedSlot = typeof params.slot === 'string' && isMealSlot(params.slot) ? params.slot : null;

  const [slot, setSlot] = useState<MealSlot>(requestedSlot ?? DEFAULT_MEAL_SLOT);
  const [tab, setTab] = useState<AddFoodTab>('search');
  const [message, setMessage] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);

  const [library, setLibrary] = useState<FoodItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodSearchOutcome | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [lib, rec, suggestions] = await Promise.all([
        loadFoods('most-used'),
        loadRecipes('all'),
        requestedSlot ? Promise.resolve(null) : loadFoodSuggestions(),
      ]);
      if (cancelled) return;
      setLibrary(lib);
      setRecipes(rec);
      if (suggestions) setSlot(suggestions.mealSlot);
      setLibraryLoading(false);
      setRecipesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Only the FIRST slot the screen opened with should seed the default — a
    // later manual change to `slot` must not be overwritten by a stale fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const refreshLibrary = useCallback(async () => {
    setLibrary(await loadFoods('most-used'));
  }, []);

  const handleQuickAdd = (key: QuickAddKey) => {
    setMessage(null);
    if (key === 'barcode') {
      setMessage(COMING_SOON_MESSAGE);
      return;
    }
    if (key === 'label') {
      router.push({ pathname: '/health-scan', params: { mode: 'label' } });
      return;
    }
    if (key === 'photo' || key === 'scale') {
      // The backend folds a kitchen-scale reading into the meal-photo path
      // (`HealthScanScreen`'s own doc comment) rather than treating Scale as a
      // separate feature, so both quick-add buttons open the same reader.
      router.push({ pathname: '/health-scan', params: { mode: 'meal' } });
      return;
    }
    setShowManualForm((current) => !current);
  };

  const handleManualSaved = ({ name, slot: savedSlot }: { name: string; slot: MealSlot }) => {
    setShowManualForm(false);
    setMessage(`${name} was added to ${MEAL_SLOT_LABELS[savedSlot]}.`);
  };

  return (
    <HealthSectionScreen title="Add Food" testID="health-add-food-screen">
      {/* Quick Add — the donor's 5-icon rail above the tab picker. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          QUICK ADD
        </Typography>
        <View style={styles.quickAddRow}>
          {QUICK_ADD_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => handleQuickAdd(action.key)}
              accessibilityRole="button"
              accessibilityLabel={
                action.key === 'barcode' ? `${action.label}, coming soon` : action.label
              }
              testID={`health-add-food-quick-${action.key}`}
              style={styles.quickAddButton}
            >
              <View
                style={[
                  styles.quickAddIcon,
                  {
                    backgroundColor: colors.backgroundMain,
                    opacity: action.key === 'barcode' ? 0.5 : 1,
                  },
                ]}
              >
                <Icon
                  name={action.icon}
                  size={20}
                  color={action.key === 'barcode' ? colors.textSecondary : colors.primary}
                />
              </View>
              <View style={styles.quickAddLabelRow}>
                <Typography variant="caption2" weight="medium" color={colors.textSecondary} numberOfLines={1}>
                  {action.label}
                </Typography>
                {action.ai ? (
                  <View style={[styles.aiBadge, { backgroundColor: colors.primary }]}>
                    <Typography variant="caption2" weight="bold" color={colors.white}>
                      AI
                    </Typography>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      {message !== null ? (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-add-food-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      ) : null}

      {showManualForm ? (
        <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
          <HealthManualFoodForm
            initialSlot={slot}
            onCancel={() => setShowManualForm(false)}
            onSaved={handleManualSaved}
          />
        </Card>
      ) : null}

      {/* Which meal everything on this screen logs into. */}
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
                testID={`health-add-food-slot-${option}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
              >
                <Typography variant="caption1" weight="semibold" color={active ? colors.white : colors.textSecondary}>
                  {MEAL_SLOT_LABELS[option]}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {/* Search / Library / Recipes — the donor's segmented control. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={[styles.segmented, { borderColor: colors.borderColor }]}>
          {TABS.map((option) => {
            const active = option.key === tab;
            return (
              <Pressable
                key={option.key}
                onPress={() => setTab(option.key)}
                accessibilityRole="button"
                accessibilityLabel={`Show ${option.label}`}
                accessibilityState={{ selected: active }}
                testID={`health-add-food-tab-${option.key}`}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
              >
                <Typography variant="caption1" weight="semibold" color={active ? colors.white : colors.textSecondary}>
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {tab === 'search' ? (
        <SearchTab
          query={query}
          onChangeQuery={setQuery}
          results={results}
          slot={slot}
          onMessage={setMessage}
          onLibraryChanged={refreshLibrary}
        />
      ) : null}

      {tab === 'library' ? (
        <LibraryTab
          foods={library}
          loading={libraryLoading}
          slot={slot}
          onMessage={setMessage}
          onChanged={refreshLibrary}
          onAddNew={() => router.push('/health-food')}
        />
      ) : null}

      {tab === 'recipes' ? (
        <RecipesTab
          recipes={recipes}
          loading={recipesLoading}
          slot={slot}
          onMessage={setMessage}
          onAddNew={() => router.push('/health-recipes')}
        />
      ) : null}
    </HealthSectionScreen>
  );
}

/* ==================================================================== */
/* Search tab                                                            */
/* ==================================================================== */

function SearchTab({
  query,
  onChangeQuery,
  results,
  slot,
  onMessage,
  onLibraryChanged,
}: {
  query: string;
  onChangeQuery: (text: string) => void;
  results: FoodSearchOutcome | null;
  slot: MealSlot;
  onMessage: (message: string | null) => void;
  onLibraryChanged: () => void;
}) {
  const colors = useAppColors();
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleLogLibraryFood = async (food: FoodItem) => {
    setBusyId(food.id);
    onMessage(null);
    const result = await logFoodToDiary(food.id, { mealSlot: slot });
    setBusyId(null);
    if (result.status === 'rejected') {
      onMessage(result.message);
      return;
    }
    onMessage(
      result.logged
        ? `Added ${formatMacro(result.logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
        : `Added to ${MEAL_SLOT_LABELS[result.mealSlot]} — it will sync when you are back online.`
    );
  };

  const handleLogExternal = async (hit: ExternalFoodItem) => {
    setBusyId(hit.id);
    onMessage(null);
    const result = await logExternalFoodToDiary(hit, { mealSlot: slot });
    setBusyId(null);
    if (result.status !== 'saved') {
      onMessage(result.message);
      return;
    }
    onLibraryChanged();
    onMessage(`Added "${hit.name}" to ${MEAL_SLOT_LABELS[result.mealSlot]}.`);
  };

  const handleSaveExternal = async (hit: ExternalFoodItem) => {
    setBusyId(hit.id);
    const result = await importExternalFood(hit);
    setBusyId(null);
    if (result.status !== 'saved') {
      onMessage(result.message);
      return;
    }
    onLibraryChanged();
    onMessage(result.created ? `Saved "${hit.name}" to your foods.` : `"${hit.name}" is already in your foods.`);
  };

  const searching = query.trim().length > 0;

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.searchRow}>
        <Icon name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search your foods and the food database"
          placeholderTextColor={colors.textSecondary}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search your foods and the food database"
          testID="health-add-food-search-input"
          style={[styles.searchInput, { color: colors.textPrimary }]}
        />
        {searching ? (
          <Pressable
            onPress={() => onChangeQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID="health-add-food-search-clear"
            hitSlop={8}
          >
            <Icon name="close" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {!searching ? (
        <Typography variant="footnote" color={colors.textSecondary}>
          Search your own foods and the food database.
        </Typography>
      ) : results === null ? (
        <Typography variant="footnote" color={colors.textSecondary}>
          Searching…
        </Typography>
      ) : (
        <>
          {results.providerNotice ? (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="health-add-food-search-notice"
            >
              {results.providerNotice}
            </Typography>
          ) : null}

          {results.library.length === 0 && results.external.length === 0 ? (
            <Typography variant="footnote" color={colors.textSecondary} testID="health-add-food-search-empty">
              Nothing matches that.
            </Typography>
          ) : (
            <>
              {results.library.map((food) => (
                <FoodLogRow
                  key={food.id}
                  food={food}
                  slot={slot}
                  busy={busyId === food.id}
                  onLog={() => void handleLogLibraryFood(food)}
                  testID={`health-add-food-search-food-${food.id}`}
                />
              ))}
              {results.external.map((hit) => (
                <ExternalFoodRow
                  key={hit.id}
                  hit={hit}
                  slot={slot}
                  busy={busyId === hit.id}
                  onLog={() => void handleLogExternal(hit)}
                  onSave={() => void handleSaveExternal(hit)}
                  testID={`health-add-food-search-external-${hit.providerFoodId}`}
                />
              ))}
            </>
          )}
        </>
      )}
    </Card>
  );
}

/* ==================================================================== */
/* Library tab                                                           */
/* ==================================================================== */

function LibraryTab({
  foods,
  loading,
  slot,
  onMessage,
  onChanged,
  onAddNew,
}: {
  foods: FoodItem[];
  loading: boolean;
  slot: MealSlot;
  onMessage: (message: string | null) => void;
  onChanged: () => void;
  onAddNew: () => void;
}) {
  const colors = useAppColors();
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleLog = async (food: FoodItem) => {
    setBusyId(food.id);
    onMessage(null);
    const result = await logFoodToDiary(food.id, { mealSlot: slot });
    setBusyId(null);
    onChanged();
    if (result.status === 'rejected') {
      onMessage(result.message);
      return;
    }
    onMessage(
      result.logged
        ? `Added ${formatMacro(result.logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
        : `Added to ${MEAL_SLOT_LABELS[result.mealSlot]} — it will sync when you are back online.`
    );
  };

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.cardHead}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          YOUR FOOD LIBRARY
        </Typography>
        <View style={styles.cardHeadRight}>
          <Typography variant="caption2" color={colors.textSecondary}>
            Sorted by most used
          </Typography>
          <Pressable
            onPress={onAddNew}
            accessibilityRole="button"
            accessibilityLabel="Add a new food to your library"
            testID="health-add-food-library-new"
            hitSlop={8}
          >
            <Icon name="add-circle" size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <Typography variant="footnote" color={colors.textSecondary}>
          Loading your foods…
        </Typography>
      ) : foods.length === 0 ? (
        <Typography variant="footnote" color={colors.textSecondary} testID="health-add-food-library-empty">
          No foods yet. Add one and it will be one tap away next time.
        </Typography>
      ) : (
        foods.map((food) => (
          <FoodLogRow
            key={food.id}
            food={food}
            slot={slot}
            busy={busyId === food.id}
            onLog={() => void handleLog(food)}
            testID={`health-add-food-library-food-${food.id}`}
          />
        ))
      )}
    </Card>
  );
}

/* ==================================================================== */
/* Recipes tab                                                           */
/* ==================================================================== */

function RecipesTab({
  recipes,
  loading,
  slot,
  onMessage,
  onAddNew,
}: {
  recipes: RecipeItem[];
  loading: boolean;
  slot: MealSlot;
  onMessage: (message: string | null) => void;
  onAddNew: () => void;
}) {
  const colors = useAppColors();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [servings, setServings] = useState<Record<string, number>>({});
  const [scaled, setScaled] = useState<ScaledRecipe | null>(null);
  const [scaleFailed, setScaleFailed] = useState(false);
  const [logging, setLogging] = useState(false);

  const expanded = recipes.find((recipe) => recipe.id === expandedId) ?? null;
  const target = expandedId ? (servings[expandedId] ?? expanded?.servings ?? 1) : 1;

  useEffect(() => {
    let cancelled = false;
    if (!expandedId) {
      setScaled(null);
      setScaleFailed(false);
      return undefined;
    }
    void scaleRecipe(expandedId, target).then((answer) => {
      if (cancelled) return;
      setScaled(answer);
      setScaleFailed(answer === null);
    });
    return () => {
      cancelled = true;
    };
  }, [expandedId, target]);

  const toggle = (recipe: RecipeItem) => {
    setExpandedId((current) => (current === recipe.id ? null : recipe.id));
    setServings((current) => ({ ...current, [recipe.id]: current[recipe.id] ?? recipe.servings }));
  };

  const handleLog = async (recipe: RecipeItem) => {
    setLogging(true);
    onMessage(null);
    const result = await logRecipeToDiary(recipe.id, { servings: target, mealSlot: slot });
    setLogging(false);
    if (result.status !== 'saved') {
      onMessage(result.message);
      return;
    }
    setExpandedId(null);
    onMessage(
      result.logged
        ? `Added ${formatMacro(result.logged.calories)} kcal to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
        : `Added to ${MEAL_SLOT_LABELS[result.mealSlot]}.`
    );
  };

  return (
    <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
      <View style={styles.cardHead}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          YOUR RECIPES
        </Typography>
        <View style={styles.cardHeadRight}>
          <Typography variant="caption2" color={colors.textSecondary} testID="health-add-food-recipe-count">
            {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
          </Typography>
          <Pressable
            onPress={onAddNew}
            accessibilityRole="button"
            accessibilityLabel="Create a new recipe"
            testID="health-add-food-recipes-new"
            hitSlop={8}
          >
            <Icon name="add-circle" size={20} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <Typography variant="footnote" color={colors.textSecondary}>
          Loading your recipes…
        </Typography>
      ) : recipes.length === 0 ? (
        <Typography variant="footnote" color={colors.textSecondary} testID="health-add-food-recipes-empty">
          No recipes yet. Build one from the foods you already track.
        </Typography>
      ) : (
        recipes.map((recipe) => {
          const isOpen = expandedId === recipe.id;
          return (
            <View
              key={recipe.id}
              style={[styles.row, { borderTopColor: colors.borderColor }]}
              testID={`health-add-food-recipe-${recipe.id}`}
            >
              <Pressable
                onPress={() => toggle(recipe)}
                accessibilityRole="button"
                accessibilityLabel={`${recipe.name}, ${recipe.servings} servings, ${formatMacro(recipe.totals.calories)} kcal total`}
                accessibilityState={{ selected: isOpen }}
                testID={`health-add-food-recipe-${recipe.id}-toggle`}
                style={styles.rowHead}
              >
                <View style={styles.rowText}>
                  <View style={styles.rowNameLine}>
                    <Typography variant="body" color={colors.textPrimary} numberOfLines={1}>
                      {recipe.name}
                    </Typography>
                    {recipe.isFavorite ? <Icon name="star" size={14} color={colors.primary} /> : null}
                  </View>
                  <Typography variant="caption1" color={colors.textSecondary}>
                    {recipe.servings} servings · {formatMacro(recipe.totals.calories)} kcal total
                  </Typography>
                </View>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
              </Pressable>

              {isOpen ? (
                <View style={styles.expandedBlock}>
                  <View style={styles.scaleRow}>
                    <Pressable
                      onPress={() =>
                        setServings((current) => ({ ...current, [recipe.id]: Math.max(1, target - 1) }))
                      }
                      accessibilityRole="button"
                      accessibilityLabel="One fewer serving"
                      testID={`health-add-food-recipe-${recipe.id}-minus`}
                      style={[styles.stepBtn, { borderColor: colors.borderColor }]}
                    >
                      <Icon name="remove" size={16} color={colors.textPrimary} />
                    </Pressable>
                    <Typography variant="body" weight="semibold" color={colors.textPrimary}>
                      {target} {target === 1 ? 'serving' : 'servings'}
                    </Typography>
                    <Pressable
                      onPress={() => setServings((current) => ({ ...current, [recipe.id]: target + 1 }))}
                      accessibilityRole="button"
                      accessibilityLabel="One more serving"
                      testID={`health-add-food-recipe-${recipe.id}-plus`}
                      style={[styles.stepBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    >
                      <Icon name="add" size={16} color={colors.white} />
                    </Pressable>
                  </View>

                  {scaled ? (
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {formatMacro(scaled.totals.calories)} kcal · {formatMacro(scaled.totals.protein)}P /{' '}
                      {formatMacro(scaled.totals.carbs)}C / {formatMacro(scaled.totals.fat)}F for {target}{' '}
                      {target === 1 ? 'serving' : 'servings'}.
                    </Typography>
                  ) : (
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {scaleFailed ? SCALE_OFFLINE_MESSAGE : 'Working out the servings…'}
                    </Typography>
                  )}

                  <Pressable
                    onPress={() => void handleLog(recipe)}
                    disabled={!scaled || logging}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${target} ${target === 1 ? 'serving' : 'servings'} of ${recipe.name} to ${MEAL_SLOT_LABELS[slot]}`}
                    accessibilityState={{ disabled: !scaled || logging }}
                    testID={`health-add-food-recipe-${recipe.id}-log`}
                    style={[
                      styles.logButton,
                      { backgroundColor: !scaled || logging ? colors.borderColor : colors.primary },
                    ]}
                  >
                    <Typography variant="caption1" weight="semibold" color={colors.white}>
                      {logging ? 'Adding…' : `Add to ${MEAL_SLOT_LABELS[slot]}`}
                    </Typography>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </Card>
  );
}

/* ==================================================================== */
/* Shared rows                                                           */
/* ==================================================================== */

function FoodLogRow({
  food,
  slot,
  busy,
  onLog,
  testID,
}: {
  food: FoodItem;
  slot: MealSlot;
  busy: boolean;
  onLog: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.row, { borderTopColor: colors.borderColor }]} testID={testID}>
      <View style={styles.rowText}>
        <Typography variant="body" color={colors.textPrimary} numberOfLines={1}>
          {food.brand ? `${food.name} · ${food.brand}` : food.name}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {formatMacro(food.serving.calories)} kcal per {formatMacro(food.portion)} {food.unit}
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
      </View>
      <Pressable
        onPress={onLog}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Add ${food.name} to ${MEAL_SLOT_LABELS[slot]}`}
        accessibilityState={{ disabled: busy }}
        testID={`${testID}-log`}
        style={[styles.logButton, { backgroundColor: busy ? colors.borderColor : colors.primary }]}
      >
        <Typography variant="caption1" weight="semibold" color={colors.white}>
          {busy ? '…' : 'Add'}
        </Typography>
      </Pressable>
    </View>
  );
}

function ExternalFoodRow({
  hit,
  slot,
  busy,
  onLog,
  onSave,
  testID,
}: {
  hit: ExternalFoodItem;
  slot: MealSlot;
  busy: boolean;
  onLog: () => void;
  onSave: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <View style={[styles.row, { borderTopColor: colors.borderColor }]} testID={testID}>
      <View style={styles.rowText}>
        <Typography variant="body" color={colors.textPrimary} numberOfLines={1}>
          {hit.brand ? `${hit.name} · ${hit.brand}` : hit.name}
        </Typography>
        <Typography variant="caption1" color={colors.textSecondary}>
          {formatMacro(hit.per100.calories)} kcal / 100 {hit.unit === 'ml' ? 'ml' : 'g'}
        </Typography>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={onSave}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Save ${hit.name} to your foods`}
          testID={`${testID}-save`}
          hitSlop={8}
        >
          <Typography variant="caption1" weight="semibold" color={colors.primary}>
            Save
          </Typography>
        </Pressable>
        <Pressable
          onPress={onLog}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Add ${hit.name} to ${MEAL_SLOT_LABELS[slot]}`}
          accessibilityState={{ disabled: busy }}
          testID={`${testID}-log`}
          style={[styles.logButton, { backgroundColor: busy ? colors.borderColor : colors.primary }]}
        >
          <Typography variant="caption1" weight="semibold" color={colors.white}>
            {busy ? '…' : 'Add'}
          </Typography>
        </Pressable>
      </View>
    </View>
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
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeadRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  quickAddRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  quickAddButton: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  quickAddIcon: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAddLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  aiBadge: {
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  row: {
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xxs,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
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
  logButton: {
    paddingHorizontal: Spacing.md,
    height: 32,
    borderRadius: CornerRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedBlock: {
    gap: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
