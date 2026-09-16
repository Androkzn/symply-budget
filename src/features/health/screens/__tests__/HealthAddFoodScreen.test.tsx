/**
 * Symply Health "Add Food" (donor `AddNutritionEntrySheet`) — the unified
 * Quick Add rail + Search / Library / Recipes surface.
 *
 * Renders the REAL screen through <ThemeProvider>. Every storage-backed
 * function this screen calls is mocked — `logFoodToDiary`, `logRecipeToDiary`,
 * `logScannedFoodsToDiary`'s cousins are already pinned in their own store
 * suites, so this file is about WIRING: which action calls which function
 * with which arguments, and what the screen shows in response.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  importExternalFood,
  loadFoodSuggestions,
  loadFoods,
  loadRecipes,
  logExternalFoodToDiary,
  logFoodToDiary,
  logRecipeToDiary,
  scaleRecipe,
  searchFoods,
  type ExternalFoodItem,
  type FoodItem,
  type FoodSearchOutcome,
  type RecipeItem,
} from '../../healthFoodStorage';
import { addMealEntry } from '../../healthNutritionStorage';
import { HealthAddFoodScreen } from '../HealthAddFoodScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthFoodStorage', () => ({
  ...jest.requireActual('../../healthFoodStorage'),
  loadFoods: jest.fn(),
  loadRecipes: jest.fn(),
  loadFoodSuggestions: jest.fn(),
  searchFoods: jest.fn(),
  logFoodToDiary: jest.fn(),
  logExternalFoodToDiary: jest.fn(),
  importExternalFood: jest.fn(),
  logRecipeToDiary: jest.fn(),
  scaleRecipe: jest.fn(),
}));

jest.mock('../../healthNutritionStorage', () => ({
  ...jest.requireActual('../../healthNutritionStorage'),
  addMealEntry: jest.fn(),
}));

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
}));

const mockLoadFoods = loadFoods as jest.Mock;
const mockLoadRecipes = loadRecipes as jest.Mock;
const mockLoadFoodSuggestions = loadFoodSuggestions as jest.Mock;
const mockSearchFoods = searchFoods as jest.Mock;
const mockLogFoodToDiary = logFoodToDiary as jest.Mock;
const mockLogExternalFoodToDiary = logExternalFoodToDiary as jest.Mock;
const mockImportExternalFood = importExternalFood as jest.Mock;
const mockLogRecipeToDiary = logRecipeToDiary as jest.Mock;
const mockScaleRecipe = scaleRecipe as jest.Mock;
const mockAddMealEntry = addMealEntry as jest.Mock;

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: over.id ?? 'cf_1',
    name: over.name ?? 'Oats',
    brand: over.brand ?? null,
    portion: over.portion ?? 100,
    unit: over.unit ?? 'g',
    serving: over.serving ?? { calories: 380, protein: 13, carbs: 60, fat: 7 },
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 3,
    lastUsedAt: over.lastUsedAt ?? '2026-07-12T08:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-12T08:00:00.000Z',
  };
}

function externalFood(over: Partial<ExternalFoodItem> = {}): ExternalFoodItem {
  return {
    id: over.id ?? 'fatsecret:1',
    provider: over.provider ?? 'fatsecret',
    providerFoodId: over.providerFoodId ?? '1',
    name: over.name ?? 'Greek Yoghurt',
    brand: over.brand ?? 'Symply Dairy',
    portion: over.portion ?? 170,
    unit: over.unit ?? 'g',
    servingId: over.servingId ?? null,
    servingDescription: over.servingDescription ?? '1 pot (170 g)',
    serving: over.serving ?? { calories: 150, protein: 15, carbs: 12, fat: 4 },
    per100: over.per100 ?? { calories: 88, protein: 9, carbs: 7, fat: 2.4 },
    servings: over.servings ?? [],
  };
}

function recipe(over: Partial<RecipeItem> = {}): RecipeItem {
  return {
    id: over.id ?? 'rcp_1',
    name: over.name ?? 'Porridge',
    description: over.description ?? null,
    servings: over.servings ?? 2,
    totals: over.totals ?? { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
    ingredients: over.ingredients ?? [],
    isFavorite: over.isFavorite ?? false,
    useCount: over.useCount ?? 0,
    category: over.category ?? null,
    preparationTime: over.preparationTime ?? null,
    cookingTime: over.cookingTime ?? null,
    imageUrl: over.imageUrl ?? null,
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

const EMPTY_SEARCH: FoodSearchOutcome = { library: [], external: [], providerNotice: null, offline: false };

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthAddFoodScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function press(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return act(async () => {
    tree.root.findByProps({ testID }).props.onPress();
  });
}

/** See `HealthScanReview.test.tsx` for why this filters on the host type. */
function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance | string) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as never);
  };
  walk(tree.root);
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockLoadFoods.mockResolvedValue([food()]);
  mockLoadRecipes.mockResolvedValue([recipe()]);
  mockLoadFoodSuggestions.mockResolvedValue(null);
  mockSearchFoods.mockResolvedValue(EMPTY_SEARCH);
  mockAddMealEntry.mockResolvedValue([]);
});

describe('HealthAddFoodScreen — Quick Add rail', () => {
  it('HEALTH-ADDFOOD-001: Barcode is a clearly-labelled "coming soon", and navigates nowhere', async () => {
    const tree = await render();
    await press(tree, 'health-add-food-quick-barcode');
    expect(mockPush).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('coming soon');
  });

  it('HEALTH-ADDFOOD-002: Label opens the scanner in label mode', async () => {
    const tree = await render();
    await press(tree, 'health-add-food-quick-label');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/health-scan', params: { mode: 'label' } });
  });

  it('HEALTH-ADDFOOD-003: Photo AND Scale both open the scanner in meal mode — the backend folds a scale reading into that same path', async () => {
    const tree = await render();
    await press(tree, 'health-add-food-quick-photo');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/health-scan', params: { mode: 'meal' } });
    await press(tree, 'health-add-food-quick-scale');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/health-scan', params: { mode: 'meal' } });
  });

  it('HEALTH-ADDFOOD-004: Manual toggles the manual-entry form open and closed', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'health-manual-food-form' })).toHaveLength(0);

    await press(tree, 'health-add-food-quick-manual');
    expect(tree.root.findAllByProps({ testID: 'health-manual-food-form' }).length).toBeGreaterThan(0);

    await press(tree, 'health-add-food-quick-manual');
    expect(tree.root.findAllByProps({ testID: 'health-manual-food-form' })).toHaveLength(0);
  });

  it('HEALTH-ADDFOOD-005: a manual save closes the form and confirms by name and meal', async () => {
    mockAddMealEntry.mockResolvedValue([]);
    const tree = await render();
    await press(tree, 'health-add-food-quick-manual');

    act(() => input(tree, 'health-manual-food-form-name').props.onChangeText('Toast'));
    act(() => input(tree, 'health-manual-food-form-calories').props.onChangeText('150'));
    await press(tree, 'health-manual-food-form-save');

    expect(mockAddMealEntry).toHaveBeenCalledWith(expect.objectContaining({ name: 'Toast' }));
    expect(tree.root.findAllByProps({ testID: 'health-manual-food-form' })).toHaveLength(0);
    expect(textOf(tree)).toContain('Toast was added to');
  });
});

describe('HealthAddFoodScreen — meal slot', () => {
  it('HEALTH-ADDFOOD-006: defaults to the SERVER-suggested slot when no route param is given', async () => {
    mockLoadFoodSuggestions.mockResolvedValue({
      timeOfDay: 'evening',
      mealSlot: 'dinner',
      suggestions: [],
    });
    const tree = await render();
    expect(
      tree.root.findByProps({ testID: 'health-add-food-slot-dinner' }).props.accessibilityState.selected
    ).toBe(true);
  });

  it('HEALTH-ADDFOOD-007: an explicit `slot` route param wins over the server suggestion', async () => {
    mockParams = { slot: 'breakfast' };
    const tree = await render();
    expect(
      tree.root.findByProps({ testID: 'health-add-food-slot-breakfast' }).props.accessibilityState
        .selected
    ).toBe(true);
    // The suggestion call is skipped entirely once the caller already named a slot.
    expect(mockLoadFoodSuggestions).not.toHaveBeenCalled();
  });
});

describe('HealthAddFoodScreen — Search tab', () => {
  it('HEALTH-ADDFOOD-008: Search is the default tab, and typing a query searches library + database', async () => {
    const tree = await render();
    expect(
      tree.root.findByProps({ testID: 'health-add-food-tab-search' }).props.accessibilityState.selected
    ).toBe(true);

    mockSearchFoods.mockResolvedValue({
      library: [food({ id: 'cf_2', name: 'Yoghurt' })],
      external: [externalFood()],
      providerNotice: null,
      offline: false,
    });
    await act(async () => {
      input(tree, 'health-add-food-search-input').props.onChangeText('yog');
    });

    expect(mockSearchFoods).toHaveBeenCalledWith('yog');
    expect(tree.root.findByProps({ testID: 'health-add-food-search-food-cf_2' })).toBeTruthy();
    expect(
      tree.root.findByProps({ testID: 'health-add-food-search-external-1' })
    ).toBeTruthy();
  });

  it('HEALTH-ADDFOOD-009: Add on a library search result logs to the picked slot', async () => {
    mockParams = { slot: 'lunch' };
    mockLogFoodToDiary.mockResolvedValue({
      foods: [],
      status: 'saved',
      message: null,
      logged: { calories: 380, protein: 13, carbs: 60, fat: 7 },
      mealSlot: 'lunch',
    });
    mockSearchFoods.mockResolvedValue({
      library: [food({ id: 'cf_2', name: 'Yoghurt' })],
      external: [],
      providerNotice: null,
      offline: false,
    });
    const tree = await render();
    await act(async () => {
      input(tree, 'health-add-food-search-input').props.onChangeText('yog');
    });
    await press(tree, 'health-add-food-search-food-cf_2-log');

    expect(mockLogFoodToDiary).toHaveBeenCalledWith('cf_2', { mealSlot: 'lunch' });
    expect(textOf(tree)).toContain('380 kcal to Lunch');
  });

  it('HEALTH-ADDFOOD-010: Add on an external-database result imports AND logs it', async () => {
    mockLogExternalFoodToDiary.mockResolvedValue({
      foods: [food()],
      status: 'saved',
      message: null,
      logged: { calories: 150, protein: 15, carbs: 12, fat: 4 },
      mealSlot: 'snacks',
      created: true,
    });
    mockSearchFoods.mockResolvedValue({
      library: [],
      external: [externalFood()],
      providerNotice: null,
      offline: false,
    });
    const tree = await render();
    await act(async () => {
      input(tree, 'health-add-food-search-input').props.onChangeText('yog');
    });
    await press(tree, 'health-add-food-search-external-1-log');

    expect(mockLogExternalFoodToDiary).toHaveBeenCalledWith(
      expect.objectContaining({ providerFoodId: '1' }),
      { mealSlot: 'snacks' }
    );
  });

  it('HEALTH-ADDFOOD-010B: Save on an external result imports it WITHOUT logging anything', async () => {
    mockImportExternalFood.mockResolvedValue({
      foods: [food()],
      status: 'saved',
      message: null,
      food: food({ id: 'cf_new' }),
      created: true,
    });
    mockSearchFoods.mockResolvedValue({
      library: [],
      external: [externalFood()],
      providerNotice: null,
      offline: false,
    });
    const tree = await render();
    await act(async () => {
      input(tree, 'health-add-food-search-input').props.onChangeText('yog');
    });
    await press(tree, 'health-add-food-search-external-1-save');

    expect(mockImportExternalFood).toHaveBeenCalledWith(expect.objectContaining({ providerFoodId: '1' }));
    expect(mockLogExternalFoodToDiary).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Saved "Greek Yoghurt" to your foods.');
  });
});

describe('HealthAddFoodScreen — Library tab', () => {
  it('HEALTH-ADDFOOD-011: shows the library sorted by most used, and "+" hands off to the full library screen', async () => {
    mockLoadFoods.mockResolvedValue([food({ id: 'cf_9', name: 'Rice' })]);
    const tree = await render();
    await press(tree, 'health-add-food-tab-library');

    expect(mockLoadFoods).toHaveBeenCalledWith('most-used');
    expect(tree.root.findByProps({ testID: 'health-add-food-library-food-cf_9' })).toBeTruthy();

    await press(tree, 'health-add-food-library-new');
    expect(mockPush).toHaveBeenCalledWith('/health-food');
  });

  it('HEALTH-ADDFOOD-012: an empty library says so rather than showing nothing', async () => {
    mockLoadFoods.mockResolvedValue([]);
    const tree = await render();
    await press(tree, 'health-add-food-tab-library');
    expect(tree.root.findByProps({ testID: 'health-add-food-library-empty' })).toBeTruthy();
  });
});

describe('HealthAddFoodScreen — Recipes tab', () => {
  it('HEALTH-ADDFOOD-013: shows the recipe count, and "+" hands off to the full recipes screen', async () => {
    mockLoadRecipes.mockResolvedValue([recipe(), recipe({ id: 'rcp_2', name: 'Chilli' })]);
    const tree = await render();
    await press(tree, 'health-add-food-tab-recipes');

    expect(tree.root.findByProps({ testID: 'health-add-food-recipe-count' }).props.children).toEqual([
      2,
      ' ',
      'recipes',
    ]);

    await press(tree, 'health-add-food-recipes-new');
    expect(mockPush).toHaveBeenCalledWith('/health-recipes');
  });

  it('HEALTH-ADDFOOD-014: opening a recipe asks the server to scale it, and Log writes the server\'s own figure', async () => {
    mockParams = { slot: 'dinner' };
    mockScaleRecipe.mockResolvedValue({
      recipeId: 'rcp_1',
      name: 'Porridge',
      servings: 2,
      targetServings: 2,
      perServing: { calories: 152, protein: 5.2, carbs: 24, fat: 2.8 },
      totals: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
      ingredients: [],
    });
    mockLogRecipeToDiary.mockResolvedValue({
      status: 'saved',
      message: null,
      logged: { calories: 304, protein: 10.4, carbs: 48, fat: 5.6 },
      servings: 2,
      mealSlot: 'dinner',
    });
    const tree = await render();
    await press(tree, 'health-add-food-tab-recipes');
    await press(tree, 'health-add-food-recipe-rcp_1-toggle');

    expect(mockScaleRecipe).toHaveBeenCalledWith('rcp_1', 2);

    await press(tree, 'health-add-food-recipe-rcp_1-log');
    expect(mockLogRecipeToDiary).toHaveBeenCalledWith('rcp_1', { servings: 2, mealSlot: 'dinner' });
    expect(textOf(tree)).toContain('304 kcal to Dinner');
  });
});
