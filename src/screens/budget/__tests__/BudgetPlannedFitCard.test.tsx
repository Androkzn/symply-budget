/**
 * BudgetPlannedFitCard — renders the priority allocation card from the shared
 * MonthlyOverview.affordability plan. Asserts the summary figures
 * (Remaining / Fits / Still free) and the fit rows are drawn from the same
 * numbers as the rest of the Budget feature.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { AffordabilityPlan } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  CANONICAL_MONTH,
  CANONICAL_YEAR,
  collectRenderedText,
  formatBudgetCurrency,
  makeCanonicalMonthlyOverview,
} from '../../../test-utils/budgetConsistency';
import { BudgetPlannedFitCard } from '../BudgetPlannedFitCard';

function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

// A distinct, whole-year affordability plan so year-window assertions can't be
// satisfied by the month figures. remaining $5,000, fits $3,200, still free $1,800.
const yearAffordability: AffordabilityPlan = {
  remaining_budget: 500000,
  used_budget: 320000,
  affordable: [
    {
      id: 'yr-boiler',
      title: 'Annual boiler service',
      priority: 'high',
      target_date: `${CANONICAL_YEAR}-11-01`,
      status: 'planned',
      estimatedCost: 320000,
      score: 100,
      reason: 'fits this year',
    },
  ],
  deferred: [
    {
      id: 'yr-sofa',
      title: 'New sofa',
      priority: 'low',
      target_date: `${CANONICAL_YEAR}-12-20`,
      status: 'planned',
      estimatedCost: 600000,
      score: 20,
      reason: "doesn't fit yet",
    },
  ],
};

// A distinct quarter plan so quarter-window assertions can't be satisfied by the
// month or year figures. remaining $2,500, fits $1,500, still free $1,000.
const quarterAffordability: AffordabilityPlan = {
  remaining_budget: 250000,
  used_budget: 150000,
  affordable: [
    {
      id: 'q-gutters',
      title: 'Gutter cleaning',
      priority: 'medium',
      target_date: `${CANONICAL_YEAR}-09-15`,
      status: 'planned',
      estimatedCost: 150000,
      score: 60,
      reason: 'fits this quarter',
    },
  ],
  deferred: [],
};

// Forward windows, each distinct so their assertions can't be satisfied by the
// month figures.
const nextMonthAffordability: AffordabilityPlan = {
  remaining_budget: 180000, // $1,800
  used_budget: 90000,
  affordable: [
    {
      id: 'nm-fence',
      title: 'Repaint fence',
      priority: 'medium',
      target_date: `${CANONICAL_YEAR}-08-10`,
      status: 'planned',
      estimatedCost: 90000,
      score: 60,
      reason: 'fits next month',
    },
  ],
  deferred: [],
};

const nextYearAffordability: AffordabilityPlan = {
  remaining_budget: 900000, // $9,000
  used_budget: 400000,
  affordable: [
    {
      id: 'ny-kitchen',
      title: 'Kitchen reno',
      priority: 'high',
      target_date: `${CANONICAL_YEAR + 1}-03-01`,
      status: 'planned',
      estimatedCost: 400000,
      score: 100,
      reason: 'fits next year',
    },
  ],
  deferred: [],
};

describe('BudgetPlannedFitCard', () => {
  const overview = makeCanonicalMonthlyOverview();

  it('renders nothing when there are no planned items', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, items: [] }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit' }).length).toBe(0);
  });

  it('renders the month allocation summary from affordability', () => {
    const tree = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    const texts = collectRenderedText(tree);
    const { remaining_budget, used_budget } = overview.affordability;
    const free = remaining_budget - used_budget;

    expect(texts).toContain(formatBudgetCurrency(remaining_budget)); // Remaining $1,000
    expect(texts).toContain(formatBudgetCurrency(used_budget)); // Fits $400
    expect(texts).toContain(formatBudgetCurrency(free)); // Still free $600
  });

  it('lists both affordable and deferred items with fit labels', () => {
    const tree = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    const texts = collectRenderedText(tree);

    for (const item of overview.affordability.affordable) {
      expect(texts).toContain(item.title);
    }
    for (const item of overview.affordability.deferred) {
      expect(texts).toContain(item.title);
    }
    expect(texts).toContain('Fits');
    expect(texts).toContain("Won't fit");
  });

  it('toggles the week window when it is available (viewing the current month)', () => {
    const now = new Date();
    const tree = render(
      <BudgetPlannedFitCard
        overview={overview}
        year={now.getFullYear()}
        month={now.getMonth() + 1}
      />
    );
    const weekChip = tree.root.findByProps({ testID: 'budget-planned-fit-week' });
    expect(weekChip.props.disabled).toBe(false);
    act(() => weekChip.props.onPress());
    // Switch back to the month window.
    act(() => tree.root.findByProps({ testID: 'budget-planned-fit-month' }).props.onPress());
    expect(tree.root.findByProps({ testID: 'budget-planned-fit-month' })).toBeTruthy();
  });

  it('offers no year window when the backend omits yearAffordability', () => {
    const tree = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit-year' }).length).toBe(0);
  });

  it('shows the year window and renders its plan when selected', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, yearAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    const yearChip = tree.root.findByProps({ testID: 'budget-planned-fit-year' });
    expect(yearChip.props.disabled).toBe(false);

    act(() => yearChip.props.onPress());
    const texts = collectRenderedText(tree);

    expect(texts).toContain(formatBudgetCurrency(yearAffordability.remaining_budget)); // Remaining $5,000
    expect(texts).toContain(formatBudgetCurrency(yearAffordability.used_budget)); // Fits $3,200
    expect(texts).toContain(
      formatBudgetCurrency(yearAffordability.remaining_budget - yearAffordability.used_budget)
    ); // Still free $1,800
    expect(texts).toContain('Annual boiler service');
    expect(texts).toContain('New sofa');
  });

  it('offers no quarter window when the backend omits quarterAffordability', () => {
    const tree = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit-quarter' }).length).toBe(0);
  });

  it('shows the quarter window and renders its plan when selected', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, quarterAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    const quarterChip = tree.root.findByProps({ testID: 'budget-planned-fit-quarter' });
    expect(quarterChip.props.disabled).toBe(false);

    act(() => quarterChip.props.onPress());
    const texts = collectRenderedText(tree);

    expect(texts).toContain(formatBudgetCurrency(quarterAffordability.remaining_budget)); // $2,500
    expect(texts).toContain(formatBudgetCurrency(quarterAffordability.used_budget)); // $1,500
    expect(texts).toContain(
      formatBudgetCurrency(quarterAffordability.remaining_budget - quarterAffordability.used_budget)
    ); // $1,000
    expect(texts).toContain('Gutter cleaning');
  });

  it('renders the card off the quarter plan even when the month has no items', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, items: [], quarterAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'budget-planned-fit-quarter' })).toBeTruthy();
  });

  it('shows the Next month window and renders its plan when selected', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, nextMonthAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    const chip = tree.root.findByProps({ testID: 'budget-planned-fit-next_month' });
    act(() => chip.props.onPress());
    const texts = collectRenderedText(tree);
    expect(texts).toContain(formatBudgetCurrency(nextMonthAffordability.remaining_budget)); // $1,800
    expect(texts).toContain('Repaint fence');
  });

  it('shows the Next year window and renders its plan when selected', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, nextYearAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    const chip = tree.root.findByProps({ testID: 'budget-planned-fit-next_year' });
    act(() => chip.props.onPress());
    const texts = collectRenderedText(tree);
    expect(texts).toContain(formatBudgetCurrency(nextYearAffordability.remaining_budget)); // $9,000
    expect(texts).toContain('Kitchen reno');
  });

  it('offers an Anytime window for undated items and ranks them when selected', () => {
    // An undated ("When possible") planned item lives in overview.items.
    const undated = {
      ...overview.items[0],
      id: 'anytime-sofa',
      title: 'Someday sofa',
      target_date: null,
      status: 'planned' as const,
    };
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, items: [...overview.items, undated] }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    const chip = tree.root.findByProps({ testID: 'budget-planned-fit-anytime' });
    act(() => chip.props.onPress());
    expect(collectRenderedText(tree)).toContain('Someday sofa');
  });

  it('offers no forward windows when the backend omits them', () => {
    const tree = render(
      <BudgetPlannedFitCard overview={overview} year={CANONICAL_YEAR} month={CANONICAL_MONTH} />
    );
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit-next_month' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit-next_year' }).length).toBe(0);
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit-anytime' }).length).toBe(0);
  });

  it('renders the card off the year plan even when the month has no items', () => {
    const tree = render(
      <BudgetPlannedFitCard
        overview={{ ...overview, items: [], yearAffordability }}
        year={CANONICAL_YEAR}
        month={CANONICAL_MONTH}
      />
    );
    // Card is reachable via the year plan; the year toggle is present.
    expect(tree.root.findAllByProps({ testID: 'budget-planned-fit' }).length).toBeGreaterThan(0);
    expect(tree.root.findByProps({ testID: 'budget-planned-fit-year' })).toBeTruthy();
  });
});
