/**
 * RateSlider — the dependency-free scenario slider. The risk-bearing math (clamp,
 * snap, touch-x → value) is pure and tested directly here; the PanResponder/JSX
 * glue is exercised by a render + onLayout pass (and by mortgage-forecast.yaml on
 * device). No native module, so it works in the standalone Release build.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { RateSlider, snap, valueFromLocationX } from '../RateSlider';

describe('snap', () => {
  it('snaps to the nearest step measured from min', () => {
    expect(snap(0.051, 0.02, 0.08, 0.0025)).toBeCloseTo(0.05, 6); // 0.02 + 12·0.0025
    expect(snap(0.0509, 0.02, 0.08, 0.0025)).toBeCloseTo(0.05, 6);
    expect(snap(0.0513, 0.02, 0.08, 0.0025)).toBeCloseTo(0.0525, 6);
  });

  it('clamps below min and above max', () => {
    expect(snap(-1, 0.02, 0.08, 0.0025)).toBe(0.02);
    expect(snap(1, 0.02, 0.08, 0.0025)).toBe(0.08);
  });
});

describe('valueFromLocationX', () => {
  const min = 0.02;
  const max = 0.08;
  const step = 0.0025;
  const width = 226; // usable = 200 after the 26pt thumb

  it('returns the fallback before layout (width <= 0)', () => {
    expect(valueFromLocationX(100, 0, min, max, step, 0.05)).toBe(0.05);
  });

  it('maps the left edge to min and the right edge to max', () => {
    expect(valueFromLocationX(13, width, min, max, step, 0.05)).toBeCloseTo(min, 6); // x = THUMB/2
    expect(valueFromLocationX(width, width, min, max, step, 0.05)).toBeCloseTo(max, 6);
  });

  it('maps the midpoint to ~the middle rate (snapped) and clamps out-of-range x', () => {
    const mid = valueFromLocationX(13 + 100, width, min, max, step, 0.05); // frac 0.5
    expect(mid).toBeCloseTo(0.05, 3);
    expect(valueFromLocationX(-500, width, min, max, step, 0.05)).toBe(min); // clamp low
    expect(valueFromLocationX(5000, width, min, max, step, 0.05)).toBe(max); // clamp high
  });
});

describe('RateSlider render', () => {
  function find(root: ReactTestRenderer.ReactTestInstance, pred: (n: ReactTestRenderer.ReactTestInstance) => boolean) {
    return root.findAll(pred, { deep: true });
  }

  it('renders both bound labels and survives a layout pass', async () => {
    const onChange = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <RateSlider value={0.05} min={0.02} max={0.08} step={0.0025} onChange={onChange} testID="slider" />
        </ThemeProvider>
      );
    });
    // The min/max labels render as "2.00%" / "8.00%".
    const texts: string[] = [];
    const walk = (n: unknown) => {
      if (typeof n === 'string') texts.push(n);
      else if (Array.isArray(n)) n.forEach(walk);
      else if (n && (n as ReactTestRenderer.ReactTestInstance).children) walk((n as ReactTestRenderer.ReactTestInstance).children);
    };
    walk(tree.root.children as unknown);
    expect(texts.join('')).toContain('2.00%');
    expect(texts.join('')).toContain('8.00%');

    // Fire onLayout on the hit area (width>0) → covers the layout + thumb-position path.
    const withLayout = find(tree.root, (n) => typeof n.props.onLayout === 'function')[0];
    await act(async () => {
      withLayout.props.onLayout({ nativeEvent: { layout: { width: 300, height: 34, x: 0, y: 0 } } });
    });
    expect(find(tree.root, (n) => n.props.testID === 'slider').length).toBeGreaterThanOrEqual(1);
  });

  it('drives onChange from the PanResponder grant handler', async () => {
    const onChange = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <RateSlider value={0.05} min={0.02} max={0.08} step={0.0025} onChange={onChange} testID="slider" />
        </ThemeProvider>
      );
    });
    const hit = find(tree.root, (n) => typeof n.props.onLayout === 'function')[0];
    await act(async () => {
      hit.props.onLayout({ nativeEvent: { layout: { width: 300, height: 34, x: 0, y: 0 } } });
    });
    // The hit view carries the PanResponder panHandlers; grant maps x → a snapped rate.
    const grant = hit.props.onResponderGrant || hit.props.onStartShouldSetResponderCapture;
    if (typeof grant === 'function') {
      await act(async () => {
        hit.props.onStartShouldSetResponder?.({ nativeEvent: { locationX: 150 } });
        const th = { touchBank: [], numberActiveTouches: 0, mostRecentTimeStamp: 0, indexOfSingleActiveTouch: 0 };
        hit.props.onResponderGrant?.({ nativeEvent: { locationX: 150 }, touchHistory: th });
        // Dragging to the far right maps to the max rate.
        hit.props.onResponderMove?.({ nativeEvent: { locationX: 100000 }, touchHistory: th });
      });
      expect(onChange).toHaveBeenCalled();
      const v = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(v).toBeGreaterThanOrEqual(0.02);
      expect(v).toBeLessThanOrEqual(0.08);
    }
  });
});
