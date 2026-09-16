/**
 * LanguageLearnScreen — Symply Language (`symply-language`) Learn home tab.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its behavior: the loading gate, greeting-by-first-name,
 * the streak badge (singular/plural), the backend-hydrated nav cards
 * (assessment-vs-plan branch + review due badge), the daily-goal checkboxes
 * (toggle → persist + streak recompute), nav-card routing, and the widget
 * snapshot it publishes. Local storage + api + widget-sync are mocked so state
 * is deterministic; their own logic is covered in sibling api/localStorage suites.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { languageAssessmentApi } from '../../api/languageAssessment';
import { languageCardsApi } from '../../api/languageCards';
import { languagePlanApi } from '../../api/languagePlan';
import {
  loadDaily,
  loadStreak,
  saveDaily,
  updateStreakOnGoalChange,
  type LanguageDaily,
} from '../../languageLocalStorage';
import { IPAD, IPHONE, allText, byTestId, hasTestId, instanceText, pressByText } from '../../test-utils/languageScreenTestKit';
import { LanguageLearnScreen } from '../LanguageLearnScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), navigate: jest.fn() }),
    // Run the focus callback once on mount so backend hydration executes.
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMock.useEffect(() => cb(), [cb]);
    },
  };
});

const mockSetSnapshot = jest.fn();
jest.mock('@services/widget-sync', () => ({
  widgetSync: { setSnapshot: (...a: unknown[]) => mockSetSnapshot(...a) },
}));

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

// `id` matters as well as `display_name`: the snapshot producer no-ops without a
// user id, so a signed-out mock would silently stop publishing. Nobody reaches this
// screen signed out anyway — `app/_layout.tsx` renders `RootNavigator` instead.
const mockUser: { id?: string; display_name?: string } | null = {
  id: 'lang-user-1',
  display_name: 'Ada Lovelace',
};
jest.mock('@stores/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: mockUser }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  // PermissionCard has no native dependency of its own (Button/Card/Typography/
  // Icon, same as everything else this mock leaves real) — keep the ACTUAL
  // implementation so these tests exercise the real not-requested/denied copy
  // and the real `-request`/`-settings`/`-dismiss` testIDs.
  const { PermissionCard } = jest.requireActual('@components/common');
  return {
    PermissionCard,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Expose the header's two nav handlers as pressables so the screen's
    // notification/profile routing is exercised.
    ScreenHeader: ({
      onNotificationPress,
      onProfilePress,
    }: {
      onNotificationPress?: () => void;
      onProfilePress?: () => void;
    }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(Pressable, {
          key: 'noti',
          testID: 'hdr-notifications',
          onPress: onNotificationPress,
        }),
        ReactMock.createElement(Pressable, {
          key: 'profile',
          testID: 'hdr-profile',
          onPress: onProfilePress,
        }),
      ]),
  };
});

jest.mock('../../languageLocalStorage', () => {
  const actual = jest.requireActual('../../languageLocalStorage');
  return {
    ...actual,
    loadDaily: jest.fn(),
    loadStreak: jest.fn(),
    saveDaily: jest.fn().mockResolvedValue(undefined),
    updateStreakOnGoalChange: jest.fn(),
  };
});
jest.mock('../../api/languageAssessment', () => ({
  languageAssessmentApi: { getStatus: jest.fn() },
}));
jest.mock('../../api/languagePlan', () => ({
  languagePlanApi: { getCurrent: jest.fn() },
}));

let mockPushState: 'unavailable' | 'not-requested' | 'denied' | 'granted' = 'unavailable';
const mockRequestPush = jest.fn().mockResolvedValue(undefined);
jest.mock('@hooks/useNotificationPermission', () => ({
  useNotificationPermission: () => ({
    state: mockPushState,
    busy: false,
    request: mockRequestPush,
    refresh: jest.fn(),
  }),
}));
jest.mock('../../api/languageCards', () => ({
  languageCardsApi: { due: jest.fn() },
}));

const mockLoadDaily = loadDaily as jest.Mock;
const mockLoadStreak = loadStreak as jest.Mock;
const mockSaveDaily = saveDaily as jest.Mock;
const mockUpdateStreak = updateStreakOnGoalChange as jest.Mock;
const mockGetStatus = languageAssessmentApi.getStatus as jest.Mock;
const mockGetCurrentPlan = languagePlanApi.getCurrent as jest.Mock;
const mockCardsDue = languageCardsApi.due as jest.Mock;

function daily(overrides: Partial<LanguageDaily> = {}): LanguageDaily {
  return { date: '2026-07-14', goals: { review: false, speak: false, learn: false }, ...overrides };
}

/** The three daily-goal checkboxes (the Pressable owning onPress, not host children). */
function checkboxes(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityRole === 'checkbox' && typeof n.props?.onPress === 'function',
  );
}

/** The most recent widget snapshot published for the given key. */
function lastSnapshot(key: string): Record<string, unknown> | undefined {
  const call = mockSetSnapshot.mock.calls.filter((c) => c[0] === key).at(-1);
  return call?.[1];
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguageLearnScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockPushState = 'unavailable';
  mockLoadDaily.mockResolvedValue(daily());
  mockLoadStreak.mockResolvedValue({ count: 0, lastCompletedDate: null });
  mockSaveDaily.mockResolvedValue(undefined);
  mockUpdateStreak.mockResolvedValue({ count: 0, lastCompletedDate: null });
  mockGetStatus.mockResolvedValue({ due: true, kind: 'initial', mandatory: true, planId: null });
  mockGetCurrentPlan.mockResolvedValue(null);
  mockCardsDue.mockResolvedValue({ dueCards: [], totalDue: 0 });
  // Stable "Good morning" greeting regardless of wall clock.
  jest.useFakeTimers().setSystemTime(new Date(2026, 6, 14, 9, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LanguageLearnScreen — loading gate', () => {
  it('shows a spinner until the daily + streak resolve', () => {
    mockLoadDaily.mockReturnValue(new Promise(() => {}));
    mockLoadStreak.mockReturnValue(new Promise(() => {}));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <LanguageLearnScreen />
        </ThemeProvider>,
      );
    });
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(hasTestId(tree, 'language-learn-screen')).toBe(true);
  });
});

describe('LanguageLearnScreen — ambient notification permission detection', () => {
  it('shows the notification card when push is not-requested, and requests it on tap', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    expect(hasTestId(tree, 'language-learn-notification-permission-card')).toBe(true);
    act(() => {
      const node = tree.root.findAll(
        (n) =>
          n.props?.testID === 'language-learn-notification-permission-card-action' &&
          typeof n.props?.onPress === 'function',
      )[0];
      node.props.onPress();
    });
    expect(mockRequestPush).toHaveBeenCalledTimes(1);
  });

  it('shows Open Settings, not a request button, once denied', async () => {
    mockPushState = 'denied';
    const tree = await renderScreen();

    const action = byTestId(tree, 'language-learn-notification-permission-card-action')[0];
    expect(instanceText(action)).toContain('Open Settings');
  });

  it('hides the card once granted or when the bridge is unavailable', async () => {
    mockPushState = 'granted';
    const grantedTree = await renderScreen();
    expect(hasTestId(grantedTree, 'language-learn-notification-permission-card')).toBe(false);

    mockPushState = 'unavailable';
    const unavailableTree = await renderScreen();
    expect(hasTestId(unavailableTree, 'language-learn-notification-permission-card')).toBe(false);
  });

  it('dismisses the card for the session without touching the permission itself', async () => {
    mockPushState = 'not-requested';
    const tree = await renderScreen();

    await act(async () => {
      const node = tree.root.findAll(
        (n) => n.props?.testID === 'language-learn-notification-permission-card-dismiss',
      )[0];
      node.props.onPress();
    });
    expect(hasTestId(tree, 'language-learn-notification-permission-card')).toBe(false);
    expect(mockRequestPush).not.toHaveBeenCalled();
  });
});

describe('LanguageLearnScreen — loaded content', () => {
  it('greets by first name and shows the daily-practice section + all goals', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Good morning, Ada');
    expect(text).toContain('A little every day');
    expect(text).toContain('Daily goals');
    expect(text).toContain('Review vocabulary');
    expect(text).toContain('Speak for 2 minutes');
    expect(text).toContain('Learn something new');
    // three daily-goal checkboxes.
    expect(checkboxes(tree)).toHaveLength(3);
  });

  it('drops the name suffix when there is no display name', async () => {
    (mockUser as { display_name?: string }).display_name = undefined;
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('Good morning');
    expect(allText(tree.toJSON())).not.toContain('Good morning,');
    (mockUser as { display_name?: string }).display_name = 'Ada Lovelace';
  });

  it('renders the streak with singular day for a 1-day streak', async () => {
    mockLoadStreak.mockResolvedValue({ count: 1, lastCompletedDate: '2026-07-14' });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('1 day');
    expect(text).not.toContain('1 days');
  });

  it('shows completed count out of three', async () => {
    mockLoadDaily.mockResolvedValue(daily({ goals: { review: true, speak: false, learn: false } }));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('1/3');
  });

  it('celebrates when all three daily goals are complete', async () => {
    mockLoadDaily.mockResolvedValue(daily({ goals: { review: true, speak: true, learn: true } }));
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('All done — great work');
    expect(text).toContain('3/3');
    expect(text).not.toContain('Daily goals');
  });
});

describe('LanguageLearnScreen — backend-hydrated nav cards', () => {
  it('shows the placement-assessment card when assessment is due and no plan exists', async () => {
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('Placement assessment');
    expect(text).not.toContain('My learning plan');
  });

  it('shows the learning-plan card once a plan exists', async () => {
    mockGetStatus.mockResolvedValue({ due: false, kind: null, mandatory: false, planId: 'p1' });
    mockGetCurrentPlan.mockResolvedValue({ id: 'p1', currentLevel: 'A2' });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('My learning plan');
    expect(text).toContain('Track your progress and goals');
    expect(text).not.toContain('Placement assessment');
  });

  it('renders the due-card badge + pluralized subtitle when cards are due', async () => {
    mockCardsDue.mockResolvedValue({ dueCards: [{ id: 'c1' }, { id: 'c2' }], totalDue: 2 });
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('2 cards due now');
  });

  it('uses the singular subtitle when exactly one card is due', async () => {
    mockCardsDue.mockResolvedValue({ dueCards: [{ id: 'c1' }], totalDue: 1 });
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('1 card due now');
    expect(text).not.toContain('1 cards due now');
  });

  it('shows the "Build your plan" card when the assessment is not due but no plan exists yet', async () => {
    mockGetStatus.mockResolvedValue({ due: false, kind: null, mandatory: false, planId: null });
    mockGetCurrentPlan.mockResolvedValue(null);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('My learning plan');
    expect(text).toContain('Build your plan');
    expect(text).not.toContain('Placement assessment');
  });

  it('defaults the due count to 0 when the backend omits totalDue', async () => {
    mockCardsDue.mockResolvedValue({ dueCards: [] }); // no totalDue field
    const tree = await renderScreen();
    // Subtitle falls back to the generic copy, no numeric badge.
    expect(allText(tree.toJSON())).toContain('Spaced-repetition practice');
    expect(lastSnapshot('widget_language_today')?.words_due).toBe(0);
  });

  it('tolerates backend failures without crashing (defaults retained)', async () => {
    mockGetStatus.mockRejectedValue(new Error('down'));
    mockGetCurrentPlan.mockRejectedValue(new Error('down'));
    mockCardsDue.mockRejectedValue(new Error('down'));
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-learn-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Placement assessment');
  });
});

describe('LanguageLearnScreen — widget snapshot', () => {
  it('publishes the assessment CTA + streak + due count to the widget', async () => {
    mockLoadStreak.mockResolvedValue({ count: 3, lastCompletedDate: '2026-07-14' });
    mockCardsDue.mockResolvedValue({ dueCards: [], totalDue: 5 });
    await renderScreen();
    expect(lastSnapshot('widget_language_today')).toMatchObject({
      streak: 3,
      words_due: 5,
      next_lesson: { title: 'Take your assessment', icon: 'help-circle-outline' },
    });
  });

  it('publishes the continue-lesson CTA once a plan exists', async () => {
    mockGetStatus.mockResolvedValue({ due: false, kind: null, mandatory: false, planId: 'p1' });
    mockGetCurrentPlan.mockResolvedValue({ id: 'p1', currentLevel: 'A2' });
    await renderScreen();
    expect(lastSnapshot('widget_language_today')?.next_lesson).toEqual({
      title: 'Continue your lesson',
      icon: 'book-outline',
    });
  });

  /**
   * The Watch face had NO writer at all before `languageWidgetSnapshot.ts`, so
   * `SymplyLanguageWatchView` was permanently stuck on its empty state. The screen
   * must feed both surfaces, in their two different shapes.
   */
  it('publishes the Watch key too, in the watch shape', async () => {
    mockLoadStreak.mockResolvedValue({ count: 3, lastCompletedDate: '2026-07-14' });
    mockCardsDue.mockResolvedValue({ dueCards: [], totalDue: 5 });
    await renderScreen();

    // `next_lesson` is a bare STRING here, and the XP field is `xp_today`.
    expect(lastSnapshot('watch_language_today')).toEqual({
      streak: 3,
      xp_today: 0,
      xp_goal: 0,
      words_due: 5,
      next_lesson: 'Take your assessment',
    });
  });

  it('publishes nothing at all when signed out', async () => {
    const previousId = mockUser?.id;
    if (mockUser) mockUser.id = undefined;
    try {
      await renderScreen();
      expect(lastSnapshot('widget_language_today')).toBeUndefined();
      expect(lastSnapshot('watch_language_today')).toBeUndefined();
    } finally {
      if (mockUser) mockUser.id = previousId;
    }
  });
});

describe('LanguageLearnScreen — daily-goal toggling', () => {
  it('persists the toggled goal and recomputes the streak', async () => {
    mockUpdateStreak.mockResolvedValue({ count: 1, lastCompletedDate: '2026-07-14' });
    const tree = await renderScreen();

    await act(async () => {
      checkboxes(tree)[0].props.onPress();
    });

    expect(mockSaveDaily).toHaveBeenCalledTimes(1);
    const saved = mockSaveDaily.mock.calls[0][0] as LanguageDaily;
    expect(saved.goals.review).toBe(true);
    expect(mockUpdateStreak).toHaveBeenCalledWith(expect.objectContaining({ review: true }));
  });
});

describe('LanguageLearnScreen — daily-goal resilience', () => {
  it('ignores a goal tap while there is no daily record to toggle', async () => {
    // A daily loader that yields nothing (corrupt/absent record) still renders
    // the goal rows — tapping one must be inert rather than persisting a
    // half-built daily or bumping the streak off a missing baseline.
    mockLoadDaily.mockResolvedValue(null);
    const tree = await renderScreen();

    await act(async () => {
      checkboxes(tree)[0].props.onPress();
    });

    expect(mockSaveDaily).not.toHaveBeenCalled();
    expect(mockUpdateStreak).not.toHaveBeenCalled();
    // Screen stays up with an all-unchecked 0/3 board.
    expect(hasTestId(tree, 'language-learn-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('0/3');
  });
});

describe('LanguageLearnScreen — navigation', () => {
  it('routes the review card to the review screen', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Review vocabulary'));
    expect(mockPush).toHaveBeenCalledWith('/language-review');
  });

  it('routes the conversation card to the dialogue screen', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Conversation practice'));
    expect(mockPush).toHaveBeenCalledWith('/language-dialogue');
  });

  it('routes the tutor card to the chat screen', async () => {
    const tree = await renderScreen();
    act(() => pressByText(tree, 'Talk to your tutor'));
    expect(mockPush).toHaveBeenCalledWith('/chat');
  });

  it('routes the header notification + profile buttons', async () => {
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'hdr-notifications' }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/notifications');
    act(() => tree.root.findByProps({ testID: 'hdr-profile' }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/profile');
  });
});

describe('LanguageLearnScreen — greeting by time of day', () => {
  it.each([
    [13, 'Good afternoon'],
    [20, 'Good evening'],
  ])('shows the right greeting at hour %s', async (hour, expected) => {
    jest.setSystemTime(new Date(2026, 6, 14, hour, 0, 0));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain(expected);
  });
});

describe('LanguageLearnScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the same content', async () => {
    mockWindow = IPAD;
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-learn-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('Daily goals');
  });
});
