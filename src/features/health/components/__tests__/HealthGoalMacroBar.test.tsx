/**
 * HealthGoalMacroBar — the three-segment protein/carbs/fat bar shared by the
 * in-app Goals screen and the onboarding nutrition step (live preview AND the
 * "Quick presets" info sheet's per-preset charts).
 *
 * Drives the real component and asserts: the legend prints each macro's own
 * share of the total, rounded to a whole percent; and a zero-total split (no
 * macros typed yet) renders 0% everywhere rather than `NaN%` or a crash — the
 * one edge `macroSplit`'s own `Math.max(total, 1)` denominator exists to guard.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { HealthGoalMacroBar } from '../HealthGoalMacroBar';

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return tree.root
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .join('');
}

function renderBar(split: Parameters<typeof HealthGoalMacroBar>[0]['split']) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthGoalMacroBar split={split} testID="macro-bar" />
      </ThemeProvider>
    );
  });
  return tree;
}

describe('HealthGoalMacroBar', () => {
  it('prints each macro’s own share of the total, rounded to a whole percent', () => {
    const tree = renderBar({
      calories: { protein: 200, carbs: 200, fat: 600 },
      share: { protein: 0.2, carbs: 0.2, fat: 0.6 },
      total: 1000,
      difference: 0,
    });

    const text = textOf(tree);
    expect(text).toContain('Protein 20%');
    expect(text).toContain('Carbs 20%');
    expect(text).toContain('Fats 60%');
  });

  it('renders 0% everywhere for a zero-total split, not NaN or a crash', () => {
    const tree = renderBar({
      calories: { protein: 0, carbs: 0, fat: 0 },
      share: { protein: 0, carbs: 0, fat: 0 },
      total: 0,
      difference: 0,
    });

    const text = textOf(tree);
    expect(text).toContain('Protein 0%');
    expect(text).toContain('Carbs 0%');
    expect(text).toContain('Fats 0%');
    expect(text).not.toContain('NaN');
  });
});
