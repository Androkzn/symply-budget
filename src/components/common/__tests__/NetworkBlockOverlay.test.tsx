/**
 * `NetworkBlockOverlay` is the root-mounted hard-block gate: renders nothing
 * while online, and the moment `useNetworkStatus` reports a sustained outage
 * it blocks every touch behind a `Modal` with a top banner + manual Retry
 * (NetInfo's own recovery signal can lag behind reality, so the member isn't
 * stuck waiting on the poller) — EXCEPT on a local-first build, where the
 * device ledger is the source of truth and an outage must block nothing.
 */

const mockRetry = jest.fn();
const mockStatus = { isOnline: true, isRetrying: false, retry: mockRetry };
const mockUseNetworkStatus = jest.fn(() => mockStatus);
jest.mock('@hooks/useNetworkStatus', () => ({
  __esModule: true,
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockBuild = { localFirst: false };
jest.mock('@utils/localFirst', () => ({
  __esModule: true,
  isLocalFirstBuild: () => mockBuild.localFirst,
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Modal, Text, TouchableOpacity } from 'react-native';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { NetworkBlockOverlay } from '../NetworkBlockOverlay';

beforeEach(() => {
  mockRetry.mockClear();
  mockUseNetworkStatus.mockClear();
  Object.assign(mockStatus, { isOnline: true, isRetrying: false });
  mockBuild.localFirst = false;
});

describe('NetworkBlockOverlay', () => {
  it('renders nothing while online', () => {
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(r.toJSON()).toBeNull();
  });

  it('blocks via a Modal and shows the offline banner once offline', () => {
    Object.assign(mockStatus, { isOnline: false });
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);

    const modal = r.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);

    const texts = r.root.findAllByType(Text).map((n) => n.props.children);
    expect(texts.flat().join(' ')).toContain('No internet connection');
  });

  it('swallows the Android back button instead of dismissing', () => {
    Object.assign(mockStatus, { isOnline: false });
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    const modal = r.root.findByType(Modal);
    expect(() => modal.props.onRequestClose()).not.toThrow();
    // Still blocking — onRequestClose is a no-op, not a dismiss handler.
    expect(r.root.findByType(Modal).props.visible).toBe(true);
  });

  it('calls retry() when the Retry action is pressed', () => {
    Object.assign(mockStatus, { isOnline: false });
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    const retryButton = r.root.findByProps({ testID: 'network-block-retry' });
    expect(retryButton.type).toBe(TouchableOpacity);
    retryButton.props.onPress();
    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner instead of the Retry label while retrying, and disables the button', () => {
    Object.assign(mockStatus, { isOnline: false, isRetrying: true });
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(r.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    const retryButton = r.root.findByProps({ testID: 'network-block-retry' });
    expect(retryButton.props.disabled).toBe(true);
  });

  // The regression that matters for House V2 / Budget V2 / Health V2: a
  // local-first build works with the radio off, so a sustained outage must
  // leave the UI untouched — no scrim, no banner, no swallowed taps. This is
  // the whole reason a signed-out member could previously be pinned on the
  // login screen by an overlay they had no way to dismiss.
  it('renders nothing while offline on a local-first build', () => {
    mockBuild.localFirst = true;
    Object.assign(mockStatus, { isOnline: false });
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(r.toJSON()).toBeNull();
    expect(r.root.findAllByType(Modal)).toHaveLength(0);
  });

  // ...but the NetInfo subscription behind it must keep running, because it is
  // what feeds React Query's `onlineManager`. Dropping it would let every
  // remote query fire into a dead radio and raise the network errors this
  // change exists to remove.
  it('still subscribes to connectivity on a local-first build', () => {
    mockBuild.localFirst = true;
    Object.assign(mockStatus, { isOnline: false });
    renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(mockUseNetworkStatus).toHaveBeenCalled();
  });
});
