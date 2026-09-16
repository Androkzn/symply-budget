/**
 * MortgageView branch coverage for the v2 forecast work: the Overview interest
 * provenance badge (actual vs estimated), the Equity projected-at-renewal row,
 * and the Forecast tab's conditional paths (no-schedule fallback, stale warning,
 * VRM-trigger warning). Each test drives a specific sub-tab + summary shape.
 * Charts + slider are stubbed (covered by their own suites); the store mock uses
 * mock-prefixed mutable state so a fresh render can't loop (see MortgageForecast).
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

let mockList: () => Promise<{ mortgages: unknown[] }> = () =>
  Promise.resolve({ mortgages: [{ id: 'm-1', nickname: 'Home', lender: 'TD', productType: 'standard', currentBalanceCents: 48_000_000, pctPaid: 0.04, nextRenewalDate: '2031-07-01', isActive: true }] });

let mockSubTab = 'overview';
let mockSummary: Record<string, unknown>;
let mockStatements: Array<Record<string, unknown>> = [];
const mockSetSelected = jest.fn();
const mockSetMortgages = jest.fn();
const mockSetActiveSubTab = jest.fn();

jest.mock('@stores/mortgageStore', () => ({
  useMortgageStore: () => ({
    selectedMortgageId: 'm-1',
    setSelectedMortgage: mockSetSelected,
    setMortgages: mockSetMortgages,
    activeSubTab: mockSubTab,
    setActiveSubTab: mockSetActiveSubTab,
    dataRevision: 0,
  }),
}));

jest.mock('@stores/householdStore', () => ({
  useHouseholdStore: () => ({ currentHousehold: { id: 'hh-1' } }),
}));

jest.mock('@api/mortgage', () => ({
  __esModule: true,
  mortgageApi: {
    list: () => mockList(),
    getSummary: () => Promise.resolve(mockSummary),
    getSchedule: () => Promise.resolve({ scheduleAvailable: true, paymentsElapsed: 2, rows: [{ index: 1, interest: 206196, principal: 84606, balance: 49915394, estimated: true }] }),
    listTerms: () => Promise.resolve({ terms: [{ sequence: 1, nominal_rate_bps: 500, term_start_date: '2026-07-01' } ] }),
    listStatements: () => Promise.resolve({ statements: mockStatements }),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { MortgageView } from '../MortgageView';

function baseSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mortgageId: 'm-1', nickname: 'Home', lender: 'TD', productType: 'standard', propertyAddressMasked: null,
    scheduleAvailable: true, originalPrincipalCents: 50_000_000, currentBalanceCents: 48_000_000,
    balanceStatus: 'confirmed', balanceAsOf: '2026-07-01', paymentsElapsed: 2, paymentsTotal: 300, pctPaid: 0.04,
    scheduledPaymentCents: 290_802, paymentFrequency: 'monthly',
    rate: { nominalPct: 5, effectiveAnnualPct: 5.06, rateType: 'variable_vrm', compounding: 'semi_annual', primeRateBps: 595, spreadBps: -95 },
    totalPaidToDateCents: 500_000, totalInterestToDateCents: 400_000, totalPrincipalToDateCents: 2_000_000, totalInterestOverLifeCents: 37_000_000,
    paidToDate: { interestSource: 'actual', throughDate: '2026-06-30', statementsWithInterest: 3 },
    remainingAmortizationMonths: 298,
    currentPaymentSplit: { interestCents: 206_196, principalCents: 84_606, interestSharePct: 71 },
    crossover: { paymentIndex: 130, reached: false },
    equity: { downPaymentCents: 0, paydownEquityCents: 2_000_000, appreciationEquityCents: 0, totalEquityCents: 2_000_000, hasAppreciation: false },
    projected: {
      forwardRate: { nominalPct: 5, basedOn: 'statement', asOfDate: '2026-06-30' },
      projectionStale: false,
      toEndOfTerm: { date: '2031-07-01', balanceCents: 44_000_000, equityCents: 6_000_000, principalPaidCents: 6_000_000, totalInterestCents: 11_000_000, interestRemainingCents: 11_000_000 },
    },
    currentTerm: { sequence: 1, termStartDate: '2026-07-01', maturityDate: '2031-07-01', termMonths: 60 },
    nextRenewalDate: '2031-07-01', daysToRenewal: 1825,
    ...overrides,
  };
}

async function renderTab(subTab: string, summary: Record<string, unknown>) {
  mockSubTab = subTab;
  mockSummary = summary;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider><MortgageView /></ThemeProvider>);
  });
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
  return tree;
}

function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const inst = n as ReactTestRenderer.ReactTestInstance;
    if (inst && inst.children) walk(inst.children as unknown);
  };
  walk(tree.root.children as unknown);
  return out.join(' ');
}
function byId(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  return tree.root.findAllByProps({ testID: id });
}

describe('MortgageView — Overview interest provenance badge', () => {
  it("shows 'from N statements' when interest is actual", async () => {
    const tree = await renderTab('overview', baseSummary());
    expect(allText(tree)).toContain('from 3 statements');
  });
  it("shows 'estimated' when no statement carried interest", async () => {
    const tree = await renderTab('overview', baseSummary({ paidToDate: { interestSource: 'estimated', throughDate: null, statementsWithInterest: 0 } }));
    expect(allText(tree)).toContain('estimated');
  });
  it("singularises 'statement' for a single source", async () => {
    const tree = await renderTab('overview', baseSummary({ paidToDate: { interestSource: 'actual', throughDate: '2026-06-30', statementsWithInterest: 1 } }));
    expect(allText(tree)).toContain('from 1 statement');
  });
});

describe('MortgageView — Overview interest-vs-equity card', () => {
  // The card answers two questions at once: what did my LAST payment do, and how
  // does that compare with a typical payment of this term.
  it('stacks the last payment over the term average', async () => {
    const tree = await renderTab('overview', baseSummary());
    expect(byId(tree, 'mortgage-split-last').length).toBeGreaterThan(0);
    expect(byId(tree, 'mortgage-split-term-average').length).toBeGreaterThan(0);
    const text = allText(tree);
    expect(text).toContain('Last payment');
    expect(text).toContain('Average this term');
    // No statement uploaded → the last payment falls back to the plan and says so.
    expect(text).toContain('from your plan');
    expect(text).toContain("at today's rate");
  });

  it("uses the bank's own figures for the last payment when a statement carries them", async () => {
    mockStatements = [STATEMENT({ statement_date: '2026-08-15', interest_paid_cents: 153_112, principal_paid_cents: 63_896 })];
    const text = allText(await renderTab('overview', baseSummary()));
    expect(text).toContain('From your Aug 2026 statement');
    // `allText` joins each text node with a space, hence the spacing here.
    expect(text).toContain('Interest  $1,531  ( 71 %)');
    expect(text).toContain('Principal  $639  ( 29 %)');
  });
});

describe('MortgageView — Overview payment frequency', () => {
  // A payment figure with no cadence next to it reads as monthly by default —
  // a biweekly/weekly mortgage must say so everywhere a $ amount appears.
  it("shows the payment cadence next to the Payment tile so it isn't read as monthly", async () => {
    const tree = await renderTab('overview', baseSummary({ paymentFrequency: 'biweekly' }));
    expect(allText(tree)).toContain('every 2 weeks');
  });

  it('folds the cadence into the term-average note', async () => {
    const tree = await renderTab('overview', baseSummary({ paymentFrequency: 'biweekly' }));
    expect(allText(tree)).toContain('biweekly payment');
  });

  it('folds the cadence into the last-payment note when a statement carries the split', async () => {
    mockStatements = [STATEMENT({ statement_date: '2026-08-15', interest_paid_cents: 153_112, principal_paid_cents: 63_896 })];
    const text = allText(await renderTab('overview', baseSummary({ paymentFrequency: 'biweekly' })));
    expect(text).toContain('biweekly payment');
  });
});

describe('MortgageView — Average this term drill-down', () => {
  it('opens the term breakdown sheet on tap and closes it again', async () => {
    const tree = await renderTab('overview', baseSummary());
    expect(byId(tree, 'mortgage-term-average-sheet').length).toBe(0);

    await act(async () => {
      byId(tree, 'mortgage-split-term-average')[0].props.onPress();
    });
    expect(byId(tree, 'mortgage-term-average-sheet').length).toBeGreaterThan(0);

    await act(async () => {
      byId(tree, 'bottom-sheet-close')[0].props.onPress();
    });
    expect(byId(tree, 'mortgage-term-average-sheet').length).toBe(0);
  });

  it('invites the tap in the term-average note', async () => {
    const tree = await renderTab('overview', baseSummary());
    expect(allText(tree)).toContain('Tap for the term breakdown');
  });
});

describe('MortgageView — Equity projected row', () => {
  it('renders the projected-at-renewal figure and the appreciation hint', async () => {
    const tree = await renderTab('equity', baseSummary());
    expect(byId(tree, 'mortgage-equity-projected').length).toBeGreaterThan(0);
    const text = allText(tree);
    expect(text).toContain('Projected at renewal');
    expect(text).toContain("Add your home's current value"); // hasAppreciation=false branch
  });
});

describe('MortgageView — Forecast branches', () => {
  it('falls back to a prompt when no schedule is available', async () => {
    const tree = await renderTab('forecast', baseSummary({ scheduleAvailable: false }));
    expect(allText(tree)).toContain('Add your rate or a statement');
  });

  it('shows the stale-projection warning', async () => {
    const tree = await renderTab('forecast', baseSummary({
      projected: { ...(baseSummary().projected as object), projectionStale: true },
    }));
    expect(byId(tree, 'mortgage-forecast-stale').length).toBeGreaterThan(0);
  });

  it('warns about a VRM trigger when a +2% scenario makes the current payment insufficient', async () => {
    // A deliberately small payment: fine at 5%, but at 7% it no longer covers interest.
    const tree = await renderTab('forecast', baseSummary({ scheduledPaymentCents: 210_000, currentBalanceCents: 50_000_000, remainingAmortizationMonths: 300 }));
    await act(async () => {
      byId(tree, 'mortgage-scenario-chip-plus2')[0].props.onPress();
    });
    expect(allText(tree)).toContain("won't amortize");
    expect(allText(tree)).toContain('trigger');
  });
});

const DEFAULT_LIST = () =>
  Promise.resolve({ mortgages: [{ id: 'm-1', nickname: 'Home', lender: 'TD', productType: 'standard', currentBalanceCents: 48_000_000, pctPaid: 0.04, nextRenewalDate: '2031-07-01', isActive: true }] });

beforeEach(() => {
  mockNavigate.mockClear();
  mockList = DEFAULT_LIST;
  mockStatements = [];
});

const STATEMENT = (over: Record<string, unknown> = {}) => ({
  id: 'st-1',
  mortgage_id: 'm-1',
  statement_date: '2025-07-31',
  closing_balance_cents: 97_536_104,
  opening_balance_cents: null,
  interest_paid_cents: 153_112,
  principal_paid_cents: 63_896,
  payment_amount_cents: 217_008,
  interest_rate_bps: 409,
  prime_rate_bps: 495,
  variance_bps: -86,
  source: 'camera',
  created_at: '2025-07-31',
  ...over,
});

describe('MortgageView — Schedule tab: amortization month column', () => {
  // Term starts 2026-07-01, monthly → payment 1 lands in Aug 2026 (start + 1 mo).
  it('labels the first column by month and links the month with a statement', async () => {
    const stmt = STATEMENT({ id: 'st-aug', statement_date: '2026-08-15' });
    mockStatements = [stmt];
    const tree = await renderTab('schedule', baseSummary());
    expect(allText(tree)).toContain('Month');
    expect(allText(tree)).toContain('Aug 2026');
    const link = byId(tree, 'mortgage-schedule-statement-1');
    expect(link.length).toBeGreaterThan(0);
    await act(async () => {
      link[0].props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatementForm', {
      mortgageId: 'm-1',
      statement: stmt,
    });
  });

  it('marks a projected month (no statement) with a ~ and no link', async () => {
    mockStatements = [];
    const tree = await renderTab('schedule', baseSummary());
    expect(allText(tree)).toContain('~Aug 2026');
    expect(byId(tree, 'mortgage-schedule-statement-1').length).toBe(0);
  });

  it('falls back to the payment number when the term anchor is unknown', async () => {
    mockStatements = [];
    // No currentTerm/paymentFrequency → cannot date rows → header reverts to "#".
    const tree = await renderTab('schedule', baseSummary({ currentTerm: undefined, paymentFrequency: undefined }));
    expect(allText(tree)).toContain('Amortization schedule');
    expect(byId(tree, 'mortgage-schedule-statement-1').length).toBe(0);
  });
});

describe('MortgageView — empty + CTA paths', () => {
  it('shows the empty state and routes to setup when there is no mortgage', async () => {
    mockList = () => Promise.resolve({ mortgages: [] });
    const tree = await renderTab('overview', baseSummary());
    expect(byId(tree, 'mortgage-empty').length).toBeGreaterThan(0);
    const setup = tree.root.findAll((n) => n.props.action?.label === 'Set up mortgage')[0];
    await act(async () => { setup.props.action.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageSetup');
  });

  it('the destination tabs navigate (Statements / Renew / History)', async () => {
    // Statements / Renew / History are now tabs in the top strip that push their
    // own screen instead of switching inline content. (Add statement moved to the
    // screen header — covered by the BudgetScreen suite.)
    const tree = await renderTab('overview', baseSummary());
    const tapTab = (id: string) => byId(tree, `filter-tab-${id}`)[0].props.onPress();
    await act(async () => { tapTab('statements'); });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageStatements', { mortgageId: 'm-1' });
    await act(async () => { tapTab('renew'); });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageRenew', { mortgageId: 'm-1' });
    await act(async () => { tapTab('history'); });
    expect(mockNavigate).toHaveBeenCalledWith('MortgageHistory', { mortgageId: 'm-1' });
  });
});

describe('MortgageView — Payments & Renewal tabs render', () => {
  it('Payments tab shows the principal-vs-interest card', async () => {
    const tree = await renderTab('payments', baseSummary());
    expect(allText(tree)).toContain('Where your payments go');
  });
  it('Renewal tab shows the renewal window + compare offers', async () => {
    const tree = await renderTab('renewal', baseSummary());
    const text = allText(tree);
    expect(text).toContain('Renewal window');
    expect(text).toContain('Compare bank offers');
  });
  it('Schedule tab shows the amortization table', async () => {
    const tree = await renderTab('schedule', baseSummary());
    expect(allText(tree)).toContain('Amortization schedule');
  });
  it('renders every sub-tab in the scrollable tab bar', async () => {
    // The tabs no longer share a fixed-width row (which shrank each label to a
    // different font size); they live in a horizontally scrollable FilterTabs, so
    // all chips are always present regardless of width. The six content tabs sit
    // alongside the three destination tabs (Statements / Renew / History).
    const tree = await renderTab('overview', baseSummary());
    const ids = [
      'overview', 'payments', 'equity', 'forecast', 'schedule', 'renewal',
      'statements', 'renew', 'history',
    ];
    for (const id of ids) {
      expect(byId(tree, `filter-tab-${id}`).length).toBeGreaterThan(0);
    }
  });
});
