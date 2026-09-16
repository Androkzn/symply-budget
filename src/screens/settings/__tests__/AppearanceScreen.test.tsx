/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * AppearanceScreen — Settings ("More" tab) appearance controls.
 *
 * The legacy Clean⇄House app-style picker was removed (the app is now one flat,
 * theme-following skin). This suite covers the remaining Dark Mode / System
 * theme toggles (now always enabled), the back button, and that the screen lays
 * out on iPhone AND iPad (AdaptiveContainer caps width on tablets).
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockAppState: {
  themeMode: 'system' | 'light' | 'dark';
  setThemeMode: jest.Mock;
  accentScheme: 'classic' | 'tealCoral' | 'sageTerracotta';
  setAccentScheme: jest.Mock;
} = {
  themeMode: 'system',
  setThemeMode: jest.fn(),
  accentScheme: 'classic',
  setAccentScheme: jest.fn(),
};

jest.mock('@stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppState) => unknown) =>
      typeof selector === 'function' ? selector(mockAppState) : mockAppState,
    { getState: () => mockAppState, setState: jest.fn(), subscribe: jest.fn() }
  ),
}));

// Stub the chrome from @components/common (AppBackground / ScreenHeader). The
// real ScreenHeader pulls in ProfileProvider + notification wiring that isn't
// the subject here; other suites cover it. AdaptiveContainer (@components/layout),
// Card and Toggle (@components/ui) stay REAL so the iPad width-cap and the
// tap assertions exercise real behaviour.
jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return { screenScrollViewStyle: { scroll: {} }, SCREEN_SCROLL_TEST_ID: 'screen-scroll', screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'app-background' }, children ?? null),
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(Text, null, title ?? ''),
        React.createElement(TouchableOpacity, {
          testID: 'screen-header-back',
          onPress: onBackPress,
        })
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID: testID ?? 'screen-scroll-end' }),
  };
});

import React from 'react';

import { AppearanceScreen } from '@screens/settings/AppearanceScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() };

function makeProps() {
  return { navigation: mockNavigation, route: { key: 'Appearance', name: 'Appearance' } } as unknown as React.ComponentProps<typeof AppearanceScreen>;
}

beforeEach(() => {
  mockAppState.themeMode = 'system';
  mockAppState.setThemeMode.mockClear();
  mockNavigation.goBack.mockClear();
});

describe('AppearanceScreen — layout', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'renders the theme controls (and no legacy app-style picker) on %s',
    (device) => {
      const r = renderOnDevice(device, <AppearanceScreen {...makeProps()} />);
      expect(r.root.findByProps({ testID: 'appearance-screen' })).toBeTruthy();
      const text = treeText(r);
      expect(text).toContain('THEME');
      expect(text).toContain('Dark Mode');
      expect(text).toContain('Use System Theme');
      // The Clean/House skin picker was removed.
      expect(text).not.toContain('APP STYLE');
      expect(text).not.toContain('Available in House style');
      // Color Scheme is Budget-only (hasMultipleAccentSchemes) — the default
      // jest brand (symply-house, see jest.setup.js) never shows it. See
      // AppearanceScreen.colorScheme.test.tsx for the Budget-side coverage.
      expect(text).not.toContain('COLOR SCHEME');
    }
  );

  it('caps content width on iPad but not on iPhone', () => {
    const findMaxWidths = (device: DeviceName) => {
      const r = renderOnDevice(device, <AppearanceScreen {...makeProps()} />);
      return r.root
        .findAll((n) => {
          const mw = (n.props?.maxWidth ?? undefined) as number | undefined;
          return typeof mw === 'number';
        })
        .map((n) => n.props.maxWidth as number);
    };
    // AdaptiveContainer receives maxWidth=1000 on tablets, undefined on phones.
    expect(findMaxWidths('iPad Pro 11 (portrait)')).toContain(1000);
    expect(findMaxWidths('iPhone 14 Pro')).not.toContain(1000);
  });
});

describe('AppearanceScreen — theme toggles', () => {
  it('toggling Dark Mode sets the theme mode', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AppearanceScreen {...makeProps()} />);
    const toggles = r.root.findAll(
      (n) => typeof n.props?.onValueChange === 'function'
    );
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    // First toggle is Dark Mode; from the default (system/light) it turns dark on.
    toggles[0].props.onValueChange(true);
    expect(mockAppState.setThemeMode).toHaveBeenCalledWith('dark');
  });

  it('never disables the theme toggles (skin picker is gone)', () => {
    const r = renderOnDevice('iPhone SE', <AppearanceScreen {...makeProps()} />);
    const toggles = r.root.findAll(
      (n) => typeof n.props?.onValueChange === 'function'
    );
    expect(toggles.length).toBeGreaterThanOrEqual(2);
    expect(toggles.every((t) => t.props.disabled !== true)).toBe(true);
  });
});

describe('AppearanceScreen — navigation', () => {
  it.each(IPADS.concat(PHONES).map((d) => [d] as [DeviceName]))(
    'goes back from the header on %s',
    (device) => {
      const r = renderOnDevice(device, <AppearanceScreen {...makeProps()} />);
      const back = r.root.findByProps({ testID: 'screen-header-back' });
      back.props.onPress();
      expect(mockNavigation.goBack).toHaveBeenCalled();
    }
  );
});
