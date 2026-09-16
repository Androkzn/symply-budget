/**
 * Symply Health — Fridge SCREEN: every control the existing screen suite drives
 * once, driven to its edges.
 *
 * `screens/__tests__/HealthFridgeScreen.test.tsx` proves the primary path (load
 * → group → add → edit → favourite → delete). This file owns the combinations
 * and the ends:
 *
 *  - the filter segments CROSSED with the search needle, on the screen rather
 *    than in `viewFridge` — the screen takes a different route for `expiring`
 *    (it filters the SERVER's window, not the full list), and that branch has
 *    no other test;
 *  - all ten unit chips and all ten category chips: each selectable, exactly one
 *    selected at a time, and the selection reaching the write;
 *  - the star flipped BOTH ways from a row, and what that does to the Favourites
 *    view the user is standing in;
 *  - removing the LAST item, which is the only way the empty copy changes from
 *    "nothing matches" to "your fridge is empty";
 *  - the quantity field's sanitiser as the user actually meets it (keystrokes),
 *    including the two inputs that silently disable Save.
 *
 * Only the storage-backed async functions are mocked; the pure helpers stay
 * real, so what is asserted is the SCREEN's use of them.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  createFridgeItem,
  deleteFridgeItem,
  expiringWithin,
  FRIDGE_CATEGORIES,
  FRIDGE_UNITS,
  loadExpiringSoon,
  loadFridge,
  setFridgeFavorite,
  updateFridgeItem,
  type FridgeItem,
  type FridgeWriteResult,
} from '../../healthFridgeStorage';
import { HealthFridgeScreen } from '../../screens/HealthFridgeScreen';

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
    // The two shared primitives the P5 fridge pulls in. Both own their own
    // suites; stubbing them keeps this file about the FRIDGE. The stub keeps
    // the real per-tile testID contract (`${testIDPrefix}-${source}`) so a
    // renamed prefix still fails here.
    ProcessingOverlay: ({ visible, testID }: { visible?: boolean; testID?: string }) =>
      visible ? ReactMock.createElement(View, { testID }) : null,
    ScanImportSources: (props: Record<string, unknown>) =>
      ReactMock.createElement(
        View,
        { testID: `${props.testIDPrefix}-sources` },
        ...(['camera', 'gallery', 'file', 'drive'] as const).map((key) =>
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

jest.mock('@components/cloud-storage', () => ({ CloudFilePicker: () => null }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));

jest.mock('../../healthFridgeStorage', () => {
  const actual = jest.requireActual('../../healthFridgeStorage');
  return {
    ...actual,
    loadFridge: jest.fn(),
    loadExpiringSoon: jest.fn(),
    createFridgeItem: jest.fn(),
    updateFridgeItem: jest.fn(),
    setFridgeFavorite: jest.fn(),
    deleteFridgeItem: jest.fn(),
  };
});

const mockLoadFridge = loadFridge as jest.Mock;
const mockLoadExpiringSoon = loadExpiringSoon as jest.Mock;
const mockCreateFridgeItem = createFridgeItem as jest.Mock;
const mockUpdateFridgeItem = updateFridgeItem as jest.Mock;
const mockSetFridgeFavorite = setFridgeFavorite as jest.Mock;
const mockDeleteFridgeItem = deleteFridgeItem as jest.Mock;

// Fixed local noon: `todayDateKey()` === '2026-07-13' in every timezone.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';
const ISO = '2026-07-13T08:00:00.000Z';

function item(over: Partial<FridgeItem> = {}): FridgeItem {
  return {
    id: 'fr_1',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    category: 'Dairy',
    expiryDate: '2026-07-15',
    isFavorite: false,
    notes: '',
    source: 'manual',
    nutrition: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...over,
  };
}

function saved(items: FridgeItem[]): FridgeWriteResult {
  return { items, status: 'saved', message: null };
}

/** Seed both reads the screen performs, with a window the server could return. */
function givenFridge(items: FridgeItem[]) {
  mockLoadFridge.mockResolvedValue(items);
  mockLoadExpiringSoon.mockResolvedValue(expiringWithin(items, 7, TODAY));
}

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

/** Every chip in a row that currently reports itself as the selected one. */
function selectedChips(tree: ReactTestRenderer.ReactTestRenderer, prefix: string): string[] {
  return tree.root
    .findAll((n) => typeof n.type === 'string' && String(n.props?.testID ?? '').startsWith(prefix))
    .filter((n) => n.props?.accessibilityState?.selected === true)
    .map((n) => String(n.props.testID).slice(prefix.length));
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

  givenFridge([]);
  mockCreateFridgeItem.mockResolvedValue(saved([]));
  mockUpdateFridgeItem.mockResolvedValue(saved([]));
  mockSetFridgeFavorite.mockResolvedValue(saved([]));
  mockDeleteFridgeItem.mockResolvedValue(saved([]));
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Filters × search, on the screen                                     */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen — filter and search combined', () => {
  /** Five rows: one per urgency, two of them starred, three categories. */
  const stock = [
    item({ id: 'gone', name: 'Yoghurt', category: 'Dairy', expiryDate: '2026-07-09' }),
    item({
      id: 'today',
      name: 'Fish pie',
      category: 'Frozen',
      expiryDate: TODAY,
      isFavorite: true,
    }),
    item({ id: 'week', name: 'Bread', category: 'Grains', expiryDate: '2026-07-18' }),
    item({
      id: 'later',
      name: 'Rice',
      category: 'Grains',
      expiryDate: '2026-12-01',
      isFavorite: true,
    }),
    item({ id: 'undated', name: 'Salt', category: 'Condiments', expiryDate: null }),
  ];

  const shown = (tree: ReactTestRenderer.ReactTestRenderer) =>
    stock.filter((s) => byTestId(tree, `health-fridge-item-${s.id}`).length === 1).map((s) => s.id);

  it('HEALTH-FRIDGE-232: searching inside Expiring narrows the SERVER window, never widens it', async () => {
    // The `expiring` branch of the screen filters `expiring` (what the deployed
    // route returned) rather than `items`. It is a separate code path from every
    // other filter, and the filter note printed above the list — "Items with no
    // date are not in this view" — is only true if a needle cannot reach past it.
    givenFridge(stock);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-filter-expiring');
    expect(shown(tree)).toEqual(['gone', 'today', 'week']);

    type(tree, 'health-fridge-search-input', 'grains');
    expect(shown(tree)).toEqual(['week']);

    // `Rice` is Grains as well, but it is outside the window. A needle must not
    // pull it back in, and neither may the undated row.
    type(tree, 'health-fridge-search-input', 'rice');
    expect(shown(tree)).toEqual([]);
    type(tree, 'health-fridge-search-input', 'salt');
    expect(shown(tree)).toEqual([]);
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
      'Nothing in your fridge matches that search.'
    );

    // …and the very same needle on All does find it, which is what makes the
    // negative above about the FILTER rather than about the search.
    press(tree, 'health-fridge-filter-all');
    expect(shown(tree)).toEqual(['undated']);
  });

  it('HEALTH-FRIDGE-233: searching inside Favourites cannot resurrect an unstarred row', async () => {
    givenFridge(stock);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-filter-favorites');
    expect(shown(tree)).toEqual(['today', 'later']);

    type(tree, 'health-fridge-search-input', 'grains');
    expect(shown(tree)).toEqual(['later']);
    // Bread is Grains and NOT starred.
    type(tree, 'health-fridge-search-input', 'bread');
    expect(shown(tree)).toEqual([]);
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
      'Nothing in your fridge matches that search.'
    );
  });

  it('HEALTH-FRIDGE-234: switching filters keeps the needle, and each empty state names its own cause', async () => {
    // The needle is screen state, not filter state, so it survives the switch —
    // and each of the three views has to explain its own emptiness rather than
    // showing the same "nothing here" that reads as data loss.
    givenFridge(stock);
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-search-input', 'zzqqxx');
    expect(input(tree, 'health-fridge-search-input').props.value).toBe('zzqqxx');
    for (const filter of ['all', 'expiring', 'favorites']) {
      press(tree, `health-fridge-filter-${filter}`);
      expect(input(tree, 'health-fridge-search-input').props.value).toBe('zzqqxx');
      // A search miss is a search miss under every filter — naming the FILTER
      // here would blame the wrong control.
      expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
        'Nothing in your fridge matches that search.'
      );
    }

    press(tree, 'health-fridge-search-clear');
    press(tree, 'health-fridge-filter-favorites');
    expect(shown(tree)).toEqual(['today', 'later']);
  });

  it('HEALTH-FRIDGE-235: the active filter is announced, and only one is active at a time', async () => {
    // `accessibilityState.selected` is what VoiceOver reads and what the Maestro
    // flows assert; a segmented control with two selected segments is a lie in
    // both directions.
    givenFridge(stock);
    const tree = await render(<HealthFridgeScreen />);

    const active = () =>
      ['all', 'expiring', 'favorites'].filter(
        (f) => byTestId(tree, `health-fridge-filter-${f}`)[0].props.accessibilityState.selected
      );
    expect(active()).toEqual(['all']);
    press(tree, 'health-fridge-filter-expiring');
    expect(active()).toEqual(['expiring']);
    press(tree, 'health-fridge-filter-favorites');
    expect(active()).toEqual(['favorites']);
    press(tree, 'health-fridge-filter-all');
    expect(active()).toEqual(['all']);
  });

  it('HEALTH-FRIDGE-236: the filter note appears only under Expiring', async () => {
    // It describes a rule that applies to exactly one view. Leaving it up under
    // All would claim undated items are hidden while they are on screen.
    givenFridge(stock);
    const tree = await render(<HealthFridgeScreen />);

    expect(byTestId(tree, 'health-fridge-filter-note').length).toBe(0);
    press(tree, 'health-fridge-filter-expiring');
    expect(allText(byTestId(tree, 'health-fridge-filter-note')[0])).toBe(
      'Dated on or before 2026-07-20, expired stock first. Items with no date are not in this view.'
    );
    press(tree, 'health-fridge-filter-favorites');
    expect(byTestId(tree, 'health-fridge-filter-note').length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* The chip rows                                                       */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen — unit and category chips', () => {
  it('HEALTH-FRIDGE-237: every one of the ten units selects, deselects the last, and reaches the write', async () => {
    // Ten chips, each a `Pressable` with its own testID. Walking all ten is the
    // only way to catch a chip whose handler closes over the wrong value — a
    // bug that would look fine for `pc` and mislabel every other row.
    const tree = await render(<HealthFridgeScreen />);
    type(tree, 'health-fridge-name-input', 'Anything');

    for (const unit of FRIDGE_UNITS) {
      press(tree, `health-fridge-unit-${unit}`);
      expect(selectedChips(tree, 'health-fridge-unit-')).toEqual([unit]);
    }

    // The last selection is what the save actually sends.
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ unit: FRIDGE_UNITS[FRIDGE_UNITS.length - 1] })
    );
  });

  it('HEALTH-FRIDGE-238: every one of the ten categories selects and reaches the write', async () => {
    const tree = await render(<HealthFridgeScreen />);
    type(tree, 'health-fridge-name-input', 'Anything');

    for (const category of FRIDGE_CATEGORIES) {
      press(tree, `health-fridge-category-${category}`);
      expect(selectedChips(tree, 'health-fridge-category-')).toEqual([category]);
    }

    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ category: FRIDGE_CATEGORIES[FRIDGE_CATEGORIES.length - 1] })
    );
  });

  it('HEALTH-FRIDGE-239: the form opens on the documented defaults', async () => {
    // `pc` and `Uncategorized` are what an item saved without touching a chip
    // gets. They are asserted through the SELECTION rather than the constants so
    // that a default changed in the store but not rendered is still caught.
    const tree = await render(<HealthFridgeScreen />);

    expect(selectedChips(tree, 'health-fridge-unit-')).toEqual(['pc']);
    expect(selectedChips(tree, 'health-fridge-category-')).toEqual(['Uncategorized']);

    type(tree, 'health-fridge-name-input', 'Bare minimum');
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith({
      name: 'Bare minimum',
      quantity: null,
      unit: 'pc',
      category: 'Uncategorized',
      expiryDate: null,
      notes: '',
      isFavorite: false,
    });
  });

  it('HEALTH-FRIDGE-240: the 14-day and 30-day picks file an item under Later, with an absolute date', async () => {
    // `later` is the one bucket the Maestro flow does not stock, and the only
    // one whose row label is an absolute date rather than a countdown.
    givenFridge([item({ id: 'far', name: 'Rice', expiryDate: '2026-08-12' })]);
    const tree = await render(<HealthFridgeScreen />);

    expect(byTestId(tree, 'health-fridge-group-later').length).toBe(1);
    expect(allText(byTestId(tree, 'health-fridge-expiry-label-far')[0])).toBe('Expires 2026-08-12');
    expect(allText(byTestId(tree, 'health-fridge-group-later')[0])).toContain(
      'Dated more than 7 days out.'
    );

    press(tree, 'health-fridge-expiry-14d');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('2026-07-27');
    press(tree, 'health-fridge-expiry-30d');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('2026-08-12');

    type(tree, 'health-fridge-name-input', 'More rice');
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ expiryDate: '2026-08-12' })
    );
  });
});

/* ------------------------------------------------------------------ */
/* Quantity, as it is actually typed                                   */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen — the quantity field', () => {
  it('HEALTH-FRIDGE-241: the field cleans each keystroke and the cleaned value is what is saved', async () => {
    const tree = await render(<HealthFridgeScreen />);
    type(tree, 'health-fridge-name-input', 'Flour');

    // `keyboardType` is a hint, not a guarantee: a paste puts anything here.
    type(tree, 'health-fridge-quantity-input', '2a.5b.7');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('2.57');

    await act(async () => press(tree, 'health-fridge-save-button'));
    // Rounded to the two decimals the column stores — not 2.57 truncated at the
    // Worker, and not a 400 the user cannot explain.
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2.57 }));
  });

  it('HEALTH-FRIDGE-242: a lone separator and an over-large number BLOCK the save — now with a hint', async () => {
    // Both are reachable from the decimal pad. `canSave` goes false and the
    // button reports `disabled`.
    //
    // FIXED (was "no hint"): the form now renders a quantity hint alongside
    // the existing expiry one, so either invalid state is explained.
    const tree = await render(<HealthFridgeScreen />);
    type(tree, 'health-fridge-name-input', 'Flour');

    const saveState = () =>
      byTestId(tree, 'health-fridge-save-button')[0].props.accessibilityState;
    expect(saveState()).toEqual({ disabled: false });

    type(tree, 'health-fridge-quantity-input', '.');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('.');
    expect(saveState()).toEqual({ disabled: true });
    expect(byTestId(tree, 'health-fridge-quantity-hint').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-expiry-hint').length).toBe(0); // that one's still fine
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();

    type(tree, 'health-fridge-quantity-input', '9000000');
    expect(saveState()).toEqual({ disabled: true });
    expect(byTestId(tree, 'health-fridge-quantity-hint').length).toBe(1);
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();

    // Clearing the field is legal again — blank means "no quantity" — and the
    // hint goes with it.
    type(tree, 'health-fridge-quantity-input', '');
    expect(saveState()).toEqual({ disabled: false });
    expect(byTestId(tree, 'health-fridge-quantity-hint').length).toBe(0);
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: null })
    );
  });

  it('HEALTH-FRIDGE-243: a whitespace-only name cannot be saved either', async () => {
    // `name.trim().length > 0` is the gate. A row named "   " would render as a
    // blank line the user cannot search for or recognise.
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-name-input', '    ');
    expect(byTestId(tree, 'health-fridge-save-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Stars, deletes and the last row                                     */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen — stars and the empty fridge', () => {
  it('HEALTH-FRIDGE-244: a row star flips BOTH ways and drops out of the Favourites view', async () => {
    // Un-starring while standing IN Favourites is the direction with real
    // consequences: the row must leave the list being read, which is the only
    // feedback the screen gives for that tap.
    const starred = item({ id: 'fr_1', name: 'Milk', isFavorite: true });
    givenFridge([starred, item({ id: 'fr_2', name: 'Cheese' })]);
    mockSetFridgeFavorite.mockImplementation((id: string, value: boolean) =>
      Promise.resolve(
        saved([
          { ...starred, isFavorite: id === 'fr_1' ? value : starred.isFavorite },
          item({ id: 'fr_2', name: 'Cheese' }),
        ])
      )
    );
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-filter-favorites');
    expect(byTestId(tree, 'health-fridge-item-fr_1').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-item-fr_2').length).toBe(0);
    // The row's own label carries the DIRECTION of the action, not just a glyph.
    expect(
      byTestId(tree, 'health-fridge-favorite-fr_1')[0].props.accessibilityLabel
    ).toBe('Unfavourite Milk');

    await act(async () => press(tree, 'health-fridge-favorite-fr_1'));

    expect(mockSetFridgeFavorite).toHaveBeenLastCalledWith('fr_1', false);
    expect(byTestId(tree, 'health-fridge-item-fr_1').length).toBe(0);
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
      'You have not starred anything yet.'
    );

    // …and back again from the All view: the same control, the other direction.
    press(tree, 'health-fridge-filter-all');
    expect(byTestId(tree, 'health-fridge-favorite-fr_1')[0].props.accessibilityLabel).toBe(
      'Favourite Milk'
    );
    await act(async () => press(tree, 'health-fridge-favorite-fr_1'));
    expect(mockSetFridgeFavorite).toHaveBeenLastCalledWith('fr_1', true);
  });

  it('HEALTH-FRIDGE-245: removing the LAST row swaps the copy to the empty-fridge line', async () => {
    // The three "nothing to show" states are indistinguishable to a user unless
    // the copy changes with the CAUSE. This is the only transition that reaches
    // the total-is-zero arm through a real interaction.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    givenFridge([item({ id: 'fr_1', name: 'Milk' })]);
    mockDeleteFridgeItem.mockResolvedValue(saved([]));
    const tree = await render(<HealthFridgeScreen />);

    expect(byTestId(tree, 'health-fridge-empty').length).toBe(0);

    press(tree, 'health-fridge-delete-fr_1');
    expect(alertSpy.mock.calls[0][1]).toBe('Take "Milk" out of your fridge?');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Remove')?.onPress?.());

    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toContain('Your fridge is empty');
    // Every group card is gone too — an empty group header would be worse than
    // the empty line it replaced.
    expect(byTestId(tree, 'health-fridge-group-today').length).toBe(0);
    // …and the summary now counts nothing rather than keeping a stale figure.
    expect(allText(byTestId(tree, 'health-fridge-window-note')[0])).toContain('counts 0 of 0 items');
    alertSpy.mockRestore();
  });

  it('HEALTH-FRIDGE-246: cancelling the remove alert writes nothing', async () => {
    // The destructive path's other half. `Cancel` carries no `onPress` at all,
    // so the proof is that the row is still there and no request was made.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    givenFridge([item({ id: 'fr_1', name: 'Milk' })]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-delete-fr_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    const cancel = buttons.find((b) => b.text === 'Cancel');
    expect(cancel?.style).toBe('cancel');
    expect(cancel?.onPress).toBeUndefined();

    expect(mockDeleteFridgeItem).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-fridge-item-fr_1').length).toBe(1);
    alertSpy.mockRestore();
  });

  it('HEALTH-FRIDGE-247: editing survives a filter switch and still targets the right row', async () => {
    // The form is bound to `editingId`, which the filter segments do not touch.
    // If a filter reset it, a half-finished edit would silently turn into a NEW
    // item — a duplicate the user never asked for.
    givenFridge([
      item({ id: 'fr_1', name: 'Milk', isFavorite: true }),
      item({ id: 'fr_2', name: 'Cheese' }),
    ]);
    mockUpdateFridgeItem.mockResolvedValue(saved([item({ id: 'fr_1', name: 'Whole milk' })]));
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-edit-fr_1');
    expect(byTestId(tree, 'health-fridge-cancel-edit').length).toBe(1);

    press(tree, 'health-fridge-filter-favorites');
    expect(byTestId(tree, 'health-fridge-cancel-edit').length).toBe(1);
    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Milk');

    type(tree, 'health-fridge-name-input', 'Whole milk');
    await act(async () => press(tree, 'health-fridge-save-button'));

    expect(mockUpdateFridgeItem).toHaveBeenCalledWith('fr_1', expect.objectContaining({
      name: 'Whole milk',
    }));
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-fridge-cancel-edit').length).toBe(0);
  });

  it('HEALTH-FRIDGE-248: cancelling an edit abandons every field, not just the name', async () => {
    // Cancel resets to EMPTY_FORM. A partial reset would leave the previous
    // row's unit, category or notes attached to the next thing added.
    givenFridge([
      item({
        id: 'fr_1',
        name: 'Milk',
        quantity: 3,
        unit: 'kg',
        category: 'Meat',
        notes: 'bottom shelf',
        isFavorite: true,
      }),
    ]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-edit-fr_1');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('3');
    expect(selectedChips(tree, 'health-fridge-unit-')).toEqual(['kg']);
    expect(selectedChips(tree, 'health-fridge-category-')).toEqual(['Meat']);
    expect(input(tree, 'health-fridge-notes-input').props.value).toBe('bottom shelf');

    press(tree, 'health-fridge-cancel-edit');

    expect(input(tree, 'health-fridge-name-input').props.value).toBe('');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('');
    expect(input(tree, 'health-fridge-notes-input').props.value).toBe('');
    expect(selectedChips(tree, 'health-fridge-unit-')).toEqual(['pc']);
    expect(selectedChips(tree, 'health-fridge-category-')).toEqual(['Uncategorized']);
    expect(allText(tree.toJSON())).toContain('Mark as favourite');
    expect(mockUpdateFridgeItem).not.toHaveBeenCalled();
  });
});
