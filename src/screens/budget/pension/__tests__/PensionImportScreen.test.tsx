/**
 * PensionImportScreen — Pension → "Import statement" (AI, draft-then-commit).
 *
 * Exercises the two-phase contract end-to-end: (1) an INPUT phase where the user
 * pastes text and/or attaches a PDF/image and presses Analyze, which calls the
 * savings registered-extract API and turns the returned draft into editable
 * account cards WITHOUT persisting anything; and (2) a REVIEW phase where the
 * user toggles accounts, picks a type + owner, and commits — which is the ONLY
 * write (savingsApi.commitRegisteredImport) and, on success, marks both the
 * pension and savings stores dirty and navigates back.
 *
 * The screen surfaces success by navigating back and every failure/guard via
 * `Alert.alert` (it does NOT use a toast manager), so those are the assertions.
 *
 * `@components/common` is stubbed (its real SafeAreaView drags in the heavy tab
 * navigator chain that crashes under the mocked navigation) and the file picker,
 * crypto, savings API and the three stores are mocked. `@components/ai/AIAccessGate`
 * is already a passthrough via jest.setup.js, so the gated body renders.
 */

// SafeAreaView + BackButton passthroughs so the heavy @components/common barrel
// never loads. SafeAreaView forwards props so the `pension-import` testID survives.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children ?? null),
    BackButton: ({ onPress, testID }: { onPress: () => void; testID?: string }) =>
      React.createElement(TouchableOpacity, { testID: testID ?? 'nav-back-button', onPress }),
    ScreenHeader: ({
      onBackPress,
      rightElement,
    }: {
      onBackPress?: () => void;
      rightElement?: React.ReactNode;
    }) =>
      React.createElement(
        View,
        null,
        React.createElement(TouchableOpacity, { testID: 'nav-back-button', onPress: onBackPress }),
        rightElement ?? null
      ),
    ProcessingOverlay: ({ visible }: { visible?: boolean }) =>
      visible ? React.createElement(View, { testID: 'processing-overlay' }) : null,
    screenScrollViewStyle: { scroll: { flex: 1 } },
  };
});

const mockGoBack = jest.fn();
const mockNav = { goBack: mockGoBack, navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => mockGetDocumentAsync(...a),
}));

// Deterministic-enough UUIDs (unique per call) so the commit payload ids are strings.
const mockUuid = { n: 0 };
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `uuid-${(mockUuid.n += 1)}`),
}));

const mockExtractText = jest.fn();
const mockExtractFile = jest.fn();
const mockCommit = jest.fn();
jest.mock('@api/savings', () => ({
  savingsApi: {
    extractRegisteredStatementText: (...a: unknown[]) => mockExtractText(...a),
    extractRegisteredStatementFile: (...a: unknown[]) => mockExtractFile(...a),
    commitRegisteredImport: (...a: unknown[]) => mockCommit(...a),
  },
}));

// Mutable holder so a test can null out the household or drop the members.
const mockHouseholdHolder: {
  currentHousehold: { id: string } | undefined;
  currentHouseholdMembers: Array<{ id: string; user_id: string; display_name: string | null }>;
} = { currentHousehold: { id: 'hh-test' }, currentHouseholdMembers: [] };
jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({
    currentHousehold: mockHouseholdHolder.currentHousehold,
    currentHouseholdMembers: mockHouseholdHolder.currentHouseholdMembers,
  }),
}));

const mockMarkPensionDirty = jest.fn();
jest.mock('@stores/pensionStore', () => ({
  usePensionStore: () => ({ selectedYear: 2026, markDirty: mockMarkPensionDirty }),
}));

const mockMarkSavingsDirty = jest.fn();
jest.mock('@stores/savingsStore', () => ({
  useSavingsStore: (sel?: (s: unknown) => unknown) => {
    const s = { markDirty: mockMarkSavingsDirty };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { fixture, pickerAsset } from '../../../../test-utils/fixtures';
import { PensionImportScreen } from '../PensionImportScreen';

// Real documents from resourses/testing — a PDF statement stand-in and an image statement.
const PENSION_PDF = fixture('house-bc-assessment'); // bc-assessment.pdf
const PENSION_IMAGE = fixture('budget-savings-statement'); // savings-statement.jpg

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** One clean account (used for the precise commit-payload assertions). */
function singleExtract() {
  return {
    accounts: [
      {
        account_type: 'rrsp' as const,
        institution: 'Wealthsimple',
        is_employer_plan: false,
        employer_name: null,
        balance: 15000, // dollars → 1_500_000 cents
        reported_room: 5000,
        contributions: [
          { date: '2026-03-01', amount: 500, contributor: 'self' as const },
          { date: '2026-06-01', amount: 250, contributor: 'employer' as const },
        ],
      },
    ],
    confidence: 0.9,
    rawText: 'raw',
  };
}

/** Two accounts, the 2nd loaded with edge cases (null type/institution/balance/date, 0/null amounts). */
function richExtract() {
  return {
    accounts: [
      singleExtract().accounts[0],
      {
        account_type: null, // → defaults to 'rrsp'
        institution: null, // → header 'Account'
        is_employer_plan: true,
        employer_name: 'Acme',
        balance: null, // → no "Statement balance" line
        reported_room: null,
        contributions: [
          { date: null, amount: 100, contributor: 'self' as const }, // date → `${selectedYear}-01-01`
          { date: '2026-02-01', amount: null, contributor: 'employer' as const }, // filtered
          { date: '2026-02-01', amount: 0, contributor: 'self' as const }, // filtered
        ],
      },
    ],
    confidence: 0.5,
    rawText: 'raw',
  };
}

/** One account whose every contribution is filtered out (amount 0 / null). */
function zeroContribExtract() {
  return {
    accounts: [
      {
        account_type: 'tfsa' as const,
        institution: 'EQ Bank',
        is_employer_plan: false,
        employer_name: null,
        balance: 1000,
        reported_room: null,
        contributions: [
          { date: '2026-01-01', amount: 0, contributor: 'self' as const },
          { date: '2026-01-01', amount: null, contributor: 'self' as const },
        ],
      },
    ],
    confidence: 0.4,
    rawText: 'raw',
  };
}

const microflush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <PensionImportScreen />
      </ThemeProvider>
    );
    await microflush();
  });
  return tree;
}

function first(root: ReactTestRenderer.ReactTestInstance, testID: string) {
  return root.findAllByProps({ testID })[0];
}

/**
 * Count review cards. `Card` forwards its `testID` onto several nested instances
 * (its own composite + the inner View it spreads props onto), so keep only the
 * OUTERMOST instance per card — the one with no same-testID ancestor.
 */
function draftCount(root: ReactTestRenderer.ReactTestInstance) {
  return root.findAllByProps({ testID: 'pension-import-draft' }).filter((n) => {
    let p: ReactTestRenderer.ReactTestInstance | null = n.parent;
    while (p) {
      if (p.props.testID === 'pension-import-draft') return false;
      p = p.parent;
    }
    return true;
  }).length;
}

async function setText(root: ReactTestRenderer.ReactTestInstance, text: string) {
  await act(async () => {
    first(root, 'pension-import-text').props.onChangeText(text);
  });
}

async function pressAnalyze(root: ReactTestRenderer.ReactTestInstance) {
  await act(async () => {
    first(root, 'pension-import-analyze').props.onPress();
    await microflush();
  });
}

async function pressPickFile(root: ReactTestRenderer.ReactTestInstance) {
  await act(async () => {
    first(root, 'pension-import-pick-file').props.onPress();
    await microflush();
  });
}

async function pressCommit(root: ReactTestRenderer.ReactTestInstance) {
  await act(async () => {
    first(root, 'pension-import-commit').props.onPress();
    await microflush();
  });
}

/** Analyze via the pasted-text path and land in the review phase. */
async function analyzeText(root: ReactTestRenderer.ReactTestInstance, text = 'RRSP statement 2026') {
  await setText(root, text);
  await pressAnalyze(root);
}

/** Walk up from a rendered label to the nearest pressable ancestor and press it. */
async function pressByLabel(root: ReactTestRenderer.ReactTestInstance, label: string) {
  await act(async () => {
    const nodes = root.findAllByProps({ children: label });
    for (const node of nodes) {
      let cur: ReactTestRenderer.ReactTestInstance | null = node.parent;
      while (cur) {
        if (typeof cur.props.onPress === 'function') {
          cur.props.onPress();
          return;
        }
        cur = cur.parent;
      }
    }
    throw new Error(`No pressable ancestor for label: ${label}`);
  });
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockUuid.n = 0;
  mockHouseholdHolder.currentHousehold = { id: 'hh-test' };
  mockHouseholdHolder.currentHouseholdMembers = [
    // member_id is the membership id (HouseholdMember.id), the backend's canonical
    // member key — the import chips assign it, not user_id.
    { id: 'm1', user_id: 'u1', display_name: 'Alex' },
    { id: 'm2', user_id: 'u2', display_name: 'Sam' },
  ];
  mockExtractText.mockResolvedValue({ draft: singleExtract() });
  mockExtractFile.mockResolvedValue({ draft: singleExtract() });
  mockCommit.mockResolvedValue({ import_batch_id: 'b1', createdAccountIds: ['a1'], transactionCount: 2 });
  mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
  (console.error as unknown as jest.SpyInstance).mockRestore();
});

describe('PensionImportScreen', () => {
  it('mounts in the input phase with the text box, file picker and Analyze (enabled)', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    expect(first(root, 'pension-import')).toBeTruthy();
    expect(first(root, 'pension-import-text')).toBeTruthy();
    expect(first(root, 'pension-import-pick-file')).toBeTruthy();
    expect(first(root, 'pension-import-analyze')).toBeTruthy();
    expect(first(root, 'nav-back-button')).toBeTruthy();
    // Analyze gates on content inside the handler (via Alert), not via `disabled`.
    expect(first(root, 'pension-import-analyze').props.disabled).toBe(false);
    // No review cards until a draft exists.
    expect(draftCount(root)).toBe(0);
    // Intro copy + the empty picker label are rendered.
    const texts = collectRenderedText(tree);
    expect(texts.includes('Choose PDF or image')).toBe(true);
  });

  it('the header back button navigates back', async () => {
    const tree = await renderScreen();
    await act(async () => {
      first(tree.root, 'nav-back-button').props.onPress();
    });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('warns and calls no API when Analyze is pressed with no text and no file', async () => {
    const tree = await renderScreen();
    await pressAnalyze(tree.root);
    expect(alertSpy).toHaveBeenCalledWith('Nothing to analyze', expect.any(String));
    expect(mockExtractText).not.toHaveBeenCalled();
    expect(mockExtractFile).not.toHaveBeenCalled();
  });

  it('does nothing when there is no current household', async () => {
    mockHouseholdHolder.currentHousehold = undefined;
    const tree = await renderScreen();
    await analyzeText(tree.root);
    expect(mockExtractText).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('paste + Analyze calls extractRegisteredStatementText(hh, text) and renders the draft card', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root, 'Paste of my RRSP statement');

    expect(mockExtractText).toHaveBeenCalledWith('hh-test', 'Paste of my RRSP statement');
    expect(mockExtractFile).not.toHaveBeenCalled();
    // One reviewable account card + the commit/start-over controls appear.
    expect(draftCount(root)).toBe(1);
    expect(first(root, 'pension-import-commit')).toBeTruthy();
    expect(collectRenderedText(tree).includes('Wealthsimple')).toBe(true);
    // Analyze produced a DRAFT only — nothing was committed or marked dirty yet.
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockMarkPensionDirty).not.toHaveBeenCalled();
  });

  it('renders multiple accounts and the null-field edge cases verbatim', async () => {
    mockExtractText.mockResolvedValue({ draft: richExtract() });
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);

    expect(draftCount(root)).toBe(2);
    const texts = collectRenderedText(tree);
    // Account A (institution present) + Account B (null institution → 'Account' header).
    expect(texts.includes('Wealthsimple')).toBe(true);
    expect(texts.includes('Account')).toBe(true);
  });

  it('shows the analyzing indicator while extraction is in flight', async () => {
    let resolve!: (v: unknown) => void;
    mockExtractText.mockReturnValue(new Promise((r) => { resolve = r; }));
    const tree = await renderScreen();
    const root = tree.root;

    await setText(root, 'text');
    await act(async () => {
      first(root, 'pension-import-analyze').props.onPress();
    });

    // In-flight: the blocking overlay is shown + the button is loading/disabled.
    expect(root.findAllByProps({ testID: 'processing-overlay' }).length).toBeGreaterThan(0);
    expect(first(root, 'pension-import-analyze').props.disabled).toBe(true);

    await act(async () => {
      resolve({ draft: singleExtract() });
      await microflush();
    });
    expect(draftCount(root)).toBe(1);
  });

  it('alerts "No accounts found" when the extract has zero accounts', async () => {
    mockExtractText.mockResolvedValue({ draft: { accounts: [], confidence: 0, rawText: '' } });
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);

    expect(alertSpy).toHaveBeenCalledWith('No accounts found', expect.any(String));
    // drafts is set to an empty array — no account cards, but not back in input phase.
    expect(draftCount(root)).toBe(0);
  });

  it('alerts on a failed extraction and stays in the input phase', async () => {
    mockExtractText.mockRejectedValue(new Error('server boom'));
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);

    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('analyze'));
    expect(draftCount(root)).toBe(0);
    expect(first(root, 'pension-import-text')).toBeTruthy();
  });

  it('attaches a file (no text) and analyzes through the file path with undefined text', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('house-bc-assessment')], // real PDF statement stand-in
    });
    const tree = await renderScreen();
    const root = tree.root;

    await pressPickFile(root);
    // The picker label now reflects the chosen file name.
    expect(collectRenderedText(tree).includes(PENSION_PDF.name)).toBe(true);

    await pressAnalyze(root);
    expect(mockExtractFile).toHaveBeenCalledWith(
      'hh-test',
      { uri: PENSION_PDF.uri, name: PENSION_PDF.name, type: 'application/pdf' },
      undefined
    );
    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it('attaches a file WITH text and passes the trimmed text alongside the file', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [pickerAsset('budget-savings-statement')], // real image statement
    });
    const tree = await renderScreen();
    const root = tree.root;

    await setText(root, '  extra context  ');
    await pressPickFile(root);
    await pressAnalyze(root);

    expect(mockExtractFile).toHaveBeenCalledWith(
      'hh-test',
      { uri: PENSION_IMAGE.uri, name: PENSION_IMAGE.name, type: PENSION_IMAGE.mime }, // savings-statement.jpg
      'extra context'
    );
  });

  it('falls back to default name + mime for an asset missing both', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://x', name: null, mimeType: null, size: 500 }],
    });
    const tree = await renderScreen();
    const root = tree.root;

    await pressPickFile(root);
    expect(collectRenderedText(tree).includes('statement')).toBe(true);

    await pressAnalyze(root);
    expect(mockExtractFile).toHaveBeenCalledWith(
      'hh-test',
      { uri: 'file://x', name: 'statement', type: 'application/pdf' },
      undefined
    );
  });

  it('rejects an oversized file and keeps no attachment', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://big.pdf', name: 'big.pdf', mimeType: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 }],
    });
    const tree = await renderScreen();
    const root = tree.root;

    await pressPickFile(root);
    expect(alertSpy).toHaveBeenCalledWith('File too large', expect.any(String));
    expect(collectRenderedText(tree).includes('Choose PDF or image')).toBe(true);
  });

  it('ignores a cancelled file pick', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: [] });
    const tree = await renderScreen();
    const root = tree.root;

    await pressPickFile(root);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(collectRenderedText(tree).includes('Choose PDF or image')).toBe(true);
  });

  it('surfaces an error when the file picker throws', async () => {
    mockGetDocumentAsync.mockRejectedValue(new Error('picker boom'));
    const tree = await renderScreen();
    const root = tree.root;

    await pressPickFile(root);
    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('file picker'));
  });

  it('commits the reviewed draft → API call + both stores dirty + navigates back', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await pressCommit(root);

    expect(mockCommit).toHaveBeenCalledTimes(1);
    const [hid, payload] = mockCommit.mock.calls[0] as [string, any];
    expect(hid).toBe('hh-test');
    expect(typeof payload.import_batch_id).toBe('string');
    expect(payload.accounts).toHaveLength(1);

    const acc = payload.accounts[0];
    expect(acc).toMatchObject({
      account_type: 'rrsp',
      member_id: null,
      institution: 'Wealthsimple',
      is_employer_plan: false,
      employer_name: null,
      balance_cents: 1500000,
    });
    expect(typeof acc.id).toBe('string');
    expect(acc.contributions).toHaveLength(2);
    expect(acc.contributions[0]).toMatchObject({
      amount_cents: 50000,
      transaction_date: '2026-03-01',
      contributor: 'self',
      tax_year: 2026,
    });
    expect(acc.contributions[1]).toMatchObject({
      amount_cents: 25000,
      transaction_date: '2026-06-01',
      contributor: 'employer',
      tax_year: 2026,
    });

    expect(mockMarkPensionDirty).toHaveBeenCalledTimes(1);
    expect(mockMarkSavingsDirty).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('picking an account type + owner flows into the commit payload', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await pressByLabel(root, 'TFSA'); // account-type chip
    await pressByLabel(root, 'Alex'); // owner chip → member m1
    await pressCommit(root);

    const [, payload] = mockCommit.mock.calls[0] as [string, any];
    expect(payload.accounts[0].account_type).toBe('tfsa');
    expect(payload.accounts[0].member_id).toBe('m1');
  });

  it('tapping the same owner chip twice clears the owner', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await pressByLabel(root, 'Alex');
    await pressByLabel(root, 'Alex'); // toggle back off
    await pressCommit(root);

    const [, payload] = mockCommit.mock.calls[0] as [string, any];
    expect(payload.accounts[0].member_id).toBeNull();
  });

  it('commits the edge-case second account with its defaulted fields', async () => {
    mockExtractText.mockResolvedValue({ draft: richExtract() });
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await pressCommit(root);

    const [, payload] = mockCommit.mock.calls[0] as [string, any];
    expect(payload.accounts).toHaveLength(2);
    const b = payload.accounts[1];
    expect(b).toMatchObject({ account_type: 'rrsp', is_employer_plan: true, employer_name: 'Acme' });
    expect(b.balance_cents).toBeUndefined(); // null balance → omitted
    expect(b.contributions).toHaveLength(1); // 0/null amounts filtered out
    expect(b.contributions[0]).toMatchObject({
      amount_cents: 10000,
      transaction_date: '2026-01-01', // null date → `${selectedYear}-01-01`
      contributor: 'self',
      tax_year: 2026,
    });
  });

  it('excluding the only account blocks the commit with a warning', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await act(async () => {
      first(root, 'pension-import-toggle-include').props.onPress(); // uncheck
    });
    await pressCommit(root);

    expect(alertSpy).toHaveBeenCalledWith('Nothing to add', expect.any(String));
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('an account with no valid contributions cannot be committed', async () => {
    mockExtractText.mockResolvedValue({ draft: zeroContribExtract() });
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    // The card renders (institution shown) but with no committable contributions.
    expect(draftCount(root)).toBe(1);
    expect(collectRenderedText(tree).includes('EQ Bank')).toBe(true);

    await pressCommit(root);
    expect(alertSpy).toHaveBeenCalledWith('Nothing to add', expect.any(String));
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('alerts and stays on the review screen when the commit fails', async () => {
    mockCommit.mockRejectedValue(new Error('commit boom'));
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    await pressCommit(root);

    expect(alertSpy).toHaveBeenCalledWith('Error', expect.stringContaining('save'));
    expect(mockGoBack).not.toHaveBeenCalled();
    // Still in review — the commit control is present.
    expect(first(root, 'pension-import-commit')).toBeTruthy();
  });

  it('"Start over" clears the draft and returns to the input phase', async () => {
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    expect(draftCount(root)).toBe(1);

    await pressByLabel(root, 'Start over');

    expect(draftCount(root)).toBe(0);
    expect(first(root, 'pension-import-text')).toBeTruthy();
  });

  it('renders the review without owner chips when the household has no members', async () => {
    mockHouseholdHolder.currentHouseholdMembers = [];
    const tree = await renderScreen();
    const root = tree.root;

    await analyzeText(root);
    // No owner chips because there are no members to assign.
    expect(root.findAllByProps({ children: 'Alex' })).toHaveLength(0);

    await pressCommit(root);
    const [, payload] = mockCommit.mock.calls[0] as [string, any];
    expect(payload.accounts[0].member_id).toBeNull();
  });
});
