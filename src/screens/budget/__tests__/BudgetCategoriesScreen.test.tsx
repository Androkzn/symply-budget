/**
 * BudgetCategoriesScreen — the "Spending Categories" screen reached from
 * Settings → Preferences. Covers: loading custom + default categories, adding a
 * custom one (icon + colour), editing it, deleting it, and toggling a built-in
 * on/off (with optimistic rollback).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({
      title,
      showBackButton,
      onBackPress,
    }: {
      title?: string;
      showBackButton?: boolean;
      onBackPress?: () => void;
    }) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        showBackButton
          ? React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' })
          : null
      ),
  };
});

const mockGetCategories = jest.fn();
const mockCreateCategory = jest.fn();
const mockDeleteCategory = jest.fn();
const mockUpdateCategory = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    getCategories: (...a: unknown[]) => mockGetCategories(...a),
    createCategory: (...a: unknown[]) => mockCreateCategory(...a),
    deleteCategory: (...a: unknown[]) => mockDeleteCategory(...a),
    updateCategory: (...a: unknown[]) => mockUpdateCategory(...a),
  },
  isCategoryNameConflict: (error: unknown) =>
    !!error && typeof error === 'object' && (error as { isConflict?: boolean }).isConflict === true,
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-consistency' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetCategory } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';
import { Spacing } from '@theme';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetCategoriesScreen } from '../BudgetCategoriesScreen';
import { PRESET_CATEGORY_COLORS } from '../budgetCategoryPresets';

// User-created (custom) category → rendered with a delete icon.
const CATEGORY: BudgetCategory = {
  id: 'cat-food',
  household_id: 'hh-consistency',
  name: 'Food',
  icon: '🍎',
  color: '#EF5350',
  sort_order: 0,
  created_at: '2026-07-01T00:00:00Z',
  is_default: false,
  hidden: false,
};

// App-seeded (predefined) category → rendered with a show/hide toggle.
const DEFAULT_CATEGORY: BudgetCategory = {
  id: 'cat-groceries',
  household_id: 'hh-consistency',
  name: 'Groceries',
  icon: '🛒',
  color: '#66BB6A',
  sort_order: 1,
  created_at: '2026-07-01T00:00:00Z',
  is_default: true,
  hidden: false,
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetCategoriesScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

const findByTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.find((n) => n.props?.testID === id);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCategories.mockResolvedValue({ categories: [CATEGORY, DEFAULT_CATEGORY] });
  mockCreateCategory.mockResolvedValue({
    category: { ...CATEGORY, id: 'cat-new', name: 'Garden', icon: '🌱', is_default: false },
  });
  mockDeleteCategory.mockResolvedValue({});
  mockUpdateCategory.mockResolvedValue({ category: { ...DEFAULT_CATEGORY, hidden: true } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('BudgetCategoriesScreen', () => {
  it('loads categories including hidden defaults', async () => {
    await renderScreen();
    expect(mockGetCategories).toHaveBeenCalledWith('hh-consistency', { includeHidden: true });
  });

  // Same words as the Settings → Preferences row that opens it, so the
  // destination confirms the tap rather than renaming it on arrival.
  it('is titled Spending Categories, matching its Settings row', async () => {
    const tree = await renderScreen();
    expect(collectRenderedText(tree)).toContain('Spending Categories');
  });

  it('renders a custom category with a delete control and a predefined one with a toggle', async () => {
    const tree = await renderScreen();
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Food'); // custom
    expect(texts).toContain('Groceries'); // predefined
    // Custom → delete icon; predefined → show/hide toggle.
    expect(findByTestID(tree, 'budget-category-delete-cat-food')).toBeTruthy();
    expect(findByTestID(tree, 'budget-category-toggle-cat-groceries')).toBeTruthy();
  });

  it('adds a new category with the default color and clears the input', async () => {
    const tree = await renderScreen();
    const nameInput = tree.root.find((n) => n.props?.placeholder === 'New category name');
    act(() => nameInput.props.onChangeText('Garden'));
    await act(async () => {
      findByTestID(tree, 'budget-category-add').props.onPress();
      await Promise.resolve();
    });
    // The icon rides along with the name and colour — a custom category keeps
    // whatever glyph its owner picked (default: the first in the palette).
    expect(mockCreateCategory).toHaveBeenCalledWith('hh-consistency', {
      name: 'Garden',
      color: '#EF5350',
      icon: 'tag',
    });
    expect(collectRenderedText(tree)).toContain('Garden');
  });

  it('picks a color from the swatch row before adding', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-category-color-#26A69A').props.onPress());

    const nameInput = tree.root.find((n) => n.props?.placeholder === 'New category name');
    act(() => nameInput.props.onChangeText('Garden'));
    await act(async () => {
      findByTestID(tree, 'budget-category-add').props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateCategory).toHaveBeenCalledWith('hh-consistency', {
      name: 'Garden',
      color: '#26A69A',
      icon: 'tag',
    });
  });

  it('picks a brand-kit glyph from the icon rail before adding', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-category-icon-leaf').props.onPress());

    const nameInput = tree.root.find((n) => n.props?.placeholder === 'New category name');
    act(() => nameInput.props.onChangeText('Dog Walking'));
    await act(async () => {
      findByTestID(tree, 'budget-category-add').props.onPress();
      await Promise.resolve();
    });
    expect(mockCreateCategory).toHaveBeenCalledWith('hh-consistency', {
      name: 'Dog Walking',
      color: '#EF5350',
      icon: 'leaf',
    });
  });

  /**
   * Both pickers sit open in the editor card — the old pair of identical colour
   * chips gave no hint that one opened colours and the other glyphs.
   */
  it('shows the colour swatches and the icon rail without tapping anything', async () => {
    const tree = await renderScreen();
    // findAll matches the composite AND its host node, so presence is >0 rather
    // than exactly 1 — only absence is a clean length check.
    expect(
      tree.root.findAll((n) => n.props?.testID === 'budget-category-color-grid').length,
    ).toBeGreaterThan(0);
    expect(
      tree.root.findAll((n) => n.props?.testID === 'budget-category-icon-grid').length,
    ).toBeGreaterThan(0);
    // The preview shows what the saved row will look like.
    expect(findByTestID(tree, 'budget-category-preview')).toBeTruthy();
  });

  /**
   * Both palettes outgrew what fits across the card. Wrapped rows would push
   * the Add button — and the whole default list — below the fold, so each has
   * to scroll sideways in place.
   */
  it('scrolls both pickers sideways rather than wrapping them', async () => {
    const tree = await renderScreen();
    for (const id of ['budget-category-color-grid', 'budget-category-icon-grid']) {
      expect(findByTestID(tree, id).props.horizontal).toBe(true);
    }
    // Every swatch is reachable on the rail, including the tones past the
    // original ten that used to be the whole palette.
    for (const swatch of PRESET_CATEGORY_COLORS) {
      expect(findByTestID(tree, `budget-category-color-${swatch}`)).toBeTruthy();
    }
    expect(PRESET_CATEGORY_COLORS.length).toBeGreaterThan(10);
  });

  it('edits a custom category name, colour and icon', async () => {
    mockUpdateCategory.mockResolvedValueOnce({
      category: { ...CATEGORY, name: 'Groceries Run', color: '#26A69A', icon: 'marketplace' },
    });
    const tree = await renderScreen();

    // Tapping edit loads the row into the shared form; Add becomes Save.
    act(() => findByTestID(tree, 'budget-category-edit-cat-food').props.onPress());
    expect(findByTestID(tree, 'budget-category-save')).toBeTruthy();
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-category-add')).toHaveLength(0);

    const nameInput = tree.root.find((n) => n.props?.placeholder === 'Category name');
    act(() => nameInput.props.onChangeText('Groceries Run'));
    act(() => findByTestID(tree, 'budget-category-color-#26A69A').props.onPress());
    act(() => findByTestID(tree, 'budget-category-icon-marketplace').props.onPress());

    await act(async () => {
      findByTestID(tree, 'budget-category-save').props.onPress();
      await Promise.resolve();
    });

    expect(mockUpdateCategory).toHaveBeenCalledWith('hh-consistency', 'cat-food', {
      name: 'Groceries Run',
      color: '#26A69A',
      icon: 'marketplace',
    });
    // Saving returns the form to "add" mode so the next tap is not an edit.
    expect(findByTestID(tree, 'budget-category-add')).toBeTruthy();
    expect(collectRenderedText(tree)).toContain('Groceries Run');
  });

  /**
   * The editor sits below the custom list, which is unbounded — a household
   * that predates the seed carries dozens of custom rows. Tapping the pencil on
   * a row near the top used to load a form two screens further down, where
   * nothing visibly changed. Starting an edit must bring the editor on screen.
   */
  it('scrolls the editor into view when an edit starts', async () => {
    const tree = await renderScreen();
    // The ScrollView class instance is the one node with a real `scrollTo`;
    // its host node's instance is null under react-test-renderer.
    const scrollView = tree.root.find(
      (n) => n.props?.testID === 'budget-categories-scroll' && typeof n.instance?.scrollTo === 'function',
    );
    const scrollTo = jest.spyOn(scrollView.instance, 'scrollTo').mockImplementation(() => {});

    // Lay the editor section out where a long custom list would put it.
    act(() =>
      findByTestID(tree, 'budget-category-editor-section').props.onLayout({
        nativeEvent: { layout: { x: 0, y: 1234, width: 390, height: 420 } },
      }),
    );
    act(() => findByTestID(tree, 'budget-category-edit-cat-food').props.onPress());

    // Lands on the section heading (one gutter above the card), never mid-card.
    expect(scrollTo).toHaveBeenCalledWith({ y: 1234 - Spacing.base, animated: true });
    expect(findByTestID(tree, 'budget-category-save')).toBeTruthy();
  });

  it('cancelling an edit restores the add form without saving', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-category-edit-cat-food').props.onPress());
    act(() => findByTestID(tree, 'budget-category-edit-cancel').props.onPress());

    expect(mockUpdateCategory).not.toHaveBeenCalled();
    expect(findByTestID(tree, 'budget-category-add')).toBeTruthy();
  });

  it('alerts with a specific message when the category name is already taken', async () => {
    mockCreateCategory.mockRejectedValue({ isConflict: true });
    const tree = await renderScreen();
    const nameInput = tree.root.find((n) => n.props?.placeholder === 'New category name');
    act(() => nameInput.props.onChangeText('Groceries'));
    await act(async () => {
      findByTestID(tree, 'budget-category-add').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Category exists',
      'A category named "Groceries" already exists.'
    );
  });

  it('confirms and deletes a custom category', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-category-delete-cat-food').props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete category');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });
    expect(mockDeleteCategory).toHaveBeenCalledWith('hh-consistency', 'cat-food');
    expect(collectRenderedText(tree)).not.toContain('Food');
  });

  it('toggles a predefined category off (hides it) via the switch', async () => {
    const tree = await renderScreen();
    await act(async () => {
      findByTestID(tree, 'budget-category-toggle-cat-groceries').props.onValueChange(false);
      await Promise.resolve();
    });
    expect(mockUpdateCategory).toHaveBeenCalledWith('hh-consistency', 'cat-groceries', {
      hidden: true,
    });
  });

  it('reverts the toggle and alerts when hiding a category fails', async () => {
    mockUpdateCategory.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const toggle = () => findByTestID(tree, 'budget-category-toggle-cat-groceries');
    expect(toggle().props.value).toBe(true);
    await act(async () => {
      toggle().props.onValueChange(false);
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not update this category.');
    // Optimistic flip is rolled back → switch is on again.
    expect(toggle().props.value).toBe(true);
  });

  it('alerts when creating a category fails', async () => {
    mockCreateCategory.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    const nameInput = tree.root.find((n) => n.props?.placeholder === 'New category name');
    act(() => nameInput.props.onChangeText('Garden'));
    await act(async () => {
      findByTestID(tree, 'budget-category-add').props.onPress();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not create this category.');
  });

  it('alerts when deleting a category fails', async () => {
    mockDeleteCategory.mockRejectedValue(new Error('boom'));
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'budget-category-delete-cat-food').props.onPress());
    const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Delete category');
    const buttons = call![2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete')!.onPress?.();
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Could not delete this category.');
    // Row remains since the delete failed.
    expect(collectRenderedText(tree)).toContain('Food');
  });

  it('goes back from the header back button', async () => {
    const tree = await renderScreen();
    act(() => findByTestID(tree, 'nav-back-button').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
  });
});
