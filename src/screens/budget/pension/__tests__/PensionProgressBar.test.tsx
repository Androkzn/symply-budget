/* eslint-disable no-restricted-syntax -- sentinel hex colors: the tests assert the exact value passed through, so tokens would defeat the check. */
/**
 * BUDGET-PEN-050 — `PensionProgressBar` had zero tests.
 *
 * The bar is presentation-only: every figure it draws is computed server-side
 * and handed in as a 0..1 `fraction`. It must clamp at BOTH ends so a bad or
 * over-contributed figure can never render a negative width or overflow the
 * track, and a zero/missing goal upstream (which yields NaN/Infinity, or an
 * omitted `secondFraction`) must not divide by zero or paint garbage.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { PensionProgressBar } from '../PensionProgressBar';

function render(node: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return tree;
}

type FlatStyle = Record<string, unknown>;

/** Flattened style objects of every HOST view, in draw order. */
function hostStyles(tree: ReactTestRenderer.ReactTestRenderer): FlatStyle[][] {
  return tree.root
    .findAll(node => typeof node.type === 'string', { deep: true })
    .map(node => {
      const style = node.props?.style;
      return (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(
        (s): s is FlatStyle => !!s && typeof s === 'object'
      );
    });
}

/** Every `width` string on the rendered views, in draw order. */
function segmentWidths(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  const widths: string[] = [];
  for (const flat of hostStyles(tree)) {
    for (const entry of flat) {
      if (typeof entry.width === 'string') widths.push(entry.width);
    }
  }
  return widths;
}

/** The numeric percentage of each segment (the track itself is '100%'). */
function fillPercents(tree: ReactTestRenderer.ReactTestRenderer): number[] {
  return segmentWidths(tree)
    .map(w => Number.parseFloat(w))
    .filter(n => Number.isFinite(n));
}

describe('PensionProgressBar — fraction clamping', () => {
  const cases: Array<[number, number]> = [
    [-0.5, 0],
    [0, 0],
    [0.5, 50],
    [1, 100],
    [1.8, 100],
  ];

  it.each(cases)(
    'BUDGET-PEN-050: fraction %p renders a %p%% fill (clamped 0–100)',
    (fraction, expected) => {
      const tree = render(<PensionProgressBar fraction={fraction} color="#00aa77" />);
      const percents = fillPercents(tree);
      // Track ('100%') + the single first segment.
      expect(percents).toContain(expected);
      for (const p of percents) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(100);
        expect(Number.isNaN(p)).toBe(false);
      }
    }
  );

  it('BUDGET-PEN-050: never emits a negative or NaN width string', () => {
    for (const fraction of [-0.5, 0, 0.5, 1, 1.8]) {
      const tree = render(<PensionProgressBar fraction={fraction} color="#00aa77" />);
      for (const w of segmentWidths(tree)) {
        expect(w).not.toMatch(/-/);
        expect(w).not.toMatch(/NaN/);
      }
    }
  });
});

describe('PensionProgressBar — zero / missing goal', () => {
  it('BUDGET-PEN-050: NaN is NOT clamped by the component — every caller must guard the zero goal', () => {
    // GAP, pinned deliberately: the clamp is `Math.max(0, Math.min(1, n))`, and
    // both Math.min and Math.max propagate NaN — so a 0/0 fraction renders
    // `width: 'NaN%'`. The component has no divide-by-zero guard of its own.
    // What actually keeps PEN-050 satisfied is that all four call sites divide
    // only when the denominator is > 0 (see PensionAccountsView `goalFrac`,
    // PensionGoalsView `fraction`, PensionRoomView `fraction`). If the clamp is
    // ever hardened to coerce NaN → 0, flip this assertion.
    const tree = render(<PensionProgressBar fraction={0 / 0} color="#00aa77" />);
    expect(segmentWidths(tree)).toContain('NaN%');
  });

  it('BUDGET-PEN-050: a guarded zero goal (caller pattern) renders a safe 0% fill', () => {
    const goalCents = 0;
    const contributed = 12345;
    const fraction = goalCents > 0 ? contributed / goalCents : 0;
    const tree = render(<PensionProgressBar fraction={fraction} color="#00aa77" />);
    expect(fillPercents(tree)).toEqual([100, 0]);
    expect(segmentWidths(tree).some(w => w.includes('NaN'))).toBe(false);
  });

  it('BUDGET-PEN-050: Infinity from a missing goal clamps to 100%', () => {
    const tree = render(<PensionProgressBar fraction={1 / 0} color="#00aa77" />);
    expect(fillPercents(tree)).toContain(100);
  });

  it('BUDGET-PEN-050: an omitted secondFraction draws no second segment', () => {
    const tree = render(<PensionProgressBar fraction={0.4} color="#00aa77" />);
    // Track + one segment only.
    expect(fillPercents(tree)).toEqual([100, 40]);
  });
});

describe('PensionProgressBar — stacked segment + over state', () => {
  it('BUDGET-PEN-050: the second segment is clamped and only drawn with a color', () => {
    const withColor = render(
      <PensionProgressBar
        fraction={0.3}
        color="#00aa77"
        secondFraction={2.5}
        secondColor="#3355ff"
      />
    );
    expect(fillPercents(withColor)).toEqual([100, 30, 100]);

    const withoutColor = render(
      <PensionProgressBar fraction={0.3} color="#00aa77" secondFraction={0.4} />
    );
    expect(fillPercents(withoutColor)).toEqual([100, 30]);
  });

  it('BUDGET-PEN-050: a zero secondFraction draws nothing (no 0%-wide ghost segment)', () => {
    const tree = render(
      <PensionProgressBar
        fraction={0.3}
        color="#00aa77"
        secondFraction={0}
        secondColor="#3355ff"
      />
    );
    expect(fillPercents(tree)).toEqual([100, 30]);
  });

  it('BUDGET-PEN-050: `over` repaints the first segment in the error tint', () => {
    const normal = render(<PensionProgressBar fraction={1} color="#00aa77" />);
    const over = render(<PensionProgressBar fraction={1} color="#00aa77" over />);

    // The fill segment is the last host view whose width is a percentage string.
    const firstBg = (tree: ReactTestRenderer.ReactTestRenderer) =>
      hostStyles(tree)
        .filter(flat => flat.some(s => typeof s.width === 'string' && s.width.endsWith('%')))
        .map(flat => flat.map(s => s.backgroundColor).filter(Boolean).pop())
        .pop();

    expect(firstBg(normal)).toBe('#00aa77');
    expect(firstBg(over)).not.toBe('#00aa77');
  });
});
