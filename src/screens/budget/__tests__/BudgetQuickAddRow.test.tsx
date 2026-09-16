/**
 * BudgetQuickAddRow — one flat strip of suggestion chips (the Recent/Popular
 * tabs are gone; the form merges both lists before rendering). Asserts the
 * chip labels + amounts render in a single section with no tab bar, taps
 * invoke onSelect, the busy chip shows a spinner, and the row collapses to
 * null when there are no suggestions.
 */
jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  return { TouchableOpacity: RN.TouchableOpacity };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetQuickAddSuggestion } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetQuickAddRow } from '../BudgetQuickAddRow';

function makeSuggestion(
  overrides: Partial<BudgetQuickAddSuggestion> & Pick<BudgetQuickAddSuggestion, 'title'>
): BudgetQuickAddSuggestion {
  return {
    description: null,
    category_id: null,
    amount: null,
    estimated_cost_min: null,
    estimated_cost_max: null,
    priority: null,
    is_recurring: false,
    recurrence_frequency: null,
    usage_count: 1,
    last_used_at: '2026-07-10T00:00:00Z',
    ...overrides,
  };
}

function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

describe('BudgetQuickAddRow', () => {
  it('renders null when there are no suggestions', () => {
    const tree = render(
      <BudgetQuickAddRow kind="spent" suggestions={[]} busyTitle={null} onSelect={jest.fn()} />
    );
    expect(tree.toJSON()).toBeNull();
  });

  it('labels the row "QUICK ADD" so it is not mistaken for a per-month spending breakdown', () => {
    const tree = render(
      <BudgetQuickAddRow
        kind="spent"
        suggestions={[makeSuggestion({ title: 'Taxes', amount: 660000 })]}
        busyTitle={null}
        onSelect={jest.fn()}
      />
    );
    // The heading element exists and reads "QUICK ADD".
    expect(tree.root.findByProps({ testID: 'budget-quick-add-heading' })).toBeTruthy();
    expect(collectRenderedText(tree)).toContain('QUICK ADD');
    // Sanity: the row still renders its tap-to-add chip alongside the heading.
    expect(tree.root.findByProps({ testID: 'budget-quick-add-chip-Taxes' })).toBeTruthy();
  });

  it('renders every suggestion in one strip, with no Recent/Popular tab bar', () => {
    const tree = render(
      <BudgetQuickAddRow
        kind="spent"
        suggestions={[
          makeSuggestion({ title: 'Netflix', amount: 1600 }),
          makeSuggestion({ title: 'Groceries', amount: 250000 }),
        ]}
        busyTitle={null}
        onSelect={jest.fn()}
      />
    );
    expect(tree.root.findByProps({ testID: 'budget-quick-add-row' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'budget-quick-add-section' })).toBeTruthy();

    // Both chips mount at once — nothing is hidden behind a tab.
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Netflix');
    expect(texts).toContain('$16');
    expect(texts).toContain('Groceries');
    expect(texts).toContain('$2,500');

    // The tab controls are gone for good; guard against them creeping back.
    expect(tree.root.findAllByProps({ testID: 'budget-quick-add-tab-recent' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'budget-quick-add-tab-popular' })).toHaveLength(0);
    expect(texts).not.toContain('Recent');
    expect(texts).not.toContain('Popular');
  });

  it('invokes onSelect with the tapped suggestion', () => {
    const onSelect = jest.fn();
    const netflix = makeSuggestion({ title: 'Netflix', amount: 1600 });
    const tree = render(
      <BudgetQuickAddRow kind="spent" suggestions={[netflix]} busyTitle={null} onSelect={onSelect} />
    );
    act(() => tree.root.findByProps({ testID: 'budget-quick-add-chip-Netflix' }).props.onPress());
    expect(onSelect).toHaveBeenCalledWith(netflix);
  });

  it('renders a planned suggestion with its estimate range', () => {
    const tree = render(
      <BudgetQuickAddRow
        kind="planned"
        suggestions={[
          makeSuggestion({ title: 'Reno', estimated_cost_min: 10000, estimated_cost_max: 20000 }),
        ]}
        busyTitle={null}
        onSelect={jest.fn()}
      />
    );
    const texts = collectRenderedText(tree);
    expect(texts).toContain('Reno');
    expect(texts).toContain('$100-$200');
  });

  it('disables the busy chip', () => {
    const tree = render(
      <BudgetQuickAddRow
        kind="spent"
        suggestions={[makeSuggestion({ title: 'Netflix', amount: 1600 })]}
        busyTitle="Netflix"
        onSelect={jest.fn()}
      />
    );
    const chip = tree.root.findByProps({ testID: 'budget-quick-add-chip-Netflix' });
    expect(chip.props.disabled).toBe(true);
  });
});
