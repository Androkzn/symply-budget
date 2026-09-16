/**
 * Shared harness for rendering components under a specific device size so tests
 * can assert iPhone **and** iPad behaviour. `useDeviceType` derives everything
 * (isTablet / shouldUseSidebar / shouldUseSplitView / columns) from
 * `useWindowDimensions`, so a test file mocks that module and this harness sets
 * the return value per device before rendering.
 *
 * Each consuming test file must hoist:
 *   jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
 *     __esModule: true,
 *     default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
 *   }));
 */
import React from 'react';
import {useWindowDimensions} from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

export const DEVICES = {
  'iPhone SE': { width: 375, height: 667 },
  'iPhone 14 Pro': { width: 393, height: 852 },
  'iPhone 15 Pro Max (landscape)': { width: 932, height: 430 },
  'iPad mini (portrait)': { width: 768, height: 1024 },
  'iPad mini (landscape)': { width: 1024, height: 768 },
  'iPad Pro 11 (portrait)': { width: 834, height: 1194 },
  'iPad Pro 11 (landscape)': { width: 1194, height: 834 },
  'iPad Pro 12.9 (portrait)': { width: 1024, height: 1366 },
} as const;

export type DeviceName = keyof typeof DEVICES;

/** The phones vs. the tablets, for parametrized `it.each` coverage. */
export const PHONES: DeviceName[] = [
  'iPhone SE',
  'iPhone 14 Pro',
  'iPhone 15 Pro Max (landscape)',
];
export const IPADS: DeviceName[] = [
  'iPad mini (portrait)',
  'iPad mini (landscape)',
  'iPad Pro 11 (portrait)',
  'iPad Pro 11 (landscape)',
  'iPad Pro 12.9 (portrait)',
];
export const ALL_DEVICES: DeviceName[] = [...PHONES, ...IPADS];

/** Point the mocked useWindowDimensions at a device's logical size. */
export function setDevice(device: DeviceName): void {
  const { width, height } = DEVICES[device];
  (useWindowDimensions as unknown as jest.Mock).mockReturnValue({
    width,
    height,
    scale: 3,
    fontScale: 1,
  });
}

/** Render a node at a given device size, wrapped in the ThemeProvider. */
export function renderOnDevice(
  device: DeviceName,
  node: React.ReactElement
): ReactTestRenderer.ReactTestRenderer {
  setDevice(device);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<ThemeProvider>{node}</ThemeProvider>);
  });
  return renderer;
}

/** Flatten every string rendered anywhere in the tree (for content assertions). */
export function treeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

/** All host nodes that carry an onPress handler (tappable targets). */
export function pressables(
  renderer: ReactTestRenderer.ReactTestRenderer
): ReactTestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (n) => typeof (n.props as { onPress?: unknown })?.onPress === 'function',
    { deep: true }
  );
}
