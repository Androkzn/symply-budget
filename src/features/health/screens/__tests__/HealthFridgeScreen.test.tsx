/**
 * Symply Health — Fridge tab.
 *
 * Renders the REAL screen through <ThemeProvider> and drives its primary paths:
 * load → group by urgency → add → edit → favourite → delete. Only the
 * storage-backed async functions are mocked; the pure helpers stay real (they
 * own their coverage in ../../__tests__/healthFridgeStorage.test.ts), so what is
 * asserted here is the SCREEN's use of them.
 *
 * The load-bearing assertions are the honest ones: expired stock is shown
 * first, undated items are named as invisible to the expiring-soon count, and
 * an empty list says WHICH emptiness it is.
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
  loadExpiringSoon,
  loadFridge,
  setFridgeFavorite,
  updateFridgeItem,
  type FridgeItem,
  type FridgeWriteResult,
} from '../../healthFridgeStorage';
import { emptyCopy, HealthFridgeScreen } from '../HealthFridgeScreen';

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
    // P5 additions. Both are shared primitives with their own suites; stubbing
    // them keeps this file about the FRIDGE rather than about the overlay.
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

// The receipt surface's pickers. None of them is reachable in this file's
// specs, but every one is imported at module load and would otherwise pull a
// native module into the renderer.
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
    id: over.id ?? 'fr_1',
    name: over.name ?? 'Milk',
    quantity: over.quantity ?? 1,
    unit: over.unit ?? 'L',
    category: over.category ?? 'Dairy',
    expiryDate: over.expiryDate === undefined ? '2026-07-15' : over.expiryDate,
    isFavorite: over.isFavorite ?? false,
    notes: over.notes ?? '',
    source: over.source ?? 'manual',
    nutrition: over.nutrition ?? null,
    createdAt: over.createdAt ?? ISO,
    updatedAt: over.updatedAt ?? ISO,
  };
}

function saved(items: FridgeItem[]): FridgeWriteResult {
  return { items, status: 'saved', message: null };
}

/**
 * Seed both reads the screen performs. The expiring window is derived with the
 * REAL `expiringWithin` (the proven twin of the deployed SQL), so a test can
 * never accidentally hand the screen a window that the server could not return.
 */
function givenFridge(items: FridgeItem[]) {
  mockLoadFridge.mockResolvedValue(items);
  mockLoadExpiringSoon.mockResolvedValue(expiringWithin(items, 7, TODAY));
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

describe('HealthFridgeScreen', () => {
  it('HEALTH-FRIDGE-050: renders the shell and names the emptiness when the fridge is bare', async () => {
    const tree = await render(<HealthFridgeScreen />);

    expect(byTestId(tree, 'health-fridge-screen').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-screen-scroll-end').length).toBe(1);
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toContain('Your fridge is empty');
    expect(allText(tree.toJSON())).toContain('NEEDS EATING');
  });

  it('HEALTH-FRIDGE-051: expired stock is shown FIRST, never folded into "this week"', async () => {
    givenFridge([
      item({ id: 'later', name: 'Rice', expiryDate: '2026-12-01' }),
      item({ id: 'gone', name: 'Yoghurt', expiryDate: '2026-07-09' }),
      item({ id: 'week', name: 'Bread', expiryDate: '2026-07-18' }),
    ]);
    const tree = await render(<HealthFridgeScreen />);

    expect(byTestId(tree, 'health-fridge-group-expired').length).toBe(1);
    expect(allText(byTestId(tree, 'health-fridge-expiry-label-gone')[0])).toBe('Expired 4 days ago');
    expect(allText(byTestId(tree, 'health-fridge-expiry-label-week')[0])).toBe('Expires in 5 days');
    // The urgent group is rendered before the relaxed one.
    const rendered = allText(tree.toJSON());
    expect(rendered.indexOf('EXPIRED')).toBeLessThan(rendered.indexOf('LATER'));
  });

  it('HEALTH-FRIDGE-052: the summary states the cutoff AND that undated items are never counted', async () => {
    givenFridge([
      item({ id: 'gone', expiryDate: '2026-07-09' }),
      item({ id: 'today', expiryDate: TODAY }),
      item({ id: 'undated', name: 'Salt', expiryDate: null }),
    ]);
    const tree = await render(<HealthFridgeScreen />);

    expect(allText(byTestId(tree, 'health-fridge-stat-expired')[0])).toContain('1');
    expect(allText(byTestId(tree, 'health-fridge-stat-today')[0])).toContain('1');
    const note = allText(byTestId(tree, 'health-fridge-window-note')[0]);
    expect(note).toContain('2026-07-20'); // today + 7, the real cutoff
    expect(note).toContain('including 1 already past their date');
    expect(note).toContain('1 undated item is never counted');
    // The undated group is named rather than hidden.
    expect(byTestId(tree, 'health-fridge-group-undated').length).toBe(1);
  });

  it('HEALTH-FRIDGE-053: adding an item persists every field, then clears the form', async () => {
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-name-input', 'Cheddar');
    type(tree, 'health-fridge-quantity-input', '250');
    press(tree, 'health-fridge-unit-g');
    press(tree, 'health-fridge-category-Dairy');
    press(tree, 'health-fridge-expiry-7d');
    type(tree, 'health-fridge-notes-input', 'back shelf');
    await act(async () => press(tree, 'health-fridge-save-button'));

    expect(mockCreateFridgeItem).toHaveBeenCalledWith({
      name: 'Cheddar',
      quantity: 250,
      unit: 'g',
      category: 'Dairy',
      expiryDate: '2026-07-20',
      notes: 'back shelf',
      isFavorite: false,
    });
    expect(input(tree, 'health-fridge-name-input').props.value).toBe('');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('');
  });

  it('HEALTH-FRIDGE-054: a nameless item, or an impossible date, cannot be saved', async () => {
    const tree = await render(<HealthFridgeScreen />);

    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-fridge-save-button')[0].props.accessibilityState).toEqual({
      disabled: true,
    });

    type(tree, 'health-fridge-name-input', 'Yoghurt');
    type(tree, 'health-fridge-expiry-input', '2026-02-30');
    await act(async () => press(tree, 'health-fridge-save-button'));

    expect(mockCreateFridgeItem).not.toHaveBeenCalled();
    // The screen says what to do instead of showing a parser error.
    expect(allText(byTestId(tree, 'health-fridge-expiry-hint')[0])).toContain('YYYY-MM-DD');
  });

  it('HEALTH-FRIDGE-055: editing loads the row, saves through the update path, then exits', async () => {
    givenFridge([item({ id: 'fr_1', notes: 'half open' })]);
    mockUpdateFridgeItem.mockResolvedValue(saved([item({ id: 'fr_1', name: 'Whole milk' })]));
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-edit-fr_1');
    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Milk');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('2026-07-15');
    expect(input(tree, 'health-fridge-notes-input').props.value).toBe('half open');

    type(tree, 'health-fridge-name-input', 'Whole milk');
    await act(async () => press(tree, 'health-fridge-save-button'));

    expect(mockUpdateFridgeItem).toHaveBeenCalledWith('fr_1', {
      name: 'Whole milk',
      quantity: 1,
      unit: 'L',
      category: 'Dairy',
      expiryDate: '2026-07-15',
      notes: 'half open',
      isFavorite: false,
    });
    // Back to "add" mode with a clean form.
    expect(byTestId(tree, 'health-fridge-cancel-edit').length).toBe(0);
    expect(input(tree, 'health-fridge-name-input').props.value).toBe('');
  });

  it('HEALTH-FRIDGE-056: the star toggles through the store and reflects the answer', async () => {
    givenFridge([item({ id: 'fr_1' })]);
    mockSetFridgeFavorite.mockResolvedValue(saved([item({ id: 'fr_1', isFavorite: true })]));
    const tree = await render(<HealthFridgeScreen />);

    await act(async () => press(tree, 'health-fridge-favorite-fr_1'));
    expect(mockSetFridgeFavorite).toHaveBeenCalledWith('fr_1', true);
    expect(byTestId(tree, 'health-fridge-favorite-fr_1')[0].props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('HEALTH-FRIDGE-057: removing an item asks first, then deletes through the store', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    givenFridge([item({ id: 'fr_1' })]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-delete-fr_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{
      text: string;
      style?: string;
      onPress?: () => void;
    }>;
    expect(buttons.find((b) => b.text === 'Cancel')?.style).toBe('cancel');

    await act(async () => buttons.find((b) => b.text === 'Remove')?.onPress?.());
    expect(mockDeleteFridgeItem).toHaveBeenCalledWith('fr_1');
    alertSpy.mockRestore();
  });

  it('HEALTH-FRIDGE-058: the expiring filter says what it excludes, and search names its own emptiness', async () => {
    givenFridge([item({ id: 'later', expiryDate: '2026-12-01' })]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-filter-expiring');
    expect(allText(byTestId(tree, 'health-fridge-filter-note')[0])).toContain(
      'Items with no date are not in this view'
    );
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toContain('2026-07-20');

    press(tree, 'health-fridge-filter-all');
    type(tree, 'health-fridge-search-input', 'zzz');
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
      'Nothing in your fridge matches that search.'
    );
  });

  it('HEALTH-FRIDGE-060: the summary card is the SERVER window, not a lookalike', async () => {
    const stock = [
      item({ id: 'gone', expiryDate: '2026-07-09' }),
      item({ id: 'later', expiryDate: '2026-12-01' }),
      item({ id: 'undated', expiryDate: null }),
    ];
    mockLoadFridge.mockResolvedValue(stock);
    // Whatever the deployed route answers is what the card reports — the screen
    // does not second-guess it with its own filter.
    mockLoadExpiringSoon.mockResolvedValue([stock[0]]);
    const tree = await render(<HealthFridgeScreen />);

    expect(mockLoadExpiringSoon).toHaveBeenCalledWith(7, TODAY);
    expect(allText(byTestId(tree, 'health-fridge-window-note')[0])).toContain(
      'counts 1 of 3 items'
    );
    expect(allText(byTestId(tree, 'health-fridge-stat-expired')[0])).toContain('1');

    // …and the "expiring" view renders exactly those rows.
    press(tree, 'health-fridge-filter-expiring');
    expect(byTestId(tree, 'health-fridge-item-gone').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-item-later').length).toBe(0);
    expect(byTestId(tree, 'health-fridge-item-undated').length).toBe(0);
  });

  it('HEALTH-FRIDGE-059: an offline write degrades to a plain-words banner, never a raw error', async () => {
    mockCreateFridgeItem.mockResolvedValue({
      items: [item({ id: 'pending', name: 'Eggs' })],
      status: 'offline',
      message: 'Saved on this device — it will sync when you are back online.',
    });
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-name-input', 'Eggs');
    await act(async () => press(tree, 'health-fridge-save-button'));

    const banner = allText(byTestId(tree, 'health-fridge-message')[0]);
    expect(banner).toContain('sync when you are back online');
    expect(banner).not.toMatch(/Error|undefined|\bTypeError\b/);
    // The row the user just added is still on screen.
    expect(byTestId(tree, 'health-fridge-item-pending').length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Form affordances and empty states                                   */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen — form affordances', () => {
  it('HEALTH-FRIDGE-061: editing an undated, unquantified item opens BLANK fields, not "null"', async () => {
    // Every one of these is a controlled <TextInput value>. A raw null there
    // makes the field uncontrolled and prints "null" on some paths — and this is
    // the shape of a row added in a hurry with only a name.
    // Built literally: the `item()` helper's `?? 1` / `?? 'L'` defaults would
    // quietly fill in exactly the nulls this case is about.
    givenFridge([
      {
        ...item({ id: 'fr_1', name: 'Leftovers', expiryDate: null }),
        quantity: null,
        unit: null,
        category: '',
      },
    ]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-edit-fr_1');

    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Leftovers');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('');

    // Unit and category are chip pickers, not free text, so "no value" is not
    // an option: both fall back to a DEFAULT so exactly one chip is selected.
    const selectedChips = (prefix: string) =>
      tree.root
        .findAll(
          (n) => typeof n.type === 'string' && String(n.props?.testID ?? '').startsWith(prefix)
        )
        .filter((n) => n.props?.accessibilityState?.selected === true);
    expect(selectedChips('health-fridge-unit-')).toHaveLength(1);
    expect(selectedChips('health-fridge-category-')).toHaveLength(1);
  });

  it('HEALTH-FRIDGE-062: the "No date" quick pick CLEARS the expiry rather than writing a word', async () => {
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-expiry-7d');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('2026-07-20');

    // `quickPickDate(null)` is null, and a null in a <TextInput value> would
    // uncontrol the field — the "no date" answer has to be an empty string.
    press(tree, 'health-fridge-expiry-none');
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('');
    // …and a blank expiry is VALID, so Save is still offered.
    expect(byTestId(tree, 'health-fridge-expiry-hint').length).toBe(0);
  });

  it('HEALTH-FRIDGE-063: the favourite toggle flips the label, the glyph and the saved draft', async () => {
    const tree = await render(<HealthFridgeScreen />);

    const toggle = () =>
      tree.root.find(
        (n) =>
          n.props?.testID === 'health-fridge-favorite-toggle' &&
          typeof n.props?.onPress === 'function'
      );
    expect(allText(tree.toJSON())).toContain('Mark as favourite');

    act(() => toggle().props.onPress());

    // Both flags, on purpose: `checked` is what VoiceOver reads on a `switch`
    // role, and `selected` is the one Maestro's `selected:` filter can see on
    // this build — the E2E flow asserts the toggle through it.
    expect(toggle().props.accessibilityState).toEqual({ checked: true, selected: true });
    expect(allText(tree.toJSON())).toContain('Favourite');
    expect(allText(tree.toJSON())).not.toContain('Mark as favourite');

    // …and the flag reaches the store, not just the glyph.
    type(tree, 'health-fridge-name-input', 'Sourdough');
    await act(async () => press(tree, 'health-fridge-save-button'));
    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({ isFavorite: true })
    );
  });

  it('HEALTH-FRIDGE-064: clearing the search restores the full list', async () => {
    givenFridge([item({ id: 'fr_1', name: 'Milk' }), item({ id: 'fr_2', name: 'Bread' })]);
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-search-input', 'milk');
    expect(byTestId(tree, 'health-fridge-item-fr_2').length).toBe(0);

    press(tree, 'health-fridge-search-clear');

    expect(input(tree, 'health-fridge-search-input').props.value).toBe('');
    expect(byTestId(tree, 'health-fridge-item-fr_1').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-item-fr_2').length).toBe(1);
  });

  it('HEALTH-FRIDGE-065: deleting the row being EDITED resets the form', async () => {
    // Otherwise the form stays bound to `editingId`, and the next Save would
    // PUT to a row the Worker has already deleted — a 404 the user cannot
    // explain, on top of a form they thought they were adding with.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    givenFridge([item({ id: 'fr_1', name: 'Milk' })]);
    mockDeleteFridgeItem.mockResolvedValue(saved([]));
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-edit-fr_1');
    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Milk');

    press(tree, 'health-fridge-delete-fr_1');
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    await act(async () => buttons.find((b) => b.text === 'Remove')?.onPress?.());

    expect(input(tree, 'health-fridge-name-input').props.value).toBe('');
    expect(byTestId(tree, 'health-fridge-cancel-edit').length).toBe(0);
    alertSpy.mockRestore();
  });

  it('HEALTH-FRIDGE-066: several undated items are counted in the plural', async () => {
    // The window note is the only place the app explains WHY an item is not in
    // the expiring count, so its grammar is the copy, not decoration.
    givenFridge([
      item({ id: 'a', expiryDate: null }),
      item({ id: 'b', expiryDate: null }),
      item({ id: 'c', expiryDate: '2026-07-14' }),
    ]);
    const tree = await render(<HealthFridgeScreen />);

    const note = allText(byTestId(tree, 'health-fridge-window-note')[0]);
    expect(note).toContain('2 undated items are never counted');
    expect(note).not.toContain('item is never counted');
  });

  it('HEALTH-FRIDGE-069: a REJECTED save keeps the form filled so nothing is retyped', async () => {
    // The rollback already discards the optimistic row. If the form cleared too,
    // the user would lose everything they typed AND see the item vanish — twice
    // punished for a refusal they cannot act on.
    mockCreateFridgeItem.mockResolvedValue({
      items: [],
      status: 'rejected',
      message: 'Those details do not fit. Check the name, quantity and expiry date.',
    });
    const tree = await render(<HealthFridgeScreen />);

    type(tree, 'health-fridge-name-input', 'Sourdough starter');
    type(tree, 'health-fridge-notes-input', 'fed on Tuesday');
    await act(async () => press(tree, 'health-fridge-save-button'));

    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Sourdough starter');
    expect(input(tree, 'health-fridge-notes-input').props.value).toBe('fed on Tuesday');
    expect(allText(byTestId(tree, 'health-fridge-message')[0])).toContain('Check the name');
  });

  it('HEALTH-FRIDGE-070: a server window row outside the urgency buckets is not counted twice', async () => {
    // The urgency split walks the SERVER's window. The deployed filter returns
    // dated rows on or before the cutoff, but the screen must not mis-attribute
    // a row the Worker included anyway — the card's counts are what the copy
    // beside them claims.
    const stock = [
      item({ id: 'gone', expiryDate: '2026-07-10' }),
      item({ id: 'today', expiryDate: TODAY }),
      item({ id: 'week', expiryDate: '2026-07-16' }),
    ];
    mockLoadFridge.mockResolvedValue(stock);
    // Deliberately over-broad: a far-future row and an undated one leak in.
    mockLoadExpiringSoon.mockResolvedValue([
      ...stock,
      item({ id: 'later', expiryDate: '2026-12-01' }),
      item({ id: 'undated', expiryDate: null }),
    ]);
    const tree = await render(<HealthFridgeScreen />);

    // Only the three real urgencies are counted; the two strays are neither
    // counted nor allowed to inflate one of the buckets.
    const note = allText(byTestId(tree, 'health-fridge-window-note')[0]);
    expect(note).toContain('including 1 already past their date');
    expect(allText(byTestId(tree, 'health-fridge-stat-expired')[0])).toContain('1');
  });

  it('HEALTH-FRIDGE-067: an empty FAVOURITES view says so, and does not read as data loss', async () => {
    givenFridge([item({ id: 'fr_1', isFavorite: false })]);
    const tree = await render(<HealthFridgeScreen />);

    press(tree, 'health-fridge-filter-favorites');

    // Naming the cause is the whole point: "nothing here" over a fridge that is
    // NOT empty reads as the app having lost the user's food.
    expect(allText(byTestId(tree, 'health-fridge-empty')[0])).toBe(
      'You have not starred anything yet.'
    );
  });
});

describe('emptyCopy', () => {
  it('HEALTH-FRIDGE-068: falls back to a neutral line rather than claiming a cause', () => {
    // The four named states above cover every route the screen can reach. This
    // is the default arm: it must not assert an emptiness the caller did not
    // describe (e.g. "your fridge is empty" over a stocked fridge).
    expect(emptyCopy({ total: 3, filter: 'all', searching: false, cutoff: '2026-07-20' })).toBe(
      'Nothing to show.'
    );
    expect(emptyCopy({ total: 0, filter: 'all', searching: false, cutoff: '2026-07-20' })).toContain(
      'Your fridge is empty'
    );
  });
});
