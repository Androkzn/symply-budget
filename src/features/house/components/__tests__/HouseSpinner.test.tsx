/**
 * HouseSpinner — Symply House's branded loading indicator.
 *
 * This is the ONLY spinner the House brand renders (see
 * `src/components/ui/ActivityIndicator.tsx`), so it sits on every loading gate
 * House owns. Asserts the public prop contract (`size` keyword vs numeric,
 * style passthrough, testID), the accessibility contract a progress indicator
 * owes assistive tech, the two composited brush layers (rotating enso ring +
 * pulsing house mark), and that both animations are started on mount and
 * cancelled on unmount — a leaked repeat keeps a worklet alive for the life of
 * the process.
 *
 * Reanimated is swapped for its shipped JS mock in jest.setup.js, so the
 * animation drivers are asserted through spies on the reanimated API rather
 * than by sampling frames.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Image, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockCancelAnimation = jest.fn();
const mockWithRepeat = jest.fn();
const mockWithTiming = jest.fn();

jest.mock('react-native-reanimated', () => {
  const ReactMock = require('react');
  const { Image: RNImage, View: RNView } = require('react-native');
  return {
    __esModule: true,
    default: {
      Image: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
        ReactMock.createElement(RNImage, props, children as React.ReactNode),
      View: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
        ReactMock.createElement(RNView, props, children as React.ReactNode),
      createAnimatedComponent: (Component: React.ComponentType<Record<string, unknown>>) =>
        (props: Record<string, unknown>) => ReactMock.createElement(Component, props),
    },
    Easing: {
      linear: 'linear',
      quad: 'quad',
      inOut: (fn: unknown) => ({ inOut: fn }),
    },
    cancelAnimation: (...args: unknown[]) => mockCancelAnimation(...args),
    // Real shared values are stable across renders — a fresh object each render
    // would re-fire every effect that lists one as a dependency.
    useSharedValue: (initial: number) => ReactMock.useRef({ value: initial }).current,
    useAnimatedStyle: (factory: () => Record<string, unknown>) => factory(),
    withRepeat: (...args: unknown[]) => {
      mockWithRepeat(...args);
      return { __repeat: args };
    },
    withTiming: (toValue: number, config?: Record<string, unknown>) => {
      mockWithTiming(toValue, config);
      return { __timing: toValue, config };
    },
  };
});

import { HouseSpinner } from '../HouseSpinner';
import HouseSpinnerDefault from '../HouseSpinner';

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

/** The root <Animated.View> the component renders (the sized, centred container). */
function root(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(View)[0];
}

function images(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(Image);
}

/** Flattened width/height off a style array. */
function box(style: unknown): { width?: number; height?: number } {
  const flat = (Array.isArray(style) ? style : [style]).filter(Boolean) as Array<
    Record<string, unknown>
  >;
  return flat.reduce<{ width?: number; height?: number }>((acc, s) => {
    if (typeof s.width === 'number') acc.width = s.width;
    if (typeof s.height === 'number') acc.height = s.height;
    return acc;
  }, {});
}

beforeEach(() => {
  mockCancelAnimation.mockClear();
  mockWithRepeat.mockClear();
  mockWithTiming.mockClear();
});

describe('HouseSpinner — sizing contract', () => {
  it('HOUSE-SPIN-001: defaults to the small (20px) keyword size', () => {
    const tree = render(<HouseSpinner />);
    expect(box(root(tree).props.style)).toEqual({ width: 20, height: 20 });
  });

  it('HOUSE-SPIN-002: maps the large keyword to 36px', () => {
    const tree = render(<HouseSpinner size="large" />);
    expect(box(root(tree).props.style)).toEqual({ width: 36, height: 36 });
  });

  it('HOUSE-SPIN-003: accepts an explicit numeric diameter', () => {
    const tree = render(<HouseSpinner size={64} />);
    expect(box(root(tree).props.style)).toEqual({ width: 64, height: 64 });
  });

  it('HOUSE-SPIN-004: nests the house mark at half the ring diameter', () => {
    const tree = render(<HouseSpinner size={80} />);
    const [ring, house] = images(tree);
    expect(box(ring.props.style)).toEqual({ width: 80, height: 80 });
    expect(box(house.props.style)).toEqual({ width: 40, height: 40 });
  });
});

describe('HouseSpinner — rendered layers', () => {
  it('HOUSE-SPIN-005: composites exactly two brush layers, ring beneath house mark', () => {
    const tree = render(<HouseSpinner size={40} />);
    const rendered = images(tree);
    expect(rendered).toHaveLength(2);
    // The ring is absolutely positioned so the house mark sits centred on top of it.
    const ringStyle = (Array.isArray(rendered[0].props.style)
      ? rendered[0].props.style
      : [rendered[0].props.style]) as Array<Record<string, unknown>>;
    expect(ringStyle.some((s) => s && s.position === 'absolute')).toBe(true);
    expect(rendered.every((img) => img.props.resizeMode === 'contain')).toBe(true);
  });

  it('HOUSE-SPIN-006: the two layers use different image sources', () => {
    const tree = render(<HouseSpinner />);
    const [ring, house] = images(tree);
    expect(ring.props.source).toBeDefined();
    expect(house.props.source).toBeDefined();
    expect(ring.props.source).not.toBe(house.props.source);
  });
});

describe('HouseSpinner — accessibility & testID', () => {
  it('HOUSE-SPIN-007: announces itself as a labelled progressbar', () => {
    const tree = render(<HouseSpinner />);
    expect(root(tree).props.accessibilityRole).toBe('progressbar');
    expect(root(tree).props.accessibilityLabel).toBe('Loading');
  });

  it('HOUSE-SPIN-008: forwards testID to the root node so E2E can find it', () => {
    const tree = render(<HouseSpinner testID="house-loading" />);
    expect(root(tree).props.testID).toBe('house-loading');
  });

  it('HOUSE-SPIN-009: leaves testID undefined when not supplied', () => {
    const tree = render(<HouseSpinner />);
    expect(root(tree).props.testID).toBeUndefined();
  });

  it('HOUSE-SPIN-010: merges a caller style after the intrinsic size', () => {
    const tree = render(<HouseSpinner size={24} style={{ marginTop: 12 }} />);
    const style = root(tree).props.style as Array<Record<string, unknown>>;
    expect(style[style.length - 1]).toEqual({ marginTop: 12 });
    expect(box(style)).toEqual({ width: 24, height: 24 });
  });
});

describe('HouseSpinner — animation drivers', () => {
  it('HOUSE-SPIN-011: rotates the ring a full turn, repeating forever without reversing', () => {
    render(<HouseSpinner duration={900} />);
    expect(mockWithTiming).toHaveBeenCalledWith(360, { duration: 900, easing: 'linear' });
    // withRepeat(anim, -1, false) — infinite, non-reversing.
    const rotationRepeat = mockWithRepeat.mock.calls[0];
    expect(rotationRepeat[1]).toBe(-1);
    expect(rotationRepeat[2]).toBe(false);
  });

  it('HOUSE-SPIN-012: pulses the house mark up and down, repeating forever with reversal', () => {
    render(<HouseSpinner duration={1000} />);
    expect(mockWithTiming).toHaveBeenCalledWith(1, {
      duration: 600,
      easing: { inOut: 'quad' },
    });
    // withRepeat(anim, -1, true) — infinite, reversing (yoyo) between 0 and 1.
    const pulseRepeat = mockWithRepeat.mock.calls[1];
    expect(pulseRepeat[1]).toBe(-1);
    expect(pulseRepeat[2]).toBe(true);
  });

  it('HOUSE-SPIN-013: derives the pulse duration as 60% of the rotation duration', () => {
    render(<HouseSpinner duration={2000} />);
    const durations = mockWithTiming.mock.calls
      .map((call) => (call[1] as { duration?: number } | undefined)?.duration)
      .filter((d): d is number => typeof d === 'number');
    expect(durations).toContain(2000);
    expect(durations).toContain(1200);
  });

  it('HOUSE-SPIN-014: cancels both animations on unmount so no worklet leaks', () => {
    const tree = render(<HouseSpinner />);
    expect(mockCancelAnimation).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
    expect(mockCancelAnimation).toHaveBeenCalledTimes(2);
  });

  it('HOUSE-SPIN-015: restarts both animations when duration changes', () => {
    const tree = render(<HouseSpinner duration={1200} />);
    mockWithTiming.mockClear();
    mockCancelAnimation.mockClear();
    act(() => {
      tree.update(<HouseSpinner duration={600} />);
    });
    expect(mockCancelAnimation).toHaveBeenCalledTimes(2);
    expect(mockWithTiming).toHaveBeenCalledWith(360, { duration: 600, easing: 'linear' });
  });
});

describe('HouseSpinner — module contract', () => {
  it('HOUSE-SPIN-016: is exported both named and default', () => {
    expect(HouseSpinnerDefault).toBe(HouseSpinner);
  });
});
