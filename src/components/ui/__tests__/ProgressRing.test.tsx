/**
 * ProgressRing — pure ring geometry (every clamp branch) + a real render through
 * <ThemeProvider> exercising the percentage label, custom center, and label.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { ProgressRing, ringGeometry } from '../ProgressRing';
import { Typography } from '../Typography';

function collectText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectText(n, out));
    return out;
  }
  const children = (node as { children?: unknown }).children;
  if (children) collectText(children, out);
  return out;
}

function render(el: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{el}</ThemeProvider>);
  });
  return tree;
}

describe('ringGeometry', () => {
  it('computes radius, circumference and dash offset for a mid value', () => {
    const g = ringGeometry(140, 14, 0.5);
    expect(g.radius).toBe(63); // (140 - 14) / 2
    expect(g.center).toBe(70);
    expect(g.circumference).toBeCloseTo(2 * Math.PI * 63, 6);
    // Half-filled → dash offset is half the circumference.
    expect(g.dashOffset).toBeCloseTo(g.circumference * 0.5, 6);
    expect(g.clamped).toBe(0.5);
  });

  it('clamps progress above 1 down to a fully drawn ring (offset 0)', () => {
    const g = ringGeometry(100, 10, 1.7);
    expect(g.clamped).toBe(1);
    expect(g.dashOffset).toBeCloseTo(0, 6);
  });

  it('clamps negative progress up to an empty ring (offset == circumference)', () => {
    const g = ringGeometry(100, 10, -0.4);
    expect(g.clamped).toBe(0);
    expect(g.dashOffset).toBeCloseTo(g.circumference, 6);
  });

  it('treats non-finite progress as 0', () => {
    expect(ringGeometry(100, 10, NaN).clamped).toBe(0);
    expect(ringGeometry(100, 10, Infinity).clamped).toBe(0);
  });

  it('never returns a negative radius when stroke exceeds size', () => {
    const g = ringGeometry(10, 40, 0.5);
    expect(g.radius).toBe(0);
    expect(g.circumference).toBe(0);
  });
});

describe('ProgressRing render', () => {
  it('renders the rounded percentage at a mid value', () => {
    const tree = render(<ProgressRing progress={0.5} />);
    expect(collectText(tree.toJSON()).join('')).toContain('50%');
  });

  it('rounds the percentage and shows an optional label', () => {
    const tree = render(<ProgressRing progress={0.336} label="paid off" />);
    const text = collectText(tree.toJSON()).join('');
    expect(text).toContain('34%');
    expect(text).toContain('paid off');
  });

  it('hides the percentage when showPercent is false', () => {
    const tree = render(<ProgressRing progress={0.5} showPercent={false} />);
    expect(collectText(tree.toJSON()).join('')).not.toContain('50%');
  });

  it('renders custom center content instead of the default label', () => {
    const tree = render(
      <ProgressRing progress={0.9} color="#123456" trackColor="#eeeeee">
        <Typography>$975k</Typography>
      </ProgressRing>
    );
    const text = collectText(tree.toJSON()).join('');
    expect(text).toContain('$975k');
    expect(text).not.toContain('90%');
  });
});
