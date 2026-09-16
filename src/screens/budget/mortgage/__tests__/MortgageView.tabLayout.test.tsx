/**
 * MortgageView — the customizable tab strip. Covers that the dashboard renders
 * the layout saved by "Customize tabs": every tab by default, hidden tabs gone,
 * the user's order honoured, and — the important one — that landing on a tab
 * that has since been hidden falls back to the first visible content view
 * instead of a blank body (Overview can never be hidden, so a fallback always
 * exists). Charts are stubbed; the strip is the real FilterTabs.
 */
jest.mock('react-native-gifted-charts', () => ({
  __esModule: true,
  LineChart: () => null,
  BarChart: () => null,
}));
jest.mock('../RateSlider', () => ({ __esModule: true, RateSlider: () => null }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));

let mockSubTab = 'overview';
let mockOrder: string[] | null = null;
let mockHidden: string[] = [];
const mockSetActiveSubTab = jest.fn();
// Hoisted, NOT inline `jest.fn()`: a fresh identity each render would change
// `load`'s deps and re-fire the focus effect forever.
const mockSetSelected = jest.fn();
const mockSetMortgages = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: () => ({
    selectedMortgageId: 'm-1',
    setSelectedMortgage: mockSetSelected,
    setMortgages: mockSetMortgages,
    activeSubTab: mockSubTab,
    setActiveSubTab: mockSetActiveSubTab,
    dataRevision: 0,
    subTabOrder: mockOrder,
    hiddenSubTabs: mockHidden,
  }),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    list: () =>
      Promise.resolve({
        mortgages: [
          {
            id: 'm-1',
            nickname: 'Home',
            lender: 'TD',
            productType: 'standard',
            currentBalanceCents: 48_000_000,
            pctPaid: 0.04,
            nextRenewalDate: '2031-07-01',
            isActive: true,
          },
        ],
      }),
    getSummary: () => Promise.resolve(SUMMARY),
    getSchedule: () =>
      Promise.resolve({ scheduleAvailable: true, paymentsElapsed: 2, rows: [] }),
    listTerms: () => Promise.resolve({ terms: [] }),
    listStatements: () => Promise.resolve({ statements: [] }),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { DEFAULT_MORTGAGE_TAB_ORDER } from '../mortgageTabs';
import { MortgageView } from '../MortgageView';

const SUMMARY: Record<string, unknown> = {
  mortgageId: 'm-1', nickname: 'Home', lender: 'TD', productType: 'standard',
  propertyAddressMasked: null, scheduleAvailable: true, originalPrincipalCents: 50_000_000,
  currentBalanceCents: 48_000_000, balanceStatus: 'confirmed', balanceAsOf: '2026-07-01',
  paymentsElapsed: 2, paymentsTotal: 300, pctPaid: 0.04, scheduledPaymentCents: 290_802,
  paymentFrequency: 'monthly',
  rate: { nominalPct: 5, effectiveAnnualPct: 5.06, rateType: 'fixed', compounding: 'semi_annual' },
  totalPaidToDateCents: 500_000, totalInterestToDateCents: 400_000,
  totalPrincipalToDateCents: 2_000_000, totalInterestOverLifeCents: 37_000_000,
  paidToDate: { interestSource: 'actual', throughDate: '2026-06-30', statementsWithInterest: 3 },
  remainingAmortizationMonths: 298,
  currentPaymentSplit: { interestCents: 206_196, principalCents: 84_606, interestSharePct: 71 },
  crossover: { paymentIndex: 130, reached: false },
  equity: {
    downPaymentCents: 0, paydownEquityCents: 2_000_000, appreciationEquityCents: 0,
    totalEquityCents: 2_000_000, hasAppreciation: false,
  },
  projected: {
    forwardRate: { nominalPct: 5, basedOn: 'statement', asOfDate: '2026-06-30' },
    projectionStale: false,
    toEndOfTerm: {
      date: '2031-07-01', balanceCents: 44_000_000, equityCents: 6_000_000,
      principalPaidCents: 6_000_000, totalInterestCents: 11_000_000,
      interestRemainingCents: 11_000_000,
    },
  },
  currentTerm: {
    sequence: 1, termStartDate: '2026-07-01', maturityDate: '2031-07-01', termMonths: 60,
  },
  nextRenewalDate: '2031-07-01', daysToRenewal: 1825,
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <MortgageView />
      </ThemeProvider>
    );
  });
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
  return tree;
}

/** The strip's tab ids, in render order. */
function stripOrder(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAll(
      (n) =>
        typeof n.props?.testID === 'string' && n.props.testID.startsWith('filter-tab-'),
      { deep: false }
    )
    .map((n) => (n.props.testID as string).replace('filter-tab-', ''))
    .filter((id, i, all) => all.indexOf(id) === i);
}

function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    const inst = n as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(tree.root.children as unknown);
  return out.join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubTab = 'overview';
  mockOrder = null;
  mockHidden = [];
});

describe('MortgageView tab strip', () => {
  it('renders the full strip when the user has not customized it', async () => {
    const tree = await render();
    expect(stripOrder(tree)).toEqual(DEFAULT_MORTGAGE_TAB_ORDER);
    expect(mockSetActiveSubTab).not.toHaveBeenCalled();
  });

  it('drops hidden tabs from the strip', async () => {
    mockHidden = ['equity', 'schedule', 'renew'];
    const tree = await render();
    const ids = stripOrder(tree);
    expect(ids).not.toContain('equity');
    expect(ids).not.toContain('schedule');
    expect(ids).not.toContain('renew');
    expect(ids).toEqual(['overview', 'payments', 'forecast', 'renewal', 'statements', 'history']);
  });

  it('honours the saved order', async () => {
    mockOrder = ['forecast', 'overview', 'statements', 'payments', 'equity', 'schedule',
      'renewal', 'renew', 'history'];
    const tree = await render();
    expect(stripOrder(tree).slice(0, 4)).toEqual([
      'forecast',
      'overview',
      'statements',
      'payments',
    ]);
  });

  it('falls back to the first visible view when the active tab was hidden', async () => {
    mockSubTab = 'schedule';
    mockHidden = ['schedule'];
    const tree = await render();

    // Body shows Overview (the first visible content tab), not a blank scroll.
    expect(stripOrder(tree)).toContain('overview');
    expect(allText(tree)).toContain('% paid off');
    expect(allText(tree)).toContain('Equity built');
    expect(mockSetActiveSubTab).toHaveBeenCalledWith('overview');
  });

  it('falls back to the first REMAINING view, not blindly to Overview', async () => {
    mockSubTab = 'equity';
    mockOrder = ['forecast', 'overview', 'payments', 'equity', 'schedule', 'renewal',
      'statements', 'renew', 'history'];
    mockHidden = ['equity'];
    await render();
    expect(mockSetActiveSubTab).toHaveBeenCalledWith('forecast');
  });

  it('still navigates from a destination tab the user kept', async () => {
    mockHidden = ['statements', 'renew'];
    const tree = await render();
    await act(async () => {
      tree.root.findAllByProps({ testID: 'filter-tab-history' })[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageHistory', { mortgageId: 'm-1' });
  });
});
