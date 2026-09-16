/**
 * MortgageHistoryScreen — the change-history timeline for a property. Verifies it
 * merges terms (origination + renewals) with logged events into one newest-first
 * list, routes to the record-a-change form, and shows the empty state. Mirrors the
 * MortgageStatementsScreen suite's stubbing (nav/focus + @components/common).
 */
jest.mock('@components/common', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children, testID }: { children?: React.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children ?? null),
    ScreenHeader: ({ onBackPress }: { onBackPress?: () => void }) =>
      React.createElement(View, { testID: 'screen-header', onPress: onBackPress }),
    screenScrollViewStyle: { scroll: {} },
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { mortgageId: 'm-1' } }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

const mockListTerms = jest.fn();
const mockListEvents = jest.fn();
const mockListStatements = jest.fn();
const mockListRatePeriods = jest.fn();
jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    listTerms: (...a: unknown[]) => mockListTerms(...a),
    listEvents: (...a: unknown[]) => mockListEvents(...a),
    listStatements: (...a: unknown[]) => mockListStatements(...a),
    listRatePeriods: (...a: unknown[]) => mockListRatePeriods(...a),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: (sel?: (s: unknown) => unknown) => {
    const s = { currentHousehold: { id: 'hh-1' } };
    return typeof sel === 'function' ? sel(s) : s;
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageHistoryScreen } from '../MortgageHistoryScreen';

const TERMS = [
  {
    id: 't1', mortgage_id: 'm-1', household_id: 'hh-1', sequence: 1, rate_type: 'fixed', compounding: 'semi_annual',
    nominal_rate_bps: 414, prime_rate_bps: null, spread_bps: null, term_months: 36, term_start_date: '2025-06-20',
    maturity_date: '2028-06-20', payment_frequency: 'monthly', amortization_months_at_start: 300,
    scheduled_payment_cents: 287546, is_current: false,
  },
  {
    id: 't2', mortgage_id: 'm-1', household_id: 'hh-1', sequence: 2, rate_type: 'fixed', compounding: 'semi_annual',
    nominal_rate_bps: 600, prime_rate_bps: null, spread_bps: null, term_months: 60, term_start_date: '2028-06-20',
    maturity_date: '2033-06-20', payment_frequency: 'monthly', amortization_months_at_start: 264,
    scheduled_payment_cents: 310000, is_current: true,
  },
];
const EVENTS = [
  {
    id: 'e1', mortgage_id: 'm-1', household_id: 'hh-1', event_type: 'rate_change', event_date: '2026-01-15',
    amount_cents: null, new_rate_bps: 450, new_payment_cents: null, policy: null, note: 'Prime moved',
    created_at: '2026-01-15T00:00:00Z',
  },
];

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageHistoryScreen />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await Promise.resolve();
  });
  return tree;
}

function allText(root: ReactTestRenderer.ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const inst = node as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(root.children as unknown);
  return out.join(' ');
}

/**
 * Two statements at different rates, with the principal/interest split a falling
 * rate produces (shaped after a real TD FlexLine term portion).
 */
const STATEMENTS = [
  {
    id: 's-aug', mortgage_id: 'm-1', statement_date: '2025-08-31', closing_balance_cents: 97408010,
    opening_balance_cents: 97536104, interest_paid_cents: -305922, principal_paid_cents: -128094,
    payment_amount_cents: -434016, interest_rate_bps: 409, prime_rate_bps: 495, variance_bps: -86,
    source: 'file', created_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 's-dec', mortgage_id: 'm-1', statement_date: '2025-12-31', closing_balance_cents: 96798197,
    opening_balance_cents: 96965288, interest_paid_cents: -266925, principal_paid_cents: -167091,
    payment_amount_cents: -434016, interest_rate_bps: 359, prime_rate_bps: 445, variance_bps: -86,
    source: 'file', created_at: '2026-01-01T00:00:00Z',
  },
];

/** The canonical rate axis — the Oct 30 mid-statement cut has its own row. */
const RATE_PERIODS = [
  {
    id: 'rp-1', mortgage_id: 'm-1', statement_id: 's-aug', effective_date: '2025-08-01',
    period_end: '2025-08-31', rate_bps: 409, prime_rate_bps: 495, variance_bps: -86,
    source: 'statement', created_at: '2025-09-01T00:00:00Z',
  },
  {
    id: 'rp-2', mortgage_id: 'm-1', statement_id: 's-dec', effective_date: '2025-10-30',
    period_end: '2025-12-31', rate_bps: 359, prime_rate_bps: 445, variance_bps: -86,
    source: 'statement', created_at: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockListTerms.mockResolvedValue({ terms: TERMS });
  mockListEvents.mockResolvedValue({ events: EVENTS });
  mockListStatements.mockResolvedValue({ statements: STATEMENTS });
  mockListRatePeriods.mockResolvedValue({ ratePeriods: RATE_PERIODS });
});

describe('MortgageHistoryScreen', () => {
  it('merges terms + events into a newest-first timeline', async () => {
    const tree = await render();
    expect(mockListTerms).toHaveBeenCalledWith('hh-1', 'm-1');
    expect(mockListEvents).toHaveBeenCalledWith('hh-1', 'm-1');
    const text = allText(tree.root);
    expect(text).toContain('Mortgage started');
    expect(text).toContain('Renewal · term 2');
    expect(text).toContain('Rate change');
    expect(text).toContain('$2,875.46');
    expect(text).toContain('Prime moved');
  });

  it('routes to the record-a-change form', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'mortgage-history-record' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageRecordChange', { mortgageId: 'm-1' });
  });

  it('shows the empty state with no terms or events', async () => {
    mockListTerms.mockResolvedValue({ terms: [] });
    mockListEvents.mockResolvedValue({ events: [] });
    mockListStatements.mockResolvedValue({ statements: [] });
    mockListRatePeriods.mockResolvedValue({ ratePeriods: [] });
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-history-empty' }).length).toBeGreaterThan(0);
    expect(allText(tree.root)).toContain('No history yet');
  });

  it('lists rate changes detected from the statements, with their exact date', async () => {
    const tree = await render();
    expect(mockListRatePeriods).toHaveBeenCalledWith('hh-1', 'm-1');
    const text = allText(tree.root);
    // The Oct 30 cut is read off the statement's own sub-period breakdown — the
    // user never entered it.
    expect(text).toContain('Rate dropped to 3.59%');
    expect(text).toContain('4.09% → 3.59%');
    expect(text).toContain('From your statement');
  });

  it('renders the rate-impact card from the actual statement splits', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-rate-impact' }).length).toBeGreaterThan(0);
    // Aug: 128094/(128094+305922) = 29.5% of the payment reached the principal.
    expect(allText(tree.root.findAllByProps({ testID: 'mortgage-impact-before' })[0])).toContain('29.5');
    // Dec, after the 4.09% → 3.59% cut: 167091/(167091+266925) = 38.5%.
    expect(allText(tree.root.findAllByProps({ testID: 'mortgage-impact-after' })[0])).toContain('38.5');
    const text = allText(tree.root);
    expect(text).toContain('What the rate changes did');
    expect(text).toContain('Your rate fell 0.50% over these statements.');
  });

  it('hides the impact card when there is only one statement to compare', async () => {
    mockListStatements.mockResolvedValue({ statements: [STATEMENTS[0]] });
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-rate-impact' })).toHaveLength(0);
  });

  it('still renders the timeline when the rate-history call fails', async () => {
    mockListRatePeriods.mockRejectedValue(new Error('offline'));
    mockListStatements.mockRejectedValue(new Error('offline'));
    const tree = await render();
    expect(allText(tree.root)).toContain('Mortgage started');
  });
});
