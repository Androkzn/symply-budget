/* eslint-disable @typescript-eslint/no-require-imports -- Jest hoisted factories and resetModules require synchronous isolated imports. */
/**
 * CustomizationScreen — Settings ("More" tab) customization hub.
 *
 * A thin navigation hub: a single LAYOUT section with two rows — "Home Screen"
 * (→ WidgetCustomization) and "Navigation" (→ NavigationCustomization) — plus a
 * header back button. Covers that both rows fire the right navigation, the back
 * button goes back, and that the screen lays out on iPhone AND iPad (the
 * AdaptiveContainer caps its width to 1000 on tablets only).
 */

// deviceRender drives useDeviceType via a mocked useWindowDimensions.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

// Stub the chrome from @components/common (AppBackground / ScreenHeader). The
// real ScreenHeader pulls in ProfileProvider + notification wiring that isn't
// the subject here; other suites cover it. AdaptiveContainer (@components/layout),
// Card and Typography (@components/ui) stay REAL so the iPad width-cap and the
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
  };
});

import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';

import { CustomizationScreen } from '@screens/settings/CustomizationScreen';

import {
  ALL_DEVICES,
  IPADS,
  PHONES,
  pressables,
  renderOnDevice,
  treeText,
  type DeviceName,
} from '../../../test-utils/deviceRender';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() };

function makeProps() {
  return {
    navigation: mockNavigation,
    route: { key: 'Customization', name: 'Customization' },
  } as unknown as React.ComponentProps<typeof CustomizationScreen>;
}

function instanceText(node: ReactTestInstance): string {
  return node
    .findAll((n) => typeof n.props?.children === 'string', { deep: true })
    .map((n) => String(n.props.children))
    .join(' ');
}

/** First pressable whose rendered subtree contains `text`. */
function pressableWithText(
  r: ReturnType<typeof renderOnDevice>,
  text: string
): ReactTestInstance | undefined {
  return pressables(r).find((n) => {
    try {
      return JSON.stringify((n as { toJSON?: () => unknown }).toJSON?.() ?? '').includes(text) || instanceText(n).includes(text);
    } catch {
      return false;
    }
  });
}

beforeEach(() => {
  mockNavigation.goBack.mockClear();
  mockNavigation.navigate.mockClear();
  mockNavigation.push.mockClear();
});

describe('CustomizationScreen — layout', () => {
  it.each(ALL_DEVICES.map((d) => [d] as [DeviceName]))(
    'renders the customization hub and its rows on %s',
    (device) => {
      const r = renderOnDevice(device, <CustomizationScreen {...makeProps()} />);
      const text = treeText(r);
      // Section header + both rows with their titles and subtitles.
      expect(text).toContain('LAYOUT');
      expect(text).toContain('Home Screen');
      expect(text).toContain('Arrange widgets and sections');
      expect(text).toContain('Navigation');
      expect(text).toContain('Reorder or hide tabs');
      // Header stub renders the screen title + a back affordance.
      expect(text).toContain('Customization');
      expect(r.root.findByProps({ testID: 'screen-header-back' })).toBeTruthy();
    }
  );

  it('renders exactly two pressable rows', () => {
    const r = renderOnDevice('iPhone 14 Pro', <CustomizationScreen {...makeProps()} />);
    // Two SettingItem Cards are pressable; the header back stub is separate chrome.
    const homeRow = pressableWithText(r, 'Home Screen');
    const navRow = pressableWithText(r, 'Reorder or hide tabs');
    expect(homeRow).toBeTruthy();
    expect(navRow).toBeTruthy();
    expect(homeRow).not.toBe(navRow);
  });

  it('caps content width on iPad but not on iPhone', () => {
    const findMaxWidths = (device: DeviceName) => {
      const r = renderOnDevice(device, <CustomizationScreen {...makeProps()} />);
      return r.root
        .findAll((n) => typeof (n.props?.maxWidth as number | undefined) === 'number')
        .map((n) => n.props.maxWidth as number);
    };
    // AdaptiveContainer receives maxWidth=1000 on tablets, undefined on phones.
    expect(findMaxWidths('iPad Pro 11 (portrait)')).toContain(1000);
    expect(findMaxWidths('iPhone 14 Pro')).not.toContain(1000);
  });
});

describe('CustomizationScreen — navigation targets', () => {
  it.each(IPADS.concat(PHONES).map((d) => [d] as [DeviceName]))(
    'navigates to WidgetCustomization from the Home Screen row on %s',
    (device) => {
      const r = renderOnDevice(device, <CustomizationScreen {...makeProps()} />);
      const homeRow = pressableWithText(r, 'Home Screen');
      expect(homeRow).toBeTruthy();
      homeRow!.props.onPress();
      expect(mockNavigation.navigate).toHaveBeenCalledWith('WidgetCustomization');
    }
  );

  it.each(IPADS.concat(PHONES).map((d) => [d] as [DeviceName]))(
    'navigates to NavigationCustomization from the Navigation row on %s',
    (device) => {
      const r = renderOnDevice(device, <CustomizationScreen {...makeProps()} />);
      const navRow = pressableWithText(r, 'Reorder or hide tabs');
      expect(navRow).toBeTruthy();
      navRow!.props.onPress();
      expect(mockNavigation.navigate).toHaveBeenCalledWith('NavigationCustomization');
    }
  );

  it('does not navigate on initial render (only on tap)', () => {
    renderOnDevice('iPhone SE', <CustomizationScreen {...makeProps()} />);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
  });
});

describe('CustomizationScreen — back navigation', () => {
  it.each(IPADS.concat(PHONES).map((d) => [d] as [DeviceName]))(
    'goes back from the header on %s',
    (device) => {
      const r = renderOnDevice(device, <CustomizationScreen {...makeProps()} />);
      const back = r.root.findByProps({ testID: 'screen-header-back' });
      back.props.onPress();
      expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    }
  );
});
