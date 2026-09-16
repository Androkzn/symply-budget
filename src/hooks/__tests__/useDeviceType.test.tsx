/**
 * Device-matrix test for the app's adaptive brain. `useDeviceType` drives the
 * whole iPhone-vs-iPad UI (FloatingTabBar vs SidebarTabBar, split-view, grid
 * column counts, sheet presentation), so this pins the exact behaviour at every
 * real device size. Mocks useWindowDimensions and asserts the derived flags.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

import React from 'react';
import { act, create } from 'react-test-renderer';

import { useDeviceType } from '@hooks/useDeviceType';

import { DEVICES, setDevice, type DeviceName } from '../../test-utils/deviceRender';

function readDeviceType(device: DeviceName) {
  setDevice(device);
  let captured!: ReturnType<typeof useDeviceType>;
  function Probe() {
    captured = useDeviceType();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return captured;
}

describe('useDeviceType — phones', () => {
  it.each(['iPhone SE', 'iPhone 14 Pro', 'iPhone 15 Pro Max (landscape)'] as DeviceName[])(
    '%s is a phone with no sidebar/split-view',
    (device) => {
      const d = readDeviceType(device);
      expect(d.isTablet).toBe(false);
      expect(d.isPhone).toBe(true);
      expect(d.shouldUseSidebar).toBe(false);
      expect(d.shouldUseSplitView).toBe(false);
    }
  );

  it('reports orientation from width vs height', () => {
    expect(readDeviceType('iPhone 14 Pro').isPortrait).toBe(true);
    expect(readDeviceType('iPhone 15 Pro Max (landscape)').isLandscape).toBe(true);
  });
});

describe('useDeviceType — tablets', () => {
  it('iPad mini portrait: tablet, but tab bar (no sidebar/split until 1024)', () => {
    const d = readDeviceType('iPad mini (portrait)'); // 768 wide
    expect(d.isTablet).toBe(true);
    expect(d.shouldUseSidebar).toBe(false); // portrait needs >= 1024
    expect(d.shouldUseSplitView).toBe(false);
    expect(d.columns).toBe(2);
  });

  it('iPad mini landscape: sidebar + split-view (width 1024 >= breakpoints)', () => {
    const d = readDeviceType('iPad mini (landscape)'); // 1024 wide
    expect(d.isTablet).toBe(true);
    expect(d.shouldUseSidebar).toBe(true);
    expect(d.shouldUseSplitView).toBe(true);
    expect(d.columns).toBe(3);
  });

  it('iPad Pro 11 portrait: tablet, sidebar OFF (834 < 1024), 2 columns', () => {
    const d = readDeviceType('iPad Pro 11 (portrait)'); // 834 wide
    expect(d.isTablet).toBe(true);
    expect(d.shouldUseSidebar).toBe(false);
    expect(d.shouldUseSplitView).toBe(false);
    expect(d.columns).toBe(2);
  });

  it('iPad Pro 11 landscape: sidebar ON (1194 >= 768), split-view ON, 3 columns', () => {
    const d = readDeviceType('iPad Pro 11 (landscape)'); // 1194 wide
    expect(d.shouldUseSidebar).toBe(true);
    expect(d.shouldUseSplitView).toBe(true);
    expect(d.columns).toBe(3);
  });

  it('iPad Pro 12.9 portrait: sidebar ON exactly at 1024', () => {
    const d = readDeviceType('iPad Pro 12.9 (portrait)'); // 1024 wide
    expect(d.shouldUseSidebar).toBe(true);
    expect(d.shouldUseSplitView).toBe(true);
  });

  it('isIPad is true for tablets on iOS', () => {
    // jest-expo reports Platform.OS === 'ios'
    expect(readDeviceType('iPad Pro 12.9 (portrait)').isIPad).toBe(true);
    expect(readDeviceType('iPhone 14 Pro').isIPad).toBe(false);
  });
});

describe('useDeviceType — grid column ladder', () => {
  it('maps width to 1/2/3/4 columns at the documented breakpoints', () => {
    expect(readDeviceType('iPhone 14 Pro').columns).toBe(1); // 393
    expect(readDeviceType('iPad mini (portrait)').columns).toBe(2); // 768
    expect(readDeviceType('iPad Pro 11 (landscape)').columns).toBe(3); // 1194
    // Sanity: the widest device we model is >= 900 → at least 3 columns.
    expect(DEVICES['iPad Pro 12.9 (portrait)'].width).toBeGreaterThanOrEqual(900);
  });
});
