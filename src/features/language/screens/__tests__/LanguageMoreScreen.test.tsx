/**
 * LanguageMoreScreen — Symply Language (`symply-language`) More/settings tab.
 * Renders the real screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives every row: the customizable-tabs overflow section (wired in
 * from the shared <TabOverflowSection>), Profile + Notifications navigation
 * (router.push), the sign-out confirmation Alert (destructive button → logout),
 * and the reset-learning-data Alert whose destructive button calls the profile
 * API and reports success ("Done") or failure ("Could not reset").
 *
 * The shared <TabOverflowSection> is stubbed here — this suite owns the screen's
 * own behavior, not the tab-registry/overflow logic (covered by its own suites).
 * The profile API is mocked so the reset flow is deterministic.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import { languageProfileApi } from '../../api/languageProfile';
import { IPAD, IPHONE, allText, hasTestId, pressByText } from '../../test-utils/languageScreenTestKit';
import { LanguageMoreScreen } from '../LanguageMoreScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// The AI entry is the shared, gated useAIAccessEntry (identical across brands).
// Force it visible with canonical values so the screen renders the row.
jest.mock('@components/ai/useAIAccessEntry', () => ({
  useAIAccessEntry: () => ({
    show: true,
    route: '/ai-access',
    title: 'AI assistance',
    subtitle: 'Connect OpenAI, Claude, or Gemini',
    icon: 'sparkles-outline',
  }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
}));

const mockLogout = jest.fn();
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: null, logout: mockLogout }),
}));

let mockIsTablet = false;
jest.mock('@hooks/useDeviceType', () => ({
  useDeviceType: () => ({ isTablet: mockIsTablet }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('../../api/languageProfile', () => ({
  languageProfileApi: { resetLearningData: jest.fn() },
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, title ? ReactMock.createElement(Text, null, title) : null),
  };
});

// The customizable-tabs overflow list is a shared component with its own suite;
// stub it so this test isolates the More screen's own rows (it also drags in the
// whole tab registry).
jest.mock('@components/navigation/TabOverflowSection', () => {
  const ReactMock = require('react');
  const { View, Text } = require('react-native');
  return {
    TabOverflowSection: () =>
      ReactMock.createElement(
        View,
        { testID: 'tab-overflow-section' },
        ReactMock.createElement(Text, null, 'MORE TABS'),
      ),
  };
});

const mockReset = languageProfileApi.resetLearningData as jest.Mock;

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageMoreScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

type AlertButton = { text: string; style?: string; onPress?: () => void | Promise<void> };

function alertCall(title: string): [string, string, AlertButton[]] {
  const call = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === title);
  if (!call) throw new Error(`No Alert.alert with title "${title}"`);
  return call as [string, string, AlertButton[]];
}

beforeEach(() => {
  mockWindow = IPHONE;
  mockIsTablet = false;
  jest.clearAllMocks();
  mockReset.mockResolvedValue({ message: 'ok', onboardingRequired: true });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore();
});

describe('LanguageMoreScreen — content', () => {
  it('renders the overflow, ACCOUNT + DATA sections with all rows and the version', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(hasTestId(tree, 'language-more-screen')).toBe(true);
    // Customizable-tabs overflow section is wired in at the top.
    expect(hasTestId(tree, 'tab-overflow-section')).toBe(true);
    expect(text).toContain('ACCOUNT');
    expect(text).toContain('Profile');
    expect(text).toContain('Notifications');
    expect(text).toContain('Sign out');
    expect(text).toContain('AI');
    expect(text).toContain('AI assistance');
    expect(text).toContain('MORE SYMPLY APPS');
    expect(text).toContain('Symply apps');
    expect(text).toContain('DATA');
    expect(text).toContain('Reset learning data');
    // Version footer: `${APP_NAME} v${APP_VERSION}` — APP_VERSION is 1.0.0.
    expect(text).toContain('v1.0.0');
  });
});

describe('LanguageMoreScreen — navigation', () => {
  it('routes the Profile row to the profile screen', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Profile'));
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  it('routes the Notifications row to the notifications screen', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Notifications'));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('routes AI assistance to the shared AI-access hub', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'AI assistance'));
    expect(mockPush).toHaveBeenCalledWith('/ai-access');
  });

  it('routes the Symply apps row to the ecosystem grid', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Symply apps'));
    expect(mockPush).toHaveBeenCalledWith('/symply-apps');
  });
});

describe('LanguageMoreScreen — sign out', () => {
  it('confirms before signing out and logs out on the destructive action', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Sign out'));

    const [, message, buttons] = alertCall('Sign out');
    expect(message).toBe('Are you sure you want to sign out?');
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Sign out']);
    expect(mockLogout).not.toHaveBeenCalled(); // not until confirmed

    const destructive = buttons.find((b) => b.style === 'destructive');
    expect(destructive?.text).toBe('Sign out');
    act(() => void destructive?.onPress?.());
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});

describe('LanguageMoreScreen — reset learning data', () => {
  it('confirms with a destructive Reset button before touching the API', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Reset learning data'));

    const [, message, buttons] = alertCall('Reset learning data');
    expect(message).toContain('permanently deletes');
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Reset']);
    expect(buttons.find((b) => b.style === 'destructive')?.text).toBe('Reset');
    expect(mockReset).not.toHaveBeenCalled(); // not until confirmed
  });

  it('resets the data and shows a Done alert on success', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Reset learning data'));

    const reset = alertCall('Reset learning data')[2].find((b) => b.style === 'destructive');
    await act(async () => {
      await reset?.onPress?.();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Done', 'Your learning data was reset.');
  });

  it('shows a "Resetting…" state (and disables the row) while the API call is in flight', async () => {
    let finishReset!: () => void;
    mockReset.mockReturnValue(new Promise<void>((resolve) => {
      finishReset = () => resolve();
    }));
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Reset learning data'));

    const reset = alertCall('Reset learning data')[2].find((b) => b.style === 'destructive');
    // Fire the async onPress but leave it pending so setResetting(true) commits.
    await act(async () => {
      void reset?.onPress?.();
      await Promise.resolve();
    });
    const inFlight = allText(tree.toJSON());
    expect(inFlight).toContain('Resetting…');
    expect(inFlight).not.toContain('Reset learning data');

    await act(async () => {
      finishReset();
      await Promise.resolve();
    });
    expect(allText(tree.toJSON())).toContain('Reset learning data');
  });

  it('shows a "Could not reset" alert when the API rejects', async () => {
    mockReset.mockRejectedValue(new Error('network down'));
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Reset learning data'));

    const reset = alertCall('Reset learning data')[2].find((b) => b.style === 'destructive');
    await act(async () => {
      await reset?.onPress?.();
    });

    expect(mockReset).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenCalledWith('Could not reset', 'Please try again in a moment.');
  });
});

describe('LanguageMoreScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions (tablet max-width path)', async () => {
    mockWindow = IPAD;
    mockIsTablet = true;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-more-screen')).toBe(true);
    expect(hasTestId(tree, 'tab-overflow-section')).toBe(true);
    expect(allText(tree.toJSON())).toContain('ACCOUNT');
  });
});
