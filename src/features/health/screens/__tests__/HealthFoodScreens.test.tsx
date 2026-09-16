/**
 * Symply Health parity-P2 tabs — Foods · Recipes.
 *
 * Renders the REAL screens through <ThemeProvider> and drives the primary path
 * of each: load → search → enter → persist → reflect. Only the storage-backed
 * async functions are mocked; the pure helpers stay real (they own their
 * coverage in ../../__tests__/healthFoodStorage.test.ts).
 *
 * The invariant these suites exist to pin: **every nutrition figure on screen is
 * a SERVER figure.** A recipe's per-serving number is only ever rendered from a
 * `/recipes/:id/scale` answer, so a screen with no answer must say so rather
 * than divide totals by servings itself.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert, Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createFood,
  createRecipe,
  deleteFood,
  deleteRecipe,
  importExternalFood,
  loadFoodSuggestions,
  loadFoods,
  loadRecipes,
  logExternalFoodToDiary,
  logFoodToDiary,
  logRecipeToDiary,
  PROVIDER_NOT_CONFIGURED_MESSAGE,
  RECIPE_LOG_OFFLINE_MESSAGE,
  scaleRecipe,
  searchFoods,
  setFoodFavorite,
  setRecipeFavorite,
  updateFood,
  updateRecipe,
  uploadRecipePhoto,
  type ExternalFoodItem,
  type FoodItem,
  type FoodSearchOutcome,
  type FoodSuggestions,
  type RecipeItem,
  type ScaledRecipe,
} from '../../healthFoodStorage';
import { HealthFoodLibraryScreen } from '../HealthFoodLibraryScreen';
import { HealthRecipesScreen } from '../HealthRecipesScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    ProcessingOverlay: ({
      visible,
      message,
      testID,
    }: {
      visible?: boolean;
      message?: string;
      testID?: string;
    }) =>
      visible
        ? ReactMock.createElement(View, {
            testID: testID ?? 'health-recipe-photo-overlay',
            accessibilityLabel: message,
          })
        : null,
    ScanImportSources: (props: Record<string, unknown>) =>
      ReactMock.createElement(
        View,
        { testID: `${props.testIDPrefix}-sources` },
        ...(['camera', 'gallery'] as const).map((key) =>
          ReactMock.createElement(Pressable, {
            key,
            testID: `${props.testIDPrefix}-${key}`,
            disabled: props.disabled,
            onPress: props[`on${key[0].toUpperCase()}${key.slice(1)}`],
          })
        )
      ),
  };
});

jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));

jest.mock('@api/healthAssets', () => {
  const actual = jest.requireActual('@api/healthAssets');
  return { ...actual, healthFileContentSource: jest.fn() };
});

jest.mock('../../healthFoodStorage', () => {
  const actual = jest.requireActual('../../healthFoodStorage');
  return {
    ...actual,
    loadFoods: jest.fn(),
    loadFoodSuggestions: jest.fn(),
    searchFoods: jest.fn(),
    importExternalFood: jest.fn(),
    logExternalFoodToDiary: jest.fn(),
    createFood: jest.fn(),
    updateFood: jest.fn(),
    deleteFood: jest.fn(),
    setFoodFavorite: jest.fn(),
    logFoodToDiary: jest.fn(),
    loadRecipes: jest.fn(),
    createRecipe: jest.fn(),
    updateRecipe: jest.fn(),
    deleteRecipe: jest.fn(),
    setRecipeFavorite: jest.fn(),
    scaleRecipe: jest.fn(),
    logRecipeToDiary: jest.fn(),
    uploadRecipePhoto: jest.fn(),
  };
});

const mockLoadFoods = loadFoods as jest.Mock;
const mockLoadSuggestions = loadFoodSuggestions as jest.Mock;
const mockSearchFoods = searchFoods as jest.Mock;
const mockImportExternal = importExternalFood as jest.Mock;
const mockLogExternal = logExternalFoodToDiary as jest.Mock;
const mockCreateFood = createFood as jest.Mock;
const mockUpdateFood = updateFood as jest.Mock;
const mockDeleteFood = deleteFood as jest.Mock;
const mockSetFoodFavorite = setFoodFavorite as jest.Mock;
const mockLogFood = logFoodToDiary as jest.Mock;

const mockLoadRecipes = loadRecipes as jest.Mock;
const mockCreateRecipe = createRecipe as jest.Mock;
const mockUpdateRecipe = updateRecipe as jest.Mock;
const mockDeleteRecipe = deleteRecipe as jest.Mock;
const mockSetRecipeFavorite = setRecipeFavorite as jest.Mock;
const mockScaleRecipe = scaleRecipe as jest.Mock;
const mockLogRecipe = logRecipeToDiary as jest.Mock;
const mockUploadRecipePhoto = uploadRecipePhoto as jest.Mock;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

/** A food-database hit, as `healthFoodStorage` hands it to the screen. */
function externalFood(over: Partial<ExternalFoodItem> = {}): ExternalFoodItem {
  return {
    id: 'fatsecret:33691',
    provider: 'fatsecret',
    providerFoodId: '33691',
    name: 'Greek Yogurt',
    brand: 'Fage',
    portion: 170,
    unit: 'g',
    servingId: 's_metric',
    servingDescription: '1 container (170 g)',
    serving: { calories: 100, protein: 18, carbs: 6, fat: 0 },
    per100: { calories: 58.8, protein: 10.6, carbs: 3.5, fat: 0 },
    servings: [
      {
        id: 's_metric',
        description: '1 container (170 g)',
        portion: 170,
        unit: 'g',
        isMetric: true,
        macros: { calories: 100, protein: 18, carbs: 6, fat: 0 },
      },
      {
        // A second METRIC serving — the Worker filters non-metric ones out.
        id: 's_100g',
        description: '100 g',
        portion: 100,
        unit: 'g',
        isMetric: true,
        macros: { calories: 59, protein: 10.6, carbs: 3.5, fat: 0 },
      },
    ],
    ...over,
  };
}

function searchOutcome(over: Partial<FoodSearchOutcome> = {}): FoodSearchOutcome {
  return { library: [], external: [], providerNotice: null, offline: false, ...over };
}

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: over.id ?? 'cf_1',
    name: over.name ?? 'Oats',
    brand: over.brand ?? null,
    portion: over.portion ?? 100,
    unit: over.unit ?? 'g',
    serving: over.serving ?? { calories: 380, protein: 13, carbs: 60, fat: 7 },
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 0,
    lastUsedAt: over.lastUsedAt ?? null,
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

function recipe(over: Partial<RecipeItem> = {}): RecipeItem {
  return {
    id: over.id ?? 'rcp_1',
    name: over.name ?? 'Porridge',
    description: over.description ?? null,
    servings: over.servings ?? 2,
    totals: over.totals ?? { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
    ingredients: over.ingredients ?? [
      {
        name: 'Oats',
        quantity: 80,
        unit: 'g',
        foodId: 'cf_1',
        macros: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
      },
    ],
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 0,
    category: over.category ?? null,
    preparationTime: over.preparationTime ?? null,
    cookingTime: over.cookingTime ?? null,
    imageUrl: over.imageUrl ?? null,
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

function scaled(over: Partial<ScaledRecipe> = {}): ScaledRecipe {
  return {
    recipeId: over.recipeId ?? 'rcp_1',
    name: over.name ?? 'Porridge',
    servings: over.servings ?? 2,
    targetServings: over.targetServings ?? 2,
    perServing: over.perServing ?? { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
    totals: over.totals ?? { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
    ingredients: over.ingredients ?? [],
  };
}

function suggestions(over: Partial<FoodSuggestions> = {}): FoodSuggestions {
  return {
    timeOfDay: over.timeOfDay ?? 'midday',
    mealSlot: over.mealSlot ?? 'lunch',
    suggestions: over.suggestions ?? [],
  };
}

/** Flatten every string in the rendered host tree, preserving concatenation. */
function allText(json: unknown): string {
  if (json == null) return '';
  if (typeof json === 'string') return json;
  if (typeof json === 'number') return String(json);
  if (Array.isArray(json)) return json.map(allText).join('');
  return allText((json as { children?: unknown }).children);
}

function byTestId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === id);
}

/** Fire onPress on the composite carrying `testID` (Pressable, not its host View). */
function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  act(() => node.props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function typeAsync(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  text: string
) {
  await act(async () => input(tree, testID).props.onChangeText(text));
}

async function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadFoods.mockResolvedValue([]);
  mockLoadSuggestions.mockResolvedValue(null);
  mockSearchFoods.mockResolvedValue(searchOutcome());
  mockImportExternal.mockResolvedValue({
    foods: [],
    status: 'saved',
    message: null,
    food: food({ id: 'cf_ext', name: 'Greek Yogurt' }),
    created: true,
  });
  mockLogExternal.mockResolvedValue({
    foods: [],
    status: 'saved',
    message: null,
    logged: { calories: 100, protein: 18, carbs: 6, fat: 0 },
    mealSlot: 'lunch',
    created: true,
  });
  mockCreateFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
  mockUpdateFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
  mockDeleteFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
  mockSetFoodFavorite.mockResolvedValue({ foods: [], status: 'saved', message: null });
  mockLogFood.mockResolvedValue({
    foods: [],
    status: 'saved',
    message: null,
    logged: { calories: 380, protein: 13, carbs: 60, fat: 7 },
    mealSlot: 'lunch',
  });

  mockLoadRecipes.mockResolvedValue([]);
  mockCreateRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockUpdateRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockDeleteRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockSetRecipeFavorite.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockScaleRecipe.mockResolvedValue(scaled());
  mockLogRecipe.mockResolvedValue({
    status: 'saved',
    message: null,
    logged: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
    servings: 2,
    mealSlot: 'dinner',
  });
  mockUploadRecipePhoto.mockResolvedValue({
    imageUrl: '/health/files/file_1/content',
    status: 'saved',
    message: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Foods                                                               */
/* ------------------------------------------------------------------ */

describe('HealthFoodLibraryScreen', () => {
  it('HEALTH-FOOD-050: renders the shell and says so when the library is empty', async () => {
    const tree = await render(<HealthFoodLibraryScreen />);

    expect(byTestId(tree, 'health-food-screen').length).toBe(1);
    expect(byTestId(tree, 'health-food-screen-scroll-end').length).toBe(1);
    expect(byTestId(tree, 'health-food-empty').length).toBe(1);
    const text = allText(tree.toJSON());
    expect(text).toContain('SEARCH');
    expect(text).toContain('ADD FOOD');
  });

  it('HEALTH-FOOD-051: a row shows the SERVER serving for its stored portion', async () => {
    mockLoadFoods.mockResolvedValue([
      food({
        id: 'cf_1',
        name: 'Greek yoghurt',
        brand: 'Fage',
        portion: 170,
        unit: 'g',
        serving: { calories: 160, protein: 17, carbs: 6, fat: 8 },
      }),
    ]);
    const tree = await render(<HealthFoodLibraryScreen />);

    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(1);
    const macros = allText(byTestId(tree, 'health-food-macros-cf_1')[0]);
    // Straight off the row — nothing on the device portioned the basis out.
    expect(macros).toContain('170 g');
    expect(macros).toContain('160 kcal');
    expect(macros).toContain('17P');
    expect(allText(tree.toJSON())).toContain('Greek yoghurt · Fage');
  });

  it('HEALTH-FOOD-052: every control carries a testID AND an accessibility label', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render(<HealthFoodLibraryScreen />);

    for (const id of [
      'health-food-search-input',
      'health-food-name-input',
      'health-food-calories-input',
      'health-food-save-button',
      'health-food-log-cf_1',
      'health-food-favorite-cf_1',
      'health-food-edit-cf_1',
      'health-food-delete-cf_1',
      'health-food-filter-favorites',
      'health-food-slot-lunch',
    ]) {
      const node = tree.root.findAll((n) => n.props?.testID === id);
      expect(node.length).toBeGreaterThan(0);
      expect(typeof node[0].props.accessibilityLabel).toBe('string');
      expect(node[0].props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  it('HEALTH-FOOD-053: typing a query searches the library and swaps the list for results', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockSearchFoods.mockResolvedValue(
      searchOutcome({ library: [food({ id: 'cf_9', name: 'Oat milk' })] })
    );
    const tree = await render(<HealthFoodLibraryScreen />);

    await typeAsync(tree, 'health-food-search-input', 'oat');

    expect(mockSearchFoods).toHaveBeenCalledWith('oat');
    expect(byTestId(tree, 'health-food-row-cf_9').length).toBe(1);
    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(0);
    // The FOOD DATABASE card only exists while a query does.
    expect(byTestId(tree, 'health-food-database').length).toBe(1);

    // Clearing the query restores the library.
    await act(async () => press(tree, 'health-food-search-clear'));
    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(1);
  });

  it('HEALTH-FOOD-054: a search with no hits says so rather than showing the whole library', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1' })]);
    mockSearchFoods.mockResolvedValue(searchOutcome());
    const tree = await render(<HealthFoodLibraryScreen />);

    await typeAsync(tree, 'health-food-search-input', 'quinoa');

    expect(byTestId(tree, 'health-food-search-empty').length).toBe(1);
    expect(byTestId(tree, 'health-food-empty').length).toBe(0);
  });

  it('HEALTH-FOOD-055: creating a food sends the portion + its macros, then clears the form', async () => {
    const tree = await render(<HealthFoodLibraryScreen />);

    type(tree, 'health-food-name-input', 'Greek yoghurt');
    type(tree, 'health-food-brand-input', 'Fage');
    type(tree, 'health-food-portion-input', '170');
    press(tree, 'health-food-unit-g');
    type(tree, 'health-food-calories-input', '160');
    type(tree, 'health-food-protein-input', '17');
    type(tree, 'health-food-carbs-input', '6');
    type(tree, 'health-food-fat-input', '8');
    await act(async () => press(tree, 'health-food-save-button'));

    expect(mockCreateFood).toHaveBeenCalledWith({
      name: 'Greek yoghurt',
      brand: 'Fage',
      portion: 170,
      unit: 'g',
      calories: 160,
      protein: 17,
      carbs: 6,
      fat: 8,
    });
    expect(input(tree, 'health-food-name-input').props.value).toBe('');
    expect(input(tree, 'health-food-calories-input').props.value).toBe('');
  });

  it('HEALTH-FOOD-056: the save button stays inert without a name or a calorie value', async () => {
    const tree = await render(<HealthFoodLibraryScreen />);

    await act(async () => press(tree, 'health-food-save-button'));
    expect(mockCreateFood).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-food-save-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    type(tree, 'health-food-name-input', 'Nameless calories');
    await act(async () => press(tree, 'health-food-save-button'));
    expect(mockCreateFood).not.toHaveBeenCalled();
  });

  it('HEALTH-FOOD-057: editing loads the row into the form and updates instead of creating', async () => {
    mockLoadFoods.mockResolvedValue([
      food({ id: 'cf_1', name: 'Oats', serving: { calories: 380, protein: 13, carbs: 60, fat: 7 } }),
    ]);
    const tree = await render(<HealthFoodLibraryScreen />);

    press(tree, 'health-food-edit-cf_1');
    expect(input(tree, 'health-food-name-input').props.value).toBe('Oats');
    expect(input(tree, 'health-food-calories-input').props.value).toBe('380');

    type(tree, 'health-food-calories-input', '390');
    await act(async () => press(tree, 'health-food-save-button'));

    expect(mockUpdateFood).toHaveBeenCalledWith('cf_1', expect.objectContaining({ calories: 390 }));
    expect(mockCreateFood).not.toHaveBeenCalled();
  });

  it('HEALTH-FOOD-058: deleting asks first, then removes it through the store', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render(<HealthFoodLibraryScreen />);

    press(tree, 'health-food-delete-cf_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.find((b) => b.text === 'Cancel')?.style).toBe('cancel');

    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());
    expect(mockDeleteFood).toHaveBeenCalledWith('cf_1');
    alertSpy.mockRestore();
  });

  it('HEALTH-FOOD-059: "Log" files the food in the chosen slot and reports the server figure', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockLogFood.mockResolvedValue({
      foods: [food({ id: 'cf_1', useCount: 1 })],
      status: 'saved',
      message: null,
      logged: { calories: 171, protein: 5.85, carbs: 27, fat: 3.15 },
      mealSlot: 'lunch',
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    press(tree, 'health-food-slot-dinner');
    await act(async () => press(tree, 'health-food-log-cf_1'));

    expect(mockLogFood).toHaveBeenCalledWith('cf_1', { mealSlot: 'dinner' });
    // The confirmation quotes the SERVER's `logged` value and the slot the
    // server actually filed it under (lunch here), not the tapped one.
    expect(allText(byTestId(tree, 'health-food-message')[0])).toContain('171 kcal');
    expect(allText(byTestId(tree, 'health-food-message')[0])).toContain('Lunch');
  });

  it('HEALTH-FOOD-060: favouriting toggles through the store and re-renders', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', isFavorite: false })]);
    mockSetFoodFavorite.mockResolvedValue({
      foods: [food({ id: 'cf_1', isFavorite: true })],
      status: 'saved',
      message: null,
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    expect(byTestId(tree, 'health-food-favorite-cf_1')[0].props.accessibilityState).toEqual({
      selected: false,
    });

    await act(async () => press(tree, 'health-food-favorite-cf_1'));
    expect(mockSetFoodFavorite).toHaveBeenCalledWith('cf_1', true);
    expect(byTestId(tree, 'health-food-favorite-cf_1')[0].props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('HEALTH-FOOD-061: switching the filter reloads that view', async () => {
    const tree = await render(<HealthFoodLibraryScreen />);

    await act(async () => press(tree, 'health-food-filter-most-used'));

    expect(mockLoadFoods).toHaveBeenLastCalledWith('most-used');
    expect(byTestId(tree, 'health-food-filter-most-used')[0].props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('HEALTH-FOOD-062: the server names the default meal slot — the device never guesses', async () => {
    mockLoadSuggestions.mockResolvedValue(
      suggestions({
        timeOfDay: 'evening',
        mealSlot: 'dinner',
        suggestions: [{ food: food({ id: 'cf_1', name: 'Oats' }), score: 0.9, reasons: ['favorite'] }],
      })
    );
    const tree = await render(<HealthFoodLibraryScreen />);

    expect(byTestId(tree, 'health-food-slot-dinner')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'health-food-suggestions').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('USUALLY AT EVENING');
    expect(allText(byTestId(tree, 'health-food-suggestion-cf_1')[0])).toContain('Favourite');

    await act(async () => press(tree, 'health-food-suggestion-cf_1'));
    expect(mockLogFood).toHaveBeenCalledWith('cf_1', { mealSlot: 'dinner' });
  });

  it('HEALTH-FOOD-063: a rejected write shows friendly copy and keeps the form filled', async () => {
    mockCreateFood.mockResolvedValue({
      foods: [],
      status: 'rejected',
      message: 'Those numbers do not add up. Check the portion, calories and macros.',
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    type(tree, 'health-food-name-input', 'Impossible');
    type(tree, 'health-food-calories-input', '5000');
    await act(async () => press(tree, 'health-food-save-button'));

    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toContain('do not add up');
    // No raw error string ever reaches the UI.
    expect(message).not.toContain('status code');
    // The form keeps what was typed so the user can fix it.
    expect(input(tree, 'health-food-name-input').props.value).toBe('Impossible');
  });

  it('HEALTH-FOOD-064: an offline write still reflects the action and says it will sync', async () => {
    mockCreateFood.mockResolvedValue({
      foods: [food({ id: 'local-1', name: 'Oats' })],
      status: 'offline',
      message: 'Saved on this device — it will sync when you are back online.',
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    type(tree, 'health-food-name-input', 'Oats');
    type(tree, 'health-food-calories-input', '380');
    await act(async () => press(tree, 'health-food-save-button'));

    expect(byTestId(tree, 'health-food-row-local-1').length).toBe(1);
    expect(allText(byTestId(tree, 'health-food-message')[0])).toContain('sync when you are back');
  });

  it('HEALTH-FOOD-265: Cancel drops the edit and empties the form back to a fresh one', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render(<HealthFoodLibraryScreen />);

    press(tree, 'health-food-edit-cf_1');
    expect(allText(tree.toJSON())).toContain('EDIT FOOD');

    press(tree, 'health-food-cancel-edit');

    // Back to ADD, with none of the edited row left behind — a stale name in
    // the form would create a second copy on the next Save.
    expect(allText(tree.toJSON())).toContain('ADD FOOD');
    expect(byTestId(tree, 'health-food-cancel-edit').length).toBe(0);
    expect(input(tree, 'health-food-name-input').props.value).toBe('');
    expect(input(tree, 'health-food-portion-input').props.value).toBe('100');
  });

  it('HEALTH-FOOD-266: deleting the food being edited abandons the edit too', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockDeleteFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
    const tree = await render(<HealthFoodLibraryScreen />);

    press(tree, 'health-food-edit-cf_1');
    press(tree, 'health-food-delete-cf_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    // Otherwise the form still says EDIT FOOD for a row that no longer exists,
    // and Save would PUT to a 404.
    expect(allText(tree.toJSON())).toContain('ADD FOOD');
    expect(input(tree, 'health-food-name-input').props.value).toBe('');
    alertSpy.mockRestore();
  });

  it('HEALTH-FOOD-267: deleting while searching drops the row from the RESULTS too', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockSearchFoods.mockResolvedValue(
      searchOutcome({
        library: [food({ id: 'cf_1', name: 'Oats' }), food({ id: 'cf_2', name: 'Oat milk' })],
      })
    );
    mockDeleteFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'oat');

    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(1);
    press(tree, 'health-food-delete-cf_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    // The results list is its own snapshot; leaving the row in it would show a
    // deleted food until the query changed.
    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(0);
    expect(byTestId(tree, 'health-food-row-cf_2').length).toBe(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-FOOD-268: deleting before a search has answered does not crash the results card', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const pending = new Promise<never>(() => {}); // never resolves
    mockSearchFoods.mockReturnValue(pending);
    mockDeleteFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
    const tree = await render(<HealthFoodLibraryScreen />);

    // A query is live but no outcome has arrived, so there is no result set to
    // prune — the update has to cope with that rather than assume one.
    await typeAsync(tree, 'health-food-search-input', 'oat');
    press(tree, 'health-food-delete-cf_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());

    expect(mockDeleteFood).toHaveBeenCalledWith('cf_1');
    expect(byTestId(tree, 'health-food-search-empty').length).toBe(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-FOOD-269: a search answer that arrives after the query moved on is discarded', async () => {
    let releaseFirst!: (value: unknown) => void;
    mockSearchFoods
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          })
      )
      .mockResolvedValue(searchOutcome({ library: [food({ id: 'cf_2', name: 'Oat milk' })] }));

    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'oa');
    await typeAsync(tree, 'health-food-search-input', 'oat');

    // The slow answer for "oa" lands last. Letting it win would repaint the
    // list with results for a query the member has already moved past.
    await act(async () => {
      releaseFirst(searchOutcome({ library: [food({ id: 'cf_1', name: 'Oats' })] }));
    });

    expect(byTestId(tree, 'health-food-row-cf_2').length).toBe(1);
    expect(byTestId(tree, 'health-food-row-cf_1').length).toBe(0);
  });

  it('HEALTH-FOOD-270: a log the store refuses says why, and claims nothing was added', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockLogFood.mockResolvedValue({
      foods: [],
      status: 'rejected',
      message: 'That food is no longer in your library.',
      logged: null,
      mealSlot: 'lunch',
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    await act(async () => press(tree, 'health-food-log-cf_1'));

    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toBe('That food is no longer in your library.');
    expect(message).not.toContain('Added');
  });

  it('HEALTH-FOOD-271: an offline log says which meal it landed in, without a made-up figure', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockLogFood.mockResolvedValue({
      foods: [food({ id: 'cf_1', useCount: 1 })],
      status: 'offline',
      message: null,
      logged: null,
      mealSlot: 'breakfast',
    });
    const tree = await render(<HealthFoodLibraryScreen />);

    await act(async () => press(tree, 'health-food-log-cf_1'));

    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toBe('Added to Breakfast — it will sync when you are back online.');
    expect(message).not.toContain('kcal');
  });

  it('HEALTH-FOOD-272: a suggestion with no reason the app knows still reads as a suggestion', async () => {
    mockLoadSuggestions.mockResolvedValue(
      suggestions({
        suggestions: [
          // A reason word the server added after this build shipped.
          {
            food: food({ id: 'cf_1', name: 'Oats' }),
            score: 0.9,
            reasons: ['seasonal_match' as never],
          },
          { food: food({ id: 'cf_2', name: 'Yoghurt' }), score: 0.5, reasons: [] },
        ],
      })
    );
    const tree = await render(<HealthFoodLibraryScreen />);

    // An unknown reason falls through as itself rather than rendering blank…
    expect(allText(byTestId(tree, 'health-food-suggestion-cf_1')[0])).toContain('seasonal_match');
    // …and no reason at all still says why the row is here.
    expect(allText(byTestId(tree, 'health-food-suggestion-cf_2')[0])).toContain('Suggested');
  });

  it('HEALTH-FOOD-273: a macro field left mid-decimal counts as nothing, not as a blocked save', async () => {
    // `.` on its own is what every decimal field looks like for one keystroke.
    // The macros are optional, so it has to read as "not given" — blocking Save
    // would make the button flicker while someone types ".5".
    const tree = await render(<HealthFoodLibraryScreen />);

    type(tree, 'health-food-name-input', 'Oats');
    type(tree, 'health-food-calories-input', '380');
    type(tree, 'health-food-protein-input', '.');
    type(tree, 'health-food-carbs-input', '.');
    type(tree, 'health-food-fat-input', '.');
    await act(async () => press(tree, 'health-food-save-button'));

    expect(mockCreateFood).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 380, protein: 0, carbs: 0, fat: 0 })
    );
  });

  it('HEALTH-FOOD-274: Android gets the numeric keypad, iOS the decimal pad', async () => {
    // `decimal-pad` does not exist on Android — asking for it there falls back
    // to a full keyboard, which is what a numeric field is trying to avoid.
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      const android = await render(<HealthFoodLibraryScreen />);
      expect(input(android, 'health-food-portion-input').props.keyboardType).toBe('numeric');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }

    const ios = await render(<HealthFoodLibraryScreen />);
    expect(input(ios, 'health-food-portion-input').props.keyboardType).toBe('decimal-pad');
  });

  /* ---- the external food database (parity phase P3) ---- */

  it('HEALTH-FOOD-220: database hits render in their OWN section, with the server figures', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    const tree = await render(<HealthFoodLibraryScreen />);

    await typeAsync(tree, 'health-food-search-input', 'yog');

    expect(byTestId(tree, 'health-food-external-33691').length).toBe(1);
    const macros = allText(byTestId(tree, 'health-food-external-macros-33691')[0]);
    // The chosen serving's figures, straight off the wire.
    expect(macros).toContain('1 container (170 g)');
    expect(macros).toContain('100 kcal');
    expect(macros).toContain('18P');
    // It is NOT a library row: no favourite, edit or delete control exists for
    // something the user does not own yet.
    expect(byTestId(tree, 'health-food-row-fatsecret:33691').length).toBe(0);
    expect(byTestId(tree, 'health-food-favorite-fatsecret:33691').length).toBe(0);
  });

  it('HEALTH-FOOD-221: with no query there is no database card at all', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1' })]);
    const tree = await render(<HealthFoodLibraryScreen />);

    // An empty database card with nothing to look up would imply there was.
    expect(byTestId(tree, 'health-food-database').length).toBe(0);
  });

  it('HEALTH-FOOD-222: a provider that cannot be consulted SAYS so, in words', async () => {
    mockSearchFoods.mockResolvedValue(
      searchOutcome({ providerNotice: PROVIDER_NOT_CONFIGURED_MESSAGE })
    );
    const tree = await render(<HealthFoodLibraryScreen />);

    await typeAsync(tree, 'health-food-search-input', 'yog');

    const notice = byTestId(tree, 'health-food-database-notice');
    expect(notice.length).toBe(1);
    expect(allText(notice[0])).toBe(PROVIDER_NOT_CONFIGURED_MESSAGE);
    // The empty copy must NOT also render — "nothing matched" and "we could not
    // ask" are different facts and only one of them is true.
    expect(byTestId(tree, 'health-food-database-empty').length).toBe(0);
    // And nothing resembling a status code or an error string is on screen.
    const text = allText(tree.toJSON());
    expect(text).not.toContain('not_configured');
    expect(text).not.toMatch(/\b(4\d\d|5\d\d)\b/);
  });

  it('HEALTH-FOOD-223: a database miss is its own sentence, not an empty card', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome());
    const tree = await render(<HealthFoodLibraryScreen />);

    await typeAsync(tree, 'health-food-search-input', 'zzqq');

    expect(byTestId(tree, 'health-food-database-empty').length).toBe(1);
    expect(byTestId(tree, 'health-food-database-notice').length).toBe(0);
  });

  it('HEALTH-FOOD-224: the serving picker only appears with a real choice, and it moves', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    const metric = byTestId(tree, 'health-food-external-serving-33691-s_metric')[0];
    expect(metric.props.accessibilityState.selected).toBe(true);

    await act(async () => press(tree, 'health-food-external-serving-33691-s_100g'));

    // The row re-renders with the CUP figures — the picker is not decoration.
    const macros = allText(byTestId(tree, 'health-food-external-macros-33691')[0]);
    expect(macros).toContain('100 g');
    expect(macros).toContain('59 kcal');

    // A single-serving food has nothing to choose between, so no chips.
    mockSearchFoods.mockResolvedValue(
      searchOutcome({
        external: [externalFood({ servings: [externalFood().servings[0]] })],
      })
    );
    const single = await render(<HealthFoodLibraryScreen />);
    await typeAsync(single, 'health-food-search-input', 'yog');
    expect(byTestId(single, 'health-food-external-serving-33691-s_metric').length).toBe(0);
  });

  it('HEALTH-FOOD-225: Save imports with the CHOSEN serving and says what happened', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockImportExternal.mockResolvedValue({
      foods: [food({ id: 'cf_ext', name: 'Greek Yogurt' })],
      status: 'saved',
      message: null,
      food: food({ id: 'cf_ext', name: 'Greek Yogurt' }),
      created: true,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    await act(async () => press(tree, 'health-food-external-serving-33691-s_100g'));
    await act(async () => press(tree, 'health-food-external-save-33691'));

    expect(mockImportExternal).toHaveBeenCalledWith(
      expect.objectContaining({ providerFoodId: '33691' }),
      { servingId: 's_100g' }
    );
    expect(allText(byTestId(tree, 'health-food-message')[0])).toContain(
      'Saved "Greek Yogurt" to your foods.'
    );
  });

  it('HEALTH-FOOD-226: Log imports AND diarises, into the slot the picker names', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockLogExternal.mockResolvedValue({
      foods: [food({ id: 'cf_ext', name: 'Greek Yogurt' })],
      status: 'saved',
      message: null,
      logged: { calories: 100, protein: 18, carbs: 6, fat: 0 },
      mealSlot: 'breakfast',
      created: true,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    press(tree, 'health-food-slot-breakfast');
    await act(async () => press(tree, 'health-food-external-log-33691'));

    expect(mockLogExternal).toHaveBeenCalledWith(
      expect.objectContaining({ providerFoodId: '33691' }),
      { mealSlot: 'breakfast', servingId: 's_metric' }
    );
    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toContain('100 kcal');
    expect(message).toContain('Breakfast');
  });

  it('HEALTH-FOOD-260: a hit already in the library says so rather than claiming a save', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockImportExternal.mockResolvedValue({
      foods: [food({ id: 'cf_ext', name: 'Greek Yogurt' })],
      status: 'saved',
      message: null,
      food: food({ id: 'cf_ext', name: 'Greek Yogurt' }),
      created: false,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    await act(async () => press(tree, 'health-food-external-save-33691'));

    // Nothing was overwritten, so "Saved" would be a claim about a write that
    // did not happen.
    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toBe('"Greek Yogurt" is already in your foods.');
  });

  it('HEALTH-FOOD-261: a refused SAVE surfaces the store copy and adds nothing', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockImportExternal.mockResolvedValue({
      foods: [],
      status: 'rejected',
      message: 'That food is no longer in the food database.',
      food: null,
      created: false,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    await act(async () => press(tree, 'health-food-external-save-33691'));

    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toBe('That food is no longer in the food database.');
    expect(message).not.toContain('Saved');
    expect(message).not.toMatch(/\b(4\d\d|5\d\d)\b|Error|undefined/);
  });

  it('HEALTH-FOOD-262: an offline Log names the meal without quoting a calorie figure it never got', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockLogExternal.mockResolvedValue({
      foods: [food({ id: 'cf_ext', name: 'Greek Yogurt' })],
      status: 'saved',
      message: null,
      // The `use` route never answered, so there is no server-derived serving.
      logged: null,
      mealSlot: 'lunch',
      created: true,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    await act(async () => press(tree, 'health-food-external-log-33691'));

    const message = allText(byTestId(tree, 'health-food-message')[0]);
    expect(message).toBe('Added "Greek Yogurt" to Lunch.');
    // No kcal figure is quoted, because none was derived — inventing one from
    // the hit's own macros is the recompute this feature forbids.
    expect(message).not.toContain('kcal');
  });

  it('HEALTH-FOOD-263: a hit with no brand, no matching serving and a volume basis still reads whole', async () => {
    // A thin provider row: nothing to disambiguate the name with, a preferred
    // serving id the serving list does not contain, and millilitres.
    mockSearchFoods.mockResolvedValue(
      searchOutcome({
        external: [
          externalFood({
            name: 'Semi-skimmed milk',
            brand: null,
            unit: 'ml',
            portion: 250,
            servingId: 's_gone',
            servingDescription: '1 glass (250 ml)',
            serving: { calories: 125, protein: 8.5, carbs: 12.5, fat: 4.3 },
            per100: { calories: 50, protein: 3.4, carbs: 5, fat: 1.7 },
            servings: [],
          }),
        ],
      })
    );
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'milk');

    const row = allText(byTestId(tree, 'health-food-external-33691')[0]);
    // The name stands alone — never "Semi-skimmed milk · null".
    expect(row).toContain('Semi-skimmed milk');
    expect(row).not.toContain('·  ');
    expect(row).not.toMatch(/null|undefined|NaN/);
    // The provider's own description stands in for the serving that is gone.
    expect(allText(byTestId(tree, 'health-food-external-macros-33691')[0])).toContain(
      '1 glass (250 ml)'
    );
    // A volume basis is stated per 100 ml, not per 100 g.
    expect(row).toContain('50 kcal / 100 ml');
  });

  it('HEALTH-FOOD-264: a hit with neither a serving id nor a description falls back to its portion', async () => {
    mockSearchFoods.mockResolvedValue(
      searchOutcome({
        external: [
          externalFood({
            name: 'Unbranded oats',
            brand: null,
            servingId: null,
            servingDescription: null,
            portion: 40,
            unit: 'g',
            serving: { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
            servings: [],
          }),
        ],
      })
    );
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'oat');

    // Something has to name the amount the macros belong to; the portion and
    // its unit are the last honest description available.
    expect(allText(byTestId(tree, 'health-food-external-macros-33691')[0])).toContain('40 g · 152 kcal');
  });

  it('HEALTH-FOOD-227: a refused import surfaces the store COPY and nothing else', async () => {
    mockSearchFoods.mockResolvedValue(searchOutcome({ external: [externalFood()] }));
    mockLogExternal.mockResolvedValue({
      foods: [],
      status: 'rejected',
      message: 'The food database could not be reached — showing your own foods.',
      logged: null,
      mealSlot: 'lunch',
      created: false,
    });
    const tree = await render(<HealthFoodLibraryScreen />);
    await typeAsync(tree, 'health-food-search-input', 'yog');

    await act(async () => press(tree, 'health-food-external-log-33691'));

    expect(allText(byTestId(tree, 'health-food-message')[0])).toBe(
      'The food database could not be reached — showing your own foods.'
    );
    // No claim that anything was added.
    expect(allText(byTestId(tree, 'health-food-message')[0])).not.toContain('Added');
  });

});

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen', () => {
  it('HEALTH-RECIPE-050: renders the shell and says so when there are no recipes', async () => {
    const tree = await render(<HealthRecipesScreen />);

    expect(byTestId(tree, 'health-recipes-screen').length).toBe(1);
    expect(byTestId(tree, 'health-recipes-empty').length).toBe(1);
    expect(allText(tree.toJSON())).toContain('NEW RECIPE');
  });

  it('HEALTH-RECIPE-051: a row shows the SERVER total, and no per-serving figure', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);

    const row = allText(byTestId(tree, 'health-recipe-total-rcp_1')[0]);
    expect(row).toContain('2 servings');
    expect(row).toContain('304 kcal total');
    // 304 / 2 = 152 must NOT appear until the server has been asked for it.
    expect(row).not.toContain('152');
  });

  it('HEALTH-RECIPE-052: ingredients are drawn from the user\'s own foods', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render(<HealthRecipesScreen />);

    expect(byTestId(tree, 'health-recipe-food-cf_1').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-ingredients-empty').length).toBe(1);

    press(tree, 'health-recipe-food-cf_1');
    type(tree, 'health-recipe-quantity-input', '80');
    press(tree, 'health-recipe-add-ingredient');

    expect(byTestId(tree, 'health-recipe-ingredient-0').length).toBe(1);
    expect(allText(byTestId(tree, 'health-recipe-ingredient-0')[0])).toContain('80 g');

    press(tree, 'health-recipe-ingredient-remove-0');
    expect(byTestId(tree, 'health-recipe-ingredients-empty').length).toBe(1);
  });

  it('HEALTH-RECIPE-053: saving posts quantities and food ids, never macros', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render(<HealthRecipesScreen />);

    type(tree, 'health-recipe-name-input', 'Porridge');
    type(tree, 'health-recipe-servings-input', '2');
    press(tree, 'health-recipe-food-cf_1');
    type(tree, 'health-recipe-quantity-input', '80');
    press(tree, 'health-recipe-add-ingredient');
    await act(async () => press(tree, 'health-recipe-save-button'));

    expect(mockCreateRecipe).toHaveBeenCalledWith({
      name: 'Porridge',
      servings: 2,
      description: undefined,
      category: null,
      preparationTime: null,
      cookingTime: null,
      imageUrl: null,
      ingredients: [{ name: 'Oats', quantity: 80, unit: 'g', foodId: 'cf_1' }],
    });
    expect(input(tree, 'health-recipe-name-input').props.value).toBe('');
  });

  it('HEALTH-RECIPE-054: a recipe with no name or no ingredient cannot be saved', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1' })]);
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-save-button'));
    expect(mockCreateRecipe).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-recipe-save-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    // A name alone is not enough — a recipe is its ingredient list.
    type(tree, 'health-recipe-name-input', 'Empty pot');
    await act(async () => press(tree, 'health-recipe-save-button'));
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('HEALTH-RECIPE-055: opening a recipe asks the SERVER for its per-serving figures', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    // The stored serving count is what the detail opens on.
    expect(mockScaleRecipe).toHaveBeenCalledWith('rcp_1', 2);
    expect(byTestId(tree, 'health-recipe-detail').length).toBe(1);
    expect(allText(byTestId(tree, 'health-recipe-per-serving')[0])).toContain('152 kcal');
    expect(allText(byTestId(tree, 'health-recipe-scaled-totals')[0])).toContain('304 kcal');
  });

  it('HEALTH-RECIPE-056: the scale control re-asks the server, it never divides locally', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    mockScaleRecipe.mockResolvedValue(
      scaled({
        targetServings: 3,
        // per-serving is invariant; only the batch total moves.
        perServing: { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
        totals: { calories: 456, protein: 15.6, carbs: 72, fat: 8.4 },
      })
    );
    await act(async () => press(tree, 'health-recipe-scale-plus'));

    expect(mockScaleRecipe).toHaveBeenLastCalledWith('rcp_1', 3);
    expect(allText(byTestId(tree, 'health-recipe-scale-value')[0])).toContain('3 servings');
    expect(allText(byTestId(tree, 'health-recipe-scaled-totals')[0])).toContain('456 kcal');
    // Per-serving is unchanged — proof it came back from the server rather than
    // being recomputed from the new total.
    expect(allText(byTestId(tree, 'health-recipe-per-serving')[0])).toContain('152 kcal');
  });

  it('HEALTH-RECIPE-057: with no scale answer the screen says so instead of dividing', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockScaleRecipe.mockResolvedValue(null);
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    expect(byTestId(tree, 'health-recipe-scale-unavailable').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-per-serving').length).toBe(0);
    // 304 / 2 = 152 is exactly the number a local recompute would show.
    expect(allText(byTestId(tree, 'health-recipe-detail')[0])).not.toContain('152');
    expect(allText(byTestId(tree, 'health-recipe-scale-unavailable')[0])).toContain(
      'needs a connection'
    );
  });

  it('HEALTH-RECIPE-058: editing loads the recipe into the form and updates', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', name: 'Porridge', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);

    press(tree, 'health-recipe-edit-rcp_1');
    expect(input(tree, 'health-recipe-name-input').props.value).toBe('Porridge');
    expect(input(tree, 'health-recipe-servings-input').props.value).toBe('2');
    expect(byTestId(tree, 'health-recipe-ingredient-0').length).toBe(1);

    type(tree, 'health-recipe-servings-input', '4');
    await act(async () => press(tree, 'health-recipe-save-button'));

    expect(mockUpdateRecipe).toHaveBeenCalledWith(
      'rcp_1',
      expect.objectContaining({ servings: 4 })
    );
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });

  it('HEALTH-RECIPE-059: favouriting and filtering go through the store', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', isFavorite: false })]);
    mockSetRecipeFavorite.mockResolvedValue({
      recipes: [recipe({ id: 'rcp_1', isFavorite: true })],
      status: 'saved',
      message: null,
    });
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-favorite-rcp_1'));
    expect(mockSetRecipeFavorite).toHaveBeenCalledWith('rcp_1', true);

    await act(async () => press(tree, 'health-recipe-filter-favorites'));
    expect(mockLoadRecipes).toHaveBeenLastCalledWith('favorites');
  });

  it('HEALTH-RECIPE-060: deleting asks first, then removes it and closes the detail', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', name: 'Porridge' })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));
    expect(byTestId(tree, 'health-recipe-detail').length).toBe(1);

    press(tree, 'health-recipe-delete-rcp_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.find((b) => b.text === 'Cancel')?.style).toBe('cancel');

    await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());
    expect(mockDeleteRecipe).toHaveBeenCalledWith('rcp_1');
    expect(byTestId(tree, 'health-recipe-detail').length).toBe(0);
    alertSpy.mockRestore();
  });

  it('HEALTH-RECIPE-061: says so when there are no foods to build a recipe from', async () => {
    mockLoadFoods.mockResolvedValue([]);
    const tree = await render(<HealthRecipesScreen />);

    expect(byTestId(tree, 'health-recipe-no-foods').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-add-ingredient')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-RECIPE-062: every control carries a testID AND an accessibility label', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1' })]);
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1' })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    for (const id of [
      'health-recipe-name-input',
      'health-recipe-servings-input',
      'health-recipe-quantity-input',
      'health-recipe-food-cf_1',
      'health-recipe-add-ingredient',
      'health-recipe-save-button',
      'health-recipe-favorite-rcp_1',
      'health-recipe-edit-rcp_1',
      'health-recipe-delete-rcp_1',
      'health-recipe-scale-minus',
      'health-recipe-scale-plus',
      'health-recipe-scale-value',
      'health-recipe-filter-all',
      // The log-to-diary panel is part of the detail card, so it is covered by
      // the same sweep rather than by a separate one that could drift.
      'health-recipe-log-slot-dinner',
      'health-recipe-log-prev-day',
      'health-recipe-log-next-day',
      'health-recipe-log-day',
      'health-recipe-log-button',
    ]) {
      const node = tree.root.findAll((n) => n.props?.testID === id);
      expect(node.length).toBeGreaterThan(0);
      expect(typeof node[0].props.accessibilityLabel).toBe('string');
      expect(node[0].props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });

  /* ---------------- recipe → diary (donor RecipePortionPickerView) -------- */

  it('HEALTH-RECIPE-063: logs the head count on screen, into the chosen meal and day', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    mockScaleRecipe.mockResolvedValue(
      scaled({ targetServings: 3, totals: { calories: 456, protein: 15.6, carbs: 72, fat: 8.4 } })
    );
    await act(async () => press(tree, 'health-recipe-scale-plus'));
    press(tree, 'health-recipe-log-slot-lunch');
    press(tree, 'health-recipe-log-prev-day');
    await act(async () => press(tree, 'health-recipe-log-button'));

    // The head count sent is the one the card is previewing — there is no second
    // servings control that could disagree with the total on screen.
    expect(mockLogRecipe).toHaveBeenCalledWith('rcp_1', {
      servings: 3,
      mealSlot: 'lunch',
      date: '2026-07-12',
    });
  });

  it('HEALTH-RECIPE-064: the previewed total is the figure that will be logged', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockScaleRecipe.mockResolvedValue(
      scaled({ targetServings: 2, totals: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 } })
    );
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    // The donor previews from a truncated per-100g figure and writes from a
    // full-precision one; here both read the same `scaled.totals` object.
    const preview = allText(byTestId(tree, 'health-recipe-log-preview')[0]);
    expect(preview).toContain('304 kcal');
    expect(preview).toContain('2 servings');
    expect(allText(byTestId(tree, 'health-recipe-scaled-totals')[0])).toContain('304 kcal');
  });

  it('HEALTH-RECIPE-065: with no scale answer there is no Log button at all', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockScaleRecipe.mockResolvedValue(null);
    const tree = await render(<HealthRecipesScreen />);

    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    // There is no honest figure to log, and a button that logged the stored
    // one-batch total would file 304 kcal as if it were the chosen portion.
    expect(byTestId(tree, 'health-recipe-log-section').length).toBe(0);
    expect(byTestId(tree, 'health-recipe-log-button').length).toBe(0);
  });

  it('HEALTH-RECIPE-066: a refused log reports friendly copy, never a raw error', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockLogRecipe.mockResolvedValue({
      status: 'unavailable',
      message: RECIPE_LOG_OFFLINE_MESSAGE,
      logged: null,
      servings: 2,
      mealSlot: 'dinner',
    });
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    await act(async () => press(tree, 'health-recipe-log-button'));

    const message = allText(byTestId(tree, 'health-recipe-log-message')[0]);
    expect(message).toBe(RECIPE_LOG_OFFLINE_MESSAGE);
    expect(message).toContain('nothing was added');
  });

  it('HEALTH-RECIPE-067: a confirmed log names the servings, the calories, the meal and the day', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', name: 'Porridge', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    await act(async () => press(tree, 'health-recipe-log-button'));

    const message = allText(byTestId(tree, 'health-recipe-log-message')[0]);
    expect(message).toContain('2 servings of Porridge');
    expect(message).toContain('304 kcal');
    expect(message).toContain('Dinner');
    expect(message).toContain('Today');
  });

  it('HEALTH-RECIPE-068: the log day cannot be stepped into the future', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render(<HealthRecipesScreen />);
    await act(async () => press(tree, 'health-recipe-open-rcp_1'));

    // Opens on today, so forward is already disabled — a diary entry dated
    // tomorrow would sit outside every window the app reads.
    expect(
      tree.root.find(
        (n) => n.props?.testID === 'health-recipe-log-next-day' && n.props?.accessibilityState
      ).props.accessibilityState
    ).toEqual({ disabled: true });

    press(tree, 'health-recipe-log-prev-day');
    expect(allText(byTestId(tree, 'health-recipe-log-day')[0])).toBe('Yesterday');
  });
});
