import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { healthFileContentSource } from '@api/healthAssets';
import { ProcessingOverlay, ScanImportSources } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { Card, Typography } from '@components/ui';
import { Icon } from '@components/ui/Icon';
import { CornerRadius, hexToRgba, Spacing, useAppColors } from '@theme';

import { HealthSectionScreen } from '../components';
import {
  createRecipe,
  deleteRecipe,
  DEFAULT_RECIPE_ICON,
  formatMacro,
  loadFoods,
  loadRecipes,
  logRecipeToDiary,
  matchFoods,
  MAX_RECIPE_TIME_MINUTES,
  MAX_SERVINGS,
  parseFoodAmount,
  parseServingsInput,
  RECIPE_CATEGORIES,
  recipeCategoryIcon,
  recipeCategoryLabel,
  sanitizeDecimalInput,
  scaleRecipe,
  SCALE_OFFLINE_MESSAGE,
  setRecipeFavorite,
  updateRecipe,
  uploadRecipePhoto,
  viewRecipes,
  type FoodItem,
  type RecipeDraft,
  type RecipeFilter,
  type RecipeItem,
  type ScaledRecipe,
} from '../healthFoodStorage';
import { todayDateKey } from '../healthLocalStorage';
import {
  formatDayKey,
  MEAL_SLOT_LABELS,
  MEAL_SLOTS,
  shiftDateKey,
  type MealSlot,
} from '../healthNutritionStorage';

/** Ingredient rows past this count are hidden behind search — see the picker. */
const MAX_INGREDIENT_PICKER_ROWS = 20;

/**
 * Recipes tab — build a dish from the food library and cook it for any number
 * of people (parity phase P2).
 *
 * Every nutrition figure on this screen is the Worker's:
 *
 *  - a row's TOTAL comes off the stored recipe (`total_*`), recomputed server-
 *    side on every write from the ingredient array;
 *  - the PER-SERVING figure and any scaled total come from `/recipes/:id/scale`.
 *    They are never obtained by dividing totals by servings here — that is the
 *    recompute the per-100 basis exists to prevent, and it would disagree with
 *    the server's rounding the moment a recipe is edited.
 *
 * So a recipe with no scale answer (offline) says so instead of showing a
 * per-serving number the app invented.
 *
 * LOGGING A RECIPE TO THE DIARY uses the SAME answer. The head-count stepper
 * already asks `/recipes/:id/scale` for "total for N servings"; the Log button
 * writes exactly that figure. The number the user reads before tapping and the
 * number that lands in the diary are therefore the same object, which is the
 * one thing the donor's `RecipePortionPickerView` gets wrong — it previews from
 * a truncated per-100g figure and writes from a full-precision one.
 *
 * With no scale answer there is no Log button, because there is no honest
 * figure to log.
 */

const FILTERS: ReadonlyArray<{ id: RecipeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favourites' },
];

interface DraftIngredient {
  name: string;
  quantity: number;
  unit: string;
  foodId: string | null;
}

/**
 * Blank ⇒ "not set" (`null`), never `0` — `parseFoodAmount` treats an empty
 * field as a zero amount, which is right for an ingredient's quantity but
 * wrong here: an unset prep time must stay unset, not become "0 min".
 */
function parseOptionalMinutes(raw: string): number | null {
  if (raw.trim().length === 0) return null;
  const value = parseFoodAmount(raw, MAX_RECIPE_TIME_MINUTES);
  return value === null ? null : Math.round(value);
}

export function HealthRecipesScreen() {
  const colors = useAppColors();

  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [filter, setFilter] = useState<RecipeFilter>('all');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [servings, setServings] = useState('1');
  const [preparationTime, setPreparationTime] = useState('');
  const [cookingTime, setCookingTime] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [pickedFoodId, setPickedFoodId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('100');
  const [ingredientQuery, setIngredientQuery] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scaleTarget, setScaleTarget] = useState(1);
  const [scaled, setScaled] = useState<ScaledRecipe | null>(null);
  const [scaleFailed, setScaleFailed] = useState(false);
  /** Bumped after a write so an open recipe re-asks for its server figures. */
  const [scaleNonce, setScaleNonce] = useState(0);

  /** Where a logged recipe lands. The head count is `scaleTarget` itself. */
  const [logSlot, setLogSlot] = useState<MealSlot>('dinner');
  const [logDate, setLogDate] = useState(() => todayDateKey());
  const [logMessage, setLogMessage] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const hydrate = useCallback(async (nextFilter: RecipeFilter) => {
    const [list, library] = await Promise.all([loadRecipes(nextFilter), loadFoods('all')]);
    setRecipes(list);
    setFoods(library);
    setLoading(false);
  }, []);

  useEffect(() => {
    void hydrate(filter);
  }, [filter, hydrate]);

  // Per-serving + scaled totals are a SERVER answer, so selecting a recipe (or
  // moving the scale) asks for one rather than dividing anything locally.
  useEffect(() => {
    let cancelled = false;
    if (!selectedId) {
      setScaled(null);
      setScaleFailed(false);
      return undefined;
    }
    void scaleRecipe(selectedId, scaleTarget).then((answer) => {
      if (cancelled) return;
      setScaled(answer);
      setScaleFailed(answer === null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId, scaleTarget, scaleNonce]);

  const parsedServings = parseServingsInput(servings);
  const parsedQuantity = parseFoodAmount(quantity);
  const canAddIngredient =
    pickedFoodId !== null && parsedQuantity !== null && parsedQuantity > 0;
  const canSave = name.trim().length > 0 && parsedServings !== null && ingredients.length > 0;

  // A flat, unfiltered library becomes unusable past a couple dozen foods, so
  // browsing shows a capped, relevance-ordered slice (`loadFoods` already
  // sorts favourites/most-used first) and typing narrows it with the SAME
  // substring match the offline search fallback uses — no second fuzzy-search
  // implementation for what is, underneath, the same "find one of my foods"
  // question.
  const ingredientMatches = useMemo(
    () => (ingredientQuery.trim().length > 0 ? matchFoods(foods, ingredientQuery) : foods),
    [foods, ingredientQuery]
  );
  const visibleIngredientMatches = ingredientMatches.slice(0, MAX_INGREDIENT_PICKER_ROWS);
  const hiddenIngredientCount = ingredientMatches.length - visibleIngredientMatches.length;

  const applyResult = useCallback(
    (next: { recipes: RecipeItem[]; message: string | null }, activeFilter: RecipeFilter) => {
      setRecipes(viewRecipes(next.recipes, activeFilter));
      setMessage(next.message);
    },
    []
  );

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setCategory(null);
    setServings('1');
    setPreparationTime('');
    setCookingTime('');
    setImageUrl(null);
    setPhotoMessage(null);
    setIngredients([]);
    setPickedFoodId(null);
    setQuantity('100');
    setIngredientQuery('');
  };

  const handleAddIngredient = () => {
    const food = foods.find((f) => f.id === pickedFoodId);
    if (!food || parsedQuantity === null || parsedQuantity <= 0) return;
    setIngredients((current) => [
      ...current,
      { name: food.name, quantity: parsedQuantity, unit: food.unit, foodId: food.id },
    ]);
    setPickedFoodId(null);
    setQuantity('100');
  };

  const handleRemoveIngredient = (index: number) => {
    setIngredients((current) => current.filter((_, i) => i !== index));
  };

  /**
   * Camera / Library → reserve + PUT (`uploadRecipePhoto`) → `imageUrl` holds
   * the proxied path from then on. Nothing is attached to the recipe itself
   * until Save — same as every other field in this form — but the photo
   * upload happens immediately (there is nowhere else to stage raw bytes).
   */
  const attachPhoto = useCallback(async (image: { path: string; filename?: string; mime: string }) => {
    setPhotoBusy(true);
    setPhotoMessage(null);
    try {
      const result = await uploadRecipePhoto({
        uri: image.path,
        name: image.filename ?? 'recipe.jpg',
        mimeType: image.mime,
      });
      if (result.imageUrl) {
        setImageUrl(result.imageUrl);
      } else if (result.message) {
        setPhotoMessage(result.message);
      }
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  /**
   * The recipe photo's four sources.
   *
   * This offered camera and gallery only. A recipe photo is very often one
   * somebody else sent — a page scanned from a cookbook, a card in a shared
   * Drive folder — and neither had a route in.
   */
  const { sourceHandlers: photoSources, drivePicker: photoDrivePicker } =
    useAttachmentSources({
      rememberScope: 'health-recipe-photo',
      pickerOptions: { cropping: false, compressImageQuality: 0.9 },
      // Inline, matching how this screen reports every other photo failure.
      onError: setPhotoMessage,
      onPicked: ([picked]) => {
        if (!picked) return;
        void attachPhoto({
          path: picked.uri,
          filename: picked.name,
          mime: picked.mime ?? 'image/jpeg',
        });
      },
    });

  const handleRemovePhoto = () => {
    setImageUrl(null);
    setPhotoMessage(null);
  };

  const handleSave = async () => {
    if (!canSave || parsedServings === null) return;
    const trimmedDescription = description.trim();
    const draft: RecipeDraft = {
      name,
      servings: parsedServings,
      description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
      category,
      preparationTime: parseOptionalMinutes(preparationTime),
      cookingTime: parseOptionalMinutes(cookingTime),
      imageUrl,
      // No macros are sent — the Worker resolves each food's stored basis.
      ingredients: ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        foodId: ingredient.foodId,
      })),
    };
    const result = editingId ? await updateRecipe(editingId, draft) : await createRecipe(draft);
    applyResult(result, filter);
    if (result.status !== 'rejected') {
      resetForm();
      // The stored totals just changed, so any open scale answer is stale.
      setScaleNonce((current) => current + 1);
    }
  };

  const handleEdit = (recipe: RecipeItem) => {
    setEditingId(recipe.id);
    setMessage(null);
    setName(recipe.name);
    setDescription(recipe.description ?? '');
    setCategory(recipe.category);
    setServings(String(recipe.servings));
    setPreparationTime(recipe.preparationTime === null ? '' : String(recipe.preparationTime));
    setCookingTime(recipe.cookingTime === null ? '' : String(recipe.cookingTime));
    setImageUrl(recipe.imageUrl);
    setPhotoMessage(null);
    setIngredientQuery('');
    setIngredients(
      recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
        foodId: ingredient.foodId,
      }))
    );
  };

  const handleDelete = (recipe: RecipeItem) => {
    Alert.alert('Delete recipe', `Remove "${recipe.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteRecipe(recipe.id).then((result) => {
            applyResult(result, filter);
            if (selectedId === recipe.id) setSelectedId(null);
            if (editingId === recipe.id) resetForm();
          });
        },
      },
    ]);
  };

  const handleFavorite = async (recipe: RecipeItem) => {
    applyResult(await setRecipeFavorite(recipe.id, !recipe.isFavorite), filter);
  };

  const handleSelect = (recipe: RecipeItem) => {
    if (selectedId === recipe.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(recipe.id);
    setScaleTarget(recipe.servings);
    // Drop the OPEN recipe's answer before asking for this one's. Keeping it
    // would put another dish's per-serving figures, its ingredient amounts and
    // its "one entry of N kcal" log preview under this recipe's name until the
    // new answer lands — the exact preview/write drift this screen exists to
    // prevent, one recipe over.
    setScaled(null);
    setScaleFailed(false);
    setLogMessage(null);
    setLogDate(todayDateKey());
  };

  const selected = recipes.find((recipe) => recipe.id === selectedId) ?? null;

  /**
   * Log the open recipe at the head count already on screen.
   *
   * `scaleTarget` is both what the card is previewing and what is sent, so the
   * "Total for 3" the user just read is the row that lands in the diary. The
   * store re-asks `/recipes/:id/scale` rather than trusting this component's
   * copy of the answer — a stale figure from before an ingredient edit is
   * exactly the drift the scale route exists to prevent.
   */
  const handleLogRecipe = async (recipe: RecipeItem) => {
    setLogging(true);
    setLogMessage(null);
    try {
      const result = await logRecipeToDiary(recipe.id, {
        servings: scaleTarget,
        mealSlot: logSlot,
        date: logDate,
      });
      if (result.status !== 'saved') {
        setLogMessage(result.message);
        return;
      }
      // The calorie figure quoted is the SERVER's `logged`. An answer that
      // carries none says nothing about calories rather than reporting the 0
      // kcal a fallback would invent for a row that is not empty.
      const calories = result.logged ? ` — ${formatMacro(result.logged.calories)} kcal` : '';
      setLogMessage(
        `Logged ${result.servings} ${result.servings === 1 ? 'serving' : 'servings'} of ${
          recipe.name
        }${calories} — to ${MEAL_SLOT_LABELS[result.mealSlot]} on ${formatDayKey(logDate)}.`
      );
    } catch {
      // Never a raw error string: the store already maps every refusal it can
      // name, so anything reaching here is unnamed and gets the neutral line.
      setLogMessage('That did not save. Check your connection and try again.');
    } finally {
      setLogging(false);
    }
  };

  const canGoLaterDay = logDate < todayDateKey();

  return (
    <HealthSectionScreen title="Recipes" testID="health-recipes-screen" loading={loading}>
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          SHOW
        </Typography>
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
                testID={`health-recipe-filter-${option.id}`}
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
      </Card>

      {message && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-recipe-message"
        >
          <Typography variant="footnote" color={colors.textSecondary} accessibilityLabel={message}>
            {message}
          </Typography>
        </Card>
      )}

      {/* Build a recipe out of the user's own foods */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <View style={styles.cardHead}>
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {editingId ? 'EDIT RECIPE' : 'NEW RECIPE'}
          </Typography>
          {editingId && (
            <Pressable
              onPress={resetForm}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
              testID="health-recipe-cancel-edit"
            >
              <Typography variant="footnote" weight="semibold" color={colors.primary}>
                Cancel
              </Typography>
            </Pressable>
          )}
        </View>
        {/* Recipe Photo — camera/library OR the photo just attached, never both. */}
        <Typography variant="caption1" color={colors.textSecondary}>
          Add a photo to make your recipe more recognizable
        </Typography>
        {imageUrl ? (
          <RecipePhotoPreview imageUrl={imageUrl} onRemove={handleRemovePhoto} />
        ) : (
          <ScanImportSources
            {...photoSources}
            disabled={photoBusy}
            testIDPrefix="health-recipe-photo"
          />
        )}
        {photoMessage ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-recipe-photo-message"
          >
            {photoMessage}
          </Typography>
        ) : null}

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Recipe name"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="next"
          accessibilityLabel="Recipe name"
          testID="health-recipe-name-input"
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
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor={colors.textSecondary}
          multiline
          accessibilityLabel="Recipe description"
          testID="health-recipe-description-input"
          style={[
            styles.input,
            styles.multilineInput,
            {
              color: colors.textPrimary,
              borderColor: colors.borderColor,
              backgroundColor: colors.backgroundMain,
            },
          ]}
        />

        <Typography variant="caption1" color={colors.textSecondary}>
          Category
        </Typography>
        <View style={styles.chipRow} testID="health-recipe-category-picker">
          <CategoryChip
            label="None"
            icon="ellipsis-horizontal-circle-outline"
            active={category === null}
            onPress={() => setCategory(null)}
            testID="health-recipe-category-none"
          />
          {RECIPE_CATEGORIES.map((option) => (
            <CategoryChip
              key={option.id}
              label={option.label}
              icon={option.icon}
              active={category === option.id}
              onPress={() => setCategory(option.id)}
              testID={`health-recipe-category-${option.id}`}
            />
          ))}
        </View>

        <View style={styles.amountRow}>
          <AmountField
            label="Servings"
            value={servings}
            onChange={setServings}
            accessibilityLabel="Servings this recipe makes"
            testID="health-recipe-servings-input"
          />
          <AmountField
            label="Prep time (min)"
            value={preparationTime}
            onChange={setPreparationTime}
            accessibilityLabel="Preparation time in minutes"
            testID="health-recipe-prep-time-input"
          />
          <AmountField
            label="Cook time (min)"
            value={cookingTime}
            onChange={setCookingTime}
            accessibilityLabel="Cooking time in minutes"
            testID="health-recipe-cook-time-input"
          />
        </View>

        <Typography variant="caption1" color={colors.textSecondary}>
          Pick an ingredient from your foods
        </Typography>
        {foods.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-recipe-no-foods"
          >
            Add a food on the Foods tab first — a recipe is built from your own library.
          </Typography>
        ) : (
          <>
            <TextInput
              value={ingredientQuery}
              onChangeText={setIngredientQuery}
              placeholder="Search your foods"
              placeholderTextColor={colors.textSecondary}
              accessibilityLabel="Search your foods for an ingredient"
              testID="health-recipe-ingredient-search"
              style={[
                styles.input,
                {
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                  backgroundColor: colors.backgroundMain,
                },
              ]}
            />
            {visibleIngredientMatches.length === 0 ? (
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                testID="health-recipe-food-search-empty"
              >
                No foods match “{ingredientQuery}”.
              </Typography>
            ) : (
              visibleIngredientMatches.map((food) => {
                const active = food.id === pickedFoodId;
                return (
                  <Pressable
                    key={food.id}
                    onPress={() => setPickedFoodId(active ? null : food.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${food.name} as an ingredient`}
                    accessibilityState={{ selected: active }}
                    testID={`health-recipe-food-${food.id}`}
                    style={[
                      styles.pickerRow,
                      {
                        borderColor: active ? colors.primary : colors.borderColor,
                        backgroundColor: active ? colors.primary + '1F' : 'transparent',
                      },
                    ]}
                  >
                    <Typography variant="body" color={colors.textPrimary}>
                      {food.name}
                    </Typography>
                    <Typography variant="caption1" color={colors.textSecondary}>
                      {formatMacro(food.serving.calories)} kcal / {formatMacro(food.portion)}{' '}
                      {food.unit}
                    </Typography>
                  </Pressable>
                );
              })
            )}
            {hiddenIngredientCount > 0 ? (
              <Typography
                variant="caption2"
                color={colors.textSecondary}
                testID="health-recipe-food-search-hint"
              >
                Showing {visibleIngredientMatches.length} of {ingredientMatches.length} — search to
                narrow it down.
              </Typography>
            ) : null}
          </>
        )}
        <View style={styles.amountRow}>
          <AmountField
            label="Quantity"
            value={quantity}
            onChange={setQuantity}
            accessibilityLabel="Ingredient quantity"
            testID="health-recipe-quantity-input"
          />
        </View>
        <Pressable
          onPress={handleAddIngredient}
          disabled={!canAddIngredient}
          accessibilityRole="button"
          accessibilityLabel="Add ingredient to recipe"
          accessibilityState={{ disabled: !canAddIngredient }}
          testID="health-recipe-add-ingredient"
          style={[
            styles.secondaryButton,
            { borderColor: canAddIngredient ? colors.primary : colors.borderColor },
          ]}
        >
          <Icon
            name="add"
            size={16}
            color={canAddIngredient ? colors.primary : colors.textSecondary}
          />
          <Typography
            variant="caption1"
            weight="semibold"
            color={canAddIngredient ? colors.primary : colors.textSecondary}
          >
            Add ingredient
          </Typography>
        </Pressable>

        {ingredients.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-recipe-ingredients-empty"
          >
            No ingredients yet.
          </Typography>
        ) : (
          ingredients.map((ingredient, index) => (
            <View
              key={`${ingredient.foodId ?? ingredient.name}-${index}`}
              testID={`health-recipe-ingredient-${index}`}
              style={[styles.row, { borderTopColor: colors.borderColor }]}
            >
              <Typography variant="body" color={colors.textPrimary} style={styles.rowText}>
                {ingredient.name} · {formatMacro(ingredient.quantity)} {ingredient.unit}
              </Typography>
              <Pressable
                onPress={() => handleRemoveIngredient(index)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${ingredient.name}`}
                testID={`health-recipe-ingredient-remove-${index}`}
                hitSlop={8}
              >
                <Icon name="close" size={16} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))
        )}

        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={editingId ? 'Save recipe changes' : 'Save new recipe'}
          accessibilityState={{ disabled: !canSave }}
          testID="health-recipe-save-button"
          style={[
            styles.primaryButton,
            { backgroundColor: canSave ? colors.primary : colors.borderColor },
          ]}
        >
          <Typography variant="body" weight="semibold" color={colors.white}>
            {editingId ? 'Save changes' : 'Save recipe'}
          </Typography>
        </Pressable>
      </Card>

      {/* The list. Totals are the server's; per-serving needs the scale route. */}
      <Card variant="filled" style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}>
        <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
          MY RECIPES
        </Typography>
        {recipes.length === 0 ? (
          <Typography
            variant="footnote"
            color={colors.textSecondary}
            testID="health-recipes-empty"
          >
            No recipes yet. Build one above from the foods you already track.
          </Typography>
        ) : (
          recipes.map((recipe) => {
            const categoryLabel = recipeCategoryLabel(recipe.category);
            // DELIBERATE DIVERGENCE from the donor's `RecipeRowCard`: the donor
            // shows `caloriesPerServing` / `caloriesPer100g` here, both derived
            // by dividing the batch total on the device. This module's whole
            // architecture forbids exactly that division (see the file header
            // and `scaleRecipe` below) — a per-serving figure is only ever a
            // `/recipes/:id/scale` answer, and the list would need one extra
            // network call PER ROW to get one honestly. So the row keeps
            // showing the server-computed BATCH total it always has (never
            // divided), plus the full P/C/F breakdown that total already
            // carries — nothing here is arithmetic this screen performed.
            const totalMinutes =
              recipe.preparationTime !== null || recipe.cookingTime !== null
                ? (recipe.preparationTime ?? 0) + (recipe.cookingTime ?? 0)
                : null;
            const photo = recipe.imageUrl ? healthFileContentSource(recipe.imageUrl) : null;

            return (
              <View
                key={recipe.id}
                testID={`health-recipe-row-${recipe.id}`}
                style={[styles.row, { borderTopColor: colors.borderColor }]}
              >
                {photo ? (
                  <Image
                    source={photo}
                    style={styles.thumb}
                    accessibilityLabel={`${recipe.name} photo`}
                    testID={`health-recipe-thumb-${recipe.id}`}
                  />
                ) : (
                  <View
                    style={[
                      styles.thumb,
                      styles.thumbFallback,
                      { backgroundColor: hexToRgba(colors.primary, 0.14) },
                    ]}
                    testID={`health-recipe-thumb-fallback-${recipe.id}`}
                  >
                    <Icon
                      name={recipeCategoryIcon(recipe.category)}
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                )}

                <Pressable
                  onPress={() => handleSelect(recipe)}
                  accessibilityRole="button"
                  // The row is one accessibility element (a `Pressable` merges its
                  // children), so the totals below are announced only if they are
                  // in this label — and `Open Maestro Bowl` alone would hide the
                  // whole nutrition line from VoiceOver and from E2E alike.
                  accessibilityLabel={`Open ${recipe.name}, ${recipe.servings} servings, ${formatMacro(
                    recipe.totals.calories
                  )} kcal total`}
                  accessibilityState={{ selected: selectedId === recipe.id }}
                  testID={`health-recipe-open-${recipe.id}`}
                  style={styles.rowText}
                >
                  <Typography variant="body" color={colors.textPrimary}>
                    {recipe.name}
                  </Typography>
                  <Typography
                    variant="caption1"
                    color={colors.textSecondary}
                    testID={`health-recipe-total-${recipe.id}`}
                  >
                    {recipe.servings} servings · {formatMacro(recipe.totals.calories)} kcal total
                  </Typography>
                  <Typography
                    variant="caption2"
                    color={colors.textSecondary}
                    testID={`health-recipe-macros-${recipe.id}`}
                  >
                    {formatMacro(recipe.totals.protein)}P / {formatMacro(recipe.totals.carbs)}C /{' '}
                    {formatMacro(recipe.totals.fat)}F
                  </Typography>
                  {(categoryLabel || totalMinutes !== null) && (
                    <View style={styles.metaRow}>
                      {categoryLabel && (
                        <View
                          style={[
                            styles.categoryBadge,
                            { backgroundColor: hexToRgba(colors.primary, 0.14) },
                          ]}
                          testID={`health-recipe-category-badge-${recipe.id}`}
                        >
                          <Icon
                            name={recipeCategoryIcon(recipe.category)}
                            size={12}
                            color={colors.primary}
                          />
                          <Typography variant="caption2" weight="semibold" color={colors.primary}>
                            {categoryLabel}
                          </Typography>
                        </View>
                      )}
                      {totalMinutes !== null && (
                        <View style={styles.timeBadge} testID={`health-recipe-time-${recipe.id}`}>
                          <Icon name="time-outline" size={12} color={colors.textSecondary} />
                          <Typography variant="caption2" color={colors.textSecondary}>
                            {totalMinutes}m
                          </Typography>
                        </View>
                      )}
                    </View>
                  )}
                </Pressable>
                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => void handleFavorite(recipe)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      recipe.isFavorite ? `Unfavourite ${recipe.name}` : `Favourite ${recipe.name}`
                    }
                    accessibilityState={{ selected: recipe.isFavorite }}
                    testID={`health-recipe-favorite-${recipe.id}`}
                    hitSlop={8}
                  >
                    <Icon
                      name={recipe.isFavorite ? 'star' : 'star-outline'}
                      size={18}
                      color={recipe.isFavorite ? colors.primary : colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => handleEdit(recipe)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${recipe.name}`}
                    testID={`health-recipe-edit-${recipe.id}`}
                    hitSlop={8}
                  >
                    <Icon name="create-outline" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(recipe)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${recipe.name}`}
                    testID={`health-recipe-delete-${recipe.id}`}
                    hitSlop={8}
                  >
                    <Icon name="close" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </Card>

      {/* Server-computed per-serving + scaling for the open recipe */}
      {selected && (
        <Card
          variant="filled"
          style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
          testID="health-recipe-detail"
        >
          <Typography variant="footnote" color={colors.textSecondary} style={styles.sectionLabel}>
            {selected.name.toUpperCase()}
          </Typography>
          <View style={styles.scaleRow}>
            <Pressable
              onPress={() => setScaleTarget((current) => Math.max(1, current - 1))}
              disabled={scaleTarget <= 1}
              accessibilityRole="button"
              accessibilityLabel="Cook for one fewer serving"
              accessibilityState={{ disabled: scaleTarget <= 1 }}
              testID="health-recipe-scale-minus"
              style={[styles.iconButton, { borderColor: colors.borderColor }]}
            >
              <Icon name="remove" size={18} color={colors.textPrimary} />
            </Pressable>
            <Typography
              variant="body"
              weight="semibold"
              color={colors.textPrimary}
              accessibilityLabel={`Cooking for ${scaleTarget} ${
                scaleTarget === 1 ? 'serving' : 'servings'
              }`}
              testID="health-recipe-scale-value"
            >
              {scaleTarget} {scaleTarget === 1 ? 'serving' : 'servings'}
            </Typography>
            <Pressable
              onPress={() => setScaleTarget((current) => Math.min(MAX_SERVINGS, current + 1))}
              disabled={scaleTarget >= MAX_SERVINGS}
              accessibilityRole="button"
              accessibilityLabel="Cook for one more serving"
              accessibilityState={{ disabled: scaleTarget >= MAX_SERVINGS }}
              testID="health-recipe-scale-plus"
              style={[
                styles.iconButton,
                { backgroundColor: colors.primary, borderColor: colors.primary },
              ]}
            >
              <Icon name="add" size={18} color={colors.white} />
            </Pressable>
          </View>

          {scaled ? (
            <>
              <Typography
                variant="body"
                color={colors.textPrimary}
                testID="health-recipe-per-serving"
                accessibilityLabel={`Per serving ${formatMacro(scaled.perServing.calories)} kcal`}
              >
                Per serving: {formatMacro(scaled.perServing.calories)} kcal ·{' '}
                {formatMacro(scaled.perServing.protein)}P / {formatMacro(scaled.perServing.carbs)}C /{' '}
                {formatMacro(scaled.perServing.fat)}F
              </Typography>
              <Typography
                variant="body"
                color={colors.textPrimary}
                testID="health-recipe-scaled-totals"
                accessibilityLabel={`Total for ${scaled.targetServings} servings ${formatMacro(
                  scaled.totals.calories
                )} kcal`}
              >
                Total for {scaled.targetServings}: {formatMacro(scaled.totals.calories)} kcal ·{' '}
                {formatMacro(scaled.totals.protein)}P / {formatMacro(scaled.totals.carbs)}C /{' '}
                {formatMacro(scaled.totals.fat)}F
              </Typography>
              {scaled.ingredients.map((ingredient, index) => (
                <Typography
                  key={`${ingredient.name}-${index}`}
                  variant="caption1"
                  color={colors.textSecondary}
                  testID={`health-recipe-scaled-ingredient-${index}`}
                >
                  {ingredient.name} · {formatMacro(ingredient.quantity)} {ingredient.unit} ·{' '}
                  {formatMacro(ingredient.macros.calories)} kcal
                </Typography>
              ))}
            </>
          ) : (
            <Typography
              variant="footnote"
              color={colors.textSecondary}
              testID="health-recipe-scale-unavailable"
            >
              {scaleFailed ? SCALE_OFFLINE_MESSAGE : 'Working out the servings…'}
            </Typography>
          )}

          {/* Donor `RecipePortionPickerView`: pick a head count, a meal and a
              day, and the recipe becomes ONE diary row. The head count is the
              stepper above, so the figure previewed is the figure logged. */}
          {scaled ? (
            <View style={styles.logSection} testID="health-recipe-log-section">
              <Typography
                variant="footnote"
                color={colors.textSecondary}
                style={styles.sectionLabel}
              >
                LOG TO DIARY
              </Typography>

              <View style={styles.chipRow}>
                {MEAL_SLOTS.map((option) => {
                  const active = option === logSlot;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => setLogSlot(option)}
                      accessibilityRole="button"
                      accessibilityLabel={`Log into ${MEAL_SLOT_LABELS[option]}`}
                      accessibilityState={{ selected: active }}
                      testID={`health-recipe-log-slot-${option}`}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? colors.primary : colors.borderColor,
                          backgroundColor: active ? `${colors.primary}1F` : 'transparent',
                        },
                      ]}
                    >
                      <Typography
                        variant="caption1"
                        weight="semibold"
                        color={active ? colors.primary : colors.textSecondary}
                      >
                        {MEAL_SLOT_LABELS[option]}
                      </Typography>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.scaleRow}>
                <Pressable
                  onPress={() => setLogDate(shiftDateKey(logDate, -1))}
                  accessibilityRole="button"
                  accessibilityLabel="Log on an earlier day"
                  testID="health-recipe-log-prev-day"
                  style={[styles.iconButton, { borderColor: colors.borderColor }]}
                >
                  <Icon name="chevron-back" size={18} color={colors.textPrimary} />
                </Pressable>
                <Typography
                  variant="body"
                  weight="semibold"
                  color={colors.textPrimary}
                  testID="health-recipe-log-day"
                  accessibilityLabel={`Logging on ${formatDayKey(logDate)}`}
                >
                  {formatDayKey(logDate)}
                </Typography>
                <Pressable
                  onPress={() => canGoLaterDay && setLogDate(shiftDateKey(logDate, 1))}
                  disabled={!canGoLaterDay}
                  accessibilityRole="button"
                  accessibilityLabel="Log on a later day"
                  accessibilityState={{ disabled: !canGoLaterDay }}
                  testID="health-recipe-log-next-day"
                  style={[
                    styles.iconButton,
                    { borderColor: colors.borderColor, opacity: canGoLaterDay ? 1 : 0.4 },
                  ]}
                >
                  <Icon name="chevron-forward" size={18} color={colors.textPrimary} />
                </Pressable>
              </View>

              <Typography
                variant="caption1"
                color={colors.textSecondary}
                testID="health-recipe-log-preview"
              >
                One entry of {formatMacro(scaled.totals.calories)} kcal ·{' '}
                {formatMacro(scaled.totals.protein)}P / {formatMacro(scaled.totals.carbs)}C /{' '}
                {formatMacro(scaled.totals.fat)}F — the server&apos;s figures for{' '}
                {scaled.targetServings}{' '}
                {scaled.targetServings === 1 ? 'serving' : 'servings'}.
              </Typography>

              <Pressable
                onPress={() => void handleLogRecipe(selected)}
                disabled={logging}
                accessibilityRole="button"
                accessibilityLabel={`Log ${scaleTarget} ${
                  scaleTarget === 1 ? 'serving' : 'servings'
                } of ${selected.name} to ${MEAL_SLOT_LABELS[logSlot]} on ${formatDayKey(logDate)}`}
                accessibilityState={{ disabled: logging }}
                testID="health-recipe-log-button"
                style={[
                  styles.primaryButton,
                  { backgroundColor: logging ? colors.borderColor : colors.primary },
                ]}
              >
                <Typography variant="body" weight="semibold" color={colors.white}>
                  {logging
                    ? 'Logging…'
                    : `Log ${scaleTarget} to ${MEAL_SLOT_LABELS[logSlot]}`}
                </Typography>
              </Pressable>

              {logMessage ? (
                <Typography
                  variant="footnote"
                  color={colors.textSecondary}
                  testID="health-recipe-log-message"
                  accessibilityLabel={logMessage}
                >
                  {logMessage}
                </Typography>
              ) : null}
            </View>
          ) : null}
        </Card>
      )}

      <ProcessingOverlay visible={photoBusy} message="Uploading photo…" />
      {photoDrivePicker}
    </HealthSectionScreen>
  );
}

/** The photo just attached, with the donor's overlaid remove (×) button. */
function RecipePhotoPreview({
  imageUrl,
  onRemove,
}: {
  imageUrl: string;
  onRemove: () => void;
}) {
  const colors = useAppColors();
  const source = healthFileContentSource(imageUrl);
  return (
    <View style={styles.photoPreviewWrap} testID="health-recipe-photo-preview">
      {source ? (
        <Image source={source} style={styles.photoPreview} accessibilityLabel="Recipe photo" />
      ) : (
        <View style={[styles.photoPreview, styles.thumbFallback, { backgroundColor: colors.backgroundMain }]}>
          <Icon name={DEFAULT_RECIPE_ICON} size={28} color={colors.textSecondary} />
        </View>
      )}
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel="Remove recipe photo"
        testID="health-recipe-photo-remove"
        hitSlop={8}
        style={[styles.photoRemoveButton, { backgroundColor: hexToRgba(colors.black, 0.55) }]}
      >
        <Icon name="close" size={14} color={colors.white} />
      </Pressable>
    </View>
  );
}

/** One "Category" chip — the "None" option and each of `RECIPE_CATEGORIES`. */
function CategoryChip({
  label,
  icon,
  active,
  onPress,
  testID,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Category ${label}`}
      accessibilityState={{ selected: active }}
      testID={testID}
      style={[
        styles.categoryChip,
        {
          borderColor: active ? colors.primary : colors.borderColor,
          backgroundColor: active ? hexToRgba(colors.primary, 0.14) : 'transparent',
        },
      ]}
    >
      <Icon
        name={icon}
        size={14}
        color={active ? colors.primary : colors.textSecondary}
      />
      <Typography
        variant="caption1"
        weight="semibold"
        color={active ? colors.primary : colors.textSecondary}
      >
        {label}
      </Typography>
    </Pressable>
  );
}

/** Small labelled numeric field, shared by servings + ingredient quantity. */
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
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  multilineInput: {
    height: 72,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  amountRow: {
    flexDirection: 'row',
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
  pickerRow: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 46,
    borderRadius: CornerRadius.sm,
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 40,
    borderWidth: 1,
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
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.base,
  },
  logSection: {
    gap: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderRadius: CornerRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: CornerRadius.sm,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: 2,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: CornerRadius.full,
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: CornerRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
  },
  photoPreviewWrap: {
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: 160,
    borderRadius: CornerRadius.md,
  },
  photoRemoveButton: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
