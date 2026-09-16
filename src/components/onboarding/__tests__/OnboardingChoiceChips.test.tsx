/**
 * OnboardingChoiceChips — `equalWidth` makes every `'chip'`-variant pill the
 * same width (a 3-way goal-type picker like Lose/Maintain/Gain) instead of
 * each sizing to its own label, which is what the default (preset shortcut
 * rows like calorie/step/water quick-picks) still does.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { OnboardingChoiceChips } from '../OnboardingChoiceChips';

const OPTIONS = [
  { key: 'lose', label: 'Lose' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain', label: 'Gain' },
];

function renderChips(props: Partial<React.ComponentProps<typeof OnboardingChoiceChips>> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <OnboardingChoiceChips
          options={OPTIONS}
          selected={null}
          onSelect={jest.fn()}
          testIDPrefix="goal"
          {...props}
        />
      </ThemeProvider>
    );
  });
  return tree;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style : [style];
  return list.reduce(
    (acc: Record<string, unknown>, s) => ({ ...acc, ...((s ?? {}) as Record<string, unknown>) }),
    {}
  );
}

describe('OnboardingChoiceChips equalWidth', () => {
  it('leaves the default preset-row layout untouched (content-sized, left-aligned)', () => {
    const tree = renderChips();
    const chip = tree.root.findByProps({ testID: 'goal-lose' });
    expect(flattenStyle(chip.props.style).flex).toBeUndefined();
  });

  it('gives every pill equal flex width and centers the row when equalWidth is set', () => {
    const tree = renderChips({ equalWidth: true });
    for (const option of OPTIONS) {
      const chip = tree.root.findByProps({ testID: `goal-${option.key}` });
      expect(flattenStyle(chip.props.style).flex).toBe(1);
    }
  });

  it('does not apply equalWidth to the segmented variant, which is already equal-width', () => {
    const tree = renderChips({ equalWidth: true, variant: 'segmented' });
    const chip = tree.root.findByProps({ testID: 'goal-lose' });
    // `segment` already carries its own `flex: 1` — this just asserts the
    // `equalWidth`-only style isn't double-applied on top of it.
    expect(flattenStyle(chip.props.style).flex).toBe(1);
    expect(flattenStyle(chip.props.style).alignItems).toBe('center');
  });
});
