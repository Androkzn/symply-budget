/**
 * Forecast sub-tab: the baseline projection (to end of term, at the latest rate)
 * and the interactive rate-scenario card. Verifies the tab renders the server's
 * projection and that a quick-chip re-runs the client scenario math live (the
 * headline value for a flexible-rate borrower). Nav/stores/api are stubbed.
 */
// The PanResponder-driven slider isn't drivable under react-test-renderer (and
// its drag isn't scriptable anyway — chips drive the recompute). Stub it; the
// scenario math is covered directly in mortgageScenario.test.ts. Charts use the
// global gifted-charts stub from jest.setup.js.
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

const SUMMARY = {
  mortgageId: 'm-1',
  nickname: 'Main home',
  lender: 'TD',
  productType: 'standard',
  propertyAddressMasked: null,
  scheduleAvailable: true,
  originalPrincipalCents: 50_000_000,
  currentBalanceCents: 50_000_000,
  balanceStatus: 'confirmed',
  balanceAsOf: '2026-07-01',
  paymentsElapsed: 0,
  paymentsTotal: 300,
  pctPaid: 0,
  scheduledPaymentCents: 290_802,
  paymentFrequency: 'monthly',
  rate: {
    nominalPct: 5,
    effectiveAnnualPct: 5.06,
    rateType: 'variable_vrm',
    compounding: 'semi_annual',
    primeRateBps: 595,
    spreadBps: -95,
  },
  totalPaidToDateCents: 0,
  totalInterestToDateCents: 0,
  totalPrincipalToDateCents: 0,
  totalInterestOverLifeCents: 37_240_600,
  paidToDate: { interestSource: 'actual', throughDate: '2026-07-01', statementsWithInterest: 3 },
  remainingAmortizationMonths: 300,
  currentPaymentSplit: { interestCents: 206_196, principalCents: 84_606, interestSharePct: 71 },
  crossover: { paymentIndex: 130, reached: false },
  equity: {
    downPaymentCents: 0,
    paydownEquityCents: 0,
    appreciationEquityCents: 0,
    totalEquityCents: 0,
    hasAppreciation: false,
  },
  projected: {
    forwardRate: { nominalPct: 5, basedOn: 'statement', asOfDate: '2026-07-01' },
    projectionStale: false,
    toEndOfTerm: {
      date: '2031-07-01',
      balanceCents: 44_000_000,
      equityCents: 6_000_000,
      principalPaidCents: 6_000_000,
      totalInterestCents: 11_000_000,
      interestRemainingCents: 11_000_000,
    },
  },
  currentTerm: { sequence: 1, termStartDate: '2026-07-01', maturityDate: '2031-07-01', termMonths: 60 },
  nextRenewalDate: '2031-07-01',
  daysToRenewal: 1825,
};

jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    list: () => Promise.resolve({ mortgages: [{ id: 'm-1', nickname: 'Main home', lender: 'TD', productType: 'standard', currentBalanceCents: 50_000_000, pctPaid: 0, nextRenewalDate: '2031-07-01', isActive: true }] }),
    getSummary: () => Promise.resolve(SUMMARY),
    getSchedule: () => Promise.resolve({ scheduleAvailable: true, paymentsElapsed: 0, rows: [] }),
    listTerms: () => Promise.resolve({ terms: [] }),
    listStatements: () =>
      Promise.resolve({
        statements: [
          { id: 's1', mortgage_id: 'm-1', statement_date: '2026-05-01', closing_balance_cents: 50_200_000, opening_balance_cents: null, interest_paid_cents: 200_000, principal_paid_cents: 90_000, payment_amount_cents: 290_000, interest_rate_bps: 480, prime_rate_bps: null, variance_bps: null, source: 'manual', created_at: '2026-05-01' },
          { id: 's2', mortgage_id: 'm-1', statement_date: '2026-06-01', closing_balance_cents: 50_100_000, opening_balance_cents: null, interest_paid_cents: 205_000, principal_paid_cents: 85_000, payment_amount_cents: 290_000, interest_rate_bps: 500, prime_rate_bps: null, variance_bps: null, source: 'manual', created_at: '2026-06-01' },
        ],
      }),
  },
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

// Stable fn references — a fresh jest.fn() per call would change `load`'s
// identity every render and make useFocusEffect re-fire in an infinite loop.
const mockSetSelected = jest.fn();
const mockSetMortgages = jest.fn();
const mockSetActiveSubTab = jest.fn();
jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: () => ({
    selectedMortgageId: 'm-1',
    setSelectedMortgage: mockSetSelected,
    setMortgages: mockSetMortgages,
    activeSubTab: 'forecast',
    setActiveSubTab: mockSetActiveSubTab,
    dataRevision: 0,
  }),
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageView } from '../MortgageView';

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

function textOf(inst: ReactTestRenderer.ReactTestInstance): string {
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
    const n = node as ReactTestRenderer.ReactTestInstance;
    if (n && n.children) walk(n.children as unknown);
  };
  walk(inst.children as unknown);
  return out.join('');
}

function byId(tree: ReactTestRenderer.ReactTestRenderer, testID: string): ReactTestRenderer.ReactTestInstance {
  return tree.root.findAllByProps({ testID })[0];
}

describe('MortgageView — Forecast tab', () => {
  it('renders the baseline projection to end of term', async () => {
    const tree = await render();
    const baseline = textOf(byId(tree, 'mortgage-forecast-baseline'));
    expect(baseline).toContain("At today's rate (5%)");
    expect(baseline).toContain('2031-07-01'); // maturity
    expect(baseline).toContain('$440,000'); // balance at renewal (44,000,000 cents)
    expect(baseline).toContain('$60,000'); // equity at renewal (6,000,000 cents)
  });

  it('starts the scenario at the current rate and re-computes on a quick-chip tap', async () => {
    const tree = await render();
    expect(textOf(byId(tree, 'mortgage-scenario-rate'))).toBe('5.00%');

    const paymentBefore = textOf(byId(tree, 'mortgage-scenario-payment'));

    // Tap "+2%" → rate becomes 7.00% and the payment recomputes higher.
    await act(async () => {
      byId(tree, 'mortgage-scenario-chip-plus2').props.onPress();
    });
    expect(textOf(byId(tree, 'mortgage-scenario-rate'))).toBe('7.00%');
    expect(textOf(byId(tree, 'mortgage-scenario-payment'))).not.toBe(paymentBefore);
  });

  it('shows the actual rate-movement chart when ≥2 statements carry a rate', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'mortgage-rate-movement' }).length).toBeGreaterThan(0);
  });
});
