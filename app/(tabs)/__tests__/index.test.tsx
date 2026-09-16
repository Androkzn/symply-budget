/**
 * app/(tabs)/index.tsx — the shared Home tab slot's brand routing.
 *
 * The Home slot is a linear if-chain over the brand gates. This suite pins that
 * chain (ROUTE-002) and the two endpoints that matter for Symply Health:
 * the Health brand must land on HealthHomeScreen (ROUTE-001) and the House
 * brand must fall through to HomeScreen without ever constructing a Health
 * component (ROUTE-005).
 *
 * Every feature module, navigator and heavy screen is mocked to a bare <View>,
 * so what is asserted here is *routing only* — never the screens' own rendering.
 * The Jest run defaults to the House brand (jest.setup.js), so each gate is
 * driven through a mutable `mock*` flag rather than the bundle's real brand.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockIsKaizenBrand = false;
let mockIsLanguageBrand = false;
let mockIsBudgetBrand = false;
let mockIsHealthBrand = false;

const mockHealthHomeScreenCtor = jest.fn();
const mockHouseHomeScreenCtor = jest.fn();

jest.mock('@features/kaizen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isKaizenBrand: () => mockIsKaizenBrand,
    KaizenTodayScreen: () => ReactMock.createElement(View, { testID: 'kaizen-today-screen' }),
  };
});

jest.mock('@features/language', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isLanguageBrand: () => mockIsLanguageBrand,
    LanguageLearnScreen: () => ReactMock.createElement(View, { testID: 'language-learn-screen' }),
  };
});

jest.mock('@features/budget', () => ({ isBudgetBrand: () => mockIsBudgetBrand }));

jest.mock('@features/health', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isHealthBrand: () => mockIsHealthBrand,
    HealthHomeScreen: () => {
      mockHealthHomeScreenCtor();
      return ReactMock.createElement(View, { testID: 'health-home-screen' });
    },
  };
});

jest.mock('@navigation/BudgetNavigator', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { BudgetNavigator: () => ReactMock.createElement(View, { testID: 'budget-navigator' }) };
});

jest.mock('@screens/main/HomeScreen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    HomeScreen: () => {
      mockHouseHomeScreenCtor();
      return ReactMock.createElement(View, { testID: 'house-home-screen' });
    },
  };
});

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));

import HomeTab from '../index';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<HomeTab />);
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return (
    tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0
  );
}

/** Which screen the slot resolved to, as a single testID. */
function resolvedScreen(tree: ReactTestRenderer.ReactTestRenderer): string | undefined {
  const known = [
    'kaizen-today-screen',
    'language-learn-screen',
    'budget-navigator',
    'health-home-screen',
    'house-home-screen',
  ];
  return known.find((id) => has(tree, id));
}

type Brand = 'kaizen' | 'language' | 'budget' | 'health' | 'house';

function setBrand(brand: Brand) {
  mockIsKaizenBrand = brand === 'kaizen';
  mockIsLanguageBrand = brand === 'language';
  mockIsBudgetBrand = brand === 'budget';
  mockIsHealthBrand = brand === 'health';
}

beforeEach(() => {
  setBrand('house');
  mockHealthHomeScreenCtor.mockClear();
  mockHouseHomeScreenCtor.mockClear();
});

describe('ROUTE-001 — Home slot on the Symply Health brand', () => {
  it('ROUTE-001: brand symply-health mounts HealthHomeScreen, not the House HomeScreen', () => {
    setBrand('health');
    const tree = render();

    expect(has(tree, 'health-home-screen')).toBe(true);
    expect(mockHealthHomeScreenCtor).toHaveBeenCalledTimes(1);

    // The House default must be fully bypassed — not merely hidden.
    expect(has(tree, 'house-home-screen')).toBe(false);
    expect(mockHouseHomeScreenCtor).not.toHaveBeenCalled();
  });
});

describe('ROUTE-002 — Home slot brand precedence is a fixed if-chain', () => {
  // The literal order in app/(tabs)/index.tsx. Health is 4th; House is the
  // unconditional fallthrough at the bottom.
  const CHAIN: Array<{ brand: Brand; screen: string; position: number }> = [
    { brand: 'kaizen', screen: 'kaizen-today-screen', position: 1 },
    { brand: 'language', screen: 'language-learn-screen', position: 2 },
    { brand: 'budget', screen: 'budget-navigator', position: 3 },
    { brand: 'health', screen: 'health-home-screen', position: 4 },
  ];

  it.each(CHAIN)(
    'ROUTE-002: $brand is gate #$position and resolves to $screen',
    ({ brand, screen }) => {
      setBrand(brand);
      expect(resolvedScreen(render())).toBe(screen);
    },
  );

  it('ROUTE-002: Health is the 4th gate — every earlier gate wins over it', () => {
    // Turn Health ON and then add one earlier gate at a time. Health may only
    // win once nothing above it in the chain matches.
    mockIsHealthBrand = true;

    mockIsKaizenBrand = false;
    mockIsLanguageBrand = false;
    mockIsBudgetBrand = false;
    expect(resolvedScreen(render())).toBe('health-home-screen');

    mockIsBudgetBrand = true;
    expect(resolvedScreen(render())).toBe('budget-navigator');

    mockIsLanguageBrand = true;
    expect(resolvedScreen(render())).toBe('language-learn-screen');

    mockIsKaizenBrand = true;
    expect(resolvedScreen(render())).toBe('kaizen-today-screen');
  });

  it('ROUTE-002: House is the fallthrough — reached only when no gate matches', () => {
    setBrand('house');
    expect(resolvedScreen(render())).toBe('house-home-screen');
    expect(mockHouseHomeScreenCtor).toHaveBeenCalledTimes(1);
  });

  it('ROUTE-002: the full resolution order is kaizen → language → budget → health → house', () => {
    const order = (['kaizen', 'language', 'budget', 'health', 'house'] as Brand[]).map((brand) => {
      setBrand(brand);
      return resolvedScreen(render());
    });

    expect(order).toEqual([
      'kaizen-today-screen',
      'language-learn-screen',
      'budget-navigator',
      'health-home-screen',
      'house-home-screen',
    ]);
  });
});

describe('ROUTE-005 — Home slot on the House brand', () => {
  it('ROUTE-005: brand symply-house mounts HomeScreen and constructs no Health component', () => {
    setBrand('house');
    const tree = render();

    expect(has(tree, 'house-home-screen')).toBe(true);
    expect(mockHouseHomeScreenCtor).toHaveBeenCalledTimes(1);

    expect(has(tree, 'health-home-screen')).toBe(false);
    expect(mockHealthHomeScreenCtor).not.toHaveBeenCalled();
  });
});
