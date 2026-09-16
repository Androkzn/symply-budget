/**
 * ProgressBar — pure fill fraction (every clamp / divide branch) + a real render
 * through <ThemeProvider> covering the progress-vs-value/max input paths.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { ProgressBar, clampFraction } from '../ProgressBar';

/** Pull every `width: 'N%'` string out of the rendered tree (the fill width). */
function fillWidths(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== 'object') return out;
  const anyNode = node as { props?: { style?: unknown }; children?: unknown };
  const style = anyNode.props?.style;
  const styles = Array.isArray(style) ? style : [style];
  for (const s of styles) {
    if (s && typeof s === 'object' && typeof (s as { width?: unknown }).width === 'string') {
      out.push((s as { width: string }).width);
    }
  }
  if (Array.isArray(anyNode.children)) anyNode.children.forEach((c) => fillWidths(c, out));
  else if (anyNode.children) fillWidths(anyNode.children, out);
  return out;
}

function render(el: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{el}</ThemeProvider>);
  });
  return tree;
}

describe('clampFraction', () => {
  it('passes a fraction through when no max is given', () => {
    expect(clampFraction(0.4)).toBeCloseTo(0.4, 6);
  });

  it('divides value by max', () => {
    expect(clampFraction(30, 120)).toBeCloseTo(0.25, 6);
  });

  it('clamps above 1 and below 0', () => {
    expect(clampFraction(2)).toBe(1);
    expect(clampFraction(-1)).toBe(0);
    expect(clampFraction(200, 120)).toBe(1);
  });

  it('returns 0 for max <= 0 (no divide-by-zero)', () => {
    expect(clampFraction(50, 0)).toBe(0);
    expect(clampFraction(50, -10)).toBe(0);
  });

  it('returns 0 for non-finite input', () => {
    expect(clampFraction(NaN)).toBe(0);
    expect(clampFraction(Infinity, 100)).toBe(0); // Infinity/100 → Infinity → not finite → 0
    expect(clampFraction(1, NaN)).toBe(0); // 1/NaN → NaN → 0
  });
});

describe('ProgressBar render', () => {
  it('renders a fill width from a fraction', () => {
    const tree = render(<ProgressBar progress={0.25} />);
    expect(fillWidths(tree.toJSON())).toContain('25%');
  });

  it('renders a fill width from value / max', () => {
    const tree = render(<ProgressBar value={90} max={360} color="#123456" trackColor="#eee" />);
    expect(fillWidths(tree.toJSON())).toContain('25%');
  });

  it('clamps an over-full bar to 100%', () => {
    const tree = render(<ProgressBar value={500} max={100} height={12} />);
    expect(fillWidths(tree.toJSON())).toContain('100%');
  });

  it('renders 0% when value is given without a max', () => {
    const tree = render(<ProgressBar value={50} />);
    expect(fillWidths(tree.toJSON())).toContain('0%');
  });

  it('renders 0% with no props at all (progress defaults to 0)', () => {
    const tree = render(<ProgressBar />);
    expect(fillWidths(tree.toJSON())).toContain('0%');
  });
});
