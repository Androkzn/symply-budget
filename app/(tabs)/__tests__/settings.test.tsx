/**
 * app/(tabs)/settings.tsx — the shared Settings/More tab slot.
 *
 * Two behaviours are pinned here:
 *  1. Brand routing — Health lands on HealthMoreScreen (ROUTE-003), House falls
 *     through to the shared SettingsNavigator (ROUTE-005).
 *  2. The focus effect (ROUTE-004) — `flushPendingSettingsNavigation()` is a
 *     House-stack concern (it replays a queued push onto SettingsNavigator), so
 *     the child brands that render their own More screen (Kaizen / Health /
 *     Language) must early-return before it fires.
 *
 * The flush is scheduled behind `setTimeout(..., 100)`, so fake timers are used
 * to drive it deterministically.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockIsKaizenBrand = false;
let mockIsLanguageBrand = false;
let mockIsHealthBrand = false;

const mockHealthMoreScreenCtor = jest.fn();
const mockFlushPendingSettingsNavigation = jest.fn();

jest.mock('@features/kaizen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isKaizenBrand: () => mockIsKaizenBrand,
    KaizenMoreScreen: () => ReactMock.createElement(View, { testID: 'kaizen-more-screen' }),
  };
});

jest.mock('@features/language', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isLanguageBrand: () => mockIsLanguageBrand,
    LanguageMoreScreen: () => ReactMock.createElement(View, { testID: 'language-more-screen' }),
  };
});

jest.mock('@features/health', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isHealthBrand: () => mockIsHealthBrand,
    HealthMoreScreen: () => {
      mockHealthMoreScreenCtor();
      return ReactMock.createElement(View, { testID: 'health-more-screen' });
    },
  };
});

jest.mock('@navigation/SettingsNavigator', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    SettingsNavigator: () => ReactMock.createElement(View, { testID: 'settings-navigator' }),
  };
});

jest.mock('@stores/settingsNavigationStore', () => ({
  flushPendingSettingsNavigation: () => mockFlushPendingSettingsNavigation(),
}));

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}) }));

// settings.tsx imports its navigation primitives from `expo-router/react-navigation`,
// which jest.config maps onto @react-navigation/native. `useFocusEffect` is run
// eagerly as an effect so the brand early-return inside it is actually exercised.
jest.mock('@react-navigation/native', () => {
  const ReactMock = require('react');
  return {
    useFocusEffect: (cb: () => void) => ReactMock.useEffect(cb, [cb]),
    NavigationContainer: ({ children }: { children?: React.ReactNode }) => children ?? null,
    NavigationIndependentTree: ({ children }: { children?: React.ReactNode }) => children ?? null,
  };
});

import SettingsTab from '../settings';

function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<SettingsTab />);
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return (
    tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0
  );
}

type Brand = 'kaizen' | 'language' | 'health' | 'house';

function setBrand(brand: Brand) {
  mockIsKaizenBrand = brand === 'kaizen';
  mockIsLanguageBrand = brand === 'language';
  mockIsHealthBrand = brand === 'health';
}

/** Render, then let the focus effect's 100ms timer fire. */
function renderAndFlushTimers() {
  const tree = render();
  act(() => {
    jest.advanceTimersByTime(200);
  });
  return tree;
}

beforeEach(() => {
  jest.useFakeTimers();
  setBrand('house');
  mockHealthMoreScreenCtor.mockClear();
  mockFlushPendingSettingsNavigation.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ROUTE-003 — Settings slot on the Symply Health brand', () => {
  it('ROUTE-003: brand symply-health mounts HealthMoreScreen', () => {
    setBrand('health');
    const tree = renderAndFlushTimers();

    expect(has(tree, 'health-more-screen')).toBe(true);
    expect(mockHealthMoreScreenCtor).toHaveBeenCalledTimes(1);

    // The shared House settings stack must not be mounted alongside it.
    expect(has(tree, 'settings-navigator')).toBe(false);
    expect(has(tree, 'kaizen-more-screen')).toBe(false);
    expect(has(tree, 'language-more-screen')).toBe(false);
  });
});

describe('ROUTE-004 — focus effect flushes pending settings navigation for House only', () => {
  it('ROUTE-004: Health does NOT call flushPendingSettingsNavigation', () => {
    setBrand('health');
    renderAndFlushTimers();
    expect(mockFlushPendingSettingsNavigation).not.toHaveBeenCalled();
  });

  it('ROUTE-004: Kaizen does NOT call flushPendingSettingsNavigation', () => {
    setBrand('kaizen');
    renderAndFlushTimers();
    expect(mockFlushPendingSettingsNavigation).not.toHaveBeenCalled();
  });

  it('ROUTE-004: Language does NOT call flushPendingSettingsNavigation', () => {
    setBrand('language');
    renderAndFlushTimers();
    expect(mockFlushPendingSettingsNavigation).not.toHaveBeenCalled();
  });

  it('ROUTE-004: House DOES call flushPendingSettingsNavigation after the 100ms delay', () => {
    setBrand('house');
    const tree = render();

    // The flush is deferred — nothing fires synchronously on focus.
    expect(mockFlushPendingSettingsNavigation).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(mockFlushPendingSettingsNavigation).toHaveBeenCalledTimes(1);
    expect(has(tree, 'settings-navigator')).toBe(true);
  });
});

describe('ROUTE-005 — Settings slot on the House brand', () => {
  it('ROUTE-005: brand symply-house mounts the shared SettingsNavigator, no Health screen', () => {
    setBrand('house');
    const tree = renderAndFlushTimers();

    expect(has(tree, 'settings-navigator')).toBe(true);
    expect(has(tree, 'health-more-screen')).toBe(false);
    expect(mockHealthMoreScreenCtor).not.toHaveBeenCalled();
  });
});
