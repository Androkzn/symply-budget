/**
 * The toast, and specifically whether a member can act on one.
 *
 * A toast that reports something only fixable elsewhere ("Google Drive needs to
 * be reconnected before backups can run") is a dead end unless it can be
 * tapped: it names the problem, fades after six seconds, and leaves the member
 * to find the screen themselves. What is pinned here is that an actionable
 * toast is a tap target over its whole banner and a plain one still cannot
 * steal a touch from the screen it is reporting on.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Animated, Text, TouchableOpacity } from 'react-native';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { Toast } from '../Toast';

/** The positioned banner — the outermost Animated.View the component renders. */
function banner(root: ReturnType<typeof renderOnDevice>['root']) {
  return root.findAllByType(Animated.View)[0];
}

/**
 * Every render is unmounted, and that is load-bearing rather than tidiness.
 *
 * Toast arms `setTimeout(dismiss, duration)` on mount and clears it in the
 * effect's cleanup. A case that renders and simply ends leaves that timer live;
 * it fires ~3s later, after Jest has torn the module registry down, and
 * `Animated.parallel` inside `dismiss` throws on an undefined `Animated` from a
 * bare timer callback with no owner — which kills the WORKER PROCESS instead of
 * failing a test. The run stays green and a suite just disappears from the
 * totals, which is near-impossible to attribute later. Unmounting runs the real
 * cleanup path, so the timer never survives the case that created it.
 */
const mounted: ReturnType<typeof renderOnDevice>[] = [];
function render(element: React.ReactElement) {
  const r = renderOnDevice('iPhone 14 Pro', element);
  mounted.push(r);
  return r;
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe('Toast', () => {
  it('is not a tap target, and blocks nothing, without an onPress', () => {
    const r = render(<Toast message="Backup saved." type="success" />);

    expect(r.root.findAllByProps({ testID: 'toast-pressable' })).toHaveLength(0);
    // The toast host is full-screen so Android can dispatch touches to a banner
    // positioned below its parent's origin; this is what keeps a plain message
    // from swallowing taps meant for the screen underneath it.
    expect(banner(r.root).props.pointerEvents).toBe('none');
  });

  it('makes the whole banner tappable when there is somewhere to go', () => {
    const onPress = jest.fn();
    const r = render(
      <Toast message="Google Drive needs to be reconnected." type="error" onPress={onPress} />
    );

    expect(banner(r.root).props.pointerEvents).toBe('auto');
    const pressable = r.root.findByProps({ testID: 'toast-pressable' });
    expect(pressable.type).toBe(TouchableOpacity);

    pressable.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The label is the visible half of the affordance; the banner behind it is
  // the half that is actually easy to hit.
  it('renders the action label alongside the whole-banner target', () => {
    const onPress = jest.fn();
    const r = render(
      <Toast
        message="Google Drive needs to be reconnected."
        type="error"
        onPress={onPress}
        action={{ label: 'Reconnect', onPress }}
      />
    );

    const texts = r.root.findAllByType(Text).map((node) => node.props.children);
    expect(texts.flat().join(' ')).toContain('Reconnect');
    r.root.findByProps({ testID: 'toast-pressable' }).props.onPress();
    expect(onPress).toHaveBeenCalled();
  });
});
