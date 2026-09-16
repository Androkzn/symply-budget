/**
 * Symply Health — Fridge SCREEN, parity phase **P5**: the barcode field, the
 * receipt reader's review list, and the meal-ideas card.
 *
 * ⚠️ These three surfaces are UNCOMMITTED working-tree work at the time of
 * writing (`HealthFridgeScreen.tsx` is ~+480 lines vs HEAD). The brief makes the
 * working tree the source of truth, so they are covered as shipped — but if that
 * work is reverted rather than landed, this file goes with it.
 *
 * What is asserted, and why each one is the thing that matters:
 *
 *  - **A barcode fills the FORM, it does not save.** The code identifies a
 *    product, not the tin in this person's hand: no expiry, no count, and often
 *    a marketing name. One review step, the same one every other import keeps.
 *  - **A lookup NEVER sets an expiry date.** Silently dating an item from a
 *    barcode would put a date on the row that nothing in the world supports.
 *  - **Every failure is a sentence, never a raw error.** Not-found, switched-off
 *    and unreachable are three different next actions and read differently.
 *  - **A receipt persists nothing until the person says so**, non-food lines are
 *    shown-but-unticked, the button COUNTS what is ticked, and with nothing
 *    ticked it refuses rather than posting an empty batch.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import {
  addFridgeItems,
  BARCODE_COPY,
  expiringWithin,
  FRIDGE_AI_COPY,
  loadExpiringSoon,
  loadFridge,
  loadFridgeMealIdeas,
  lookupFridgeBarcode,
  createFridgeItem,
  scanFridgeReceipt,
  type FridgeItem,
  type FridgeWriteResult,
  type ReceiptDraftRow,
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
    // Stubs that KEEP the real contracts this screen depends on: the overlay
    // only renders while `visible`, and each source tile keeps the shared
    // `${testIDPrefix}-${source}` id, so a renamed prefix still fails here.
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
// Re-encoding a picked file is a filesystem concern with its own suite; the
// receipt specs below drive the review list, which starts after it.
jest.mock('../../healthVisionAttachments', () => ({
  HEALTH_VISION_MIMES: ['image/jpeg', 'image/png'],
  toVisionSafeBase64: jest.fn(async () => ({ base64: 'AAA', mimeType: 'image/jpeg' })),
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
    addFridgeItems: jest.fn(),
    lookupFridgeBarcode: jest.fn(),
    scanFridgeReceipt: jest.fn(),
    loadFridgeMealIdeas: jest.fn(),
  };
});

const mockLoadFridge = loadFridge as jest.Mock;
const mockLoadExpiringSoon = loadExpiringSoon as jest.Mock;
const mockCreateFridgeItem = createFridgeItem as jest.Mock;
const mockAddFridgeItems = addFridgeItems as jest.Mock;
const mockLookupBarcode = lookupFridgeBarcode as jest.Mock;
const mockScanReceipt = scanFridgeReceipt as jest.Mock;
const mockMealIdeas = loadFridgeMealIdeas as jest.Mock;

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

function receiptRow(over: Partial<ReceiptDraftRow> = {}): ReceiptDraftRow {
  return {
    key: '0-Tomatoes',
    name: 'Tomatoes',
    category: 'Vegetables',
    suggestedExpiryDays: 5,
    suggestedExpiryDate: '2026-07-18',
    amountCents: 249,
    looksLikeFood: true,
    selected: true,
    ...over,
  };
}

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

async function pressAsync(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  const node = tree.root.find(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  );
  await act(async () => {
    node.props.onPress();
  });
}

function input(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.find(
    (n) => (n.type as unknown as string) === 'TextInput' && n.props?.testID === testID
  );
}

function type(tree: ReactTestRenderer.ReactTestRenderer, testID: string, text: string) {
  act(() => input(tree, testID).props.onChangeText(text));
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthFridgeScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Drive a receipt scan to its review list. */
async function scanTo(tree: ReactTestRenderer.ReactTestRenderer, rows: ReceiptDraftRow[]) {
  mockScanReceipt.mockResolvedValue({
    status: 'ok',
    vendor: 'Corner Shop',
    purchaseDate: '2026-07-12',
    rows,
    message: null,
  });
  await pressAsync(tree, 'health-fridge-receipt-camera');
  await pressAsync(tree, 'health-fridge-receipt-run');
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(FIXED_NOW);

  givenFridge([item()]);
  mockCreateFridgeItem.mockResolvedValue(saved([]));
  (jest.requireMock('../../healthFridgeStorage').updateFridgeItem as jest.Mock).mockResolvedValue(
    saved([])
  );
  mockAddFridgeItems.mockResolvedValue({
    items: [],
    status: 'saved',
    message: '1 item added to your fridge.',
    saved: 1,
    attempted: 1,
  });
  mockMealIdeas.mockResolvedValue({ status: 'ok', plan: { meals: [], notes: null, considered: [] } });
  // A picked photo, so the receipt button is reachable without a native picker.
  const picker = jest.requireMock('@services/image-picker-compat').default;
  picker.openCamera.mockResolvedValue({ path: 'file:///receipt.jpg', filename: 'receipt.jpg' });
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* Barcode                                                             */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen P5 — barcode', () => {
  it('HEALTH-FRIDGE-249: the field is digits-only and the button is dead until something is typed', async () => {
    const tree = await render();

    expect(byTestId(tree, 'health-fridge-barcode-lookup')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    await pressAsync(tree, 'health-fridge-barcode-lookup');
    expect(mockLookupBarcode).not.toHaveBeenCalled();

    // Letters and punctuation are DROPPED as they are typed — the field takes
    // the digits printed under the bars and nothing else.
    type(tree, 'health-fridge-barcode-input', '5000-abc157 024671');
    expect(input(tree, 'health-fridge-barcode-input').props.value).toBe('5000157024671');
    expect(byTestId(tree, 'health-fridge-barcode-lookup')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    // …and the card says what the field is for, since there is no camera here.
    expect(allText(tree.toJSON())).toContain('Type the digits printed under the bars');
  });

  it('HEALTH-FRIDGE-250: a match FILLS THE FORM and saves nothing, with no expiry invented', async () => {
    mockLookupBarcode.mockResolvedValue({
      status: 'found',
      barcode: '5000157024671',
      message: '',
      draft: {
        name: 'Heinz Baked Beans',
        quantity: 1,
        unit: 'pc',
        category: 'Uncategorized',
        expiryDate: null,
        notes: 'Barcode 5000157024671',
        isFavorite: false,
        source: 'scan',
        nutrition: {
          calories: 155,
          protein: 9.4,
          carbs: 26.1,
          fats: 0.4,
          portion: 200,
          unit: 'g',
          source: 'fatsecret',
          barcode: '5000157024671',
        },
      },
    });
    const tree = await render();

    type(tree, 'health-fridge-barcode-input', '5000157024671');
    await pressAsync(tree, 'health-fridge-barcode-lookup');

    expect(mockLookupBarcode).toHaveBeenCalledWith('5000157024671');
    // NOTHING was saved: the person still has to press Add.
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();

    expect(input(tree, 'health-fridge-name-input').props.value).toBe('Heinz Baked Beans');
    expect(input(tree, 'health-fridge-quantity-input').props.value).toBe('1');
    expect(input(tree, 'health-fridge-notes-input').props.value).toBe('Barcode 5000157024671');
    // A barcode identifies a PRODUCT, not the tin in this hand. Dating it would
    // put a date on the row that nothing supports.
    expect(input(tree, 'health-fridge-expiry-input').props.value).toBe('');
    // The field is cleared so the next scan does not append to the last code.
    expect(input(tree, 'health-fridge-barcode-input').props.value).toBe('');
    expect(allText(byTestId(tree, 'health-fridge-message')[0])).toContain(
      'Found Heinz Baked Beans'
    );
  });

  it('HEALTH-FRIDGE-251: saving the filled form carries the macros and the scan source through', async () => {
    mockLookupBarcode.mockResolvedValue({
      status: 'found',
      barcode: '5000157024671',
      message: '',
      draft: {
        name: 'Heinz Baked Beans',
        quantity: 1,
        unit: 'pc',
        category: 'Uncategorized',
        expiryDate: null,
        notes: 'Barcode 5000157024671',
        isFavorite: false,
        source: 'scan',
        nutrition: { calories: 155, protein: 9.4, carbs: 26.1, fats: 0.4, portion: 200, unit: 'g' },
      },
    });
    const tree = await render();

    type(tree, 'health-fridge-barcode-input', '5000157024671');
    await pressAsync(tree, 'health-fridge-barcode-lookup');
    // The person adds the one thing the database could not know.
    type(tree, 'health-fridge-expiry-input', '2026-08-01');
    await pressAsync(tree, 'health-fridge-save-button');

    expect(mockCreateFridgeItem).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Heinz Baked Beans',
        expiryDate: '2026-08-01',
        source: 'scan',
        nutrition: expect.objectContaining({ calories: 155, portion: 200 }),
      })
    );
  });

  it('HEALTH-FRIDGE-252: an EDIT never inherits the last scan source or macros', async () => {
    // The extras are applied on CREATE only. Sending them on a PUT would rewrite
    // a hand-typed row's provenance with whatever the form last held.
    mockLookupBarcode.mockResolvedValue({
      status: 'found',
      barcode: '5000157024671',
      message: '',
      draft: {
        name: 'Heinz Baked Beans',
        quantity: 1,
        unit: 'pc',
        category: 'Uncategorized',
        expiryDate: null,
        notes: 'Barcode 5000157024671',
        isFavorite: false,
        source: 'scan',
        nutrition: { calories: 155, protein: 0, carbs: 0, fats: 0, portion: 200, unit: 'g' },
      },
    });
    const tree = await render();

    type(tree, 'health-fridge-barcode-input', '5000157024671');
    await pressAsync(tree, 'health-fridge-barcode-lookup');
    // …then abandon it and edit an existing row instead.
    press(tree, 'health-fridge-edit-fr_1');
    await pressAsync(tree, 'health-fridge-save-button');

    const patch = (jest.requireMock('../../healthFridgeStorage').updateFridgeItem as jest.Mock).mock
      .calls[0][1];
    expect(patch.source).toBeUndefined();
    expect(patch.nutrition).toBeUndefined();
  });

  it('HEALTH-FRIDGE-253: not-found, switched-off and unreachable each get their OWN sentence', async () => {
    // Three different next actions. Collapsing them into one "could not look
    // that up" is what makes a switched-off feature read as a broken one.
    const tree = await render();

    for (const [status, copy] of [
      ['not_found', BARCODE_COPY.not_found],
      ['not_configured', BARCODE_COPY.not_configured],
      ['unavailable', BARCODE_COPY.unavailable],
    ] as const) {
      mockLookupBarcode.mockResolvedValue({
        status,
        draft: null,
        barcode: '5000157024671',
        message: copy,
      });
      type(tree, 'health-fridge-barcode-input', '5000157024671');
      await pressAsync(tree, 'health-fridge-barcode-lookup');

      const banner = allText(byTestId(tree, 'health-fridge-message')[0]);
      expect([status, banner]).toEqual([status, copy]);
      // No raw error text, ever.
      expect(banner).not.toMatch(/Error|undefined|status code|axios/i);
      // A failed lookup must not touch the form the person may be mid-way through.
      expect(input(tree, 'health-fridge-name-input').props.value).toBe('');
    }
    expect(mockCreateFridgeItem).not.toHaveBeenCalled();
  });

  it('HEALTH-FRIDGE-254: the blocking overlay is up only while a lookup is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    mockLookupBarcode.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const tree = await render();

    expect(byTestId(tree, 'health-fridge-overlay').length).toBe(0);
    type(tree, 'health-fridge-barcode-input', '5000157024671');
    act(() => {
      tree.root
        .find(
          (n) =>
            n.props?.testID === 'health-fridge-barcode-lookup' &&
            typeof n.props?.onPress === 'function'
        )
        .props.onPress();
    });
    expect(byTestId(tree, 'health-fridge-overlay').length).toBe(1);

    await act(async () => {
      release({ status: 'not_found', draft: null, barcode: '5000157024671', message: 'x' });
    });
    expect(byTestId(tree, 'health-fridge-overlay').length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Receipt review                                                      */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen P5 — receipt review', () => {
  it('HEALTH-FRIDGE-255: nothing is saved by a scan, and non-food lines are SHOWN but unticked', async () => {
    const tree = await render();

    await scanTo(tree, [
      receiptRow(),
      receiptRow({
        key: '1-Carrier bag',
        name: 'Carrier bag',
        category: 'Uncategorized',
        suggestedExpiryDays: null,
        suggestedExpiryDate: null,
        looksLikeFood: false,
        selected: false,
      }),
    ]);

    expect(mockAddFridgeItems).not.toHaveBeenCalled();
    expect(byTestId(tree, 'health-fridge-receipt-review').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-receipt-row-0-Tomatoes').length).toBe(1);
    // The non-food row is present, unticked, and SAYS WHY — a dropped line
    // would look like the reader missed it.
    expect(
      byTestId(tree, 'health-fridge-receipt-tick-1-Carrier bag')[0].props.accessibilityState
    ).toEqual({ checked: false });
    expect(allText(byTestId(tree, 'health-fridge-receipt-nonfood-1-Carrier bag')[0])).toBe(
      'This did not look like food, so it is not ticked.'
    );
    // The vendor names the receipt, and the card says nothing is saved yet.
    expect(allText(tree.toJSON())).toContain('FROM CORNER SHOP');
    expect(allText(tree.toJSON())).toContain('Nothing is saved yet.');
  });

  it('HEALTH-FRIDGE-256: the button COUNTS what is ticked, and refuses when nothing is', async () => {
    const tree = await render();

    await scanTo(tree, [
      receiptRow(),
      receiptRow({ key: '1-Milk', name: 'Milk', category: 'Dairy' }),
    ]);

    const saveLabel = () => allText(byTestId(tree, 'health-fridge-receipt-save')[0]);
    const saveState = () => byTestId(tree, 'health-fridge-receipt-save')[0].props.accessibilityState;
    expect(saveLabel()).toBe('Add 2 items');

    press(tree, 'health-fridge-receipt-tick-1-Milk');
    expect(saveLabel()).toBe('Add 1 item'); // singular, not "1 items"
    expect(saveState()).toEqual({ disabled: false });

    press(tree, 'health-fridge-receipt-tick-0-Tomatoes');
    expect(saveLabel()).toBe('Nothing ticked');
    expect(saveState()).toEqual({ disabled: true });
    await pressAsync(tree, 'health-fridge-receipt-save');
    expect(mockAddFridgeItems).not.toHaveBeenCalled();

    // Ticking back on is the same control in the other direction.
    press(tree, 'health-fridge-receipt-tick-0-Tomatoes');
    expect(saveLabel()).toBe('Add 1 item');
  });

  it('HEALTH-FRIDGE-257: only the TICKED rows are committed, and the review clears afterwards', async () => {
    const tree = await render();

    await scanTo(tree, [
      receiptRow(),
      receiptRow({ key: '1-Milk', name: 'Milk', category: 'Dairy' }),
      receiptRow({
        key: '2-Batteries',
        name: 'Batteries',
        category: 'Uncategorized',
        suggestedExpiryDays: null,
        suggestedExpiryDate: null,
        looksLikeFood: false,
        selected: false,
      }),
    ]);

    press(tree, 'health-fridge-receipt-tick-1-Milk'); // untick the milk
    await pressAsync(tree, 'health-fridge-receipt-save');

    expect(mockAddFridgeItems).toHaveBeenCalledTimes(1);
    const drafts = mockAddFridgeItems.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(drafts.map((d) => d.name)).toEqual(['Tomatoes']);
    expect(drafts[0]).toMatchObject({
      source: 'receipt',
      notes: 'Added from a receipt',
      // The typical shelf life is applied by default when there is one.
      expiryDate: '2026-07-18',
      // A receipt does not say how many, so the count stays unknown.
      quantity: null,
    });
    // The review list is gone — leaving it up would invite a second commit of
    // rows that are already in the fridge.
    expect(byTestId(tree, 'health-fridge-receipt-review').length).toBe(0);
  });

  it('HEALTH-FRIDGE-258: the typical shelf life is a CHOICE, per row', async () => {
    // It is a category default, not something printed on the receipt, so the
    // person can decline it — and a row the reader could not place offers no
    // control at all rather than a disabled one implying a date exists.
    const tree = await render();

    await scanTo(tree, [
      receiptRow(),
      receiptRow({
        key: '1-Something',
        name: 'Something',
        category: 'Uncategorized',
        suggestedExpiryDays: null,
        suggestedExpiryDate: null,
      }),
    ]);

    expect(allText(byTestId(tree, 'health-fridge-receipt-expiry-0-Tomatoes')[0])).toBe(
      'Typically keeps 5 days — expiry 2026-07-18. Tap for no date.'
    );
    expect(byTestId(tree, 'health-fridge-receipt-expiry-1-Something').length).toBe(0);

    press(tree, 'health-fridge-receipt-expiry-0-Tomatoes');
    expect(allText(byTestId(tree, 'health-fridge-receipt-expiry-0-Tomatoes')[0])).toBe(
      'No expiry date. Tap to use the typical shelf life.'
    );

    await pressAsync(tree, 'health-fridge-receipt-save');
    const drafts = mockAddFridgeItems.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(drafts.find((d) => d.name === 'Tomatoes')?.expiryDate).toBeNull();
  });

  it('HEALTH-FRIDGE-259: Discard throws the whole review away without writing', async () => {
    const tree = await render();
    await scanTo(tree, [receiptRow()]);

    press(tree, 'health-fridge-receipt-discard');

    expect(byTestId(tree, 'health-fridge-receipt-review').length).toBe(0);
    expect(byTestId(tree, 'health-fridge-receipt-shots').length).toBe(0);
    expect(mockAddFridgeItems).not.toHaveBeenCalled();
  });

  it('HEALTH-FRIDGE-294: a refused AI call is a plain sentence and leaves no half-review behind', async () => {
    const tree = await render();
    mockScanReceipt.mockResolvedValue({
      status: 'needs_ai',
      vendor: null,
      purchaseDate: null,
      rows: [],
      message: FRIDGE_AI_COPY.needs_ai,
    });

    await pressAsync(tree, 'health-fridge-receipt-camera');
    await pressAsync(tree, 'health-fridge-receipt-run');

    expect(allText(byTestId(tree, 'health-fridge-message')[0])).toBe(FRIDGE_AI_COPY.needs_ai);
    expect(byTestId(tree, 'health-fridge-receipt-review').length).toBe(0);
    expect(mockAddFridgeItems).not.toHaveBeenCalled();
  });

  it('HEALTH-FRIDGE-295: a receipt with nothing fridge-worthy on it says so', async () => {
    // An empty read is a real outcome (a receipt of cleaning products), and it
    // has to be distinguishable from a failed read.
    const tree = await render();
    mockScanReceipt.mockResolvedValue({
      status: 'ok',
      vendor: null,
      purchaseDate: null,
      rows: [],
      message: null,
    });

    await pressAsync(tree, 'health-fridge-receipt-camera');
    await pressAsync(tree, 'health-fridge-receipt-run');

    expect(allText(byTestId(tree, 'health-fridge-message')[0])).toBe(
      'Nothing on that receipt looked like something for your fridge.'
    );
    expect(byTestId(tree, 'health-fridge-receipt-review').length).toBe(0);
  });

  it('HEALTH-FRIDGE-296: the reader cannot run without a photo, and a picked one can be removed', async () => {
    const tree = await render();

    expect(byTestId(tree, 'health-fridge-receipt-run')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    await pressAsync(tree, 'health-fridge-receipt-run');
    expect(mockScanReceipt).not.toHaveBeenCalled();

    await pressAsync(tree, 'health-fridge-receipt-camera');
    expect(byTestId(tree, 'health-fridge-receipt-shots').length).toBe(1);
    expect(byTestId(tree, 'health-fridge-receipt-run')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    // Several images are ONE receipt read in order — the copy says so, because
    // otherwise a second photo looks like a second receipt.
    expect(allText(byTestId(tree, 'health-fridge-receipt-shots')[0])).toContain(
      'All of them are read as ONE long receipt, in order.'
    );

    press(tree, 'health-fridge-receipt-remove-0');
    expect(byTestId(tree, 'health-fridge-receipt-shots').length).toBe(0);
    expect(byTestId(tree, 'health-fridge-receipt-run')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
  });
});

/* ------------------------------------------------------------------ */
/* Meal ideas                                                          */
/* ------------------------------------------------------------------ */

describe('HealthFridgeScreen P5 — meal ideas', () => {
  it('HEALTH-FRIDGE-297: the button is dead on an EMPTY fridge, and says why', async () => {
    // An empty fridge has nothing to plan from, and spending an AI call to be
    // told so is worse than saying it in a line of copy.
    //
    // The guard is the `Pressable`'s own `disabled` — `handleMealIdeas` only
    // checks `mealsBusy`, so a future refactor that made this button pressable
    // (a toolbar item, a keyboard shortcut) WOULD fire an empty-fridge request.
    // Asserted as the disabled state rather than by invoking `onPress`, which
    // in the renderer bypasses `disabled` and would prove nothing either way.
    givenFridge([]);
    const tree = await render();

    expect(byTestId(tree, 'health-fridge-meals-run')[0].props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(allText(tree.toJSON())).toContain('there is nothing to cook from yet');

    // …and with one item in the fridge the same button really is live, so the
    // assertion above is about the EMPTY state rather than about a button that
    // is never enabled.
    givenFridge([item()]);
    const stocked = await render();
    expect(byTestId(stocked, 'health-fridge-meals-run')[0].props.accessibilityState).toEqual({
      disabled: false,
    });
    expect(allText(stocked.toJSON())).not.toContain('there is nothing to cook from yet');
    await pressAsync(stocked, 'health-fridge-meals-run');
    expect(mockMealIdeas).toHaveBeenCalledWith({ today: TODAY });
  });

  it('HEALTH-FRIDGE-298: a plan renders its meals and names how many items it was built from', async () => {
    mockMealIdeas.mockResolvedValue({
      status: 'ok',
      message: null,
      plan: {
        meals: [
          {
            name: 'Tomato soup',
            description: 'Uses what is going off first.',
            ingredients_used: ['Tomatoes'],
            missing_ingredients: ['Stock'],
            calories: 210,
            protein_g: 6,
            carbs_g: 24,
            fat_g: 9,
            instructions: ['Chop', 'Simmer'],
            uses_expiring: ['Tomatoes'],
            prep_minutes: 25,
          },
        ],
        notes: null,
        considered: ['Tomatoes', 'Onions'],
      },
    });
    const tree = await render();

    await pressAsync(tree, 'health-fridge-meals-run');

    expect(mockMealIdeas).toHaveBeenCalledWith({ today: TODAY });
    expect(byTestId(tree, 'health-fridge-meals-list').length).toBe(1);
    expect(allText(byTestId(tree, 'health-fridge-meal-0')[0])).toContain('Tomato soup');
    expect(allText(byTestId(tree, 'health-fridge-meal-urgent-0')[0])).toContain('Tomatoes');
    // The footnote makes the estimate checkable rather than magic, and warns
    // against logging a dish nobody weighed.
    const note = allText(byTestId(tree, 'health-fridge-meals-note')[0]);
    expect(note).toContain('Built from 2 items in your fridge');
    expect(note).toContain('estimates');
  });

  it('HEALTH-FRIDGE-299: "no meal in this fridge" is an ANSWER, not an error banner', async () => {
    mockMealIdeas.mockResolvedValue({
      status: 'ok',
      message: null,
      plan: { meals: [], notes: 'There is not much to work with yet.', considered: ['Salt'] },
    });
    const tree = await render();

    await pressAsync(tree, 'health-fridge-meals-run');

    expect(allText(byTestId(tree, 'health-fridge-meals-empty')[0])).toBe(
      'There is not much to work with yet.'
    );
    expect(byTestId(tree, 'health-fridge-message').length).toBe(0);
  });

  it('HEALTH-FRIDGE-300: a refused plan is the shared AI sentence and renders no empty card', async () => {
    mockMealIdeas.mockResolvedValue({
      status: 'needs_ai',
      plan: null,
      message: FRIDGE_AI_COPY.needs_ai,
    });
    const tree = await render();

    await pressAsync(tree, 'health-fridge-meals-run');

    expect(allText(byTestId(tree, 'health-fridge-message')[0])).toBe(FRIDGE_AI_COPY.needs_ai);
    expect(byTestId(tree, 'health-fridge-meals-list').length).toBe(0);
    expect(byTestId(tree, 'health-fridge-meals-empty').length).toBe(0);
  });
});
