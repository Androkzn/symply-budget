/**
 * LanguagePlanScreen — Symply Language (`symply-language`) "My plan" screen.
 *
 * Renders the REAL screen through <ThemeProvider> on iPhone- and iPad-class
 * windows and drives its behavior: the loading gate, the no-plan empty state
 * (with its placement-assessment CTA), the loaded plan (CEFR level + target,
 * task/minutes/week progress line, goals list, today's metrics), the optional
 * progress card, resilience when the progress endpoint fails, and back
 * navigation. The plan + progress api modules are mocked so state is
 * deterministic; their own logic is covered in sibling api suites.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { ThemeProvider } from '@contexts/ThemeContext';

import { languagePlanApi, type LearningPlan } from '../../api/languagePlan';
import { languageProgressApi, type ProgressSnapshot } from '../../api/languageProgress';
import { IPAD, IPHONE, allText, hasTestId } from '../../test-utils/languageScreenTestKit';
import { LanguagePlanScreen } from '../LanguagePlanScreen';

let mockWindow = IPHONE;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const ReactMock = require('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), navigate: jest.fn() }),
    // Unused by this screen, but mirrors the canonical Language test harness.
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactMock.useEffect(() => cb(), [cb]);
    },
  };
});

jest.mock('@hooks/useLayoutPadding', () => ({
  useLayoutPadding: () => ({ content: 16 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View, Pressable } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    // Expose the header's back handler so back routing is exercised.
    ScreenHeader: ({ title, onBackPress }: { title?: string; onBackPress?: () => void }) =>
      ReactMock.createElement(View, { testID: 'screen-header' }, [
        ReactMock.createElement(Pressable, {
          key: 'back',
          testID: 'hdr-back',
          onPress: onBackPress,
        }),
        ReactMock.createElement(View, { key: 'title', testID: 'hdr-title' }, title),
      ]),
  };
});

jest.mock('../../api/languagePlan', () => ({
  languagePlanApi: { getCurrent: jest.fn() },
}));
jest.mock('../../api/languageProgress', () => ({
  languageProgressApi: { get: jest.fn() },
}));

const mockGetCurrent = languagePlanApi.getCurrent as jest.Mock;
const mockGetProgress = languageProgressApi.get as jest.Mock;

function plan(overrides: Partial<LearningPlan> = {}): LearningPlan {
  return {
    id: 'p1',
    currentLevel: 'A2',
    currentCefrLevel: 'B1',
    targetCefrLevel: 'C1',
    dailyMinutes: 20,
    goals: ['Order food in a restaurant', 'Hold a 5-minute conversation'],
    schedule: { mon: { minutes: 20, focus: 'grammar' } },
    totalTasks: 40,
    completedTasks: 10,
    currentWeek: 3,
    ...overrides,
  };
}

function progress(overrides: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    today: {
      vocabularyRetention: 0.8,
      grammarAccuracy: 0.9,
      speakingFluency: 0.7,
      listeningComprehension: 0.6,
      totalPracticeMinutes: 15,
    },
    weekly: [],
    ...overrides,
  };
}

async function renderScreen() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <LanguagePlanScreen />
      </ThemeProvider>,
    );
  });
  return tree;
}

beforeEach(() => {
  mockWindow = IPHONE;
  jest.clearAllMocks();
  mockGetCurrent.mockResolvedValue(null);
  mockGetProgress.mockResolvedValue(progress());
});

describe('LanguagePlanScreen — loading gate', () => {
  it('shows a spinner until the plan resolves', () => {
    mockGetCurrent.mockReturnValue(new Promise(() => {}));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ThemeProvider>
          <LanguagePlanScreen />
        </ThemeProvider>,
      );
    });
    expect(tree.root.findAllByType(ActivityIndicator).length).toBe(1);
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
    // Neither the empty state nor plan content has committed yet.
    expect(allText(tree.toJSON())).not.toContain('No learning plan yet');
  });
});

describe('LanguagePlanScreen — empty state', () => {
  it('renders the build-a-plan CTA when getCurrent resolves null', async () => {
    mockGetCurrent.mockResolvedValue(null);
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('No learning plan yet');
    expect(text).toContain('Take the placement assessment');
    expect(text).toContain('Start assessment');
    expect(text).not.toContain('CURRENT LEVEL');
  });

  it('routes the Start assessment CTA to the assessment screen', async () => {
    mockGetCurrent.mockResolvedValue(null);
    const tree = await renderScreen();
    const cta = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole !== 'button',
    );
    // The primary CTA is the only pressable in the empty state body.
    const pressable = tree.root.find(
      (n) =>
        typeof n.props?.onPress === 'function' &&
        n.props?.style &&
        JSON.stringify(n.props.style).includes('marginTop'),
    );
    await act(async () => {
      pressable.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/language-assessment');
    expect(cta.length).toBeGreaterThan(0);
  });
});

describe('LanguagePlanScreen — loaded plan', () => {
  it('shows level, target, progress line, goals and today metrics', async () => {
    mockGetCurrent.mockResolvedValue(plan());
    mockGetProgress.mockResolvedValue(progress());
    const tree = await renderScreen();
    const text = allText(tree.toJSON());

    // Level card: currentCefrLevel wins over currentLevel; target shown.
    expect(text).toContain('CURRENT LEVEL');
    expect(text).toContain('B1');
    expect(text).toContain('TARGET');
    expect(text).toContain('C1');

    // Progress summary line.
    expect(text).toContain('10/40 tasks');
    expect(text).toContain('20 min/day');
    expect(text).toContain('week 3');

    // Goals list.
    expect(text).toContain('GOALS');
    expect(text).toContain('Order food in a restaurant');
    expect(text).toContain('Hold a 5-minute conversation');

    // Today metrics: 15m / 90% / 80%.
    expect(text).toContain('TODAY');
    expect(text).toContain('Practice');
    expect(text).toContain('15m');
    expect(text).toContain('90%');
    expect(text).toContain('80%');

    expect(text).not.toContain('No learning plan yet');
  });

  it('falls back to currentLevel and omits target/week/goals/today when absent', async () => {
    mockGetCurrent.mockResolvedValue(
      plan({
        currentCefrLevel: undefined,
        targetCefrLevel: undefined,
        goals: [],
        totalTasks: undefined,
        completedTasks: undefined,
        currentWeek: undefined,
      }),
    );
    mockGetProgress.mockResolvedValue(progress({ today: null }));
    const tree = await renderScreen();
    const text = allText(tree.toJSON());

    expect(text).toContain('A2'); // currentLevel fallback
    expect(text).not.toContain('TARGET');
    expect(text).toContain('0/0 tasks');
    expect(text).not.toContain('week ');
    expect(text).not.toContain('GOALS');
    expect(text).not.toContain('TODAY');
  });

  it('defaults today metrics to zero when values are missing', async () => {
    mockGetCurrent.mockResolvedValue(plan());
    // Empty today object exercises the ?? 0 fallbacks in the Metric cells.
    mockGetProgress.mockResolvedValue(progress({ today: {} as ProgressSnapshot['today'] }));
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('TODAY');
    expect(text).toContain('0m');
    expect(text).toContain('0%');
  });

  it('renders a partial progress bar without dividing by zero', async () => {
    mockGetCurrent.mockResolvedValue(plan({ totalTasks: 4, completedTasks: 1 }));
    const tree = await renderScreen();
    // The fill width is derived from completion; screen stays mounted.
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('1/4 tasks');
  });

  it('treats a plan with tasks but no completed count as 0% complete', async () => {
    // totalTasks > 0 but completedTasks undefined → completion = (0 / total).
    // Exercises the `completedTasks ?? 0` fallback inside the completion calc.
    mockGetCurrent.mockResolvedValue(plan({ totalTasks: 12, completedTasks: undefined }));
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('0/12 tasks');
  });
});

describe('LanguagePlanScreen — resilience', () => {
  it('still renders the plan when the progress endpoint fails', async () => {
    // The screen guards the progress fetch with `.catch(() => null)`, so a
    // failed progress load degrades gracefully: plan renders, TODAY is dropped.
    mockGetCurrent.mockResolvedValue(plan());
    mockGetProgress.mockRejectedValue(new Error('progress down'));
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('CURRENT LEVEL');
    expect(text).toContain('B1');
    expect(text).not.toContain('TODAY');
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
  });

  it('degrades to the empty state when the plan fetch fails (no unhandled rejection)', async () => {
    // getCurrent is guarded with `.catch(() => null)`, so a backend failure
    // (e.g. a 500) is swallowed and the screen shows the build-a-plan CTA
    // rather than surfacing an unhandled promise rejection.
    mockGetCurrent.mockRejectedValue(new Error('plan endpoint 500'));
    mockGetProgress.mockResolvedValue(progress());
    const tree = await renderScreen();
    const text = allText(tree.toJSON());
    expect(text).toContain('No learning plan yet');
    expect(text).not.toContain('CURRENT LEVEL');
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
  });

  it('renders the empty state when both plan and progress fail', async () => {
    mockGetCurrent.mockRejectedValue(new Error('plan down'));
    mockGetProgress.mockRejectedValue(new Error('progress down'));
    const tree = await renderScreen();
    expect(allText(tree.toJSON())).toContain('No learning plan yet');
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
  });
});

describe('LanguagePlanScreen — navigation', () => {
  it('routes the header back button to router.back', async () => {
    mockGetCurrent.mockResolvedValue(plan());
    const tree = await renderScreen();
    act(() => tree.root.findByProps({ testID: 'hdr-back' }).props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('LanguagePlanScreen — iPad rendering', () => {
  it('mounts on iPad-class dimensions with the same plan content', async () => {
    mockWindow = IPAD;
    mockGetCurrent.mockResolvedValue(plan());
    const tree = await renderScreen();
    expect(hasTestId(tree, 'language-plan-screen')).toBe(true);
    expect(allText(tree.toJSON())).toContain('CURRENT LEVEL');
  });
});
