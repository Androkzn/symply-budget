/**
 * Symply Health — the Recipes tab, second sweep.
 *
 * `HealthFoodScreens.test.tsx` owns the primary Recipes path (load → build →
 * save → open → scale → log). This file owns the edges that path never reaches:
 * switching between open recipes, the racing scale answers behind the stepper,
 * a write the Worker refuses, a store that throws, and the boundary head counts
 * where the copy has to go singular.
 *
 * Same rules as the rest of the health screen suites: the REAL screen renders
 * through <ThemeProvider>, only the storage-backed async functions are mocked,
 * and every assertion is on something a member could read or press.
 *
 * The invariant these cases exist to pin: **the figure on screen belongs to the
 * recipe whose name is above it.** A per-serving number is only ever a
 * `/recipes/:id/scale` answer, and an answer for a DIFFERENT recipe — or for a
 * head count the user has already stepped past — is not an answer at all.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert, Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createRecipe,
  deleteRecipe,
  loadFoods,
  loadRecipes,
  logRecipeToDiary,
  scaleRecipe,
  setRecipeFavorite,
  updateRecipe,
  uploadRecipePhoto,
  type FoodItem,
  type LogRecipeResult,
  type RecipeItem,
  type ScaledRecipe,
} from '../../healthFoodStorage';
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
const mockLoadRecipes = loadRecipes as jest.Mock;
const mockCreateRecipe = createRecipe as jest.Mock;
const mockUpdateRecipe = updateRecipe as jest.Mock;
const mockDeleteRecipe = deleteRecipe as jest.Mock;
const mockSetRecipeFavorite = setRecipeFavorite as jest.Mock;
const mockScaleRecipe = scaleRecipe as jest.Mock;
const mockLogRecipe = logRecipeToDiary as jest.Mock;
const mockUploadRecipePhoto = uploadRecipePhoto as jest.Mock;
const mockContentSource = jest.requireMock('@api/healthAssets').healthFileContentSource as jest.Mock;
const ImageCropPicker = jest.requireMock('@services/image-picker-compat').default as {
  openCamera: jest.Mock;
  openPicker: jest.Mock;
};

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

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
async function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => node.props.onPress());
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

async function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  await act(async () => input(tree, testID).props.onChangeText(text));
}

/** A promise the test resolves by hand, for asserting an in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthRecipesScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  mockLoadFoods.mockResolvedValue([]);
  mockLoadRecipes.mockResolvedValue([]);
  mockCreateRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockUpdateRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockDeleteRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockSetRecipeFavorite.mockResolvedValue({ recipes: [], status: 'saved', message: null });
  mockScaleRecipe.mockResolvedValue(scaled());
  mockUploadRecipePhoto.mockResolvedValue({
    imageUrl: '/health/files/file_1/content',
    status: 'saved',
    message: null,
  });
  mockLogRecipe.mockResolvedValue({
    status: 'saved',
    message: null,
    logged: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
    servings: 2,
    mealSlot: 'dinner',
  });
  // No auth token by default — a row/preview falls back to its glyph rather
  // than firing a request that can only 401. Tests that need a real thumbnail
  // override this.
  mockContentSource.mockReturnValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* One card, one recipe's figures                                      */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — the open recipe', () => {
  const two = [
    recipe({ id: 'rcp_1', name: 'Porridge', servings: 2 }),
    recipe({
      id: 'rcp_2',
      name: 'Chilli',
      servings: 4,
      totals: { calories: 2000, protein: 120, carbs: 180, fat: 60 },
    }),
  ];

  it('HEALTH-RECIPE-100: opening a SECOND recipe never shows the first one’s figures', async () => {
    // The scale answer is per recipe. Holding the previous one while this one
    // is in flight puts another dish's per-serving figure, its ingredient
    // amounts and its "one entry of N kcal" preview under this recipe's name —
    // and the Log button under all three.
    mockLoadRecipes.mockResolvedValue(two);
    const chilli = deferred<ScaledRecipe | null>();
    mockScaleRecipe.mockResolvedValueOnce(scaled());
    mockScaleRecipe.mockReturnValueOnce(chilli.promise);
    const tree = await render();

    await press(tree, 'health-recipe-open-rcp_1');
    expect(allText(byTestId(tree, 'health-recipe-per-serving')[0])).toContain('152 kcal');

    await press(tree, 'health-recipe-open-rcp_2');

    const detail = allText(byTestId(tree, 'health-recipe-detail')[0]);
    expect(detail).toContain('CHILLI');
    expect(detail).not.toContain('152');
    expect(detail).not.toContain('304');
    expect(byTestId(tree, 'health-recipe-per-serving')).toEqual([]);
    expect(allText(byTestId(tree, 'health-recipe-scale-unavailable')[0])).toBe(
      'Working out the servings…'
    );
    // No figure means no Log button: there is nothing honest to file.
    expect(byTestId(tree, 'health-recipe-log-section')).toEqual([]);

    await act(async () => {
      chilli.resolve(
        scaled({
          recipeId: 'rcp_2',
          name: 'Chilli',
          servings: 4,
          targetServings: 4,
          perServing: { calories: 500, protein: 30, carbs: 45, fat: 15 },
          totals: { calories: 2000, protein: 120, carbs: 180, fat: 60 },
        })
      );
    });
    expect(allText(byTestId(tree, 'health-recipe-per-serving')[0])).toContain('500 kcal');
  });

  it('HEALTH-RECIPE-101: tapping the open recipe again closes its card', async () => {
    mockLoadRecipes.mockResolvedValue(two);
    const tree = await render();

    await press(tree, 'health-recipe-open-rcp_1');
    expect(byTestId(tree, 'health-recipe-detail').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-open-rcp_1')[0].props.accessibilityState).toEqual({
      selected: true,
    });

    await press(tree, 'health-recipe-open-rcp_1');
    expect(byTestId(tree, 'health-recipe-detail')).toEqual([]);
    expect(byTestId(tree, 'health-recipe-open-rcp_1')[0].props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('HEALTH-RECIPE-102: cooking for FEWER re-asks the server and stops at one', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 3 })]);
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    await press(tree, 'health-recipe-scale-minus');
    expect(mockScaleRecipe).toHaveBeenLastCalledWith('rcp_1', 2);
    await press(tree, 'health-recipe-scale-minus');
    expect(mockScaleRecipe).toHaveBeenLastCalledWith('rcp_1', 1);

    // Cooking for nobody is not a portion — and the copy goes singular with it.
    expect(allText(byTestId(tree, 'health-recipe-scale-value')[0])).toBe('1 serving');
    expect(
      tree.root.find(
        (n) => n.props?.testID === 'health-recipe-scale-minus' && n.props?.accessibilityState
      ).props.accessibilityState
    ).toEqual({ disabled: true });
  });

  it('HEALTH-RECIPE-103: the ingredient amounts are restated for the head count', async () => {
    // Cooking for six is a shopping list, not a calorie count: the amounts are
    // the server's scaled quantities, and without them the stepper only moves
    // a number.
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockScaleRecipe.mockResolvedValue(
      scaled({
        targetServings: 4,
        ingredients: [
          {
            name: 'Oats',
            quantity: 160,
            unit: 'g',
            foodId: 'cf_1',
            macros: { calories: 608, protein: 20.8, carbs: 96, fat: 11.2 },
          },
          {
            name: 'Milk',
            quantity: 500,
            unit: 'ml',
            foodId: 'cf_2',
            macros: { calories: 320, protein: 17, carbs: 24, fat: 17 },
          },
        ],
      })
    );
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    expect(allText(byTestId(tree, 'health-recipe-scaled-ingredient-0')[0])).toBe(
      'Oats · 160 g · 608 kcal'
    );
    expect(allText(byTestId(tree, 'health-recipe-scaled-ingredient-1')[0])).toBe(
      'Milk · 500 ml · 320 kcal'
    );
  });

  it('HEALTH-RECIPE-114: a scale answer for a head count already stepped past is dropped', async () => {
    // The stepper moves faster than the network. Rendering the late answer
    // would label 2 servings' figures "Total for 2" under a stepper reading 3.
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const first = deferred<ScaledRecipe | null>();
    const second = deferred<ScaledRecipe | null>();
    mockScaleRecipe.mockReturnValueOnce(first.promise);
    mockScaleRecipe.mockReturnValueOnce(second.promise);
    const tree = await render();

    await press(tree, 'health-recipe-open-rcp_1');
    await press(tree, 'health-recipe-scale-plus');

    await act(async () => first.resolve(scaled({ targetServings: 2 })));
    expect(byTestId(tree, 'health-recipe-scaled-totals')).toEqual([]);
    expect(allText(byTestId(tree, 'health-recipe-scale-unavailable')[0])).toBe(
      'Working out the servings…'
    );

    await act(async () =>
      second.resolve(
        scaled({ targetServings: 3, totals: { calories: 456, protein: 15.6, carbs: 72, fat: 8.4 } })
      )
    );
    expect(allText(byTestId(tree, 'health-recipe-scaled-totals')[0])).toContain('Total for 3');
    expect(allText(byTestId(tree, 'health-recipe-scaled-totals')[0])).toContain('456 kcal');
  });
});

/* ------------------------------------------------------------------ */
/* Logging a recipe to the diary                                       */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — logging to the diary', () => {
  it('HEALTH-RECIPE-104: the log day steps back and forward, and stops at today', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    await press(tree, 'health-recipe-log-prev-day');
    expect(allText(byTestId(tree, 'health-recipe-log-day')[0])).toBe('Yesterday');

    await press(tree, 'health-recipe-log-next-day');
    expect(allText(byTestId(tree, 'health-recipe-log-day')[0])).toBe('Today');

    // Already on today: the disabled control does nothing rather than dating a
    // diary row tomorrow, which sits outside every window the app reads.
    await press(tree, 'health-recipe-log-next-day');
    expect(allText(byTestId(tree, 'health-recipe-log-day')[0])).toBe('Today');
  });

  it('HEALTH-RECIPE-105: cooking for ONE is singular everywhere it is stated', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', name: 'Porridge', servings: 1 })]);
    mockScaleRecipe.mockResolvedValue(
      scaled({
        servings: 1,
        targetServings: 1,
        totals: { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
      })
    );
    mockLogRecipe.mockResolvedValue({
      status: 'saved',
      message: null,
      logged: { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
      servings: 1,
      mealSlot: 'dinner',
    });
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    expect(allText(byTestId(tree, 'health-recipe-log-preview')[0])).toContain('for 1 serving.');
    expect(
      tree.root.find(
        (n) => n.props?.testID === 'health-recipe-log-button' && n.props?.accessibilityLabel
      ).props.accessibilityLabel
    ).toBe('Log 1 serving of Porridge to Dinner on Today');

    await press(tree, 'health-recipe-log-button');
    expect(allText(byTestId(tree, 'health-recipe-log-message')[0])).toBe(
      'Logged 1 serving of Porridge — 152 kcal — to Dinner on Today.'
    );
  });

  it('HEALTH-RECIPE-106: a saved answer with no macros never claims 0 kcal', async () => {
    // `logged` is the SERVER's figure for the row it wrote. With none, the
    // confirmation still has to say what was filed and where — but "0 kcal"
    // would be a number the diary does not contain.
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', name: 'Porridge', servings: 2 })]);
    mockLogRecipe.mockResolvedValue({
      status: 'saved',
      message: null,
      logged: null,
      servings: 2,
      mealSlot: 'lunch',
    });
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    await press(tree, 'health-recipe-log-button');
    const message = allText(byTestId(tree, 'health-recipe-log-message')[0]);
    expect(message).toBe('Logged 2 servings of Porridge — to Lunch on Today.');
    expect(message).not.toContain('kcal');
  });

  it('HEALTH-RECIPE-107: the button says it is working and cannot be pressed again', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    const write = deferred<LogRecipeResult>();
    mockLogRecipe.mockReturnValue(write.promise);
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    await press(tree, 'health-recipe-log-button');
    // A second tap here would file the same meal twice.
    expect(allText(byTestId(tree, 'health-recipe-log-button')[0])).toBe('Logging…');
    expect(byTestId(tree, 'health-recipe-log-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    await act(async () => {
      write.resolve({
        status: 'saved',
        message: null,
        logged: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
        servings: 2,
        mealSlot: 'dinner',
      });
    });
    expect(allText(byTestId(tree, 'health-recipe-log-button')[0])).toBe('Log 2 to Dinner');
    expect(byTestId(tree, 'health-recipe-log-button')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it('HEALTH-RECIPE-108: a store that THROWS becomes friendly copy, never a raw error', async () => {
    // Every refusal the store can name it names. Anything reaching the catch is
    // unnamed, and a member must not read it.
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', servings: 2 })]);
    mockLogRecipe.mockRejectedValue(new Error('Network request failed'));
    const tree = await render();
    await press(tree, 'health-recipe-open-rcp_1');

    await press(tree, 'health-recipe-log-button');

    const message = allText(byTestId(tree, 'health-recipe-log-message')[0]);
    expect(message).toBe('That did not save. Check your connection and try again.');
    expect(allText(tree.toJSON())).not.toContain('Network request failed');
    // The button comes back rather than staying stuck on "Logging…".
    expect(allText(byTestId(tree, 'health-recipe-log-button')[0])).toBe('Log 2 to Dinner');
  });
});

/* ------------------------------------------------------------------ */
/* Building and editing                                                */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — the builder', () => {
  it('HEALTH-RECIPE-109: a REFUSED save shows the store copy and keeps the form filled', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    mockCreateRecipe.mockResolvedValue({
      recipes: [],
      status: 'rejected',
      message: 'Those ingredients could not be resolved. Check the amounts and try again.',
    });
    const tree = await render();

    await type(tree, 'health-recipe-name-input', 'Porridge');
    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '80');
    await press(tree, 'health-recipe-add-ingredient');
    await press(tree, 'health-recipe-save-button');

    const message = allText(byTestId(tree, 'health-recipe-message')[0]);
    expect(message).toBe('Those ingredients could not be resolved. Check the amounts and try again.');
    expect(message).not.toMatch(/\b(4\d\d|5\d\d)\b/);
    // Nothing was stored, so nothing is cleared — the work is still there to fix.
    expect(input(tree, 'health-recipe-name-input').props.value).toBe('Porridge');
    expect(byTestId(tree, 'health-recipe-ingredient-0').length).toBe(1);
  });

  it('HEALTH-RECIPE-110: deleting clears the form only when it was THAT recipe', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const confirm = async () => {
      const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as Array<{
        text: string;
        onPress?: () => void;
      }>;
      await act(async () => buttons.find((b) => b.text === 'Delete')?.onPress?.());
    };
    mockLoadRecipes.mockResolvedValue([
      recipe({ id: 'rcp_1', name: 'Porridge' }),
      recipe({ id: 'rcp_2', name: 'Chilli' }),
    ]);
    const tree = await render();

    // Editing Porridge, deleting Chilli: the form belongs to the other recipe
    // and losing it would throw away work the delete never touched.
    await press(tree, 'health-recipe-edit-rcp_1');
    await press(tree, 'health-recipe-open-rcp_1');
    mockDeleteRecipe.mockResolvedValue({
      recipes: [recipe({ id: 'rcp_1', name: 'Porridge' })],
      status: 'saved',
      message: null,
    });
    await press(tree, 'health-recipe-delete-rcp_2');
    await confirm();

    expect(mockDeleteRecipe).toHaveBeenCalledWith('rcp_2');
    expect(input(tree, 'health-recipe-name-input').props.value).toBe('Porridge');
    expect(byTestId(tree, 'health-recipe-detail').length).toBe(1);

    // Deleting the recipe being edited takes the form with it — a "Save
    // changes" button for a row that no longer exists cannot do anything.
    mockDeleteRecipe.mockResolvedValue({ recipes: [], status: 'saved', message: null });
    await press(tree, 'health-recipe-delete-rcp_1');
    await confirm();

    expect(input(tree, 'health-recipe-name-input').props.value).toBe('');
    expect(allText(tree.toJSON())).toContain('NEW RECIPE');
    expect(byTestId(tree, 'health-recipe-detail')).toEqual([]);
    alertSpy.mockRestore();
  });

  it('HEALTH-RECIPE-111: tapping the picked food again un-picks it', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    await press(tree, 'health-recipe-food-cf_1');
    expect(byTestId(tree, 'health-recipe-food-cf_1')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'health-recipe-add-ingredient')[0].props.accessibilityState).toEqual({
      disabled: false,
    });

    await press(tree, 'health-recipe-food-cf_1');
    expect(byTestId(tree, 'health-recipe-food-cf_1')[0].props.accessibilityState).toEqual({
      selected: false,
    });
    expect(byTestId(tree, 'health-recipe-add-ingredient')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it('HEALTH-RECIPE-112: an ingredient of nothing is not an ingredient', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '0');

    expect(byTestId(tree, 'health-recipe-add-ingredient')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    await press(tree, 'health-recipe-add-ingredient');
    // A 0 g row would post a zero-quantity ingredient the Worker would refuse.
    expect(byTestId(tree, 'health-recipe-ingredient-0')).toEqual([]);
    expect(byTestId(tree, 'health-recipe-ingredients-empty').length).toBe(1);
  });

  it('HEALTH-RECIPE-113: an ingredient with no food id survives an edit round trip', async () => {
    // Recipes imported or written before the food library existed carry a bare
    // name. Editing one must not drop the line or re-point it at a food.
    mockLoadRecipes.mockResolvedValue([
      recipe({
        id: 'rcp_1',
        name: 'Stock',
        servings: 2,
        ingredients: [
          {
            name: 'Grandma’s stock',
            quantity: 200,
            unit: 'ml',
            foodId: null,
            macros: { calories: 40, protein: 2, carbs: 4, fat: 1 },
          },
        ],
      }),
    ]);
    const tree = await render();

    await press(tree, 'health-recipe-edit-rcp_1');
    expect(allText(byTestId(tree, 'health-recipe-ingredient-0')[0])).toContain(
      'Grandma’s stock · 200 ml'
    );

    await press(tree, 'health-recipe-save-button');
    expect(mockUpdateRecipe).toHaveBeenCalledWith('rcp_1', {
      name: 'Stock',
      servings: 2,
      description: undefined,
      category: null,
      preparationTime: null,
      cookingTime: null,
      imageUrl: null,
      ingredients: [{ name: 'Grandma’s stock', quantity: 200, unit: 'ml', foodId: null }],
    });
  });

  it('HEALTH-RECIPE-115: Android gets the numeric keypad, iOS the decimal pad', async () => {
    // `decimal-pad` does not exist on Android — asking for it there falls back
    // to a full keyboard, which is what a numeric field is trying to avoid.
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      const android = await render();
      expect(input(android, 'health-recipe-servings-input').props.keyboardType).toBe('numeric');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }

    const ios = await render();
    expect(input(ios, 'health-recipe-servings-input').props.keyboardType).toBe('decimal-pad');
  });
});

/* ------------------------------------------------------------------ */
/* The list row: photo/category placeholder, category badge, time      */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — the list row', () => {
  it('HEALTH-RECIPE-116: a category + time set shows both badges and the macro line', async () => {
    mockLoadRecipes.mockResolvedValue([
      recipe({
        id: 'rcp_1',
        category: 'desserts',
        preparationTime: 10,
        cookingTime: 20,
        totals: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
      }),
    ]);
    const tree = await render();

    // No auth token (the suite default) — the placeholder glyph, not an <Image>.
    expect(byTestId(tree, 'health-recipe-thumb-fallback-rcp_1').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-thumb-rcp_1')).toEqual([]);

    // `.toContain`, not `.toBe`: the badge's icon renders its own glyph
    // character as part of the same text tree, so the label is IN the string
    // rather than the whole string.
    expect(allText(byTestId(tree, 'health-recipe-category-badge-rcp_1')[0])).toContain('Desserts');
    // Prep + cook are summed for the ONE glyph the row has room for — never
    // computed nutrition, just the two stored minute counts added together.
    expect(allText(byTestId(tree, 'health-recipe-time-rcp_1')[0])).toContain('30m');
    expect(allText(byTestId(tree, 'health-recipe-macros-rcp_1')[0])).toBe('10.4P / 48C / 5.6F');
  });

  it('HEALTH-RECIPE-117: no category and no time shows neither badge, never a stray "0m"', async () => {
    mockLoadRecipes.mockResolvedValue([recipe({ id: 'rcp_1', category: null })]);
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-category-badge-rcp_1')).toEqual([]);
    expect(byTestId(tree, 'health-recipe-time-rcp_1')).toEqual([]);
    // The category-icon placeholder still renders — just the generic glyph.
    expect(byTestId(tree, 'health-recipe-thumb-fallback-rcp_1').length).toBe(1);
  });

  it('HEALTH-RECIPE-118: a stored photo renders as the thumbnail, not the category glyph', async () => {
    mockContentSource.mockReturnValue({
      uri: 'https://api.test/health/files/rcp_1_photo/content',
      headers: { Authorization: 'Bearer t' },
    });
    mockLoadRecipes.mockResolvedValue([
      recipe({ id: 'rcp_1', category: 'desserts', imageUrl: '/health/files/rcp_1_photo/content' }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-thumb-rcp_1').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-thumb-fallback-rcp_1')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The builder: category, servings & time, photo attach                */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — category, time and photo', () => {
  it('HEALTH-RECIPE-119: picking a category selects its chip and posts it on save', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-category-none')[0].props.accessibilityState).toEqual({
      selected: true,
    });

    await press(tree, 'health-recipe-category-desserts');
    expect(byTestId(tree, 'health-recipe-category-desserts')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(byTestId(tree, 'health-recipe-category-none')[0].props.accessibilityState).toEqual({
      selected: false,
    });

    await type(tree, 'health-recipe-name-input', 'Cake');
    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '80');
    await press(tree, 'health-recipe-add-ingredient');
    await press(tree, 'health-recipe-save-button');

    expect(mockCreateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'desserts' })
    );
  });

  it('HEALTH-RECIPE-120: a blank prep/cook time saves as unset, never as zero minutes', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    // Prep/cook are left blank — the donor shows "Not set", and this module's
    // parser must agree: `parseFoodAmount` alone would turn blank into 0.
    await type(tree, 'health-recipe-name-input', 'Toast');
    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '80');
    await press(tree, 'health-recipe-add-ingredient');
    await press(tree, 'health-recipe-save-button');

    expect(mockCreateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ preparationTime: null, cookingTime: null })
    );
  });

  it('HEALTH-RECIPE-121: a typed prep/cook time round-trips as a whole number', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    await type(tree, 'health-recipe-name-input', 'Stew');
    await type(tree, 'health-recipe-prep-time-input', '15');
    await type(tree, 'health-recipe-cook-time-input', '45');
    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '80');
    await press(tree, 'health-recipe-add-ingredient');
    await press(tree, 'health-recipe-save-button');

    expect(mockCreateRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ preparationTime: 15, cookingTime: 45 })
    );
  });

  it('HEALTH-RECIPE-122: editing a recipe loads its category, time and photo back into the form', async () => {
    mockLoadRecipes.mockResolvedValue([
      recipe({
        id: 'rcp_1',
        category: 'desserts',
        preparationTime: 10,
        cookingTime: 20,
        imageUrl: '/health/files/rcp_1_photo/content',
      }),
    ]);
    const tree = await render();

    await press(tree, 'health-recipe-edit-rcp_1');

    expect(byTestId(tree, 'health-recipe-category-desserts')[0].props.accessibilityState).toEqual({
      selected: true,
    });
    expect(input(tree, 'health-recipe-prep-time-input').props.value).toBe('10');
    expect(input(tree, 'health-recipe-cook-time-input').props.value).toBe('20');
    // A photo already on the recipe shows the preview, not the camera/library
    // buttons — the donor shows one OR the other, never both.
    expect(byTestId(tree, 'health-recipe-photo-preview').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-photo-sources')).toEqual([]);
  });

  it('HEALTH-RECIPE-123: camera attach uploads, shows the preview, and removing it clears the field', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    ImageCropPicker.openCamera.mockResolvedValueOnce({
      path: 'file:///tmp/recipe.jpg',
      filename: 'recipe.jpg',
      mime: 'image/jpeg',
    });
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-photo-sources').length).toBe(1);
    await press(tree, 'health-recipe-photo-camera');

    expect(mockUploadRecipePhoto).toHaveBeenCalledWith({
      uri: 'file:///tmp/recipe.jpg',
      name: 'recipe.jpg',
      mimeType: 'image/jpeg',
    });
    expect(byTestId(tree, 'health-recipe-photo-preview').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-photo-sources')).toEqual([]);

    await press(tree, 'health-recipe-photo-remove');
    expect(byTestId(tree, 'health-recipe-photo-preview')).toEqual([]);
    expect(byTestId(tree, 'health-recipe-photo-sources').length).toBe(1);

    await type(tree, 'health-recipe-name-input', 'Muffins');
    await press(tree, 'health-recipe-food-cf_1');
    await type(tree, 'health-recipe-quantity-input', '80');
    await press(tree, 'health-recipe-add-ingredient');
    await press(tree, 'health-recipe-save-button');
    // Removed before saving, so nothing is attached.
    expect(mockCreateRecipe).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: null }));
  });

  it('HEALTH-RECIPE-124: a refused upload says so and never blocks the rest of the form', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    ImageCropPicker.openPicker.mockResolvedValueOnce({
      path: 'file:///tmp/recipe.pdf',
      filename: 'recipe.pdf',
      mime: 'application/pdf',
    });
    mockUploadRecipePhoto.mockResolvedValueOnce({
      imageUrl: null,
      status: 'rejected',
      message:
        'That kind of file cannot be stored here. Photos (JPEG, PNG, WebP, HEIC), PDFs and plain text are supported.',
    });
    const tree = await render();

    await press(tree, 'health-recipe-photo-gallery');

    expect(allText(byTestId(tree, 'health-recipe-photo-message')[0])).toContain(
      'cannot be stored here'
    );
    // The form itself is untouched — a failed photo is not a failed recipe.
    expect(byTestId(tree, 'health-recipe-photo-sources').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The builder: searchable ingredient picker                           */
/* ------------------------------------------------------------------ */

describe('HealthRecipesScreen — searchable ingredient picker', () => {
  it('HEALTH-RECIPE-125: typing narrows the list to a name/brand match', async () => {
    mockLoadFoods.mockResolvedValue([
      food({ id: 'cf_1', name: 'Greek yoghurt' }),
      food({ id: 'cf_2', name: 'Oats', brand: 'Quaker' }),
      food({ id: 'cf_3', name: 'Banana' }),
    ]);
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-food-cf_1').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-food-cf_2').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-food-cf_3').length).toBe(1);

    await type(tree, 'health-recipe-ingredient-search', 'quak');

    expect(byTestId(tree, 'health-recipe-food-cf_2').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-food-cf_1')).toEqual([]);
    expect(byTestId(tree, 'health-recipe-food-cf_3')).toEqual([]);
  });

  it('HEALTH-RECIPE-126: a query that matches nothing says so instead of showing an empty list', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_1', name: 'Oats' })]);
    const tree = await render();

    await type(tree, 'health-recipe-ingredient-search', 'xyz');

    expect(byTestId(tree, 'health-recipe-food-search-empty').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-food-cf_1')).toEqual([]);
  });

  it('HEALTH-RECIPE-127: browsing an unsearched library caps the rows and says how many are hidden', async () => {
    const library = Array.from({ length: 25 }, (_, i) =>
      food({ id: `cf_${i}`, name: `Food ${String(i).padStart(2, '0')}` })
    );
    mockLoadFoods.mockResolvedValue(library);
    const tree = await render();

    expect(byTestId(tree, 'health-recipe-food-cf_0').length).toBe(1);
    expect(byTestId(tree, 'health-recipe-food-cf_24')).toEqual([]);
    expect(allText(byTestId(tree, 'health-recipe-food-search-hint')[0])).toContain(
      'Showing 20 of 25'
    );
  });
});
