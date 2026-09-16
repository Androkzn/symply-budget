/**
 * BudgetEncouragementBanner — pure presentation of the BE-computed "Budget
 * Wins" payload. Asserts the headline / message / highlight render verbatim and
 * that a null highlight is omitted.
 */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const AnimatedView = React.forwardRef(
    (props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { ...props, ref })
  );
  return {
    __esModule: true,
    default: { View: AnimatedView, createAnimatedComponent: (c: unknown) => c },
    FadeIn: { duration: () => ({}) },
  };
});

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { BudgetEncouragement } from '@api/budget';
import { ThemeProvider } from '@contexts/ThemeContext';

import { collectRenderedText } from '../../../test-utils/budgetConsistency';
import { BudgetEncouragementBanner } from '../BudgetEncouragementBanner';

function makeEncouragement(overrides: Partial<BudgetEncouragement> = {}): BudgetEncouragement {
  return {
    tone: 'celebrate',
    emoji: '🎉',
    headline: "You're under budget!",
    message: 'Spending is $250 below your cap so far.',
    highlight: '3-month streak',
    plannedBudgetCents: 300000,
    actualSpentCents: 160000,
    remainingBudgetCents: 100000,
    paceSavingsCents: 25000,
    spentThisWeekCents: 20000,
    spentLastWeekCents: 30000,
    weekOverWeekDeltaCents: -10000,
    ytdSavingsCents: 500000,
    monthsUnderBudgetStreak: 3,
    isPositive: true,
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

describe('BudgetEncouragementBanner', () => {
  it('renders the headline, message, highlight and a branded icon for mapped emoji', () => {
    const encouragement = makeEncouragement();
    const tree = render(<BudgetEncouragementBanner encouragement={encouragement} />);
    const texts = collectRenderedText(tree);

    expect(tree.root.findByProps({ testID: 'budget-encouragement-banner' })).toBeTruthy();
    expect(tree.root.findByProps({ testID: 'budget-encouragement-icon' })).toBeTruthy();
    expect(texts).toContain(encouragement.headline);
    expect(texts).toContain(encouragement.message);
    expect(texts).toContain(encouragement.highlight);
    expect(texts).not.toContain(encouragement.emoji);
  });

  it('omits the highlight pill when highlight is null', () => {
    const tree = render(
      <BudgetEncouragementBanner encouragement={makeEncouragement({ highlight: null })} />
    );
    const texts = collectRenderedText(tree);
    expect(texts).toContain("You're under budget!");
    expect(texts).not.toContain('3-month streak');
  });

  it.each(['celebrate', 'positive', 'neutral', 'watch', 'tip'] as const)(
    'renders for the %s tone without crashing',
    (tone) => {
      const tree = render(<BudgetEncouragementBanner encouragement={makeEncouragement({ tone })} />);
      expect(tree.root.findByProps({ testID: 'budget-encouragement-banner' })).toBeTruthy();
    }
  );
});
