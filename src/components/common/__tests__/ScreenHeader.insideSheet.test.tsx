/**
 * ScreenHeader — `insideSheet`, for screens presented as an iOS sheet
 * (`modal` / `pageSheet`, e.g. BudgetItemForm).
 *
 * `useSafeAreaInsets` reports *window* insets, which stay at the status-bar
 * height even when the screen itself is a sheet card that already starts below
 * the status bar. Padding the header by that inset therefore rendered a blank
 * status-bar-sized band above the title inside the sheet. Inside a sheet the
 * inset must be dropped for a flat sheet top padding instead.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Window insets of a Dynamic Island iPhone — the exact value the sheet header
// must NOT pick up. The global setup mock reports 0, which cannot fail.
const WINDOW_TOP_INSET = 59;

jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 59, right: 0, bottom: 34, left: 0 };
  const frame = { width: 393, height: 852, x: 0, y: 0 };
  return {
    SafeAreaProvider: (props: { children: unknown }) => props.children,
    SafeAreaView: (props: { children: unknown }) => props.children,
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

jest.mock('@contexts/ProfileContext', () => ({
  __esModule: true,
  useProfile: () => ({ user: { display_name: 'Andrei', email: 'a@example.com' } }),
}));

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type ReactTestRenderer from 'react-test-renderer';

import { Header } from '@theme';

import { renderOnDevice } from '../../../test-utils/deviceRender';
import { ScreenHeader } from '../ScreenHeader';

/**
 * The header row is the only node carrying an explicit `paddingTop` — the value
 * built from the safe-area inset in `ScreenHeader`.
 */
const headerPaddingTop = (
  renderer: ReactTestRenderer.ReactTestRenderer
): number | undefined => {
  for (const node of renderer.root.findAllByType(View)) {
    const flat = StyleSheet.flatten(node.props.style) as
      | { paddingTop?: number }
      | undefined;
    if (typeof flat?.paddingTop === 'number') return flat.paddingTop;
  }
  return undefined;
};

const renderHeader = (insideSheet: boolean) =>
  renderOnDevice(
    'iPhone 14 Pro',
    <ScreenHeader
      title="Edit spending"
      showBackButton
      onBackPress={() => {}}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
      insideSheet={insideSheet}
    />
  );

describe('ScreenHeader insideSheet', () => {
  it('drops the window top inset inside a sheet', () => {
    expect(headerPaddingTop(renderHeader(true))).toBe(Header.sheetTopPadding);
  });

  it('keeps the safe-area inset on a full-screen presentation', () => {
    expect(headerPaddingTop(renderHeader(false))).toBe(
      WINDOW_TOP_INSET + Header.safeAreaTopExtra
    );
  });

  it('reclaims the status bar band the sheet no longer owns', () => {
    const sheet = headerPaddingTop(renderHeader(true)) ?? 0;
    const fullScreen = headerPaddingTop(renderHeader(false)) ?? 0;

    expect(fullScreen - sheet).toBeGreaterThan(WINDOW_TOP_INSET / 2);
  });
});
