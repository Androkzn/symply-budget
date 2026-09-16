/**
 * HealthSpinner — Symply Health's branded loading indicator.
 *
 * This is the ONLY spinner the Health brand renders (see
 * `src/components/ui/ActivityIndicator.tsx`), so it sits on the Home tab's
 * loading gate and on every AI/download surface Health inherits. Asserts the
 * public prop contract (`size` keyword vs numeric, style passthrough, testID),
 * the accessibility contract a progress indicator owes assistive tech, the two
 * composited brush layers (rotating enso ring + pulsing heart), and that both
 * animations are started on mount and cancelled on unmount — a leaked repeat
 * keeps a worklet alive for the life of the process.
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
const mockWithSequence = jest.fn();
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
    },
    Easing: {
      linear: 'linear',
      quad: 'quad',
      in: (fn: unknown) => ({ in: fn }),
      out: (fn: unknown) => ({ out: fn }),
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
    withSequence: (...args: unknown[]) => {
      mockWithSequence(...args);
      return { __sequence: args };
    },
    withTiming: (toValue: number, config?: Record<string, unknown>) => {
      mockWithTiming(toValue, config);
      return { __timing: toValue, config };
    },
  };
});

import { HealthSpinner } from '../HealthSpinner';
import HealthSpinnerDefault from '../HealthSpinner';

function render(element: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

/** The root <View> the component renders (the sized, centred container). */
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
  mockWithSequence.mockClear();
  mockWithTiming.mockClear();
});

describe('HealthSpinner — sizing contract', () => {
  it('HEALTH-SPIN-001: defaults to the small (20px) keyword size', () => {
    const tree = render(<HealthSpinner />);
    expect(box(root(tree).props.style)).toEqual({ width: 20, height: 20 });
  });

  it('HEALTH-SPIN-002: maps the large keyword to 36px', () => {
    const tree = render(<HealthSpinner size="large" />);
    expect(box(root(tree).props.style)).toEqual({ width: 36, height: 36 });
  });

  it('HEALTH-SPIN-003: accepts an explicit numeric diameter', () => {
    const tree = render(<HealthSpinner size={64} />);
    expect(box(root(tree).props.style)).toEqual({ width: 64, height: 64 });
  });

  it('HEALTH-SPIN-004: nests the heart at half the ring diameter', () => {
    const tree = render(<HealthSpinner size={80} />);
    const [ring, heart] = images(tree);
    expect(box(ring.props.style)).toEqual({ width: 80, height: 80 });
    expect(box(heart.props.style)).toEqual({ width: 40, height: 40 });
  });
});

describe('HealthSpinner — rendered layers', () => {
  it('HEALTH-SPIN-005: composites exactly two brush layers, ring beneath heart', () => {
    const tree = render(<HealthSpinner size={40} />);
    const rendered = images(tree);
    expect(rendered).toHaveLength(2);
    // The ring is absolutely positioned so the heart sits centred on top of it.
    const ringStyle = (Array.isArray(rendered[0].props.style)
      ? rendered[0].props.style
      : [rendered[0].props.style]) as Array<Record<string, unknown>>;
    expect(ringStyle.some((s) => s && s.position === 'absolute')).toBe(true);
    expect(rendered.every((img) => img.props.resizeMode === 'contain')).toBe(true);
  });

  it('HEALTH-SPIN-006: the two layers use different image sources', () => {
    const tree = render(<HealthSpinner />);
    const [ring, heart] = images(tree);
    expect(ring.props.source).toBeDefined();
    expect(heart.props.source).toBeDefined();
    expect(ring.props.source).not.toBe(heart.props.source);
  });
});

describe('HealthSpinner — accessibility & testID', () => {
  it('HEALTH-SPIN-007: announces itself as a labelled progressbar', () => {
    const tree = render(<HealthSpinner />);
    expect(root(tree).props.accessibilityRole).toBe('progressbar');
    expect(root(tree).props.accessibilityLabel).toBe('Loading');
  });

  it('HEALTH-SPIN-008: forwards testID to the root node so E2E can find it', () => {
    const tree = render(<HealthSpinner testID="health-loading" />);
    expect(root(tree).props.testID).toBe('health-loading');
  });

  it('HEALTH-SPIN-009: leaves testID undefined when not supplied', () => {
    const tree = render(<HealthSpinner />);
    expect(root(tree).props.testID).toBeUndefined();
  });

  it('HEALTH-SPIN-010: merges a caller style after the intrinsic size', () => {
    const tree = render(<HealthSpinner size={24} style={{ marginTop: 12 }} />);
    const style = root(tree).props.style as Array<Record<string, unknown>>;
    expect(style[style.length - 1]).toEqual({ marginTop: 12 });
    expect(box(style)).toEqual({ width: 24, height: 24 });
  });
});

describe('HealthSpinner — animation drivers', () => {
  it('HEALTH-SPIN-011: rotates the ring a full turn, repeating forever without reversing', () => {
    render(<HealthSpinner rotationDuration={900} />);
    expect(mockWithTiming).toHaveBeenCalledWith(360, { duration: 900, easing: 'linear' });
    // withRepeat(anim, -1, false) — infinite, non-reversing.
    const rotationRepeat = mockWithRepeat.mock.calls[0];
    expect(rotationRepeat[1]).toBe(-1);
    expect(rotationRepeat[2]).toBe(false);
  });

  it('HEALTH-SPIN-012: beats the heart as a five-step lub-dub sequence', () => {
    render(<HealthSpinner beatDuration={1000} />);
    expect(mockWithSequence).toHaveBeenCalledTimes(1);
    expect(mockWithSequence.mock.calls[0]).toHaveLength(5);
    // Two thumps peak at 1.18 then 1.12, each settling back to 1.
    const scales = mockWithTiming.mock.calls.map((call) => call[0]);
    expect(scales).toEqual(expect.arrayContaining([1.18, 1.12, 1]));
  });

  it('HEALTH-SPIN-013: derives thump/rest timings from beatDuration (4 thumps + rest)', () => {
    render(<HealthSpinner beatDuration={1000} />);
    const thump = 1000 * 0.14;
    const rest = 1000 - thump * 4;
    const durations = mockWithTiming.mock.calls
      .map((call) => (call[1] as { duration?: number } | undefined)?.duration)
      .filter((d): d is number => typeof d === 'number');
    expect(durations.filter((d) => d === thump)).toHaveLength(4);
    expect(durations).toContain(rest);
    expect(thump * 4 + rest).toBe(1000);
  });

  it('HEALTH-SPIN-014: cancels both animations on unmount so no worklet leaks', () => {
    const tree = render(<HealthSpinner />);
    expect(mockCancelAnimation).not.toHaveBeenCalled();
    act(() => {
      tree.unmount();
    });
    expect(mockCancelAnimation).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-SPIN-015: restarts the ring when rotationDuration changes', () => {
    const tree = render(<HealthSpinner rotationDuration={1200} />);
    mockWithTiming.mockClear();
    mockCancelAnimation.mockClear();
    act(() => {
      tree.update(<HealthSpinner rotationDuration={600} />);
    });
    // The old rotation is cancelled and a new one is scheduled at the new tempo.
    expect(mockCancelAnimation).toHaveBeenCalledTimes(1);
    expect(mockWithTiming).toHaveBeenCalledWith(360, { duration: 600, easing: 'linear' });
  });

  it('HEALTH-SPIN-016: restarts the heartbeat when beatDuration changes', () => {
    const tree = render(<HealthSpinner beatDuration={1100} />);
    mockWithSequence.mockClear();
    mockCancelAnimation.mockClear();
    act(() => {
      tree.update(<HealthSpinner beatDuration={800} />);
    });
    expect(mockCancelAnimation).toHaveBeenCalledTimes(1);
    expect(mockWithSequence).toHaveBeenCalledTimes(1);
  });
});

describe('HealthSpinner — module contract', () => {
  it('HEALTH-SPIN-017: is exported both named and default', () => {
    expect(HealthSpinnerDefault).toBe(HealthSpinner);
  });
});
