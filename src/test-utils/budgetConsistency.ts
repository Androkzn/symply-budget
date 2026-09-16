/**
 * Cross-tab consistency harness for the Budget feature.
 *
 * Every Budget tab (Dashboard, Planned, Spendings, Savings) renders numbers
 * that originate from exactly TWO backend view models:
 *
 *   • `MonthlyOverview` (budgetApi.getMonthlyOverview) — feeds Dashboard,
 *     Planned and Spendings.
 *   • `SavingsOverview` (savingsApi.getOverview)       — feeds the Savings tab
 *     AND the Dashboard "Savings summary" card.
 *
 * Because the tabs never recompute money locally, "all numbers match across
 * tabs" reduces to: (1) both view models are internally coherent, and (2) the
 * tabs render the same figure for the same field. This module provides ONE
 * canonical, internally-consistent dataset plus the invariant assertions and a
 * shared formatter/text-extractor, so a single source of truth drives every
 * tab test. If a tab ever renders a number that disagrees with this dataset,
 * the consistency test fails.
 */
import type ReactTestRenderer from 'react-test-renderer';

import type {
  AffordabilityPlan,
  BudgetItem,
  Expense,
  MonthlyOverview,
} from '@api/budget';
import type { SavingsOverview } from '@api/savings';

export const CANONICAL_HOUSEHOLD_ID = 'hh-consistency';
export const CANONICAL_YEAR = 2026;
export const CANONICAL_MONTH = 7;

/**
 * `formatCurrency` as implemented (identically) by BudgetDashboardView and
 * BudgetPlannedFitCard: cents → whole grouped dollars, `$1,635`, signed — never
 * abbreviated to `$1.6k` and never cents.
 * Kept here so tests assert against the *same* rounding the screens use.
 */
export function formatBudgetCurrency(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.round(Math.abs(dollars));
  return `${sign}$${abs.toLocaleString('en-CA')}`;
}

function makeExpense(overrides: Partial<Expense> & Pick<Expense, 'id' | 'amount'>): Expense {
  return {
    household_id: CANONICAL_HOUSEHOLD_ID,
    budget_item_id: null,
    category_id: null,
    title: 'Expense',
    description: null,
    saved_amount: 0,
    deposit_amount: 0,
    expense_date: `${CANONICAL_YEAR}-07-10`,
    vendor: null,
    receipt_key: null,
    created_by: null,
    created_at: `${CANONICAL_YEAR}-07-10T00:00:00Z`,
    ...overrides,
  };
}

function makeBudgetItem(
  overrides: Partial<BudgetItem> & Pick<BudgetItem, 'id' | 'title'>
): BudgetItem {
  return {
    household_id: CANONICAL_HOUSEHOLD_ID,
    category_id: null,
    timeframe: 'immediate',
    year: CANONICAL_YEAR,
    quarter: null,
    description: null,
    estimated_cost_min: null,
    estimated_cost_max: null,
    actual_cost: null,
    priority: 'medium',
    status: 'planned',
    is_recurring: false,
    recurrence_frequency: null,
    source_type: null,
    source_id: null,
    target_date: `${CANONICAL_YEAR}-07-15`,
    completed_at: null,
    created_by: null,
    created_at: `${CANONICAL_YEAR}-07-01T00:00:00Z`,
    updated_at: `${CANONICAL_YEAR}-07-01T00:00:00Z`,
    ...overrides,
  };
}

/**
 * The one canonical MonthlyOverview. All figures are hand-picked so the money
 * identities below hold exactly:
 *   actualSpent    = Σ expenses.amount
 *   committedTotal = Σ affordable planned estimates
 *   remainingBudget = plannedBudget − actualSpent − committedTotal
 *   affordability.remaining_budget === remainingBudget
 *   affordability.used_budget      === committedTotal
 */
export function makeCanonicalMonthlyOverview(): MonthlyOverview {
  const expenses: Expense[] = [
    makeExpense({ id: 'exp-groceries', title: 'Groceries', amount: 120000, category_id: 'cat-food' }),
    makeExpense({ id: 'exp-garden', title: 'Garden soil', amount: 30000, category_id: 'cat-garden' }),
    makeExpense({ id: 'exp-misc', title: 'Misc', amount: 10000, category_id: null }),
  ];
  const actualSpent = expenses.reduce((sum, e) => sum + e.amount, 0); // 160000

  // Two affordable planned items + one deferred. Committed = affordable sum.
  const affordableItems: BudgetItem[] = [
    makeBudgetItem({
      id: 'bi-filter',
      title: 'Water filter',
      priority: 'high',
      estimated_cost_min: 25000,
      estimated_cost_max: 25000,
    }),
    makeBudgetItem({
      id: 'bi-paint',
      title: 'Touch-up paint',
      priority: 'medium',
      estimated_cost_min: 15000,
      estimated_cost_max: 15000,
    }),
  ];
  const deferredItems: BudgetItem[] = [
    makeBudgetItem({
      id: 'bi-roof',
      title: 'Roof inspection',
      priority: 'low',
      estimated_cost_min: 400000,
      estimated_cost_max: 400000,
      target_date: `${CANONICAL_YEAR}-07-28`,
    }),
  ];
  const committedTotal = affordableItems.reduce(
    (sum, i) => sum + (i.estimated_cost_min ?? 0),
    0
  ); // 40000

  const plannedBudget = 300000;
  const remainingBudget = plannedBudget - actualSpent - committedTotal; // 100000

  const affordability: AffordabilityPlan = {
    remaining_budget: remainingBudget,
    used_budget: committedTotal,
    affordable: affordableItems.map((i) => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
      target_date: i.target_date,
      status: i.status,
      estimatedCost: i.estimated_cost_min ?? 0,
      score: 100,
      reason: 'fits this month',
    })),
    deferred: deferredItems.map((i) => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
      target_date: i.target_date,
      status: i.status,
      estimatedCost: i.estimated_cost_min ?? 0,
      score: 20,
      reason: "doesn't fit yet",
    })),
  };

  const items = [...affordableItems, ...deferredItems];

  return {
    goal: {
      id: 'goal-consistency',
      household_id: CANONICAL_HOUSEHOLD_ID,
      year: CANONICAL_YEAR,
      month: CANONICAL_MONTH,
      planned_budget: plannedBudget,
      actual_spent: actualSpent,
      category_budgets: null,
      notes: null,
      created_at: `${CANONICAL_YEAR}-07-01T00:00:00Z`,
      updated_at: `${CANONICAL_YEAR}-07-01T00:00:00Z`,
    },
    plannedBudget,
    actualSpent,
    committedTotal,
    remainingBudget,
    affordability,
    items,
    expenses,
    itemCount: items.length,
    savedTotal: expenses.reduce((sum, e) => sum + (e.saved_amount ?? 0), 0),
    depositsTotal: expenses.reduce((sum, e) => sum + (e.deposit_amount ?? 0), 0),
    taxesTotal: expenses.reduce((sum, e) => sum + (e.tax_amount ?? 0), 0),
  };
}

/**
 * The one canonical SavingsOverview, coherent with these identities (the unified
 * model — savings = income − monthly payments − spendings, applied everywhere):
 *   spending.spendings = MonthlyOverview.actualSpent  (SINGLE spend source)
 *   spending.total     = spending.monthlyPayments + spending.spendings
 *   netSavings         = income.total − spending.total
 * `spendings` is the SAME figure the Budget Spendings tab & Dashboard "Spent"
 * render (Σ expenses.amount = 160000), so both view models agree on spend.
 */
export function makeCanonicalSavingsOverview(): SavingsOverview {
  const income = { total: 900000, bySource: { payroll: 800000, rental: 100000 }, entries: [] };
  // Must equal makeCanonicalMonthlyOverview().actualSpent — the one spend source.
  const spendings = 160000;
  const monthlyPayments = 200000;
  const spending = {
    total: monthlyPayments + spendings, // 360000
    monthlyPayments,
    spendings,
  };
  const netSavings = income.total - spending.total; // 540000
  const goals = [
    {
      id: 'goal-ef',
      name: 'Emergency Fund',
      type: 'emergency_fund' as const,
      target: 1000000,
      current: 400000,
      monthlyAllocation: 300000,
    },
  ];

  return {
    year: CANONICAL_YEAR,
    month: CANONICAL_MONTH,
    income,
    spending,
    netSavings,
    ytdNet: 1234500,
    goals,
  };
}

/** Throws if the MonthlyOverview fixture violates a money identity. */
export function assertMonthlyOverviewCoherent(overview: MonthlyOverview): void {
  const expensesSum = overview.expenses.reduce((sum, e) => sum + e.amount, 0);
  if (expensesSum !== overview.actualSpent) {
    throw new Error(
      `actualSpent (${overview.actualSpent}) must equal Σ expenses (${expensesSum})`
    );
  }
  const affordableSum = overview.affordability.affordable.reduce(
    (sum, i) => sum + i.estimatedCost,
    0
  );
  if (affordableSum !== overview.committedTotal) {
    throw new Error(
      `committedTotal (${overview.committedTotal}) must equal Σ affordable (${affordableSum})`
    );
  }
  const expectedRemaining =
    overview.plannedBudget - overview.actualSpent - overview.committedTotal;
  if (expectedRemaining !== overview.remainingBudget) {
    throw new Error(
      `remainingBudget (${overview.remainingBudget}) must equal planned − spent − committed (${expectedRemaining})`
    );
  }
  if (overview.affordability.remaining_budget !== overview.remainingBudget) {
    throw new Error(
      `affordability.remaining_budget (${overview.affordability.remaining_budget}) must equal remainingBudget (${overview.remainingBudget})`
    );
  }
  if (overview.affordability.used_budget !== overview.committedTotal) {
    throw new Error(
      `affordability.used_budget (${overview.affordability.used_budget}) must equal committedTotal (${overview.committedTotal})`
    );
  }
}

/** Throws if the SavingsOverview fixture violates a money identity. */
export function assertSavingsOverviewCoherent(overview: SavingsOverview): void {
  if (
    overview.spending.total !==
    overview.spending.monthlyPayments + overview.spending.spendings
  ) {
    throw new Error('spending.total must equal monthlyPayments + spendings');
  }
  const expectedNet = overview.income.total - overview.spending.total;
  if (expectedNet !== overview.netSavings) {
    throw new Error(
      `netSavings (${overview.netSavings}) must equal income − (monthlyPayments + spendings) (${expectedNet})`
    );
  }
}

/**
 * Throws if the two view models disagree on the ONE spend figure. This is the
 * single-source-of-truth guarantee: the Savings tab's `spending.spendings` must
 * equal the Budget MonthlyOverview's `actualSpent` (= Σ expenses.amount).
 */
export function assertCrossModelSpendConsistent(
  monthly: MonthlyOverview,
  savings: SavingsOverview
): void {
  if (monthly.actualSpent !== savings.spending.spendings) {
    throw new Error(
      `savings.spending.spendings (${savings.spending.spendings}) must equal ` +
        `MonthlyOverview.actualSpent (${monthly.actualSpent}) — one spend source`
    );
  }
}

/**
 * Every string rendered anywhere in the tree. Screens render dollar figures as
 * plain Text children, so this lets a test assert a figure is present exactly
 * as a user would read it.
 */
export function collectRenderedText(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  const root = tree.root;
  return root
    .findAll((n) => typeof n.props?.children === 'string', { deep: true })
    .map((n) => n.props.children as string);
}

/** True when `label` appears verbatim among the rendered text nodes. */
export function rendersText(tree: ReactTestRenderer.ReactTestRenderer, label: string): boolean {
  return collectRenderedText(tree).includes(label);
}
