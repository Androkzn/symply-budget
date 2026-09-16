/**
 * UtilityBillsScreen — mount + state coverage.
 *
 * REGRESSION GUARD (the reason this file exists): the screen referenced
 * `colors` in its own body while the only `useAppColors()` call in the file sat
 * inside the `BillCard` sub-component. `isLoading` initialises to `true`, so the
 * loading branch — which reads `colors.primary` — ran on the VERY FIRST render
 * and threw `ReferenceError: colors is not defined`. View Bills was broken on
 * every brand, and `tsc` flagged it as TS2304 at two call sites, but the repo
 * carries a large pre-existing error baseline so nothing surfaced it.
 *
 * `should render the loading state without throwing` fails if that regresses.
 */
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@components/common', () => ({
  __esModule: true,
  AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
  ScreenHeader: () => null,
}));

jest.mock('@features/utilities/components/ProviderLogo', () => ({
  __esModule: true,
  ProviderLogo: () => null,
}));

const mockGetBills = jest.fn();
jest.mock('@features/utilities/api/utilities', () => ({
  utilitiesApi: {
    get getBills() {
      return mockGetBills;
    },
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-test' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../../test-utils/budgetConsistency';
import { UtilityBillsScreen } from '../UtilityBillsScreen';

let tree: ReactTestRenderer.ReactTestRenderer | undefined;

function bill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bill-1',
    household_id: 'hh-test',
    bill_type: 'electricity',
    provider: 'BC Hydro',
    account_number: '1234567',
    billing_period_start: '2026-04-01',
    billing_period_end: '2026-05-31',
    amount: 17972,
    due_date: '2026-06-15',
    paid_date: null,
    paid_amount: null,
    usage_quantity: 812,
    usage_unit: 'kWh',
    document_url: null,
    ai_extracted_data: null,
    confidence_score: null,
    task_id: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

async function mount() {
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <UtilityBillsScreen />
      </ThemeProvider>
    );
  });
}

afterEach(() => {
  tree?.unmount();
  tree = undefined;
  mockGetBills.mockReset();
});

describe('UtilityBillsScreen', () => {
  it('should render the loading state without throwing', async () => {
    // Never resolves — the screen stays on the `isLoading` branch, which is the
    // exact path that used to throw on the first render.
    mockGetBills.mockReturnValue(new Promise(() => {}));

    await expect(mount()).resolves.not.toThrow();
    expect(tree!.toJSON()).not.toBeNull();
  });

  it('should render a bill once loading resolves', async () => {
    // A provider with no bundled logo, so the text title is not suppressed.
    mockGetBills.mockResolvedValue([bill({ provider: 'Acme Utility' })]);
    await mount();

    const text = collectRenderedText(tree!).join(' | ');
    expect(text).toContain('Acme Utility');
    expect(text).toContain('$179.72');
  });

  it('should suppress the provider name whenever a bundled logo matches', async () => {
    // `hasProviderLogo` matches on /hydro/i, /fortis/i, /surrey/i and a few
    // municipality names, and the card renders the logo INSTEAD of the name.
    //
    // This is a real hazard now that the app targets all of Canada: "Hydro One"
    // (Ontario) and "Hydro-Québec" both match /hydro/i and would be stamped with
    // the BC Hydro wordmark — with no text label to correct it, because the
    // logo is what suppressed the label. Pinned so the fix is deliberate.
    mockGetBills.mockResolvedValue([bill({ provider: 'Hydro One' })]);
    await mount();

    const text = collectRenderedText(tree!).join(' | ');
    expect(text).not.toContain('Hydro One');
    expect(text).toContain('$179.72');
  });

  it('should show the empty state when there are no bills', async () => {
    mockGetBills.mockResolvedValue([]);
    await mount();

    expect(collectRenderedText(tree!).join(' | ')).toContain('No bills found');
  });

  it('should render every filter tab', async () => {
    mockGetBills.mockResolvedValue([]);
    await mount();

    const text = collectRenderedText(tree!).join(' | ');
    ['All', 'Electricity', 'Gas', 'Water', 'Garbage', 'Unpaid'].forEach(label => {
      expect(text).toContain(label);
    });
  });

  it('should mark a paid bill as Paid', async () => {
    mockGetBills.mockResolvedValue([bill({ paid_date: '2026-06-10', paid_amount: 17972 })]);
    await mount();

    expect(collectRenderedText(tree!).join(' | ')).toContain('Paid');
  });

  it('should not crash when the fetch rejects', async () => {
    // `loadBills` only console.errors, so a failure renders as an empty list —
    // a real UX gap, pinned here so a future error state is a deliberate change.
    mockGetBills.mockRejectedValue(new Error('network down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(mount()).resolves.not.toThrow();
    expect(collectRenderedText(tree!).join(' | ')).toContain('No bills found');

    spy.mockRestore();
  });
});
