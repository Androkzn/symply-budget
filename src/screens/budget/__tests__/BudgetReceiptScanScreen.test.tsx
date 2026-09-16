/**
 * BudgetReceiptScanScreen — capture a grocery receipt, review AI-extracted line
 * items, edit/toggle them, and bulk-save as grocery expenses (with savings).
 *
 * Drives every top-level branch:
 *   • pick from camera / gallery / file → attachment chip
 *   • scan → drafts render, vendor/date meta, totals + save label
 *   • scan returns nothing → alert
 *   • toggle include, edit price/saved, remove item, add blank item
 *   • save → addExpensesBulk with included items (with saved_amount) → goBack
 *   • save with missing name/price → warn before skipping
 *   • save with nothing selected → alert
 *   • scan / save API errors → alert
 *   • cancel → goBack
 */
const mockGoBack = jest.fn();
const mockNav = { goBack: mockGoBack };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity, Text } = require('react-native');
  return {
    // Mirrors `OverlaySheetHeader`: the sheet's glass ✕ (carrying `closeTestID`)
    // and an optional trailing commit — the "Done" these pickers used to end in
    // is now the ✕, so a flow driving that id still finds it here.
    OverlaySheetHeader: ({ title, onClose, closeTestID, action }: Record<string, any>) =>
      React.createElement(
        View,
        null,
        title ? React.createElement(Text, null, title) : null,
        React.createElement(TouchableOpacity, { onPress: onClose, testID: closeTestID }),
        action
          ? React.createElement(
              TouchableOpacity,
              { onPress: action.onPress, testID: action.testID },
              React.createElement(Text, null, action.label)
            )
          : null
      ),
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(TouchableOpacity, { onPress: onBackPress, testID: 'nav-back-button' }),
    ScanImportSources: ({
      testIDPrefix,
      disabled,
      onCamera,
      onGallery,
      onFile,
      onDrive,
    }: {
      testIDPrefix?: string;
      disabled?: boolean;
      onCamera?: () => void;
      onGallery?: () => void;
      onFile?: () => void;
      onDrive?: () => void;
    }) => {
      const handlers: Record<string, (() => void) | undefined> = {
        camera: onCamera,
        gallery: onGallery,
        file: onFile,
        drive: onDrive,
      };
      return React.createElement(
        View,
        null,
        ['camera', 'gallery', 'file', 'drive']
          .filter((k) => handlers[k])
          .map((k) =>
            React.createElement(TouchableOpacity, {
              key: k,
              testID: testIDPrefix ? `${testIDPrefix}-${k}` : undefined,
              disabled,
              onPress: handlers[k],
            })
          )
      );
    },
    ProcessingOverlay: ({ visible }: { visible?: boolean }) =>
      visible ? React.createElement(View, { testID: 'processing-overlay' }) : null,
    screenScrollViewStyle: { scroll: {}, contentGrow: {} },
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockOpenCamera = jest.fn();
const mockOpenPicker = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openCamera: (...a: unknown[]) => mockOpenCamera(...a),
    openPicker: (...a: unknown[]) => mockOpenPicker(...a),
  },
}));

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}));

// The rate lookup is a network call; every test drives it explicitly so a
// foreign receipt behaves the same offline as on wifi.
const mockGetExchangeRate = jest.fn();
jest.mock('@services/exchangeRates', () => ({
  getExchangeRate: (...a: unknown[]) => mockGetExchangeRate(...a),
}));

const mockScanReceipt = jest.fn();
const mockAddExpensesBulk = jest.fn();
const mockGetCategories = jest.fn();
const mockCreateCategory = jest.fn();
const mockUpdateCategory = jest.fn();
jest.mock('@api/budget', () => ({
  budgetApi: {
    scanReceipt: (...a: unknown[]) => mockScanReceipt(...a),
    addExpensesBulk: (...a: unknown[]) => mockAddExpensesBulk(...a),
    getCategories: (...a: unknown[]) => mockGetCategories(...a),
    createCategory: (...a: unknown[]) => mockCreateCategory(...a),
    updateCategory: (...a: unknown[]) => mockUpdateCategory(...a),
  },
  // Mirrors the real predicate without pulling axios into the mock.
  isCategoryNameConflict: (error: { name?: string; response?: { status?: number } } | null) =>
    error?.name === 'CategoryNameConflictError' || error?.response?.status === 409,
}));

const mockMarkInsightsDirty = jest.fn();
const mockSetSelectedMonth = jest.fn();
// Mutable so a test can put the screen on a DIFFERENT month than the receipt's
// printed date — the case where a scan lands outside the month on screen.
const budgetStoreState = { selectedYear: 2026, selectedMonth: 7 };
jest.mock('@stores/budgetStore', () => ({
  useBudgetStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: budgetStoreState.selectedYear,
      selectedMonth: budgetStoreState.selectedMonth,
      markInsightsDirty: mockMarkInsightsDirty,
      setSelectedMonth: mockSetSelectedMonth,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

const mockShowToast = jest.fn();
jest.mock('@services/toastManager', () => ({
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

// Cloud drive picker: render a tappable stub (only when `visible`) that hands
// back a selected file, so the Drive → attachment path is drivable in tests.
const mockDriveFile = { uri: 'file:///drive/grocery.png', name: 'grocery.png', size: 2048 };
jest.mock('@components/cloud-storage', () => {
  const React = require('react');
  const { TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: ({
      visible,
      onFileSelected,
    }: {
      visible: boolean;
      onFileSelected: (f: { uri: string; name: string; size: number }) => void;
    }) =>
      visible
        ? React.createElement(TouchableOpacity, {
            testID: 'mock-drive-pick',
            onPress: () => onFileSelected(mockDriveFile),
          })
        : null,
  };
});

// Chat → confirm-screen handoff: BudgetReceiptScanScreen consumes a stashed
// draft on mount. Default to none (a normal local scan); prefill test overrides.
const mockTakePendingReceiptDraft = jest.fn(() => null as GroceryReceiptScanResult | null);
jest.mock('@features/chat/receiptDraftStore', () => ({
  takePendingReceiptDraft: () => mockTakePendingReceiptDraft(),
}));

const mockListAliasHints = jest.fn(async (..._args: unknown[]) => []);
const mockUpsertAliases = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@features/budget/local/receiptAliases', () => ({
  listAliasHints: (...a: unknown[]) => mockListAliasHints(...a),
  upsertAliases: (...a: unknown[]) => mockUpsertAliases(...a),
  aliasKeyForItem: (rawCode?: string | null, rawName?: string) =>
    rawCode?.trim() || (rawName ?? '').trim().toLowerCase(),
}));

jest.mock('@utils/visionSafeAttachment', () => ({
  toVisionSafeAttachment: async <T,>(attachment: T) => attachment,
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { GroceryReceiptScanResult } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';
import { buildReceiptDraftFromRaw, type RawReceiptDraft } from '@features/budget/local/ai/buildReceiptDraft';
import { useAppStore } from '@stores/appStore';

import liveGemini from '../../../features/budget/local/ai/__tests__/fixtures/live-gemini-receipts.json';
import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { fixture, pickerAsset } from '../../../test-utils/fixtures';
import { BudgetReceiptScanScreen } from '../BudgetReceiptScanScreen';

// Real grocery receipt photo from resourses/testing (see e2e/fixtures/manifest.json).
const RECEIPT = fixture('budget-receipt'); // receipt.jpg
// react-native-image-crop-picker (camera/gallery) shape for the real receipt.
const RECEIPT_IMAGE = { path: RECEIPT.uri, filename: RECEIPT.name, mime: RECEIPT.mime };

const SCAN_RESULT: GroceryReceiptScanResult = {
  vendor: 'FreshMart',
  purchase_date: '2026-07-01',
  category_id: 'cat-groceries',
  category_name: 'Groceries',
  items: [
    { name: 'milk', amount: 349, saved_amount: 0 },
    { name: 'greek yogurt', amount: 599, saved_amount: 279 },
  ],
};

// A taxed receipt: milk exempt, bags carries GST+PST (amounts are TAX-INCLUSIVE,
// tax_amount is the folded-in portion). Reconciles: 500 + 1120 = 1620 total.
const TAXED_SCAN: GroceryReceiptScanResult = {
  vendor: 'Costco',
  purchase_date: '2026-07-01',
  category_id: 'cat-groceries',
  category_name: 'Groceries',
  items: [
    { name: 'milk', amount: 500, tax_amount: 0, saved_amount: 0 },
    { name: 'bags', amount: 1120, tax_amount: 120, saved_amount: 0 },
  ],
  subtotal_amount: 1500,
  tax_amount: 120,
  total_amount: 1620,
  tax_breakdown: [
    { label: 'GST', amount: 50 },
    { label: 'PST', amount: 70 },
  ],
  tax_source: 'printed-coded',
  region_known: true,
};

let tree: ReactTestRenderer.ReactTestRenderer;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

async function renderScreen() {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetReceiptScanScreen />
      </ThemeProvider>
    );
  });
  await flush();
  return tree;
}

const byTestID = (id: string) => tree.root.find((n) => n.props?.testID === id);
const allByTestID = (id: string) => tree.root.findAll((n) => n.props?.testID === id);

/**
 * `@components/ui` TextInput/GradientButton forward their `testID` to several
 * nested nodes (composite + host), so a plain findAll returns duplicates. Each
 * rendered instance shares ONE handler reference, so dedupe by that reference
 * to get exactly one node per on-screen control.
 */
function uniqueNodes(id: string, handlerProp: 'onPress' | 'onChangeText') {
  const out: ReturnType<typeof allByTestID> = [];
  for (const n of allByTestID(id)) {
    if (typeof n.props?.[handlerProp] !== 'function') continue;
    // Keep only the OUTERMOST node carrying this testID.
    //
    // Deduping by handler identity used to stand in for "one node per control",
    // and it only worked while `@components/ui` TextInput passed `onChangeText`
    // straight through: the composite and its host then shared one function.
    // The moment that component wrapped the handler — as it now does, to strip
    // letters out of numeric fields — composite and host held DIFFERENT
    // functions, every control counted twice, and a screen with two draft rows
    // reported four. The failures land on the counts (`toBe(2)` receiving 4),
    // which reads as the screen rendering duplicates rather than as the helper
    // mismeasuring.
    //
    // An ancestor with the same testID means this node is an inner copy of a
    // control already counted, which is true however the component chooses to
    // forward its props.
    let ancestor = n.parent;
    let nested = false;
    while (ancestor) {
      if (ancestor.props?.testID === id) {
        nested = true;
        break;
      }
      ancestor = ancestor.parent;
    }
    if (!nested) out.push(n);
  }
  return out;
}

async function press(id: string) {
  await act(async () => {
    byTestID(id).props.onPress();
    await Promise.resolve();
  });
  await flush();
}

async function pressAt(id: string, index: number) {
  await act(async () => {
    uniqueNodes(id, 'onPress')[index].props.onPress();
    await Promise.resolve();
  });
  await flush();
}

async function setInputAt(id: string, index: number, value: string) {
  await act(async () => {
    uniqueNodes(id, 'onChangeText')[index].props.onChangeText(value);
    await Promise.resolve();
  });
}

const draftCount = () => uniqueNodes('budget-receipt-name', 'onChangeText').length;
const inputValueAt = (id: string, index: number) =>
  uniqueNodes(id, 'onChangeText')[index]?.props.value;

async function attachViaCamera() {
  mockOpenCamera.mockResolvedValue(RECEIPT_IMAGE);
  await press('budget-receipt-camera');
}

async function scan() {
  await attachViaCamera();
  await press('budget-receipt-scan-button');
}

afterEach(async () => {
  await flush();
  await act(async () => {
    try {
      tree?.unmount();
    } catch {
      /* already unmounted */
    }
  });
});

const CATEGORIES = [
  { id: 'cat-groceries', name: 'Groceries', icon: '🛒' },
  { id: 'cat-alcohol', name: 'Alcohol', icon: '🍷' },
  { id: 'cat-household', name: 'Household', icon: '🧻' },
  { id: 'cat-dairy', name: 'Dairy', icon: '🥛' },
  { id: 'cat-produce', name: 'Produce', icon: '🥬' },
];

beforeEach(() => {
  jest.clearAllMocks();
  budgetStoreState.selectedYear = 2026;
  budgetStoreState.selectedMonth = 7;
  mockScanReceipt.mockResolvedValue(SCAN_RESULT);
  mockGetExchangeRate.mockResolvedValue({
    from: 'USD',
    to: 'CAD',
    rate: 1.3712,
    asOf: '2026-09-04',
    source: 'fetched',
  });
  mockAddExpensesBulk.mockResolvedValue({ expenses: [] });
  mockGetCategories.mockResolvedValue({ categories: CATEGORIES });
  mockCreateCategory.mockResolvedValue({
    category: { id: 'cat-new', name: 'Cat show fees', icon: 'tag' },
  });
  mockUpdateCategory.mockResolvedValue({ category: { id: 'cat-new', name: 'Cat show fees' } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  // Deterministic tax region: default unset so scan forwards {null,null}; the
  // region-nudge tests override this and it resets before the next test.
  useAppStore.setState({ taxCountry: null, taxRegion: null, currency: 'USD' });
});

describe('BudgetReceiptScanScreen — attachment', () => {
  it('sets an attachment from the camera and enables scanning', async () => {
    await renderScreen();
    expect(byTestID('budget-receipt-scan-button').props.disabled).toBe(true);
    await attachViaCamera();
    expect(byTestID('budget-receipt-remove')).toBeTruthy();
    expect(byTestID('budget-receipt-scan-button').props.disabled).toBe(false);
  });

  it('sets an attachment from the gallery', async () => {
    mockOpenPicker.mockResolvedValue(RECEIPT_IMAGE);
    await renderScreen();
    await press('budget-receipt-gallery');
    expect(byTestID('budget-receipt-remove')).toBeTruthy();
  });

  it('sets an attachment from a file', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('budget-receipt')], // real receipt.jpg
    });
    await renderScreen();
    await press('budget-receipt-file');
    expect(byTestID('budget-receipt-remove')).toBeTruthy();
  });

  it('clears the attachment when removed', async () => {
    await renderScreen();
    await attachViaCamera();
    await press('budget-receipt-remove');
    expect(allByTestID('budget-receipt-remove')).toHaveLength(0);
    expect(byTestID('budget-receipt-scan-button').props.disabled).toBe(true);
  });

  it('does not alert when the camera is cancelled', async () => {
    mockOpenCamera.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    await renderScreen();
    await press('budget-receipt-camera');
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('alerts on a non-cancel camera error', async () => {
    mockOpenCamera.mockRejectedValue({ code: 'E_OTHER' });
    await renderScreen();
    await press('budget-receipt-camera');
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('camera'));
  });

  it('alerts on a non-cancel gallery error', async () => {
    mockOpenPicker.mockRejectedValue({ code: 'E_OTHER' });
    await renderScreen();
    await press('budget-receipt-gallery');
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('photo library'));
  });

  it('alerts when the document picker throws', async () => {
    mockGetDocumentAsync.mockRejectedValue(new Error('boom'));
    await renderScreen();
    await press('budget-receipt-file');
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.stringContaining('file picker'));
  });

  it('sets an attachment from the Drive picker (mime inferred from name)', async () => {
    await renderScreen();
    // Drive tile opens the cloud picker; selecting a file sets the attachment.
    await press('budget-receipt-drive');
    await press('mock-drive-pick');
    expect(byTestID('budget-receipt-remove')).toBeTruthy();
    expect(byTestID('budget-receipt-scan-button').props.disabled).toBe(false);

    // Scanning forwards the drive file (as a one-item list) with the mime
    // inferred from ".png", plus the (unset) region for the tax fallback.
    await press('budget-receipt-scan-button');
    expect(mockScanReceipt).toHaveBeenCalledWith(
      'hh-test',
      [{ uri: mockDriveFile.uri, name: 'grocery.png', type: 'image/png' }],
      { country: null, stateProvince: null },
      [],
      // Progress sink for the streamed scan — see receiptScanProgress.
      expect.any(Function)
    );
  });
});

describe('BudgetReceiptScanScreen — intro copy', () => {
  it('renders the receipt intro copy so the purpose is visible', async () => {
    await renderScreen();
    // The description must be present/legible before any attachment is picked
    // (regression guard for the copy-visibility fix).
    expect(collectRenderedText(tree)).toContain(
      'Snap any receipt — each item is added as an expense and discounts are tracked as savings.'
    );
  });
});

describe('BudgetReceiptScanScreen — chat prefill', () => {
  it('loads drafts stashed by Budget chat on mount, no scan needed', async () => {
    mockTakePendingReceiptDraft.mockReturnValueOnce({
      vendor: 'Costco',
      purchase_date: '2026-07-20',
      category_id: 'cat-groceries',
      category_name: 'Groceries',
      items: [
        { name: 'eggs', amount: 399, saved_amount: 0 },
        { name: 'coffee', amount: 1299, saved_amount: 200 },
      ],
    });

    await renderScreen();

    // Drafts appear from the stashed chat scan with no attachment / scan call.
    expect(mockScanReceipt).not.toHaveBeenCalled();
    expect(draftCount()).toBe(2);
    expect(inputValueAt('budget-receipt-name', 0)).toBe('eggs');
    expect(inputValueAt('budget-receipt-amount', 1)).toBe('12.99');
    expect(inputValueAt('budget-receipt-saved', 1)).toBe('2.00');

    // Saving persists them with the stashed vendor/date/category.
    await press('budget-receipt-save');
    const [householdId, items] = mockAddExpensesBulk.mock.calls[0];
    expect(householdId).toBe('hh-test');
    expect(items).toEqual([
      expect.objectContaining({
        title: 'eggs',
        amount: 399,
        expense_date: '2026-07-20',
        category_id: 'cat-groceries',
        vendor: 'Costco',
      }),
      expect.objectContaining({ title: 'coffee', amount: 1299, saved_amount: 200 }),
    ]);
  });
});

describe('BudgetReceiptScanScreen — scanning', () => {
  it('scans the attachment and renders editable drafts + totals', async () => {
    await renderScreen();
    await scan();

    expect(mockScanReceipt).toHaveBeenCalledWith(
      'hh-test',
      [{ uri: RECEIPT.uri, name: RECEIPT.name /* receipt.jpg */, type: RECEIPT.mime /* image/jpeg */ }],
      { country: null, stateProvince: null },
      [],
      expect.any(Function)
    );
    expect(draftCount()).toBe(2);
    expect(inputValueAt('budget-receipt-name', 0)).toBe('milk');
    expect(inputValueAt('budget-receipt-amount', 1)).toBe('5.99');
    expect(inputValueAt('budget-receipt-saved', 1)).toBe('2.79');
    // Both included → "Add 2 items".
    expect(collectRenderedText(tree)).toContain('Add 2 items');
  });

  it('alerts when the receipt yields no items', async () => {
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, items: [] });
    await renderScreen();
    await scan();
    expect(Alert.alert).toHaveBeenCalledWith('Nothing found', expect.any(String));
  });

  it('alerts when the scan API rejects', async () => {
    mockScanReceipt.mockRejectedValue(new Error('boom'));
    await renderScreen();
    await scan();
    expect(Alert.alert).toHaveBeenCalledWith('Error', expect.any(String));
  });
});

describe('BudgetReceiptScanScreen — editing drafts', () => {
  it('excluding an item lowers the count and skips it on save', async () => {
    await renderScreen();
    await scan();

    await pressAt('budget-receipt-toggle', 1); // exclude greek yogurt
    expect(collectRenderedText(tree)).toContain('Add 1 item');

    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledTimes(1);
    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk', amount: 349, saved_amount: 0 }),
    ]);
  });

  it('edits an item price/savings and reflects it on save', async () => {
    await renderScreen();
    await scan();

    await setInputAt('budget-receipt-amount', 0, '4.00');
    await setInputAt('budget-receipt-saved', 0, '1.50');
    await press('budget-receipt-save');

    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([
        expect.objectContaining({ title: 'milk', amount: 400, saved_amount: 150 }),
      ])
    );
  });

  it('edits an item name and reflects it on save', async () => {
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-name', 0, 'oat milk');
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([
        expect.objectContaining({ title: 'oat milk', amount: 349 }),
      ])
    );
  });

  it('removes an item', async () => {
    await renderScreen();
    await scan();
    await pressAt('budget-receipt-remove-item', 0);
    expect(draftCount()).toBe(1);
  });

  it('defaults each item to the scanned category and lets you change one', async () => {
    await renderScreen();
    await scan();

    // Both cards default to the receipt's resolved category (Groceries).
    expect(uniqueNodes('budget-receipt-category', 'onPress')).toHaveLength(2);

    // Open the second card's category picker and switch it to Alcohol.
    await pressAt('budget-receipt-category', 1);
    await press('budget-receipt-category-cat-alcohol');

    await press('budget-receipt-save');
    const [, items] = mockAddExpensesBulk.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({ title: 'milk', category_id: 'cat-groceries' }),
      expect.objectContaining({ title: 'greek yogurt', category_id: 'cat-alcohol' }),
    ]);
  });

  it('honors the AI per-item category from the scan as each card default', async () => {
    // The scan now returns a distinct category PER item (milk→Groceries,
    // wine→Alcohol). Each card must default to ITS own category, and saving
    // must carry the per-item category without the user touching anything.
    mockScanReceipt.mockResolvedValue({
      vendor: 'Superstore',
      purchase_date: '2026-07-01',
      category_id: 'cat-groceries',
      category_name: 'Groceries',
      items: [
        { name: 'milk', amount: 349, saved_amount: 0, category_id: 'cat-groceries', category_name: 'Groceries' },
        { name: 'wine', amount: 1999, saved_amount: 0, category_id: 'cat-alcohol', category_name: 'Alcohol' },
      ],
    });

    await renderScreen();
    await scan();
    await press('budget-receipt-save');

    const [, items] = mockAddExpensesBulk.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({ title: 'milk', category_id: 'cat-groceries' }),
      expect.objectContaining({ title: 'wine', category_id: 'cat-alcohol' }),
    ]);
  });

  it('creates a missing category from a card picker and assigns it to that line', async () => {
    await renderScreen();
    await scan();

    await pressAt('budget-receipt-category', 1);
    await act(async () => {
      byTestID('budget-receipt-category-search').props.onChangeText('Cat show fees');
      await Promise.resolve();
    });
    await press('budget-receipt-category-create');

    expect(mockCreateCategory).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ name: 'Cat show fees', icon: 'tag' })
    );

    await press('budget-receipt-save');
    const [, items] = mockAddExpensesBulk.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({ title: 'milk', category_id: 'cat-groceries' }),
      expect.objectContaining({ title: 'greek yogurt', category_id: 'cat-new' }),
    ]);
  });

  it('can clear a card category via "No category" so the item saves uncategorized', async () => {
    await renderScreen();
    await scan();

    await pressAt('budget-receipt-category', 0);
    await press('budget-receipt-category-none');

    await press('budget-receipt-save');
    const [, items] = mockAddExpensesBulk.mock.calls[0];
    // milk was explicitly cleared → saved with no category (not the receipt one);
    // greek yogurt keeps its default Groceries category.
    expect(items[0]).toEqual(expect.objectContaining({ title: 'milk' }));
    expect(items[0].category_id).toBeUndefined();
    expect(items[1]).toEqual(expect.objectContaining({ title: 'greek yogurt', category_id: 'cat-groceries' }));
  });

  it('adds a blank item', async () => {
    await renderScreen();
    await scan();
    await press('budget-receipt-add-item');
    expect(draftCount()).toBe(3);
  });
});

describe('BudgetReceiptScanScreen — saving', () => {
  it('saves included items with the scanned date/category/vendor then goes back', async () => {
    await renderScreen();
    await scan();
    await press('budget-receipt-save');

    expect(mockAddExpensesBulk).toHaveBeenCalledTimes(1);
    const [householdId, items] = mockAddExpensesBulk.mock.calls[0];
    expect(householdId).toBe('hh-test');
    expect(items).toEqual([
      expect.objectContaining({
        title: 'milk',
        amount: 349,
        saved_amount: 0,
        expense_date: '2026-07-01',
        category_id: 'cat-groceries',
        vendor: 'FreshMart',
      }),
      expect.objectContaining({ title: 'greek yogurt', amount: 599, saved_amount: 279 }),
    ]);
    expect(mockMarkInsightsDirty).toHaveBeenCalledWith('hh-test');
    expect(mockGoBack).toHaveBeenCalled();
  });

  /**
   * A receipt keeps its own printed date when it is recent enough
   * (`resolveReceiptExpenseDate` trusts up to 13 months back), so a July
   * receipt scanned in August files the expenses under JULY. The Spent list is
   * filtered by the selected month, so the screen the member lands back on is
   * unchanged and the import reads as "Save did nothing" — the exact complaint
   * behind this coverage. Every other test in this file pins purchase_date to
   * the month on screen, so the mismatch case had no coverage at all.
   */
  describe('when the receipt lands outside the month on screen', () => {
    it('names the receipt’s month in the toast', async () => {
      budgetStoreState.selectedMonth = 8; // viewing August, receipt says 2026-07-01
      await renderScreen();
      await scan();
      await press('budget-receipt-save');

      const [, items] = mockAddExpensesBulk.mock.calls[0];
      expect(items[0]).toEqual(expect.objectContaining({ expense_date: '2026-07-01' }));
      expect(mockShowToast).toHaveBeenCalledWith('success', 'Added 2 items to Jul 2026');
    });

    /**
     * Naming the month must NOT be accompanied by navigating to it.
     * `selectedMonth` is shared by Home/Planning/Spending/Savings and persisted,
     * so switching it here parked the whole app in the receipt's month long
     * after the import — across launches, and across every E2E flow that ran
     * afterwards (2026-08-22).
     */
    it('does not move the member’s selected month', async () => {
      budgetStoreState.selectedMonth = 8;
      await renderScreen();
      await scan();
      await press('budget-receipt-save');

      expect(mockSetSelectedMonth).not.toHaveBeenCalled();
    });

    it('says just the count when the receipt belongs to the month on screen', async () => {
      budgetStoreState.selectedMonth = 7; // viewing July, receipt says 2026-07-01
      await renderScreen();
      await scan();
      await press('budget-receipt-save');

      expect(mockShowToast).toHaveBeenCalledWith('success', 'Added 2 items');
    });
  });

  it('blocks saving when every item is excluded', async () => {
    await renderScreen();
    await scan();
    await pressAt('budget-receipt-toggle', 0);
    await pressAt('budget-receipt-toggle', 1);
    await press('budget-receipt-save');

    expect(Alert.alert).toHaveBeenCalledWith('Nothing to add', expect.any(String));
    expect(mockAddExpensesBulk).not.toHaveBeenCalled();
  });

  it('warns before skipping selected items that are missing a name or price', async () => {
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _msg, buttons) => {
        // Simulate the user confirming "Add anyway".
        const confirm = buttons?.find((b) => b.text === 'Add anyway');
        confirm?.onPress?.();
      });

    await renderScreen();
    await scan();
    // Blank out the price of the first selected item so it becomes invalid.
    await setInputAt('budget-receipt-amount', 0, '');
    await press('budget-receipt-save');

    expect(alertSpy).toHaveBeenCalledWith(
      'Some items will be skipped',
      expect.stringContaining('1'),
      expect.any(Array)
    );
    // Only the valid item is persisted.
    expect(mockAddExpensesBulk).toHaveBeenCalledTimes(1);
    const [, items] = mockAddExpensesBulk.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({ title: 'greek yogurt', amount: 599 }),
    ]);
  });

  it('shows an error toast and stays on screen when a save fails', async () => {
    mockAddExpensesBulk.mockRejectedValue(new Error('nope'));
    await renderScreen();
    await scan();
    await press('budget-receipt-save');
    expect(mockShowToast).toHaveBeenCalledWith('error', expect.any(String));
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe('BudgetReceiptScanScreen — navigation', () => {
  it('cancels back out of the screen', async () => {
    await renderScreen();
    await press('nav-back-button');
    expect(mockGoBack).toHaveBeenCalled();
  });
});

describe('BudgetReceiptScanScreen — sales tax', () => {
  it('renders Subtotal / per-label tax / Total and a per-line tax hint', async () => {
    mockScanReceipt.mockResolvedValue(TAXED_SCAN);
    await renderScreen();
    await scan();

    // collectRenderedText yields per-node fragments; join to match visual text.
    const text = collectRenderedText(tree).join('');
    expect(text).toContain('Subtotal'); // = $15.00 (1620 − 120)
    expect(text).toContain('GST'); // breakdown labels from the scan result
    expect(text).toContain('PST');
    expect(text).toContain('Total (incl. tax)');
    // Bags line is tax-inclusive ($11.20) and shows how much of that is tax.
    expect(text).toContain('incl. $1.20 tax');
    expect(inputValueAt('budget-receipt-amount', 1)).toBe('11.20');
    // Milk is exempt → its amount is unchanged and it carries no tax hint.
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('5.00');
  });

  it('bulk-saves the tax-inclusive amount plus a per-line tax_amount', async () => {
    mockScanReceipt.mockResolvedValue(TAXED_SCAN);
    await renderScreen();
    await scan();
    await press('budget-receipt-save');

    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk', amount: 500, tax_amount: 0 }),
      expect.objectContaining({ title: 'bags', amount: 1120, tax_amount: 120 }),
    ]);
  });

  it('nudges to set a Region when no tax was detected and none is set', async () => {
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, tax_source: 'none' });
    useAppStore.setState({ taxCountry: null, taxRegion: null });
    await renderScreen();
    await scan();

    expect(allByTestID('budget-receipt-tax-notice').length).toBeGreaterThan(0);
    expect(collectRenderedText(tree).join('')).toContain('Region');
  });

  it('shows a neutral no-tax notice (no Region prompt) when a region is set', async () => {
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, tax_source: 'none' });
    useAppStore.setState({ taxCountry: 'CA', taxRegion: 'BC' });
    await renderScreen();
    await scan();

    expect(collectRenderedText(tree).join('')).toContain('No sales tax was printed');
  });
});

describe('BudgetReceiptScanScreen — multi-file (one long receipt)', () => {
  it('adds several gallery photos as ONE receipt and scans them together', async () => {
    const part2 = { path: 'file:///r/part2.jpg', filename: 'part2.jpg', mime: 'image/jpeg' };
    mockOpenPicker.mockResolvedValue([RECEIPT_IMAGE, part2]);
    await renderScreen();
    await press('budget-receipt-gallery');

    // Two attachment chips + the "N sections" hint.
    expect(uniqueNodes('budget-receipt-remove', 'onPress').length).toBe(2);
    expect(collectRenderedText(tree).join('')).toContain('2 sections');

    await press('budget-receipt-scan-button');
    const [householdId, files, region] = mockScanReceipt.mock.calls[0];
    expect(householdId).toBe('hh-test');
    expect(files).toHaveLength(2);
    expect(region).toEqual({ country: null, stateProvince: null });
  });

  it('removes one section without clearing the other', async () => {
    const part2 = { path: 'file:///r/part2.jpg', filename: 'part2.jpg', mime: 'image/jpeg' };
    mockOpenPicker.mockResolvedValue([RECEIPT_IMAGE, part2]);
    await renderScreen();
    await press('budget-receipt-gallery');
    expect(uniqueNodes('budget-receipt-remove', 'onPress').length).toBe(2);

    await pressAt('budget-receipt-remove', 0);
    expect(uniqueNodes('budget-receipt-remove', 'onPress').length).toBe(1);
    // One section left → scanning is still enabled.
    expect(byTestID('budget-receipt-scan-button').props.disabled).toBe(false);
  });
});

describe('BudgetReceiptScanScreen — v2 review', () => {
  const V2_SCAN: GroceryReceiptScanResult = {
    vendor: 'Real Canadian Superstore',
    purchase_date: '2026-07-01',
    category_id: 'cat-groceries',
    category_name: 'Groceries',
    items: [
      {
        raw_name: 'ICE CREAM 4L',
        raw_code: '06038302715',
        name: 'Ice Cream',
        name_suggestions: ['Ice Cream', 'Ice Cream 4l', 'Frozen Dessert'],
        amount: 699,
        tax_amount: 0,
        saved_amount: 0,
        deposit_amount: 25,
        fees: [{ kind: 'deposit', label: 'Deposit', amount: 25 }],
        category_id: 'cat-groceries',
        category_name: 'Groceries',
        category_suggestions: [{ id: 'cat-household', name: 'Household' }],
      },
    ],
  };

  it('shows store, name chips, category chips, tax pill, and fee chips', async () => {
    mockScanReceipt.mockResolvedValue(V2_SCAN);
    await renderScreen();
    await scan();

    expect(inputValueAt('budget-receipt-store', 0)).toBe('Real Canadian Superstore');
    expect(allByTestID('budget-receipt-name-chips').length).toBeGreaterThan(0);
    expect(allByTestID('budget-receipt-category-chips').length).toBeGreaterThan(0);
    expect(allByTestID('budget-receipt-tax-pill').length).toBeGreaterThan(0);
    expect(allByTestID('budget-receipt-fee-chips').length).toBeGreaterThan(0);
    const text = collectRenderedText(tree).join('');
    expect(text).toContain('Ice Cream 4l');
    expect(text).toContain('No tax');
    expect(text).toContain('Deposit');
    expect(text).toContain('Household');
  });

  it('applying a category chip updates the saved category', async () => {
    mockScanReceipt.mockResolvedValue(V2_SCAN);
    await renderScreen();
    await scan();
    const chips = tree.root.findAll(
      (n) => n.props?.testID === 'budget-receipt-category-chip' && typeof n.props?.onPress === 'function'
    );
    expect(chips.length).toBeGreaterThan(0);
    await act(async () => {
      chips[0].props.onPress();
      await Promise.resolve();
    });
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      [expect.objectContaining({ title: 'Ice Cream', category_id: 'cat-household' })]
    );
  });

  it('More reveals the remaining name chips so the user can apply them', async () => {
    mockScanReceipt.mockResolvedValue({
      ...V2_SCAN,
      items: [
        {
          ...V2_SCAN.items[0],
          name_suggestions: [
            'Ice Cream',
            'Ice Cream 4l',
            'Frozen Dessert',
            'Vanilla Ice Cream',
            'Tub Ice Cream',
          ],
        },
      ],
    });
    await renderScreen();
    await scan();
    expect(allByTestID('budget-receipt-name-more').length).toBeGreaterThan(0);
    const more = tree.root.findAll(
      (n) => n.props?.testID === 'budget-receipt-name-more' && typeof n.props?.onPress === 'function'
    )[0];
    await act(async () => {
      more.props.onPress();
      await Promise.resolve();
    });
    const vanilla = tree.root.findAll(
      (n) => n.props?.label === 'Vanilla Ice Cream' && typeof n.props?.onPress === 'function'
    );
    expect(vanilla.length).toBeGreaterThan(0);
    await act(async () => {
      vanilla[0].props.onPress();
      await Promise.resolve();
    });
    expect(inputValueAt('budget-receipt-name', 0)).toBe('Vanilla Ice Cream');
  });

  it('applying a name chip updates the draft name', async () => {
    mockScanReceipt.mockResolvedValue(V2_SCAN);
    await renderScreen();
    await scan();
    const chips = tree.root.findAll(
      (n) => n.props?.label === 'Ice Cream 4l' && typeof n.props?.onPress === 'function'
    );
    expect(chips.length).toBeGreaterThan(0);
    await act(async () => {
      chips[0].props.onPress();
      await Promise.resolve();
    });
    expect(inputValueAt('budget-receipt-name', 0)).toBe('Ice Cream 4l');
  });

  it('removing a fee chip subtracts from amount and deposit', async () => {
    mockScanReceipt.mockResolvedValue(V2_SCAN);
    await renderScreen();
    await scan();
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('6.99');
    const feeChip = tree.root.findAll(
      (n) => typeof n.props?.onRemove === 'function' && String(n.props?.label ?? '').includes('Deposit')
    )[0];
    await act(async () => {
      feeChip.props.onRemove();
      await Promise.resolve();
    });
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('6.74');
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      [expect.objectContaining({ title: 'Ice Cream', amount: 674, deposit_amount: 0 })]
    );
  });

  it('saves deposit_amount and vendor, and upserts aliases', async () => {
    mockScanReceipt.mockResolvedValue(V2_SCAN);
    await renderScreen();
    await scan();
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      [
        expect.objectContaining({
          title: 'Ice Cream',
          amount: 699,
          deposit_amount: 25,
          vendor: 'Real Canadian Superstore',
        }),
      ]
    );
    expect(mockUpsertAliases).toHaveBeenCalledWith([
      expect.objectContaining({ key: '06038302715', name: 'Ice Cream' }),
    ]);
  });

  it('renders a complete Costco analysis: store, Kumato, tax only on Roti, milk fees, apply chips', async () => {
    const draft = buildReceiptDraftFromRaw(
      {
        vendor: 'Costco Wholesale',
        purchase_date: '2026-07-01',
        receipt_country: 'CA',
        receipt_region: 'BC',
        tax_summary: [{ code: 'G', label: 'TAX', rate_percent: null, amount: 40 }],
        items: [
          {
            raw_name: '1% MILK',
            raw_code: '1281',
            name: '1% Milk',
            name_suggestions: ['1% Milk', 'Milk', '1% Milk'],
            amount: 573,
            saved_amount: 0,
            tax_codes: [],
            category: 'Dairy',
            category_suggestions: ['Groceries'],
            fees: [
              { kind: 'environmental', label: 'Enviro fee', amount: 7 },
              { kind: 'deposit', label: 'Deposit', amount: 10 },
            ],
          },
          {
            raw_name: 'KUMATO',
            raw_code: '43483',
            name: 'Kumato',
            name_suggestions: ['Kumato', 'Kumato Tomato', 'Tomatoes'],
            amount: 2097,
            saved_amount: 0,
            tax_codes: [],
            category: 'Produce',
            category_suggestions: ['Groceries'],
            fees: [],
          },
          {
            raw_name: 'ROTI CHICKEN',
            raw_code: '347937',
            name: 'Roti Chicken',
            name_suggestions: ['Roti Chicken', 'Chicken Roti', 'Prepared Food'],
            amount: 799,
            saved_amount: 0,
            tax_codes: ['G'],
            category: 'Groceries',
            category_suggestions: ['Household'],
            fees: [],
          },
        ],
      },
      CATEGORIES,
    );
    mockScanReceipt.mockResolvedValue(draft);
    await renderScreen();
    await scan();

    expect(inputValueAt('budget-receipt-store', 0)).toBe('Costco Wholesale');
    const text = collectRenderedText(tree).join('\n');
    expect(text).toMatch(/Kumato Tomato/);
    expect(text).toMatch(/Chicken Roti|Prepared Food/);
    expect(text).toMatch(/Enviro fee/);
    expect(text).toMatch(/Deposit/);
    expect(text).toMatch(/No tax/);
    expect(text).toMatch(/\bTax\b/);
    const taxLabels = tree.root
      .findAll((n) => n.props?.label === 'Tax' || n.props?.label === 'No tax')
      .map((n) => n.props.label as string);
    expect(taxLabels.filter((l) => l === 'Tax')).toHaveLength(1);
    expect(taxLabels.filter((l) => l === 'No tax').length).toBeGreaterThanOrEqual(2);
    const feeLabels = tree.root
      .findAll((n) => typeof n.props?.label === 'string' && typeof n.props?.onRemove === 'function')
      .map((n) => String(n.props.label));
    expect(feeLabels.some((l) => /enviro/i.test(l))).toBe(true);
    expect(feeLabels.some((l) => /deposit/i.test(l))).toBe(true);
    expect(draft.items.filter((i) => (i.tax_amount ?? 0) > 0)).toHaveLength(1);

    const kumatoChip = tree.root.findAll(
      (n) => n.props?.label === 'Kumato Tomato' && typeof n.props?.onPress === 'function'
    )[0];
    await act(async () => {
      kumatoChip.props.onPress();
      await Promise.resolve();
    });
    expect(inputValueAt('budget-receipt-name', 1)).toBe('Kumato Tomato');

    const catChip = tree.root.findAll(
      (n) => n.props?.testID === 'budget-receipt-category-chip' && n.props?.label === 'Groceries'
    )[0];
    await act(async () => {
      catChip.props.onPress();
      await Promise.resolve();
    });
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([
        expect.objectContaining({ title: '1% Milk', category_id: 'cat-groceries' }),
        expect.objectContaining({ title: 'Kumato Tomato' }),
        expect.objectContaining({ title: 'Roti Chicken', tax_amount: 40 }),
      ]),
    );
  });

  function liveDraft(label: string): GroceryReceiptScanResult {
    const row = liveGemini.find((r) => r.label === label);
    if (!row || !('items' in row)) throw new Error(`missing ${label}`);
    return buildReceiptDraftFromRaw(
      {
        vendor: row.vendor,
        purchase_date: row.purchase_date,
        receipt_country: 'CA',
        receipt_region: 'BC',
        tax_summary: row.tax_summary,
        items: row.items,
      } as RawReceiptDraft,
      CATEGORIES,
    );
  }

  it('live Superstore analysis fills store, Title Case chips, No tax, and milk fee pills', async () => {
    mockScanReceipt.mockResolvedValue(liveDraft('superstore'));
    await renderScreen();
    await scan();
    expect(inputValueAt('budget-receipt-store', 0)).toBe('Real Canadian Superstore');
    const text = collectRenderedText(tree).join('\n');
    expect(text).toMatch(/Prt Skm Milk 1%/);
    expect(text).toMatch(/No tax/);
    expect(text).toMatch(/RECYCLING FEE|Recycling/i);
    expect(text).toMatch(/DEPOSIT 1|Deposit/i);
    expect(allByTestID('budget-receipt-name-chip').length).toBeGreaterThan(0);
    const milkChip = tree.root.findAll(
      (n) => n.props?.label === 'Prt Skm Milk 1%' && typeof n.props?.onPress === 'function'
    )[0];
    await act(async () => {
      milkChip.props.onPress();
      await Promise.resolve();
    });
    expect(
      tree.root
        .findAll((n) => n.props?.testID === 'budget-receipt-name' && typeof n.props?.onChangeText === 'function')
        .some((n) => n.props.value === 'Prt Skm Milk 1%'),
    ).toBe(true);
  });

  it('live BCL analysis shows Canadian Club, deposit fee, Tax pill, and apply works', async () => {
    mockScanReceipt.mockResolvedValue(liveDraft('bcl'));
    await renderScreen();
    await scan();
    expect(inputValueAt('budget-receipt-store', 0)).toBe('BC Liquor Store');
    const text = collectRenderedText(tree).join('\n');
    expect(text).toMatch(/Canadian Club/);
    expect(inputValueAt('budget-receipt-name', 0)).toMatch(/canadian club/i);
    expect(text).toMatch(/Container Deposit|Deposit/);
    expect(text).toMatch(/\bTax\b/);
    const nameChips = tree.root.findAll(
      (n) => n.props?.testID === 'budget-receipt-name-chip' && typeof n.props?.onPress === 'function'
    );
    expect(nameChips.length).toBeGreaterThan(0);
    const applied = String(nameChips[0].props.label);
    await act(async () => {
      nameChips[0].props.onPress();
      await Promise.resolve();
    });
    expect(inputValueAt('budget-receipt-name', 0)).toBe(applied);
  });
});

/**
 * Foreign receipts — a receipt bought abroad prints its own currency, and the
 * budget it lands in is kept in the member's.
 *
 * The invariant under test: amounts stay in the receipt's currency for the
 * whole review (the member is checking them against the paper) and are
 * converted exactly once, at save. A domestic receipt must be untouched by all
 * of it.
 */
describe('BudgetReceiptScanScreen — foreign currency', () => {
  /** SCAN_RESULT (milk 349, yogurt 599 saving 279) as a US receipt. */
  const USD_SCAN = { ...SCAN_RESULT, receipt_currency: 'USD' };

  const rateCaption = () => byTestID('budget-receipt-rate-caption').props.children;

  it('leaves a domestic receipt alone: no rate row, amounts saved as printed', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, receipt_currency: 'CAD' });
    await renderScreen();
    await scan();

    expect(allByTestID('budget-receipt-rate')).toHaveLength(0);
    expect(allByTestID('budget-receipt-converted-total')).toHaveLength(0);
    expect(mockGetExchangeRate).not.toHaveBeenCalled();

    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk', amount: 349, saved_amount: 0 }),
      expect.objectContaining({ title: 'greek yogurt', amount: 599, saved_amount: 279 }),
    ]);
  });

  it('treats an unmarked receipt as domestic rather than guessing', async () => {
    // The regression guard: `currency` is USD for everyone who never opened
    // Settings → Currency, so a Canadian receipt must not look "foreign" to an
    // unconfigured member and block their weekly shop behind a rate.
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: null,
      receipt_country: 'CA',
    });
    await renderScreen();
    await scan();

    expect(allByTestID('budget-receipt-rate')).toHaveLength(0);
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk', amount: 349 }),
      expect.objectContaining({ title: 'greek yogurt', amount: 599 }),
    ]);
  });

  it('prefills the fetched rate and shows what the receipt converts to', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();

    expect(mockGetExchangeRate).toHaveBeenCalledWith('USD', 'CAD');
    expect(inputValueAt('budget-receipt-rate', 0)).toBe('1.3712');
    expect(rateCaption()).toContain('2026-09-04');
    // The Price field holds the MEMBER's currency — that is what will land in
    // the budget, so it is what they see and edit. 349 x 1.3712 = 478.55 -> 4.79.
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('4.79');
    // The printed figure is still shown, as the working behind that number.
    expect(byTestID('budget-receipt-converted-total')).toBeTruthy();
  });

  it('shows each line in BOTH currencies, not just the receipt\'s', async () => {
    // The Price field is a bare number in the receipt's currency, so on its own
    // it tells a member budgeting in CAD nothing about what they spent. The
    // grand total answers that for the whole receipt, not for the line in front
    // of them.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();

    const hints = uniqueNodes('budget-receipt-line-converted', 'onPress');
    const text = allByTestID('budget-receipt-line-converted')
      .map((n) => n.props.children)
      .join(' ');
    // milk 349 -> US$3.49; 349 x 1.3712 = 478.55 -> CA$4.79
    expect(text).toContain('$3.49');
    expect(text).toContain('4.79');
    expect(hints.length + allByTestID('budget-receipt-line-converted').length).toBeGreaterThan(0);
  });

  it('shows the per-line TAX in both currencies too', async () => {
    useAppStore.setState({ currency: 'CAD' });
    // A taxed US line: 500 total of which 120 is tax.
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: 'USD',
      items: [{ name: 'bags', amount: 500, tax_amount: 120, saved_amount: 0 }],
    });
    await renderScreen();
    await scan();

    const taxText = allByTestID('budget-receipt-tax-pill')
      .concat(allByTestID('budget-receipt-amount'))
      .length; // presence guard; the hint itself is asserted below
    expect(taxText).toBeGreaterThan(0);
    const hint = tree.root
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string)
      .find((t) => t.startsWith('incl.'));
    // 120 x 1.3712 = 164.5 -> 165  => CA$1.65, alongside the printed US$1.20
    expect(hint).toContain('$1.20');
    expect(hint).toContain('1.65');
  });

  it('does not warn about a blank row the member never filled in', async () => {
    // "Add item" creates a row pre-checked and empty. Tapping it and changing
    // your mind used to produce "1 selected item is missing a name or price"
    // on the way out — a warning about nothing.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, receipt_currency: 'CAD' });
    await renderScreen();
    await scan();
    await press('budget-receipt-add-item');
    await press('budget-receipt-save');

    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Some items will be skipped',
      expect.anything(),
      expect.anything(),
    );
    // The real rows still save.
    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk' }),
      expect.objectContaining({ title: 'greek yogurt' }),
    ]);
  });

  it('still warns when a selected row has a name but no price', async () => {
    // That row holds real intent — dropping it silently is the bug the warning
    // was written for, so the blank-row fix must not swallow it too.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, receipt_currency: 'CAD' });
    await renderScreen();
    await scan();
    await press('budget-receipt-add-item');
    const nameFields = uniqueNodes('budget-receipt-name', 'onChangeText');
    await setInputAt('budget-receipt-name', nameFields.length - 1, 'Forgot the price');
    await press('budget-receipt-save');

    expect(Alert.alert).toHaveBeenCalledWith(
      'Some items will be skipped',
      expect.stringContaining('1 selected item'),
      expect.anything(),
    );
  });

  it('prices a US fuel line per LITRE, in both currencies', async () => {
    // US-recept-1.HEIC: Kendall Market, "Supreme-+ 10.068G", $61.40 total.
    // 10.068 US gal = 38.11 L -> US$1.611/L, and at 1.3712 -> CA$2.209/L.
    // Converting only the currency would leave "CA$8.42/gal", which means
    // nothing to someone who buys fuel by the litre.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: 'USD',
      items: [
        {
          name: 'Supreme Gasoline',
          amount: 6140,
          saved_amount: 0,
          quantity: 10.068,
          unit: 'G',
        },
      ],
    });
    await renderScreen();
    await scan();

    const text = allByTestID('budget-receipt-per-litre')
      .map((n) => n.props.children)
      .join(' ');
    expect(text).toContain('38.1 L');
    // Quoted in the member's currency: a Canadian driver compares against the
    // station down the road, and "$1.611/L" in dollars of another size is not
    // a number they can use.
    expect(text).toMatch(/CA\$2\.2\d\d\/L/);
  });

  it('shows no per-litre price for a line that is not a volume', async () => {
    // Weight and plain counts have no per-litre price; inventing one would be
    // worse than omitting it.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: 'USD',
      items: [
        { name: 'Carrots', amount: 199, saved_amount: 0, quantity: 2.4, unit: 'lb' },
        { name: 'Milk', amount: 349, saved_amount: 0 },
      ],
    });
    await renderScreen();
    await scan();
    expect(allByTestID('budget-receipt-per-litre')).toHaveLength(0);
  });

  it('shows no per-line conversion for a domestic receipt', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, receipt_currency: 'CAD' });
    await renderScreen();
    await scan();
    expect(allByTestID('budget-receipt-line-converted')).toHaveLength(0);
  });

  it('shows the PRICE in the member\'s currency and the receipt\'s as the working', async () => {
    // The whole point of the inversion: the budget is kept in CAD, so the
    // number on screen — and the number being edited — is CAD. The printed
    // USD figure and the rate are shown beside it so the conversion is
    // checkable against the paper rather than taken on trust.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();

    // 349 x 1.3712 = 478.55 -> CA$4.79 in the field.
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('4.79');

    // ...and the working spells out where it came from.
    const working = allByTestID('budget-receipt-line-converted')
      .flatMap((n) => n.findAll((c) => typeof c.props?.children === 'string'))
      .map((n) => n.props.children as string)
      .join(' ');
    expect(working).toContain('$3.49'); // as printed
    expect(working).toContain('1.3712'); // the rate applied
    expect(working).toContain('4.79'); // the result now in the field
  });

  it('re-derives every row from the PRINTED figures when the rate changes', async () => {
    // Converting the displayed number a second time would compound the rate and
    // look entirely plausible, so each pass must start from the receipt.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('4.79');

    await setInputAt('budget-receipt-rate', 0, '2');
    // 349 x 2 = 698 -> 6.98, NOT 4.79 x 2.
    expect(inputValueAt('budget-receipt-amount', 0)).toBe('6.98');
  });

  it('converts every amount exactly once, on save', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await press('budget-receipt-save');

    // 349 × 1.3712 = 478.55 → 479;  599 × 1.3712 = 821.35 → 821
    // 279 × 1.3712 = 382.56 → 383
    expect(mockAddExpensesBulk).toHaveBeenCalledWith('hh-test', [
      expect.objectContaining({ title: 'milk', amount: 479, saved_amount: 0 }),
      expect.objectContaining({ title: 'greek yogurt', amount: 821, saved_amount: 383 }),
    ]);
  });

  it('takes an edited price as the member\'s OWN currency, not the receipt\'s', async () => {
    // The field is labelled with their currency and holds their currency, so a
    // typed 10.00 is CA$10.00 and must be saved as 1000 — not re-converted to
    // CA$13.71, which would silently inflate every correction they make.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-amount', 0, '10.00');
    await press('budget-receipt-save');

    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([expect.objectContaining({ title: 'milk', amount: 1000 })]),
    );
  });

  it('uses a hand-typed rate over the fetched one', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-rate', 0, '1.5');
    await press('budget-receipt-save');

    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([
        expect.objectContaining({ title: 'milk', amount: 524 }), // 349 × 1.5 = 523.5 → 524
      ]),
    );
  });

  it('derives the rate from what the card was actually charged', async () => {
    // SCAN_RESULT totals US$9.48 (349 + 599). A statement line of CA$13.00
    // implies 13.00 / 9.48 = 1.3713 — the rate the member really paid, spread
    // and foreign-transaction fee included.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-charged', 0, '13.00');
    await press('budget-receipt-charged-apply');

    // The rate box now shows the derived rate and stops being editable, so the
    // two inputs cannot fight over the same number.
    const rateNode = uniqueNodes('budget-receipt-rate', 'onChangeText')[0];
    expect(rateNode.props.value).toMatch(/^1\.371/);
    expect(rateNode.props.editable).toBe(false);
    expect(rateCaption()).toContain('what you were charged');

    await press('budget-receipt-save');
    // Lines convert at the DERIVED rate, and still sum to the charged total.
    const [, saved] = mockAddExpensesBulk.mock.calls[0];
    const total = (saved as Array<{ amount: number }>).reduce((n, i) => n + i.amount, 0);
    expect(total).toBe(1300);
  });

  it('falls back to the fetched rate when the charged total is cleared', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-charged', 0, '13.00');
    await press('budget-receipt-charged-apply');
    await setInputAt('budget-receipt-charged', 0, '');
    await press('budget-receipt-charged-apply');

    const rateNode = uniqueNodes('budget-receipt-rate', 'onChangeText')[0];
    expect(rateNode.props.value).toBe('1.3712');
    expect(rateNode.props.editable).toBe(true);
  });

  it('does NOT recalculate until Apply is pressed', async () => {
    // The whole reason Apply exists: typing "13.00" walks through 1, 13, 13.0,
    // and recalculating on each keystroke churns every line and total under the
    // member while they are still entering the figure.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();
    await setInputAt('budget-receipt-charged', 0, '13.00');

    // Still the fetched rate, still editable — nothing moved.
    const rateNode = uniqueNodes('budget-receipt-rate', 'onChangeText')[0];
    expect(rateNode.props.value).toBe('1.3712');
    expect(rateNode.props.editable).toBe(true);

    await press('budget-receipt-save');
    // Saved at the FETCHED rate, not the typed-but-unapplied one.
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([expect.objectContaining({ title: 'milk', amount: 479 })]),
    );
  });

  it('blocks the save when the rate could not be fetched, until one is typed', async () => {
    useAppStore.setState({ currency: 'CAD' });
    mockGetExchangeRate.mockResolvedValue(null);
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    await renderScreen();
    await scan();

    // Saving a foreign receipt at par is silent corruption — the button says so
    // rather than going quietly grey.
    const save = byTestID('budget-receipt-save');
    expect(save.props.disabled).toBe(true);
    expect(save.props.title).toBe('Enter exchange rate');
    expect(rateCaption()).toContain('Could not fetch a rate');

    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).not.toHaveBeenCalled();

    await setInputAt('budget-receipt-rate', 0, '1.4');
    expect(byTestID('budget-receipt-save').props.disabled).toBe(false);
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([
        expect.objectContaining({ title: 'milk', amount: 489 }), // 349 × 1.4 = 488.6 → 489
      ]),
    );
  });

  it('shows the address the scan read, and what it is used for', async () => {
    // The address already picks the sales-tax profile — a WA receipt is taxed
    // at WA's rates. That was invisible: the tax appeared with nothing saying
    // which jurisdiction produced it, or letting the member catch a misread.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: 'USD',
      receipt_country: 'US',
      receipt_region: 'WA',
    });
    await renderScreen();
    await scan();

    const text = allByTestID('budget-receipt-detected-region')
      .flatMap((n) => n.findAll((c) => typeof c.props?.children === 'string'))
      .map((n) => n.props.children as string)
      .join(' ');
    expect(text).toContain('Washington');
    expect(text).toContain('sales tax');
  });

  it('says nothing about an address the scan could not read', async () => {
    // An absent address is not a jurisdiction of "unknown" — it is simply
    // nothing to show.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: 'USD',
      receipt_country: null,
      receipt_region: null,
    });
    await renderScreen();
    await scan();
    expect(allByTestID('budget-receipt-detected-region')).toHaveLength(0);
  });

  it('lets the member declare a foreign currency BEFORE scanning', async () => {
    // Detection reads a bare "$" with no known home region as the member's own
    // currency — correct, and useless to someone who knows this one is
    // American. The prompt is available before a photo is even attached.
    useAppStore.setState({ currency: 'CAD', taxCountry: null, taxRegion: null });
    mockScanReceipt.mockResolvedValue({
      ...SCAN_RESULT,
      receipt_currency: null,
      receipt_country: null,
    });
    await renderScreen();

    await press('budget-receipt-currency-hint');
    await press('budget-receipt-currency-USD');
    await scan();

    // The scan must NOT overwrite what the member said.
    expect(byTestID('budget-receipt-rate')).toBeTruthy();
    expect(mockGetExchangeRate).toHaveBeenCalledWith('USD', 'CAD');
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([expect.objectContaining({ title: 'milk', amount: 479 })]),
    );
  });

  it('a stated currency beats what the receipt itself printed', async () => {
    // The member has the paper; detection only has an inference about it. If
    // they say EUR and the receipt says USD, they win.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue(USD_SCAN);
    mockGetExchangeRate.mockResolvedValue({
      from: 'EUR',
      to: 'CAD',
      rate: 1.5,
      asOf: '2026-09-04',
      source: 'fetched',
    });
    await renderScreen();

    await press('budget-receipt-currency-hint');
    await press('budget-receipt-currency-EUR');
    await scan();

    expect(mockGetExchangeRate).toHaveBeenCalledWith('EUR', 'CAD');
  });

  it('says nothing when the member has no opinion', async () => {
    // Unstated, the prompt is an invitation and not a claim — it must not
    // assert a currency the member never chose.
    useAppStore.setState({ currency: 'CAD' });
    await renderScreen();
    // Read the rendered strings, not props.children — the latter is a React
    // element graph and JSON.stringify walks it into a circular reference.
    const text = byTestID('budget-receipt-currency-hint')
      .findAll((n) => typeof n.props?.children === 'string')
      .map((n) => n.props.children as string)
      .join(' ');
    expect(text).toContain('another currency');
    // The stated form names a currency ("Bought in Euro (EUR) — converts to
    // CAD"); the unstated one must never do that, or it reads as a decision the
    // member did not make.
    expect(text).not.toMatch(/Bought in .+ \([A-Z]{3}\)/);
    expect(text).not.toContain('converts to');
  });

  it('lets the member correct a receipt whose currency was misread', async () => {
    // A receipt that printed a bare "$" arrives as the member's own currency;
    // the picker is how they say otherwise.
    useAppStore.setState({ currency: 'CAD' });
    mockScanReceipt.mockResolvedValue({ ...SCAN_RESULT, receipt_currency: null });
    await renderScreen();
    await scan();
    expect(allByTestID('budget-receipt-rate')).toHaveLength(0);

    await press('budget-receipt-currency');
    await press('budget-receipt-currency-USD');

    expect(mockGetExchangeRate).toHaveBeenCalledWith('USD', 'CAD');
    await press('budget-receipt-save');
    expect(mockAddExpensesBulk).toHaveBeenCalledWith(
      'hh-test',
      expect.arrayContaining([expect.objectContaining({ title: 'milk', amount: 479 })]),
    );
  });
});
