/**
 * LoanPaymentInsights — the richer "loan payoff insights" section for a
 * loan-tracked Monthly-Payments row. Covers:
 *   - stat tiles render synchronously off `item.loan_summary` (props only,
 *     no fetch) even while the schedule/loan fetches are still pending
 *   - both chart cards appear once the schedule (+ loan) fetch resolves
 *   - the cumulative-interest chart is skipped for a 0% APR loan
 *   - a lender/portal-link row appears once the loan record resolves
 *   - a null `loan_summary` renders nothing, without crashing
 */
const mockGetLoan = jest.fn();
const mockGetSchedule = jest.fn();
jest.mock('@api/budgetLoans', () => ({
  __esModule: true,
  budgetLoansApi: {
    get: (...a: unknown[]) => mockGetLoan(...a),
    getSchedule: (...a: unknown[]) => mockGetSchedule(...a),
  },
}));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetLoan, LoanScheduleRow, LoanScheduleView } from '@api/budgetLoans';
import type { RecurringPaymentLoanSummary, SavingsRecurringPayment } from '@api/savings';
import { ThemeProvider } from '@contexts/ThemeContext';

import { formatBudgetCurrency } from '../../budgetFormat';
import { fmtMonthYear } from '../../mortgage/mortgageFormat';
import { LoanPaymentInsights } from '../LoanPaymentInsights';

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

async function renderInsights(item: SavingsRecurringPayment, householdId = 'hh-test') {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LoanPaymentInsights item={item} householdId={householdId} />
      </ThemeProvider>
    );
  });
  return tree;
}

function allText(tree: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

const LOAN_SUMMARY: RecurringPaymentLoanSummary = {
  termMonths: 60,
  elapsedMonths: 24,
  paymentsRemaining: 36,
  currentBalanceCents: 1_100_000,
  interestPaidToDateCents: 90_000,
  totalInterestCents: 300_000,
  totalCostCents: 2_100_000,
  payoffDate: '2029-01-15',
};

const BASE_ITEM: SavingsRecurringPayment = {
  id: 'rp-1',
  household_id: 'hh-test',
  category_id: null,
  label: 'Car loan',
  amount_cents: 45_000,
  currency: 'CAD',
  day_of_month: 15,
  group_label: null,
  is_essential: true,
  active: true,
  is_automated: true,
  scope_type: 'all_year',
  scope_year: null,
  active_months: null,
  source: 'manual',
  created_by: null,
  created_at: '',
  updated_at: '',
  renewal_summary: null,
  loan_summary: LOAN_SUMMARY,
};

const SCHEDULE_ROWS: LoanScheduleRow[] = Array.from({ length: 60 }, (_, i) => {
  const index = i + 1;
  const interest = Math.max(0, 5_000 - index * 60);
  const principal = 30_000 - interest;
  return { index, interest, principal, balance: Math.max(0, 1_800_000 - principal * index) };
});
const SCHEDULE_VIEW: LoanScheduleView = { paymentsElapsed: 24, rows: SCHEDULE_ROWS };

const LOAN_FIXED: BudgetLoan = {
  id: 'loan-1',
  household_id: 'hh-test',
  recurring_payment_id: 'rp-1',
  loan_kind: 'installment',
  rate_type: 'fixed',
  rate_bps: 649,
  principal_cents: 1_800_000,
  term_months: 60,
  start_date: '2024-01-15',
  lender: 'Toyota Financial',
  notes: null,
  portal_url: 'https://example.com/my-account',
  amount_paid_cents: null,
  created_by: null,
  created_at: '',
  updated_at: '',
};

const LOAN_ZERO: BudgetLoan = {
  ...LOAN_FIXED,
  rate_type: 'zero',
  rate_bps: 0,
  lender: null,
  portal_url: null,
};

describe('LoanPaymentInsights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the stat tiles synchronously from props, before the schedule/loan fetches resolve', async () => {
    // Never-resolving promises — proves the tiles do not wait on the network.
    mockGetSchedule.mockReturnValue(new Promise<LoanScheduleView>(() => {}));
    mockGetLoan.mockReturnValue(
      new Promise<{ loan: BudgetLoan | null; summary: null }>(() => {})
    );

    const tree = await renderInsights(BASE_ITEM);

    expect(tree.root.findAllByProps({ testID: 'savings-loan-stat-tiles' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-balance' }).props.value).toBe(
      formatBudgetCurrency(LOAN_SUMMARY.currentBalanceCents)
    );
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-remaining' }).props.value).toBe(
      String(LOAN_SUMMARY.paymentsRemaining)
    );
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-payoff' }).props.value).toBe(
      fmtMonthYear(LOAN_SUMMARY.payoffDate)
    );
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-interest-paid' }).props.value).toBe(
      formatBudgetCurrency(LOAN_SUMMARY.interestPaidToDateCents)
    );
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-total-interest' }).props.value).toBe(
      formatBudgetCurrency(LOAN_SUMMARY.totalInterestCents)
    );
    expect(tree.root.findByProps({ testID: 'savings-loan-stat-total-cost' }).props.value).toBe(
      formatBudgetCurrency(LOAN_SUMMARY.totalCostCents)
    );

    // Chart-card area is still showing its loading affordance, not the charts.
    expect(tree.root.findAllByProps({ testID: 'savings-loan-charts-loading' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-payments-go' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-cumulative' })).toHaveLength(0);
  });

  it('renders both chart cards once the schedule and loan fetches resolve (fixed-rate loan)', async () => {
    mockGetSchedule.mockResolvedValue(SCHEDULE_VIEW);
    mockGetLoan.mockResolvedValue({ loan: LOAN_FIXED, summary: null });

    const tree = await renderInsights(BASE_ITEM);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-loan-charts-loading' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-payments-go' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-cumulative' }).length).toBeGreaterThan(0);
  });

  it('skips the cumulative-interest chart for a 0% APR loan, but keeps the payments-go chart', async () => {
    mockGetSchedule.mockResolvedValue(SCHEDULE_VIEW);
    mockGetLoan.mockResolvedValue({ loan: LOAN_ZERO, summary: null });

    const tree = await renderInsights(BASE_ITEM);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-payments-go' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'savings-loan-chart-cumulative' })).toHaveLength(0);
  });

  it('renders the lender name and a tappable portal link once the loan record resolves', async () => {
    mockGetSchedule.mockResolvedValue(SCHEDULE_VIEW);
    mockGetLoan.mockResolvedValue({ loan: LOAN_FIXED, summary: null });

    const tree = await renderInsights(BASE_ITEM);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(allText(tree)).toContain('Toyota Financial');
    expect(tree.root.findAllByProps({ testID: 'savings-loan-portal-link' }).length).toBeGreaterThan(0);
  });

  it('omits the lender card when the loan has neither lender nor portal_url', async () => {
    mockGetSchedule.mockResolvedValue(SCHEDULE_VIEW);
    mockGetLoan.mockResolvedValue({ loan: LOAN_ZERO, summary: null });

    const tree = await renderInsights(BASE_ITEM);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(tree.root.findAllByProps({ testID: 'savings-loan-lender-card' })).toHaveLength(0);
  });

  it('renders nothing and does not crash when loan_summary is null', async () => {
    mockGetSchedule.mockResolvedValue(SCHEDULE_VIEW);
    mockGetLoan.mockResolvedValue({ loan: null, summary: null });

    const tree = await renderInsights({ ...BASE_ITEM, loan_summary: null });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(tree.toJSON()).toBeNull();
    expect(mockGetSchedule).not.toHaveBeenCalled();
    expect(mockGetLoan).not.toHaveBeenCalled();
  });
});
