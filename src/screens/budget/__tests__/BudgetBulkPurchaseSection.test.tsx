/**
 * The bulk section in isolation: stepper bounds, the loading and empty states,
 * the "over after this" warning, and the closed-months note.
 */
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BulkMonthContext, BulkSuggestion } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { BudgetBulkPurchaseSection } from '../BudgetBulkPurchaseSection';
import { formatBudgetCurrency } from '../budgetFormat';

const SUGGESTION: BulkSuggestion = {
  months: 4,
  rawMonths: 4,
  basis: 'category_rate',
  confidence: 'low',
  looksRegularSize: false,
  evidence: {
    productLabel: 'Salmon',
    eventCount: 0,
    firstEventDate: null,
    monthlyRateCents: 6000,
    medianGapDays: null,
    relatedLabels: [],
    categoryName: 'Fish',
    precedentMonths: null,
    unit: null,
  },
};

const CONTEXT: BulkMonthContext[] = [
  { month: '2026-09', plannedBudget: 200000, countedCents: 195000 },
  { month: '2026-10', plannedBudget: 200000, countedCents: 0 },
  { month: '2026-11', plannedBudget: null, countedCents: 0 },
];

type Props = React.ComponentProps<typeof BudgetBulkPurchaseSection>;

function render(overrides: Partial<Props> = {}) {
  const props: Props = {
    enabled: true,
    onToggle: jest.fn(),
    months: 3,
    onChangeMonths: jest.fn(),
    suggestion: SUGGESTION,
    loading: false,
    totalCents: 40000,
    purchaseDate: '2026-09-11',
    monthContext: CONTEXT,
    touchesClosedMonths: false,
    ...overrides,
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <BudgetBulkPurchaseSection {...props} />
      </ThemeProvider>
    );
  });
  return { tree, props };
}

const textOf = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
// A testID sits on the composite (which carries onPress/disabled) and on its
// host node; pick the one that can be pressed.
const byTestID = (tree: ReactTestRenderer.ReactTestRenderer, id: string) => {
  const matches = tree.root.findAll((n) => n.props?.testID === id);
  return matches.find((n) => typeof n.props.onPress === 'function') ?? matches[0];
};

describe('BudgetBulkPurchaseSection', () => {
  it('renders only the toggle while off', () => {
    const { tree, props } = render({ enabled: false });
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-item-bulk-card')).toHaveLength(0);
    act(() => byTestID(tree, 'budget-item-bulk-toggle')!.props.onPress());
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });

  it('steps within 2..12 and disables the buttons at the bounds', () => {
    const { tree, props } = render({ months: 3 });
    act(() => byTestID(tree, 'budget-item-bulk-minus')!.props.onPress());
    act(() => byTestID(tree, 'budget-item-bulk-plus')!.props.onPress());
    expect((props.onChangeMonths as jest.Mock).mock.calls.map((c: unknown[]) => c[0])).toEqual([2, 4]);

    const atMin = render({ months: 2 });
    expect(byTestID(atMin.tree, 'budget-item-bulk-minus')!.props.disabled).toBe(true);
    act(() => byTestID(atMin.tree, 'budget-item-bulk-minus')!.props.onPress());
    expect(atMin.props.onChangeMonths).toHaveBeenCalledWith(2);

    const atMax = render({ months: 12 });
    expect(byTestID(atMax.tree, 'budget-item-bulk-plus')!.props.disabled).toBe(true);
    act(() => byTestID(atMax.tree, 'budget-item-bulk-plus')!.props.onPress());
    expect(atMax.props.onChangeMonths).toHaveBeenCalledWith(12);
  });

  it('previews every month with what is left, flags an overrun, and says when no cap is set', () => {
    const { tree } = render({ months: 3 });
    const text = textOf(tree);
    expect(text).toContain('3 months');
    expect(text).toContain('Based on what you usually spend on Fish.');
    // Sep: 200000 − 195000 − 13334 → $83.34 over.
    expect(text).toContain(`${formatBudgetCurrency(8334)} over after this`);
    // Oct: 200000 − 0 − 13333.
    expect(text).toContain(`${formatBudgetCurrency(186667)} left after this`);
    expect(text).toContain('No budget set yet');
    expect(text).toContain(
      `This month counts ${formatBudgetCurrency(13334)} of ${formatBudgetCurrency(40000)}.`
    );
    expect(tree.root.findAll((n) => n.props?.testID === 'budget-item-bulk-closed-note')).toHaveLength(0);
  });

  it('shows the estimating state, a fallback line, and the empty-amount footer', () => {
    const loading = render({ loading: true, suggestion: null });
    expect(textOf(loading.tree)).toContain('Estimating from your spending history…');

    const noSuggestion = render({ suggestion: null, totalCents: 0 });
    const text = textOf(noSuggestion.tree);
    expect(text).toContain('Pick how many months this purchase should last.');
    expect(text).toContain('Enter the amount to see the split.');
  });

  it('warns when a re-spread reaches into closed months and handles a one-month label', () => {
    const { tree } = render({ touchesClosedMonths: true, months: 1 });
    expect(textOf(tree)).toContain('Changes earlier months too.');
    expect(textOf(tree)).toContain('1 month');
  });
});
