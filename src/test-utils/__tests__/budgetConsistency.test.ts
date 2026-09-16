/**
 * Self-validation for the cross-tab consistency harness. If these pass, the
 * canonical dataset is guaranteed internally coherent, so any tab test that
 * renders a figure disagreeing with it is a real cross-tab inconsistency (and
 * not a bad fixture).
 */
import React from 'react';
import { Text, View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import {
  assertCrossModelSpendConsistent,
  assertMonthlyOverviewCoherent,
  assertSavingsOverviewCoherent,
  collectRenderedText,
  formatBudgetCurrency,
  makeCanonicalMonthlyOverview,
  makeCanonicalSavingsOverview,
  rendersText,
} from '../budgetConsistency';

describe('formatBudgetCurrency', () => {
  it('renders sub-$1k values as whole dollars', () => {
    expect(formatBudgetCurrency(30000)).toBe('$300');
    expect(formatBudgetCurrency(0)).toBe('$0');
  });

  it('renders $1k+ values in full, comma-grouped', () => {
    expect(formatBudgetCurrency(160000)).toBe('$1,600');
    expect(formatBudgetCurrency(100000)).toBe('$1,000');
  });

  it('signs negative values', () => {
    expect(formatBudgetCurrency(-150000)).toBe('-$1,500');
    expect(formatBudgetCurrency(-30000)).toBe('-$300');
  });
});

describe('canonical MonthlyOverview', () => {
  const overview = makeCanonicalMonthlyOverview();

  it('is internally coherent (all money identities hold)', () => {
    expect(() => assertMonthlyOverviewCoherent(overview)).not.toThrow();
  });

  it('has the expected headline figures', () => {
    expect(overview.plannedBudget).toBe(300000);
    expect(overview.actualSpent).toBe(160000);
    expect(overview.committedTotal).toBe(40000);
    expect(overview.remainingBudget).toBe(100000);
  });

  it('detects an incoherent remaining budget', () => {
    expect(() =>
      assertMonthlyOverviewCoherent({ ...overview, remainingBudget: 99999 })
    ).toThrow(/remainingBudget/);
  });

  it('detects expenses that do not sum to actualSpent', () => {
    expect(() =>
      assertMonthlyOverviewCoherent({ ...overview, actualSpent: 123 })
    ).toThrow(/actualSpent/);
  });

  it('detects a committedTotal that does not equal Σ affordable estimates', () => {
    expect(() =>
      assertMonthlyOverviewCoherent({ ...overview, committedTotal: 99999 })
    ).toThrow(/committedTotal/);
  });

  it('detects affordability.remaining_budget disagreeing with remainingBudget', () => {
    expect(() =>
      assertMonthlyOverviewCoherent({
        ...overview,
        affordability: { ...overview.affordability, remaining_budget: 1 },
      })
    ).toThrow(/affordability\.remaining_budget/);
  });

  it('detects affordability.used_budget disagreeing with committedTotal', () => {
    expect(() =>
      assertMonthlyOverviewCoherent({
        ...overview,
        affordability: { ...overview.affordability, used_budget: 1 },
      })
    ).toThrow(/affordability\.used_budget/);
  });
});

describe('canonical SavingsOverview', () => {
  const overview = makeCanonicalSavingsOverview();

  it('is internally coherent (all money identities hold)', () => {
    expect(() => assertSavingsOverviewCoherent(overview)).not.toThrow();
  });

  it('has the expected headline figures', () => {
    // net = income 900000 − monthlyPayments 200000 − spendings 160000 = 540000
    expect(overview.netSavings).toBe(540000);
    expect(overview.ytdNet).toBe(1234500);
    expect(overview.spending.total).toBe(360000);
    expect(overview.spending.monthlyPayments).toBe(200000);
    expect(overview.spending.spendings).toBe(160000);
  });

  it('detects a net that does not equal income − spending', () => {
    expect(() =>
      assertSavingsOverviewCoherent({ ...overview, netSavings: 1 })
    ).toThrow(/netSavings/);
  });

  it('detects an incoherent spending total (≠ monthlyPayments + spendings)', () => {
    expect(() =>
      assertSavingsOverviewCoherent({
        ...overview,
        spending: { ...overview.spending, total: 1 },
      })
    ).toThrow(/spending.total/);
  });

});

describe('cross-model spend consistency (single source of truth)', () => {
  it('the Savings spendings equals the Budget actualSpent', () => {
    const monthly = makeCanonicalMonthlyOverview();
    const savings = makeCanonicalSavingsOverview();
    expect(savings.spending.spendings).toBe(monthly.actualSpent);
    expect(() => assertCrossModelSpendConsistent(monthly, savings)).not.toThrow();
  });

  it('throws when the two view models disagree on spend', () => {
    const monthly = makeCanonicalMonthlyOverview();
    const savings = makeCanonicalSavingsOverview();
    expect(() =>
      assertCrossModelSpendConsistent(
        { ...monthly, actualSpent: 999 },
        savings
      )
    ).toThrow(/one spend source/);
  });
});

describe('rendered-text extractor helpers', () => {
  function render(node: React.ReactElement): TestRenderer.ReactTestRenderer {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(node);
    });
    return tree;
  }

  it('collectRenderedText returns every string leaf and rendersText matches verbatim', () => {
    // JSX is avoided so this stays a plain .ts suite; createElement is equivalent.
    const tree = render(
      React.createElement(View, null, [
        React.createElement(Text, { key: 'a' }, '$300'),
        React.createElement(Text, { key: 'b' }, 'Remaining'),
      ])
    );
    expect(collectRenderedText(tree)).toEqual(expect.arrayContaining(['$300', 'Remaining']));
    expect(rendersText(tree, '$300')).toBe(true);
    expect(rendersText(tree, 'nope')).toBe(false);
  });
});
