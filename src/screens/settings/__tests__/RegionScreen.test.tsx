/**
 * RegionScreen — Settings country + province/state picker that drives the
 * sales-tax fallback for receipt scanning. Covers: country list renders, picking
 * a country reveals its subdivisions and persists via setTaxRegion, picking a
 * subdivision persists the pair, and the header back button.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const mockGetLocales = jest.fn(() => [] as Array<{ regionCode?: string }>);
jest.mock('expo-localization', () => ({
  getLocales: () => mockGetLocales(),
}));

const mockAppState: {
  taxCountry: string | null;
  taxRegion: string | null;
  setTaxRegion: jest.Mock;
  accentScheme: string;
} = {
  taxCountry: null,
  taxRegion: null,
  setTaxRegion: jest.fn(),
  accentScheme: 'classic',
};

jest.mock('@stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppState) => unknown) =>
      typeof selector === 'function' ? selector(mockAppState) : mockAppState,
    { getState: () => mockAppState, setState: jest.fn(), subscribe: jest.fn() }
  ),
}));

jest.mock('@components/common', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
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

import { RegionScreen } from '@screens/settings/RegionScreen';

import { renderOnDevice, treeText } from '../../../test-utils/deviceRender';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn(), push: jest.fn() };

function makeProps() {
  return { navigation: mockNavigation, route: { key: 'Region', name: 'Region' } } as any;
}

function tap(root: ReturnType<typeof renderOnDevice>['root'], testID: string) {
  const node = root.findAll(
    (n) => n.props?.testID === testID && typeof n.props?.onPress === 'function'
  )[0];
  node.props.onPress();
}

beforeEach(() => {
  mockAppState.taxCountry = null;
  mockAppState.taxRegion = null;
  mockAppState.setTaxRegion.mockClear();
  mockNavigation.goBack.mockClear();
  mockGetLocales.mockReturnValue([]);
});

describe('RegionScreen', () => {
  it('lists both countries and hides subdivisions until a country is picked', () => {
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    expect(r.root.findByProps({ testID: 'region-screen' })).toBeTruthy();
    const text = treeText(r);
    expect(text).toContain('Canada');
    expect(text).toContain('United States');
    // No province/state list before a country is chosen.
    expect(r.root.findAll((n) => n.props?.testID === 'region-sub-BC')).toHaveLength(0);
  });

  it('picking Canada persists the country selection', () => {
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    tap(r.root, 'region-country-CA');
    expect(mockAppState.setTaxRegion).toHaveBeenCalledWith('CA', null);
  });

  it('reveals Canadian provinces once Canada is the active country', () => {
    mockAppState.taxCountry = 'CA';
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    const text = treeText(r);
    expect(text).toContain('PROVINCE');
    expect(text).toContain('British Columbia');
    expect(r.root.findAll((n) => n.props?.testID === 'region-sub-BC').length).toBeGreaterThan(0);
  });

  it('picking a province persists the country + province pair', () => {
    mockAppState.taxCountry = 'CA';
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    tap(r.root, 'region-sub-BC');
    expect(mockAppState.setTaxRegion).toHaveBeenCalledWith('CA', 'BC');
  });

  it('shows US states (labelled STATE) when the country is the United States', () => {
    mockAppState.taxCountry = 'US';
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    const text = treeText(r);
    expect(text).toContain('STATE');
    expect(text).toContain('California');
    tap(r.root, 'region-sub-CA');
    expect(mockAppState.setTaxRegion).toHaveBeenCalledWith('US', 'CA');
  });

  it('goes back from the header', () => {
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    r.root.findByProps({ testID: 'screen-header-back' }).props.onPress();
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });

  it('defaults the picker to the device locale country on first run', () => {
    mockGetLocales.mockReturnValue([{ regionCode: 'CA' }]);
    const r = renderOnDevice('iPhone 14 Pro', <RegionScreen {...makeProps()} />);
    expect(r.root.findAll((n) => n.props?.testID === 'region-sub-BC').length).toBeGreaterThan(0);
    expect(treeText(r)).toContain('PROVINCE');
  });
});
