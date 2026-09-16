/**
 * Language brand gates in the expo-router tab layer.
 *
 * Two shapes are covered here:
 *  1. The first-class Language tabs — app/(tabs)/language-{assessment,review,
 *     plan,dialogue}.tsx. Each is a thin brand gate: on the Symply Language
 *     brand it renders the section screen; on any other brand it must
 *     <Redirect href="/"> so a mis-pinned tab can never surface a Language
 *     screen inside House/Budget/Kaizen/Health.
 *  2. The shared tab slots that Language re-points — index.tsx (Learn),
 *     chat.tsx (AI tutor) and settings.tsx (More). Only the LANGUAGE branch is
 *     asserted here; the House/Kaizen/Budget/Health branches of those slots are
 *     owned by their own suites.
 *
 * The feature modules and expo-router are mocked so every branch is driven
 * deterministically regardless of the bundle's active brand (the Jest run
 * defaults to House).
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

let mockIsLanguageBrand = true;
jest.mock('@features/language', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const screen = (testID: string) => () => ReactMock.createElement(View, { testID });
  return {
    isLanguageBrand: () => mockIsLanguageBrand,
    LanguageAssessmentScreen: screen('assessment-screen'),
    LanguageReviewScreen: screen('review-screen'),
    LanguagePlanScreen: screen('plan-screen'),
    LanguageDialogueScreen: screen('dialogue-screen'),
    LanguageLearnScreen: screen('learn-screen'),
    LanguageTutorScreen: screen('tutor-screen'),
    LanguageMoreScreen: screen('more-screen'),
  };
});

// Sibling brand gates in the shared slots — always false so the Language branch
// is the only one that can win when `mockIsLanguageBrand` is true, and so the
// non-Language case falls through to each slot's House default.
jest.mock('@features/kaizen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isKaizenBrand: () => false,
    KaizenTodayScreen: () => ReactMock.createElement(View, { testID: 'kaizen-today-screen' }),
    KaizenMoreScreen: () => ReactMock.createElement(View, { testID: 'kaizen-more-screen' }),
  };
});

jest.mock('@features/health', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    isHealthBrand: () => false,
    HealthHomeScreen: () => ReactMock.createElement(View, { testID: 'health-home-screen' }),
    HealthMoreScreen: () => ReactMock.createElement(View, { testID: 'health-more-screen' }),
  };
});

jest.mock('@features/budget', () => ({ isBudgetBrand: () => false }));

jest.mock('@navigation/BudgetNavigator', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { BudgetNavigator: () => ReactMock.createElement(View, { testID: 'budget-navigator' }) };
});

jest.mock('@features/chat', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    ChatNavigator: () => ReactMock.createElement(View, { testID: 'chat-navigator' }),
    houseChatConfig: { id: 'house' },
  };
});

jest.mock('@navigation/SettingsNavigator', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { SettingsNavigator: () => ReactMock.createElement(View, { testID: 'settings-navigator' }) };
});

jest.mock('@screens/main/HomeScreen', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return { HomeScreen: () => ReactMock.createElement(View, { testID: 'house-home-screen' }) };
});

const mockFlushPendingSettingsNavigation = jest.fn();
jest.mock('@stores/settingsNavigationStore', () => ({
  flushPendingSettingsNavigation: () => mockFlushPendingSettingsNavigation(),
}));

jest.mock('expo-router', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) =>
      ReactMock.createElement(View, { testID: 'redirect', href }),
    useLocalSearchParams: () => ({}),
  };
});

// settings.tsx imports the navigation hooks from `expo-router/react-navigation`,
// which jest.config maps onto @react-navigation/native. `useFocusEffect` is
// invoked eagerly so the brand early-return inside it is actually exercised.
jest.mock('@react-navigation/native', () => {
  const ReactMock = require('react');
  return {
    useFocusEffect: (cb: () => void) => ReactMock.useEffect(cb, [cb]),
    NavigationContainer: ({ children }: { children?: React.ReactNode }) => children ?? null,
    NavigationIndependentTree: ({ children }: { children?: React.ReactNode }) => children ?? null,
  };
});

import ChatTab from '../chat';
import HomeTab from '../index';
import LanguageAssessmentTab from '../language-assessment';
import LanguageDialogueTab from '../language-dialogue';
import LanguagePlanTab from '../language-plan';
import LanguageReviewTab from '../language-review';
import SettingsTab from '../settings';

type Tab = React.ComponentType;

function render(Component: Tab) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<Component />);
  });
  return tree;
}

function has(tree: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === testID).length > 0;
}

function redirectHref(tree: ReactTestRenderer.ReactTestRenderer): string | undefined {
  const nodes = tree.root.findAll((n) => typeof n.type === 'string' && n.props?.testID === 'redirect');
  return nodes[0]?.props?.href;
}

const TABS: Array<{ name: string; Component: Tab; screen: string }> = [
  { name: 'language-assessment', Component: LanguageAssessmentTab, screen: 'assessment-screen' },
  { name: 'language-review', Component: LanguageReviewTab, screen: 'review-screen' },
  { name: 'language-plan', Component: LanguagePlanTab, screen: 'plan-screen' },
  { name: 'language-dialogue', Component: LanguageDialogueTab, screen: 'dialogue-screen' },
];

describe('Language tab wrappers — on the Language brand', () => {
  beforeEach(() => {
    mockIsLanguageBrand = true;
  });

  TABS.forEach(({ name, Component, screen }) => {
    it(`${name} renders its section screen and does not redirect`, () => {
      const tree = render(Component);
      expect(has(tree, screen)).toBe(true);
      expect(has(tree, 'redirect')).toBe(false);
    });
  });
});

describe('Language tab wrappers — on a non-Language brand', () => {
  beforeEach(() => {
    mockIsLanguageBrand = false;
  });

  TABS.forEach(({ name, Component, screen }) => {
    it(`${name} redirects to "/" and never renders the screen`, () => {
      const tree = render(Component);
      expect(has(tree, screen)).toBe(false);
      expect(redirectHref(tree)).toBe('/');
    });
  });
});

describe('shared tab slots re-pointed by the Language brand', () => {
  beforeEach(() => {
    mockIsLanguageBrand = true;
    mockFlushPendingSettingsNavigation.mockClear();
  });

  it('index (Home) renders the Language Learn screen, not the House home', () => {
    const tree = render(HomeTab);
    expect(has(tree, 'learn-screen')).toBe(true);
    expect(has(tree, 'house-home-screen')).toBe(false);
  });

  it('chat renders the Language tutor instead of the shared ChatNavigator', () => {
    const tree = render(ChatTab);
    expect(has(tree, 'tutor-screen')).toBe(true);
    expect(has(tree, 'chat-navigator')).toBe(false);
  });

  it('settings renders the Language More screen instead of the SettingsNavigator', () => {
    const tree = render(SettingsTab);
    expect(has(tree, 'more-screen')).toBe(true);
    expect(has(tree, 'settings-navigator')).toBe(false);
  });

  it('settings skips the pending-navigation flush on the Language brand', () => {
    jest.useFakeTimers();
    try {
      render(SettingsTab);
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(mockFlushPendingSettingsNavigation).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('settings still schedules the flush when the brand is not Language', () => {
    mockIsLanguageBrand = false;
    jest.useFakeTimers();
    try {
      render(SettingsTab);
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(mockFlushPendingSettingsNavigation).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
