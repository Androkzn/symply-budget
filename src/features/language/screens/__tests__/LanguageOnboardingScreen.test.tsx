/**
 * LanguageOnboardingScreen — Symply Language (`symply-language`) first-run NUX.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives every interactive element: the 10 native-language chips
 * (single-select), the 5 motivation chips (multi-select toggle on/off), the
 * enabled/disabled state of the "Start learning" CTA, and the finish flow
 * (persist learner profile via the api mock → navigate to EssentialPermissions,
 * which itself completes onboarding), including the saving spinner and the
 * non-blocking error path where the profile save fails but the hand-off still
 * happens. The profile api + navigation + layout-padding are mocked so state
 * is deterministic; the api's own logic is covered in the sibling
 * languageProfile suite.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { languageProfileApi } from '../../api/languageProfile';
import {
  IPAD,
  IPHONE,
  allText,
  hasTestId,
  pressByText,
  pressablesWithText,
} from '../../test-utils/languageScreenTestKit';
import { LanguageOnboardingScreen } from '../LanguageOnboardingScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockNavigate = jest.fn();
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    SafeAreaView: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'safe-area-view' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, title),
    // Brand lockup renders the app name via SVG; stub it with the name text so
    // the welcome copy assertion still sees "Symply Language".
    HeaderLogo: () =>
      ReactMock.createElement(require('react-native').Text, null, 'Symply Language'),
    screenScrollViewStyle: { scroll: {} },
    SCREEN_SCROLL_TEST_ID: 'screen-scroll',
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../api/languageProfile', () => ({
  languageProfileApi: { updateLearnerProfile: jest.fn() },
}));

const mockUpdateLearnerProfile = languageProfileApi.updateLearnerProfile as jest.Mock;

const NATIVE_LANGUAGES = [
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Russian',
  'Chinese',
  'Japanese',
  'Arabic',
  'Hindi',
  'Other',
];
const MOTIVATION_LABELS = [
  'Travel',
  'Work & career',
  'Study / exams',
  'Family & friends',
  'Culture & media',
];

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageOnboardingScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

/** The "Start learning" CTA Pressable (present only while not saving). */
function ctaButton(tree: ReactTestRenderer.ReactTestRenderer) {
  return pressablesWithText(tree, 'Start learning')[0];
}

/** Count of ActivityIndicator host nodes currently mounted. */
function spinnerCount(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(ActivityIndicator).length;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockUpdateLearnerProfile.mockResolvedValue({});
});

describe('LanguageOnboardingScreen — initial render', () => {
  it('mounts with the welcome copy, both question cards, and every chip', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());

    expect(hasTestId(tree, 'app-background')).toBe(true);
    expect(text).toContain('Welcome to');
    expect(text).toContain('Symply Language');
    expect(text).toContain('A couple of quick questions so your tutor and plan fit you.');
    expect(text).toContain('MY NATIVE LANGUAGE');
    expect(text).toContain("WHY I'M LEARNING (optional)");
    expect(text).toContain('Start learning');

    NATIVE_LANGUAGES.forEach((lang) => expect(text).toContain(lang));
    MOTIVATION_LABELS.forEach((label) => expect(text).toContain(label));
  });

  it('starts with the CTA disabled and no spinner (nothing selected yet)', async () => {
    const tree = await renderScreen();
    expect(ctaButton(tree).props.disabled).toBe(true);
    expect(spinnerCount(tree)).toBe(0);
  });
});

describe('LanguageOnboardingScreen — native language selection', () => {
  it('enables the CTA once a native language is picked', async () => {
    const tree = await renderScreen();
    expect(ctaButton(tree).props.disabled).toBe(true);

    act(() => pressByText(tree, 'Spanish'));
    expect(ctaButton(tree).props.disabled).toBe(false);
  });

  it('every native-language chip is selectable and enables the CTA', async () => {
    const tree = await renderScreen();
    for (const lang of NATIVE_LANGUAGES) {
      act(() => pressByText(tree, lang));
      expect(ctaButton(tree).props.disabled).toBe(false);
    }
  });

  it('is single-select: the last picked language wins in the saved profile', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Spanish'));
    act(() => pressByText(tree, 'French'));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledWith({
      nativeLanguage: 'French',
      motivations: [],
    });
  });
});

describe('LanguageOnboardingScreen — motivations (multi-select)', () => {
  it('accumulates every selected motivation in the saved profile', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'German'));
    act(() => pressByText(tree, 'Travel'));
    act(() => pressByText(tree, 'Work & career'));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledWith({
      nativeLanguage: 'German',
      motivations: ['travel', 'work'],
    });
  });

  it('toggles a motivation back off when pressed twice', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'German'));
    act(() => pressByText(tree, 'Study / exams'));
    act(() => pressByText(tree, 'Study / exams')); // toggle off

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledWith({
      nativeLanguage: 'German',
      motivations: [],
    });
  });

  it('drives all five motivation chips on', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Hindi'));
    MOTIVATION_LABELS.forEach((label) => act(() => pressByText(tree, label)));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledWith({
      nativeLanguage: 'Hindi',
      motivations: ['travel', 'work', 'study', 'family', 'culture'],
    });
  });
});

describe('LanguageOnboardingScreen — finish flow', () => {
  it('persists the profile and hands off to EssentialPermissions', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Spanish'));
    act(() => pressByText(tree, 'Travel'));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateLearnerProfile).toHaveBeenCalledWith({
      nativeLanguage: 'Spanish',
      motivations: ['travel'],
    });
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
  });

  it('does nothing when the CTA is pressed with no native language selected', async () => {
    const tree = await renderScreen();

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows the saving spinner while the profile save is in flight, then finishes', async () => {
    let resolveSave!: (v: unknown) => void;
    mockUpdateLearnerProfile.mockReturnValue(
      new Promise((res) => {
        resolveSave = res;
      }),
    );

    const tree = await renderScreen();
    act(() => pressByText(tree, 'Spanish'));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    // Mid-flight: spinner shown, CTA text gone, hand-off not yet fired.
    expect(spinnerCount(tree)).toBe(1);
    expect(allText(tree.toJSON())).not.toContain('Start learning');
    expect(mockNavigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveSave({});
    });

    // Settled: spinner gone, CTA label back, handed off to EssentialPermissions.
    expect(spinnerCount(tree)).toBe(0);
    expect(allText(tree.toJSON())).toContain('Start learning');
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
  });

  it('hands off to EssentialPermissions even when the profile save rejects (non-blocking)', async () => {
    mockUpdateLearnerProfile.mockRejectedValue(new Error('network down'));

    const tree = await renderScreen();
    act(() => pressByText(tree, 'Spanish'));

    await act(async () => {
      pressByText(tree, 'Start learning');
    });

    expect(mockUpdateLearnerProfile).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('EssentialPermissions', { onDone: 'complete' });
    expect(spinnerCount(tree)).toBe(0);
  });
});

describe('LanguageOnboardingScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'app-background')).toBe(true);
    const text = allText(tree.toJSON());
    expect(text).toContain('Welcome to');
    expect(text).toContain('Symply Language');
    expect(text).toContain('MY NATIVE LANGUAGE');
    expect(text).toContain('Start learning');
  });
});
