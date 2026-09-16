/**
 * The end-to-end version of the local-first suppression, deliberately kept in
 * its own file: `NetworkBlockOverlay.test.tsx` mocks `@utils/localFirst`, which
 * proves the overlay honours the switch but proves nothing about the switch
 * being wired to the Budget build. This file mocks only the network reading and
 * lets the REAL `isLocalFirstBuild()` → `isBudgetLocalFirst()` chain run off the
 * same `EXPO_PUBLIC_BUDGET_LOCAL_FIRST` every Budget EAS profile and the local
 * archive script set.
 *
 * The bug it guards: a Budget member whose entire budget lives in an on-device
 * ledger being pinned behind a full-screen "No internet connection" scrim with
 * a Retry button that cannot help, because sync — not the screen they are
 * looking at — is the only thing the radio was ever needed for.
 *
 * Both flags are read at RENDER time, so the env var is set per test and no
 * module reset is involved (resetting would hand the overlay a second copy of
 * React while the renderer holds the first, and every hook would throw).
 */

const mockRetry = jest.fn();
const mockStatus = { isOnline: false, isRetrying: false, retry: mockRetry };
jest.mock('@hooks/useNetworkStatus', () => ({
  __esModule: true,
  useNetworkStatus: () => mockStatus,
}));

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { Modal } from 'react-native';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { NetworkBlockOverlay } from '../NetworkBlockOverlay';

const FLAG = 'EXPO_PUBLIC_BUDGET_LOCAL_FIRST';
const original = process.env[FLAG];

afterEach(() => {
  if (original === undefined) delete process.env[FLAG];
  else process.env[FLAG] = original;
});

describe('NetworkBlockOverlay on a real Budget local-first build', () => {
  it('renders nothing while offline', () => {
    process.env[FLAG] = '1';
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(r.toJSON()).toBeNull();
    expect(r.root.findAllByType(Modal)).toHaveLength(0);
  });

  // The counterpart: with Budget's kill switch thrown the build IS Worker-backed
  // again, so the block has to come back. Without this, "renders nothing" could
  // pass for the boring reason that the overlay never renders at all.
  it('still blocks while offline once the Budget kill switch is thrown', () => {
    process.env[FLAG] = '0';
    const r = renderOnDevice('iPhone 14 Pro', <NetworkBlockOverlay />);
    expect(r.root.findByType(Modal).props.visible).toBe(true);
  });
});
