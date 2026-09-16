/**
 * AppearanceScreen — Color Scheme section (accent-scheme picker).
 *
 * Separate from AppearanceScreen.test.tsx because this section is
 * brand-gated (`hasMultipleAccentSchemes` — Budget only) and the default
 * jest brand (`symply-house`, see jest.setup.js) never shows it. Forces the
 * gate on here to exercise the picker itself; `AppearanceScreen.test.tsx`
 * separately guards that non-Budget brands render nothing.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockAppState = {
  themeMode: 'system' as 'system' | 'light' | 'dark',
  setThemeMode: jest.fn(),
  accentScheme: 'tealCoral' as 'classic' | 'tealCoral' | 'sageTerracotta',
  setAccentScheme: jest.fn(),
};

jest.mock('@stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppState) => unknown) =>
      typeof selector === 'function' ? selector(mockAppState) : mockAppState,
    { getState: () => mockAppState, setState: jest.fn(), subscribe: jest.fn() }
  ),
}));

jest.mock('@theme', () => ({
  ...jest.requireActual('@theme'),
  hasMultipleAccentSchemes: () => true,
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, { testID: 'app-background' }, children ?? null),
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      React.createElement(
        View,
        { testID: 'screen-header' },
        React.createElement(Text, null, title ?? ''),
        React.createElement(TouchableOpacity, { testID: 'screen-header-back', onPress: onBackPress })
      ),
    ScreenScrollEnd: ({ testID }: { testID?: string }) =>
      React.createElement(View, { testID: testID ?? 'screen-scroll-end' }),
  };
});

import React from 'react';

import { AppearanceScreen } from '@screens/settings/AppearanceScreen';
import { ACCENT_SCHEME_ORDER, ACCENT_SCHEMES } from '@theme';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';

function makeProps() {
  return {
    navigation: { goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() },
    route: { key: 'Appearance', name: 'Appearance' },
  } as any;
}

beforeEach(() => {
  mockAppState.accentScheme = 'tealCoral';
  mockAppState.setAccentScheme.mockClear();
});

describe('AppearanceScreen — Color Scheme section', () => {
  it('renders all three scheme options with their labels', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AppearanceScreen {...makeProps()} />);
    const text = treeText(r);
    expect(text).toContain('COLOR SCHEME');
    for (const id of ACCENT_SCHEME_ORDER) {
      expect(text).toContain(ACCENT_SCHEMES[id].label);
    }
  });

  it('marks the active scheme selected via testID', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AppearanceScreen {...makeProps()} />);
    expect(r.root.findByProps({ testID: 'color-scheme-tealCoral' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'color-scheme-sageTerracotta' })).toBeTruthy();
    expect(r.root.findByProps({ testID: 'color-scheme-classic' })).toBeTruthy();
  });

  it('tapping a scheme row calls setAccentScheme with that id', () => {
    const r = renderOnDevice('iPhone 14 Pro', <AppearanceScreen {...makeProps()} />);
    const row = r.root.findByProps({ testID: 'color-scheme-sageTerracotta' });
    row.props.onPress();
    expect(mockAppState.setAccentScheme).toHaveBeenCalledWith('sageTerracotta');
  });
});
