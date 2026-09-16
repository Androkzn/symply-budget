/**
 * SavingsImportScreen — AI import (draft-then-confirm) end-to-end behaviour.
 *
 * Stubs the heavy `@components/common` barrel (its real `SafeAreaView` pulls
 * the SidebarTabBar → TaskDetail navigator chain that crashes under the mocked
 * `@react-navigation/native`), the file-picker native modules, the savings API,
 * and the stores — then exercises: mount + Analyze gating, paste → importAnalyze
 * renders the 3 review sections, and the two-step "analyze produces a DRAFT,
 * only Save commits" contract (importCommit → markDirty → navigation.goBack).
 */

// SafeAreaView passthrough so the heavy @components/common barrel never loads.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(TouchableOpacity, { testID: 'nav-back-button', onPress: onBackPress }),
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
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// ActionSheetIOS is native-only; pick the first real member (index 1).
const mockShowActionSheet = jest.fn((_opts: unknown, cb: unknown) => (cb as (i: number) => void)(1));
jest.mock('react-native/Libraries/ActionSheetIOS/ActionSheetIOS', () => ({
  __esModule: true,
  default: { showActionSheetWithOptions: (o: unknown, cb: unknown) => mockShowActionSheet(o, cb) },
}));

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}));

const mockOpenPicker = jest.fn();
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: {
    openPicker: (...a: unknown[]) => mockOpenPicker(...a),
  },
}));

const mockManipulateSaveAsync = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  __esModule: true,
  ImageManipulator: {
    manipulate: () => ({ renderAsync: async () => ({ saveAsync: (...a: unknown[]) => mockManipulateSaveAsync(...a) }) }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockHouseholdsGet = jest.fn();
jest.mock('@api/households', () => ({
  householdsApi: {
    get: (...a: unknown[]) => mockHouseholdsGet(...a),
  },
}));

jest.mock('@components/cloud-storage', () => ({
  CloudFilePicker: ({
    visible,
    onFileSelected,
    onClose,
  }: {
    visible: boolean;
    onFileSelected: (f: { uri: string; name: string; size: number }) => void;
    onClose: () => void;
  }) =>
    visible
      ? require('react').createElement(require('react-native').View, {
          testID: 'cloud-file-picker',
          onFileSelected,
          onClose,
        })
      : null,
}));

const mockImportAnalyze = jest.fn();
const mockImportAnalyzeWithFile = jest.fn();
const mockImportGet = jest.fn();
const mockImportCommit = jest.fn();

jest.mock('@api/savings', () => ({
  savingsApi: {
    importAnalyze: (...args: unknown[]) => mockImportAnalyze(...args),
    importAnalyzeWithFile: (...args: unknown[]) => mockImportAnalyzeWithFile(...args),
    importGet: (...args: unknown[]) => mockImportGet(...args),
    importCommit: (...args: unknown[]) => mockImportCommit(...args),
  },
}));

const mockMarkDirty = jest.fn();
const mockSetSelectedMonth = jest.fn();

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = {
      selectedYear: 2026,
      selectedMonth: 7,
      dataRevision: 0,
      markDirty: mockMarkDirty,
      setSelectedMonth: mockSetSelectedMonth,
    };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { fixture, pickerAsset } from '../../../../test-utils/fixtures';
import { SavingsImportScreen } from '../SavingsImportScreen';

// Real documents from resourses/testing (see e2e/fixtures/manifest.json).
const SAVINGS = fixture('budget-savings-statement'); // savings-statement.jpg
// react-native-image-crop-picker (gallery) shape for the real savings image.
const SAVINGS_IMAGE = { path: SAVINGS.uri, filename: SAVINGS.name, mime: SAVINGS.mime };

/** A full draft (one row per section) mirroring SavingsImportDraft. */
const DRAFT = {
  income: [
    {
      member_name: 'Andrei',
      source_type: 'payroll' as const,
      label: 'Salary',
      amount_cents: 500000,
      income_date: '2026-07-01',
      is_recurring: true,
      day_of_month: 1,
    },
  ],
  spending: [
    {
      category_name: 'Utilities',
      label: 'Hydro',
      amount_cents: 12000,
      spending_date: '2026-07-05',
    },
  ],
  recurringPayments: [
    {
      label: 'Internet',
      amount_cents: 8000,
      category_name: null,
      day_of_month: 15,
      group_label: 'Other',
      is_essential: false,
    },
  ],
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <SavingsImportScreen />
      </ThemeProvider>
    );
    // Flush the on-mount householdsApi.get so its setMembers update is wrapped in act.
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
}

/** Paste text and press Analyze, awaiting the async resolution. */
async function pasteAndAnalyze(root: ReactTestRenderer.ReactTestInstance, text: string) {
  await act(async () => {
    root.findByProps({ testID: 'savings-import-input' }).props.onChangeText(text);
  });
  await act(async () => {
    await root.findByProps({ testID: 'savings-import-analyze' }).props.onPress();
  });
}

describe('SavingsImportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImportAnalyze.mockResolvedValue({ jobId: 'job-1', draft: DRAFT });
    mockImportAnalyzeWithFile.mockResolvedValue({ jobId: 'job-1', draft: DRAFT });
    mockImportGet.mockResolvedValue({ job: { status: 'ready' }, draft: DRAFT });
    mockImportCommit.mockResolvedValue({ income: 1, spending: 1, recurringPayments: 1 });
    mockHouseholdsGet.mockResolvedValue({
      members: [
        { id: 'm1', user_id: 'u1', display_name: 'Andrei', email: 'a@x.com' },
        { id: 'm2', user_id: 'u2', display_name: 'Sam', email: 's@x.com' },
      ],
    });
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    mockOpenPicker.mockResolvedValue(SAVINGS_IMAGE);
  });

  it('mounts with the text box + attach controls and disables Analyze until input', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <SavingsImportScreen />
        </ThemeProvider>
      );
    });
    const root = tree.root;

    expect(root.findByProps({ testID: 'savings-import' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-input' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-gallery' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-file' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-drive' })).toBeTruthy();
    // No draft yet, so Analyze is present but disabled.
    expect(root.findByProps({ testID: 'savings-import-analyze' }).props.disabled).toBe(true);
  });

  it('enables Analyze after entering text', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-import-input' }).props.onChangeText('Payroll $4200');
    });

    expect(root.findByProps({ testID: 'savings-import-analyze' }).props.disabled).toBe(false);
  });

  it('paste + Analyze calls importAnalyze(hh, text) and renders the three review sections', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await pasteAndAnalyze(root, 'Payroll $5000. Hydro $120. Internet $80/mo.');

    // Analyze went through the text (not file) path with the trimmed household id.
    expect(mockImportAnalyze).toHaveBeenCalledWith(
      'hh-test',
      'Payroll $5000. Hydro $120. Internet $80/mo.',
      'all'
    );
    expect(mockImportAnalyzeWithFile).not.toHaveBeenCalled();

    // The returned draft renders all three review sections.
    expect(root.findByProps({ testID: 'savings-import-section-income' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-section-spending' })).toBeTruthy();
    expect(root.findByProps({ testID: 'savings-import-section-payments' })).toBeTruthy();

    // At least the one editable row per section (via the row toggles) is present.
    expect(root.findAllByProps({ testID: 'savings-import-income-toggle' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'savings-import-spending-toggle' }).length).toBeGreaterThan(0);
    expect(root.findAllByProps({ testID: 'savings-import-payment-toggle' }).length).toBeGreaterThan(0);
  });

  it('Analyze produces a DRAFT only — it must NOT commit until Save is pressed', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await pasteAndAnalyze(root, 'Some text');

    // Draft is shown but nothing was persisted.
    expect(mockImportCommit).not.toHaveBeenCalled();
    expect(mockMarkDirty).not.toHaveBeenCalled();
    // The Save control appears now that a draft exists.
    expect(root.findByProps({ testID: 'savings-import-save' })).toBeTruthy();
  });

  it('Save to Savings commits the selections, marks dirty, and navigates back', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await pasteAndAnalyze(root, 'Some text');

    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });

    expect(mockImportCommit).toHaveBeenCalledTimes(1);
    const [hid, jobId, selections] = mockImportCommit.mock.calls[0];
    expect(hid).toBe('hh-test');
    expect(jobId).toBe('job-1');
    // Selections carry the included rows (default: all three included), sans local `include` flag.
    expect(selections.income).toHaveLength(1);
    expect(selections.income[0]).toMatchObject({ label: 'Salary', amount_cents: 500000 });
    expect(selections.income[0]).not.toHaveProperty('include');
    expect(selections.spending).toHaveLength(1);
    expect(selections.recurringPayments).toHaveLength(1);

    // Post-commit side effects.
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('jumps the Savings view to the imported income month so the new rows are visible', async () => {
    // Draft income is dated 2026-07-01; the view must switch to that month on save
    // (the Income list is month-scoped, so otherwise imported rows can hide off-screen).
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenCalledWith(2026, 7);
  });

  it('flags a multi-month income import in the success alert', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // Two income rows in different months → the alert should tell the user to
    // review each month, and the view jumps to the most recent (2026-09).
    mockImportAnalyze.mockResolvedValue({
      jobId: 'job-1',
      draft: {
        ...DRAFT,
        income: [
          { ...DRAFT.income[0], income_date: '2026-07-01' },
          { ...DRAFT.income[0], income_date: '2026-09-01' },
        ],
      },
    });
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenCalledWith(2026, 9);
    expect(alertSpy).toHaveBeenCalledWith(
      'Saved to Savings',
      expect.stringContaining('spans 2 months')
    );
    alertSpy.mockRestore();
  });

  it('jumps to the spending month for a spending-only import (no income)', async () => {
    // Regression: a spending-only import has no income rows, so keying the month
    // jump off income alone left the view on the current month and the imported
    // (past-dated) spending was invisible until the user changed months manually.
    // The jump must fall back to the spending dates.
    mockImportAnalyze.mockResolvedValue({
      jobId: 'job-1',
      draft: {
        ...DRAFT,
        income: [],
        recurringPayments: [],
        spending: [{ ...DRAFT.spending[0], spending_date: '2026-05-05' }],
      },
    });
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    expect(mockSetSelectedMonth).toHaveBeenCalledWith(2026, 5);
  });

  it('excludes a de-selected row from the commit selections', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await pasteAndAnalyze(root, 'Some text');

    // Toggle the single spending row OFF (findAll → the composite instance is [0]).
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-spending-toggle' })[0].props.onPress();
    });

    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });

    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income).toHaveLength(1);
    expect(selections.spending).toHaveLength(0); // excluded
    expect(selections.recurringPayments).toHaveLength(1);
  });

  it('opens the Google Drive picker when Drive is tapped', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-import-drive' }).props.onPress();
    });

    expect(root.findByProps({ testID: 'cloud-file-picker' })).toBeTruthy();
  });

  it('warns and does not commit when nothing is selected', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;

    await pasteAndAnalyze(root, 'Some text');

    // De-select all three rows.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-income-toggle' })[0].props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-spending-toggle' })[0].props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-payment-toggle' })[0].props.onPress();
    });

    // With nothing included, the Save button is disabled — pressing it is a no-op.
    expect(root.findByProps({ testID: 'savings-import-save' }).props.disabled).toBe(true);
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });

    expect(mockImportCommit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('toggles all rows off then on via the global select control', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    // Deselect all → Save disabled.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-select-all' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'savings-import-save' }).props.disabled).toBe(true);

    // Select all again → Save enabled.
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-select-all' })[0].props.onPress();
    });
    expect(root.findByProps({ testID: 'savings-import-save' }).props.disabled).toBe(false);
  });

  it('toggles a whole section via its section select control', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-select-income' })[0].props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income).toHaveLength(0); // income section toggled off
    expect(selections.spending).toHaveLength(1);
  });

  it('edits an income row amount before committing', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    // The first "Amount ($)" input belongs to the income row.
    const amountInput = root.findAllByProps({ label: 'Amount ($)' })[0];
    await act(async () => {
      amountInput.props.onChangeText('75');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income[0].amount_cents).toBe(7500);
  });

  it('renames an auto-generated income row before committing', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    // The AI seeds the label "Salary"; the user renames it to "Ann Payroll".
    const nameInput = root.findByProps({ testID: 'savings-import-income-label' });
    expect(nameInput.props.value).toBe('Salary');
    await act(async () => {
      nameInput.props.onChangeText('Ann Payroll');
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income[0].label).toBe('Ann Payroll');
  });

  it('picks a household member for an income row', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      await Promise.resolve(); // let householdsApi.get resolve
    });
    // Open the member dropdown for the income row → the mocked action sheet
    // immediately selects the first member (Andrei).
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-income-member' })[0].props.onPress();
    });
    expect(mockShowActionSheet).toHaveBeenCalled();
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income[0].member_name).toBe('Andrei');
  });

  it('analyzes a gallery attachment through the file path', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-gallery' }).props.onPress();
      await Promise.resolve();
    });
    expect(root.findByProps({ testID: 'savings-import-remove-attachment' })).toBeTruthy();

    await act(async () => {
      await root.findByProps({ testID: 'savings-import-analyze' }).props.onPress();
    });
    expect(mockImportAnalyzeWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ name: SAVINGS.name, type: SAVINGS.mime }), // savings-statement.jpg
      undefined,
      'all'
    );
    expect(mockImportAnalyze).not.toHaveBeenCalled();
  });

  it('attaches a document and can remove it', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('house-bc-assessment')], // real PDF statement stand-in
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-file' }).props.onPress();
      await Promise.resolve();
    });
    expect(root.findByProps({ testID: 'savings-import-remove-attachment' })).toBeTruthy();
    await act(async () => {
      root.findByProps({ testID: 'savings-import-remove-attachment' }).props.onPress();
    });
    expect(root.findAllByProps({ testID: 'savings-import-remove-attachment' })).toHaveLength(0);
  });

  it('passes the route scope through to importAnalyze', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <SavingsImportScreen route={{ params: { scope: 'recurring' } } as any} />
        </ThemeProvider>
      );
    });
    const root = tree.root;
    await pasteAndAnalyze(root, 'Internet $80/mo');
    expect(mockImportAnalyze).toHaveBeenCalledWith('hh-test', 'Internet $80/mo', 'recurring');
  });

  it('alerts on a terminal analyze error', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportAnalyze.mockRejectedValue({ response: { status: 500 }, message: 'server error' });
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    expect(alertSpy).toHaveBeenCalled();
    expect(mockImportCommit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('edits spending amount and category before committing', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    const amounts = root.findAllByProps({ label: 'Amount ($)' });
    const categories = root.findAllByProps({ label: 'Category' });
    // Order in the draft form: income[0], spending[1], payment[2] amounts;
    // spending[0], payment[1] categories.
    await act(async () => amounts[1].props.onChangeText('12.5'));
    await act(async () => categories[0].props.onChangeText('Groceries'));
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.spending[0].amount_cents).toBe(1250);
    expect(selections.spending[0].category_name).toBe('Groceries');
  });

  it('edits a recurring payment amount and category before committing', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    const amounts = root.findAllByProps({ label: 'Amount ($)' });
    const categories = root.findAllByProps({ label: 'Category' });
    await act(async () => amounts[2].props.onChangeText('99'));
    await act(async () => categories[1].props.onChangeText('Utilities'));
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.recurringPayments[0].amount_cents).toBe(9900);
    expect(selections.recurringPayments[0].category_name).toBe('Utilities');
  });

  it('shows a "still working" notice when analyze times out with no job id', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportAnalyze.mockRejectedValue({ code: 'ECONNABORTED', message: 'timeout of 120000ms' });
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    expect(alertSpy).toHaveBeenCalledWith('Still working', expect.any(String));
    expect(mockImportCommit).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('rejects an oversized gallery image', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockOpenPicker.mockResolvedValue({
      path: 'file://big.jpg',
      filename: 'big.jpg',
      mime: 'image/jpeg',
      size: 25 * 1024 * 1024,
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-gallery' }).props.onPress();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('File too large', expect.any(String));
    expect(root.findAllByProps({ testID: 'savings-import-remove-attachment' })).toHaveLength(0);
    alertSpy.mockRestore();
  });

  it('re-encodes a HEIC gallery photo to JPEG before analyzing', async () => {
    // iOS Photos hands back HEIC by default — the vision model can't read it
    // and the request used to fail with "Could not read that" until the
    // attachment was re-encoded to JPEG before upload.
    mockOpenPicker.mockResolvedValue({
      path: 'file://IMG_1345.heic',
      filename: 'IMG_1345.heic',
      mime: 'image/heic',
      size: 2_000_000,
    });
    mockManipulateSaveAsync.mockResolvedValue({ uri: 'file://IMG_1345-converted.jpg' });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-gallery' }).props.onPress();
      await Promise.resolve();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-analyze' }).props.onPress();
    });
    expect(mockImportAnalyzeWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({
        uri: 'file://IMG_1345-converted.jpg',
        name: 'IMG_1345.jpg',
        type: 'image/jpeg',
      }),
      undefined,
      'all'
    );
  });

  it('surfaces an error when the gallery picker fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockOpenPicker.mockRejectedValue({ code: 'E_UNKNOWN' });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-gallery' }).props.onPress();
      await Promise.resolve();
    });
    // The wording is the fleet's, not this screen's: every upload surface now
    // reports a picker failure the same way, through `useAttachmentSources`.
    expect(alertSpy).toHaveBeenCalledWith(
      'The photo library could not be opened.',
      expect.any(String)
    );
    alertSpy.mockRestore();
  });

  it('ignores a cancelled gallery pick', async () => {
    mockOpenPicker.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-gallery' }).props.onPress();
      await Promise.resolve();
    });
    expect(root.findAllByProps({ testID: 'savings-import-remove-attachment' })).toHaveLength(0);
  });

  it('cancels back to the previous screen', async () => {
    const tree = await renderScreen();
    await act(async () => {
      // Cancel is now the ScreenHeader back button (onBackPress → navigation.goBack()).
      tree.root.findByProps({ testID: 'nav-back-button' }).props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('toggles the spending and payments sections via their select controls', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');

    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-select-spending' })[0].props.onPress();
    });
    await act(async () => {
      root.findAllByProps({ testID: 'savings-import-select-payments' })[0].props.onPress();
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    const [, , selections] = mockImportCommit.mock.calls[0];
    expect(selections.income).toHaveLength(1);
    expect(selections.spending).toHaveLength(0);
    expect(selections.recurringPayments).toHaveLength(0);
  });

  it('attaches a Drive file (inferring its mime type) and closes the picker', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await act(async () => {
      root.findByProps({ testID: 'savings-import-drive' }).props.onPress();
    });
    await act(async () => {
      root
        .findByProps({ testID: 'cloud-file-picker' })
        .props.onFileSelected({ uri: 'file://stmt.png', name: 'stmt.png', size: 2048 });
    });
    const chip = root.findByProps({ testID: 'savings-import-remove-attachment' });
    expect(chip).toBeTruthy();

    // Re-open and close via the picker's onClose.
    await act(async () => {
      root.findByProps({ testID: 'savings-import-drive' }).props.onPress();
    });
    await act(async () => {
      root.findByProps({ testID: 'cloud-file-picker' }).props.onClose();
    });
    expect(root.findAllByProps({ testID: 'cloud-file-picker' })).toHaveLength(0);
  });

  it('falls back to a default mime type for an extensionless Drive file', async () => {
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-drive' }).props.onPress();
    });
    await act(async () => {
      root
        .findByProps({ testID: 'cloud-file-picker' })
        .props.onFileSelected({ uri: 'file://notes', name: 'notes', size: 500 });
    });
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-analyze' }).props.onPress();
    });
    expect(mockImportAnalyzeWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ name: 'notes', type: 'application/pdf' }),
      undefined,
      'all'
    );
  });

  it('rejects an oversized Drive file', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-drive' }).props.onPress();
    });
    await act(async () => {
      root
        .findByProps({ testID: 'cloud-file-picker' })
        .props.onFileSelected({ uri: 'file://big.pdf', name: 'big.pdf', size: 25 * 1024 * 1024 });
    });
    expect(alertSpy).toHaveBeenCalledWith('File too large', expect.any(String));
    expect(root.findAllByProps({ testID: 'savings-import-remove-attachment' })).toHaveLength(0);
    alertSpy.mockRestore();
  });

  it('infers the mime type from a document without a mimeType', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://scan.webp', name: 'scan.webp', mimeType: null, size: 1000 }],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-file' }).props.onPress();
      await Promise.resolve();
    });
    // Analyze with the attachment → the guessed type flows into importAnalyzeWithFile.
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-analyze' }).props.onPress();
    });
    expect(mockImportAnalyzeWithFile).toHaveBeenCalledWith(
      'hh-test',
      expect.objectContaining({ name: 'scan.webp', type: 'image/webp' }),
      undefined,
      'all'
    );
  });

  it('rejects an oversized uploaded document', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: 25 * 1024 * 1024 }],
    });
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-file' }).props.onPress();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('File too large', expect.any(String));
    expect(root.findAllByProps({ testID: 'savings-import-remove-attachment' })).toHaveLength(0);
    alertSpy.mockRestore();
  });

  it('surfaces an error when the document picker throws', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetDocumentAsync.mockRejectedValue(new Error('picker boom'));
    const tree = await renderScreen();
    const root = tree.root;
    await act(async () => {
      root.findByProps({ testID: 'savings-import-file' }).props.onPress();
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith(
      expect.stringContaining('file picker'),
      expect.any(String)
    );
    alertSpy.mockRestore();
  });

  it('treats a network error (no code, no response) as timeout-like', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportAnalyze.mockRejectedValue({ message: 'Network request failed' });
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    // No jobId was returned → "Still working" recovery notice.
    expect(alertSpy).toHaveBeenCalledWith('Still working', expect.any(String));
    alertSpy.mockRestore();
  });

  it('alerts when the commit fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockImportCommit.mockRejectedValue(new Error('commit boom'));
    const tree = await renderScreen();
    const root = tree.root;
    await pasteAndAnalyze(root, 'Some text');
    await act(async () => {
      await root.findByProps({ testID: 'savings-import-save' }).props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
