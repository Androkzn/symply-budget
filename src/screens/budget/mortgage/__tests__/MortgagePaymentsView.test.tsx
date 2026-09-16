/**
 * Mortgage → Payments tab (MORT-262..270). Asserts the tab renders the enriched
 * cards off the BE schedule, that the chart axis is labelled by CALENDAR period
 * (never "#145"), that the month/year toggle + year stepper drive the bars, and
 * that a year with statements shows the bank's actuals instead of the plan.
 *
 * Charts use the global gifted-charts stub from jest.setup.js; the bar/line data
 * is asserted through the stub's captured props.
 */
const barProps: Array<Record<string, unknown>> = [];
const lineProps: Array<Record<string, unknown>> = [];
jest.mock('react-native-gifted-charts', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BarChart: (p: Record<string, unknown>) => {
      barProps.push(p);
      return React.createElement(View, { testID: 'bar-chart' });
    },
    LineChart: (p: Record<string, unknown>) => {
      lineProps.push(p);
      return React.createElement(View, { testID: 'line-chart' });
    },
    PieChart: () => null,
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { MortgageScheduleRow, MortgageStatement, MortgageSummary } from '@api/mortgage';
import { ThemeProvider } from '@contexts/ThemeContext';
import { buildSchedule } from '@features/mortgage/amortization';

import { MortgagePaymentsView } from '../MortgagePaymentsView';

const TERM_START = '2026-01-01';

/** $500k at 5% over 25 years, monthly — the same engine the server runs. */
const ROWS: MortgageScheduleRow[] = buildSchedule({
  principal: 500_000,
  nominalAnnual: 0.05,
  frequency: 'monthly',
  compounding: 'semi_annual',
  amortizationMonths: 300,
}).map((r) => ({
  index: r.index,
  interest: Math.round(r.interest * 100),
  principal: Math.round(r.principal * 100),
  balance: Math.round(r.balance * 100),
  estimated: true,
}));

const SUMMARY = {
  mortgageId: 'm-1',
  nickname: 'Main home',
  lender: 'TD',
  productType: 'standard',
  propertyAddressMasked: null,
  scheduleAvailable: true,
  originalPrincipalCents: 500_000_00,
  currentBalanceCents: 472_000_00,
  balanceStatus: 'confirmed',
  balanceAsOf: '2026-07-01',
  paymentsElapsed: 60,
  paymentsTotal: 300,
  pctPaid: 0.056,
  scheduledPaymentCents: 290_802,
  paymentFrequency: 'monthly',
  rate: {
    nominalPct: 4.09,
    effectiveAnnualPct: 4.13,
    rateType: 'fixed',
    compounding: 'semi_annual',
    primeRateBps: null,
    spreadBps: null,
  },
  totalPaidToDateCents: 17_448_120,
  totalInterestToDateCents: 12_000_000,
  totalPrincipalToDateCents: 5_448_120,
  totalInterestOverLifeCents: 37_240_600,
  paidToDate: { interestSource: 'actual', throughDate: '2026-07-01', statementsWithInterest: 2 },
  remainingAmortizationMonths: 240,
  currentPaymentSplit: { interestCents: 160_889, principalCents: 129_913, interestSharePct: 55 },
  crossover: { paymentIndex: 130, reached: false },
  equity: {
    downPaymentCents: 0,
    paydownEquityCents: 5_448_120,
    appreciationEquityCents: 0,
    totalEquityCents: 5_448_120,
    hasAppreciation: false,
  },
  projected: {
    forwardRate: { nominalPct: 4.09, basedOn: 'term', asOfDate: null },
    projectionStale: false,
    toEndOfTerm: {
      date: '2031-01-01',
      balanceCents: 440_000_00,
      equityCents: 60_000_00,
      principalPaidCents: 60_000_00,
      totalInterestCents: 110_000_00,
      interestRemainingCents: 90_000_00,
    },
  },
  currentTerm: { sequence: 1, termStartDate: TERM_START, maturityDate: '2031-01-01', termMonths: 60 },
  nextRenewalDate: '2031-01-01',
  daysToRenewal: 1600,
} as unknown as MortgageSummary;

function stmt(date: string, interestCents: number, principalCents: number): MortgageStatement {
  return {
    id: `s-${date}`,
    mortgage_id: 'm-1',
    statement_date: date,
    closing_balance_cents: 472_000_00,
    opening_balance_cents: null,
    interest_paid_cents: interestCents,
    principal_paid_cents: principalCents,
    payment_amount_cents: 290_802,
    interest_rate_bps: 409,
    prime_rate_bps: null,
    variance_bps: null,
    source: 'manual',
    created_at: date,
  };
}

async function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
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

function byId(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAllByProps({ testID })[0];
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0;
}

/** X-axis labels of the most recently rendered bar chart. */
function lastBarLabels(): string[] {
  const last = barProps[barProps.length - 1];
  const stacks = (last?.stackData ?? []) as Array<{ label: string }>;
  return stacks.map((s) => s.label);
}

const SCHEDULE = { scheduleAvailable: true, paymentsElapsed: 60, rows: ROWS };

beforeEach(() => {
  barProps.length = 0;
  lineProps.length = 0;
});

describe('MortgagePaymentsView', () => {
  it('breaks the next payment down and prices the balance per day', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    const anatomy = textOf(byId(tree, 'mortgage-payments-anatomy'));
    expect(anatomy).toContain('$2,908'); // scheduled payment
    expect(anatomy).toContain('every month');
    expect(anatomy).toContain('Interest $1,609 (55%)');
    expect(anatomy).toContain('Principal $1,299 (45%)');
    // $472,000 at 4.09% ≈ $53/day — the tangible cost of carrying the balance.
    expect(textOf(byId(tree, 'mortgage-payments-per-day'))).toContain('$53 a day');
  });

  it('labels the bars by calendar month, never by payment number', async () => {
    await render(<MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />);
    const labels = lastBarLabels();
    expect(labels).toEqual(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
    expect(labels.some((l) => l.startsWith('#'))).toBe(false);
  });

  it('switches to one bar per year (thinned, and says so) via the range chips', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    await act(async () => {
      byId(tree, 'mortgage-payments-range-yearly').props.onPress();
    });
    const labels = lastBarLabels();
    expect(labels.length).toBeLessThanOrEqual(12);
    expect(labels[0]).toBe("'26");
    // 26 calendar years > 12 bars → thinned, and the caption must admit it.
    expect(labels[labels.length - 1]).toBe("'51");
    expect(textOf(byId(tree, 'mortgage-payments-breakdown'))).toContain('showing every 3rd year');
  });

  it('steps the year selector and re-buckets the bars', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    // Opens on the year of the NEXT unpaid payment (60 monthly payments in → 2031).
    expect(textOf(byId(tree, 'mortgage-payments-year-label'))).toBe('2031');
    const totalsBefore = textOf(byId(tree, 'mortgage-payments-visible-totals'));

    await act(async () => {
      byId(tree, 'mortgage-payments-year-next').props.onPress();
    });
    expect(textOf(byId(tree, 'mortgage-payments-year-label'))).toBe('2032');
    // A later year pays less interest and more principal, so the totals move.
    expect(textOf(byId(tree, 'mortgage-payments-visible-totals'))).not.toBe(totalsBefore);
  });

  it("prefers the bank's own figures for the year once statements exist", async () => {
    const tree = await render(
      <MortgagePaymentsView
        schedule={SCHEDULE}
        summary={SUMMARY}
        statements={[stmt('2031-02-01', 150_000, 140_802), stmt('2031-03-01', 149_000, 141_802)]}
      />
    );
    const year = textOf(byId(tree, 'mortgage-payments-year'));
    expect(year).toContain('2031 at a glance');
    expect(year).toContain("Your bank's own figures from 2 statements");
    expect(textOf(byId(tree, 'mortgage-payments-year-interest'))).toContain('$2,990'); // 150,000 + 149,000
    expect(textOf(byId(tree, 'mortgage-payments-year-interest'))).toContain('paid so far');
    // The plan stays visible beside the actuals.
    expect(year).toContain('Full-year plan:');
  });

  it('falls back to the plan (and asks for statements) when none are uploaded', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    const year = textOf(byId(tree, 'mortgage-payments-year'));
    expect(year).toContain('upload statements to see the bank');
    expect(textOf(byId(tree, 'mortgage-payments-year-interest'))).toContain('planned');
  });

  it('dates the tipping point and counts down to it', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    const tipping = textOf(byId(tree, 'mortgage-payments-tipping'));
    expect(tipping).toContain('The tipping point');
    expect(tipping).toMatch(/Payment #\d+/);
    expect(tipping).toMatch(/\d+y \d+m away|\d+ mo away/);
  });

  it('plots cumulative interest against cumulative principal on one axis', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    expect(has(tree, 'mortgage-payments-cumulative')).toBe(true);
    const line = lineProps[lineProps.length - 1];
    // Two series, same length, shared ceiling.
    expect((line.data as unknown[]).length).toBe((line.data2 as unknown[]).length);
    expect(line.maxValue).toBeGreaterThan(0);
    const totals = textOf(byId(tree, 'mortgage-payments-total-interest'));
    expect(totals).toContain("at today's rate");
    // $500k at 5%/25y costs ~$0.72 of interest per dollar borrowed.
    expect(textOf(byId(tree, 'mortgage-payments-per-dollar'))).toMatch(/\$0\.\d\d/);
  });

  it('contrasts payments made with interest already burned', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={SUMMARY} statements={[]} />
    );
    const front = textOf(byId(tree, 'mortgage-payments-frontloading'));
    expect(front).toContain('20% of the way through the payments'); // 60 of 300
    expect(front).toMatch(/3\d% of the way through the interest/); // front-loaded
    expect(front).toContain('extra payments made early save far more');
  });

  it('leads with the first-payment interest share on a brand-new mortgage', async () => {
    const tree = await render(
      <MortgagePaymentsView
        schedule={{ ...SCHEDULE, paymentsElapsed: 0 }}
        summary={SUMMARY}
        statements={[]}
      />
    );
    expect(textOf(byId(tree, 'mortgage-payments-frontloading'))).toContain(
      'Your first payment is 71% interest'
    );
  });

  it('asks for a rate/statement instead of charting nothing when no schedule exists', async () => {
    const tree = await render(
      <MortgagePaymentsView
        schedule={{ scheduleAvailable: false, paymentsElapsed: 0, rows: [] }}
        summary={SUMMARY}
        statements={[]}
      />
    );
    expect(has(tree, 'mortgage-payments-unavailable')).toBe(true);
    expect(has(tree, 'mortgage-payments-breakdown')).toBe(false);
  });

  it('degrades to payment-indexed bars when the summary failed to load', async () => {
    const tree = await render(
      <MortgagePaymentsView schedule={SCHEDULE} summary={null} statements={[]} />
    );
    // No anatomy/year/cumulative cards without the summary's rate + term anchor…
    expect(has(tree, 'mortgage-payments-anatomy')).toBe(false);
    expect(has(tree, 'mortgage-payments-year')).toBe(false);
    expect(has(tree, 'mortgage-payments-cumulative')).toBe(false);
    // …but the breakdown card still renders REAL bars, payment-indexed, with the
    // calendar controls (and the misleading "shown total") hidden.
    expect(has(tree, 'mortgage-payments-breakdown')).toBe(true);
    expect(has(tree, 'mortgage-payments-range-yearly')).toBe(false);
    expect(has(tree, 'mortgage-payments-visible-totals')).toBe(false);
    const labels = lastBarLabels();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0]).toBe('#1');
    expect(textOf(byId(tree, 'mortgage-payments-breakdown'))).toContain('one payment of the plan');
  });
});
