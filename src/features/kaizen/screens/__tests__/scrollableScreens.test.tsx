/**
 * Scroll contract — every Symply Kaizen screen must render a flex-bound ScrollView
 * so tab-root and pushed routes scroll on iPhone/iPad (regression: Today tab stuck).
 */

/* eslint-disable @typescript-eslint/no-require-imports */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';


import { ThemeProvider } from '@contexts/ThemeContext';

import { expectScrollableScreen } from '../../test-utils/kaizenScreenTestKit';
import { AssessScreen } from '../AssessScreen';
import { AttemptHistoryScreen } from '../AttemptHistoryScreen';
import { BookDetailScreen } from '../BookDetailScreen';
import { BookQuizScreen } from '../BookQuizScreen';
import { BookReaderScreen } from '../BookReaderScreen';
import { BooksScreen } from '../BooksScreen';
import { CareerHubScreen } from '../CareerHubScreen';
import { CareerProgressScreen } from '../CareerProgressScreen';
import { CareerSetupScreen } from '../CareerSetupScreen';
import { CoachChatScreen } from '../CoachChatScreen';
import { KAIZEN_SCREEN_SCROLL_TEST_ID } from '../common';
import { DeepWorkScreen } from '../DeepWorkScreen';
import { HabitStackScreen } from '../HabitStackScreen';
import { InsightsScreen } from '../InsightsScreen';
import { InterviewPipelineScreen } from '../InterviewPipelineScreen';
import { KaizenMoreScreen } from '../KaizenMoreScreen';
import { LearningPlanScreen } from '../LearningPlanScreen';
import { LearnScreen } from '../LearnScreen';
import { MemorySettingsScreen } from '../MemorySettingsScreen';
import { NotificationsScreen } from '../NotificationsScreen';
import { OnboardingScreen } from '../OnboardingScreen';
import { PracticeSessionScreen } from '../PracticeSessionScreen';
import { QuestionBanksScreen } from '../QuestionBanksScreen';
import { QuestionImportScreen } from '../QuestionImportScreen';
import { ResumeReviewScreen } from '../ResumeReviewScreen';
import { ReviewsScreen } from '../ReviewsScreen';
import { SettingsScreen } from '../SettingsScreen';
import { SkillAssessmentScreen } from '../SkillAssessmentScreen';
import { SkillDetailScreen } from '../SkillDetailScreen';
import { SystemConfigScreen } from '../SystemConfigScreen';
import { SystemDetailScreen } from '../SystemDetailScreen';
import { SystemsHubScreen } from '../SystemsHubScreen';
import { TodayScreen } from '../TodayScreen';
import { WeeklyRotationScreen } from '../WeeklyRotationScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('expo-linear-gradient', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { LinearGradient: (p: { children?: React.ReactNode }) => R.createElement(View, null, p.children) };
});

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn().mockResolvedValue('resume text'),
}));

jest.mock('react-native-webview', () => {
  const R = require('react');
  const { View } = require('react-native');
  return { WebView: (p: Record<string, unknown>) => R.createElement(View, p) };
});

jest.mock('@components/cloud-storage', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    CloudFilePicker: () => R.createElement(View, { testID: 'cloud-file-picker' }),
  };
});

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true }),
}));

jest.mock('expo-font', () => {
  const actual = jest.requireActual('expo-font');
  return { ...actual, isLoaded: () => true, loadAsync: jest.fn().mockResolvedValue(undefined) };
});

jest.mock('@services/voice-recording', () => ({
  __esModule: true,
  VoiceRecordingService: {
    requestPermission: jest.fn().mockResolvedValue(true),
    startRecording: jest.fn().mockResolvedValue(true),
    stopRecording: jest.fn().mockResolvedValue({ uri: 'file:///rec.m4a', duration: 3 }),
    cancelRecording: jest.fn().mockResolvedValue(undefined),
    playVoiceNote: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@features/kaizen/services/deepLinks', () => ({
  handleKaizenDeepLink: jest.fn(),
}));

jest.mock('@components/common', () => {
  const R = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      R.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: () => R.createElement(View, { testID: 'screen-header' }),
    ScreenScrollEnd: ({ testID }: { testID: string }) =>
      R.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

// A local factory REPLACES the expo-router stub in jest.setup.js wholesale, so
// every hook these screens reach for has to be re-declared here — a missing one
// surfaces as "(0 , _expoRouter.useX) is not a function" at render
// (QuestionImportScreen → useFocusEffect).
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    __esModule: true,
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn() },
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      setParams: jest.fn(),
    }),
    useLocalSearchParams: () => ({
      bookId: 'book-1',
      chapterId: 'ch-1',
      skillId: 'skill-1',
      questionId: 'q-1',
      system: 'career',
      setup: '0',
    }),
    // A mounted screen in a test is a focused screen: run the callback once.
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []),
    Redirect: () => null,
    Link: ({ children }: { children?: React.ReactNode }) => children,
  };
});

jest.mock('@features/kaizen/services/coachToolResolver', () => ({
  openCoachToolRoute: jest.fn(),
  resolveCoachToolResults: jest.fn().mockResolvedValue([]),
}));

jest.mock('@features/kaizen/hooks/useKaizenWeeklyReviews', () => ({
  __esModule: true,
  useKaizenWeeklyReviews: () => ({ data: [] }),
  useInvalidateKaizenWeeklyReviews: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@features/kaizen/hooks/useKaizenBooks', () => ({
  __esModule: true,
  useKaizenBooks: () => ({
    data: [{ id: 'book-1', title: 'Sample', author: 'Author', status: 'reading' }],
  }),
  useInvalidateKaizenBooks: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@stores/authStore', () => ({
  useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) =>
    sel({ user: { id: 'u1' } }),
}));

jest.mock('@features/kaizen/services/learningPlan', () => ({
  __esModule: true,
  buildSkillLearningPlan: jest.fn().mockResolvedValue({
    concept_sequence: [],
    practice_queue: [],
    review_focus: [],
  }),
  isLearningTaskComplete: jest.fn(() => false),
  toggleLearningTaskComplete: jest.fn(),
}));

const mockState: Record<string, unknown> = {
  profile: {
    onboarding_complete: 1,
    enabled_systems: JSON.stringify(['career']),
    system_activation_states: JSON.stringify({ career: 'enabled' }),
    career_setup_step: 'complete',
    timezone: 'UTC',
  },
  skills: [{ id: 'skill-1', name: 'React', is_assessable: 1, mastery_0_to_100: 40, activation_state: 'active' }],
  questions: [{ id: 'q-1', prompt: 'Explain hooks', question_bank: 'technical', import_review_status: 'approved' }],
  books: [{ id: 'book-1', title: 'Sample', author: 'Author', status: 'reading' }],
  chapters: [{ id: 'ch-1', book_id: 'book-1', title: 'Intro', order_index: 0 }],
  knowledge: [],
  gtd: [],
  pipeline: [],
  dailyCore: [],
  todayLogs: [],
  deepWork: [],
  rotations: [],
  habitStacks: [],
  habitStackSteps: [],
  wakeConfirmedToday: true,
  isSyncing: false,
  attempts: [],
  notifications: [],
  memories: [],
  reviews: [],
  bookQuestions: [],
  bookAttempts: [],
  bookChapters: [{ id: 'ch-1', book_id: 'book-1', title: 'Intro', order_index: 0, chapter_index: 0 }],
  bookHighlights: [],
  getAttemptsForQuestion: () => [],
  getBookChapters: () => [{ id: 'ch-1', book_id: 'book-1', title: 'Intro', order_index: 0, chapter_index: 0 }],
  readChapterText: jest.fn().mockResolvedValue('Sample chapter text.'),
  addBookHighlight: jest.fn().mockResolvedValue(undefined),
  deleteBookHighlight: jest.fn().mockResolvedValue(undefined),
  generateBookChapterQuestions: jest.fn().mockResolvedValue(6),
  submitBookAttempt: jest.fn().mockResolvedValue(undefined),
  submitSpokenBookAttempt: jest.fn().mockResolvedValue(undefined),
  markBookChapterRead: jest.fn().mockResolvedValue(undefined),
  deleteBook: jest.fn().mockResolvedValue(undefined),
  attachBookFile: jest.fn().mockResolvedValue(undefined),
  saveWeeklyReview: jest.fn().mockResolvedValue(undefined),
  approveMemory: jest.fn().mockResolvedValue(undefined),
  archiveMemory: jest.fn().mockResolvedValue(undefined),
  scheduleDailyReminders: jest.fn().mockResolvedValue(undefined),
  hasAIDisclosureAck: jest.fn(() => true),
  setAIDisclosureAck: jest.fn(),
  sendCoachMessage: jest.fn().mockResolvedValue({ assistant_message: 'ok', tool_results: [] }),
  hydrate: jest.fn().mockResolvedValue(undefined),
  sync: jest.fn().mockResolvedValue(undefined),
  completeDailyAction: jest.fn().mockResolvedValue(undefined),
  skipDailyAction: jest.fn().mockResolvedValue(undefined),
  confirmWake: jest.fn().mockResolvedValue(undefined),
  setSystemActivation: jest.fn().mockResolvedValue(undefined),
  beginSetupSystems: jest.fn().mockResolvedValue(undefined),
  addGtdItem: jest.fn().mockResolvedValue(undefined),
  addKnowledgeItem: jest.fn().mockResolvedValue(undefined),
  updateGtdStatus: jest.fn().mockResolvedValue(undefined),
  analyzeResume: jest.fn().mockResolvedValue({ target_roles: [], suggested_skills: [], summary: '' }),
  saveCareerSetup: jest.fn().mockResolvedValue(undefined),
  addSkill: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@features/kaizen/stores/kaizenStore', () => {
  const useKaizenStore = (selector?: (s: typeof mockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  useKaizenStore.getState = () => mockState;
  return { __esModule: true, useKaizenStore };
});

jest.mock('@features/kaizen/stores/notificationStore', () => {
  const notifState: Record<string, unknown> = {
    permissionGranted: false,
    isRegistering: false,
    unreadCount: 0,
    inbox: [],
    initialize: jest.fn().mockResolvedValue(undefined),
    refreshInbox: jest.fn().mockResolvedValue(undefined),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    clearAll: jest.fn(),
  };
  const useNotificationStore = (selector?: (s: typeof notifState) => unknown) =>
    selector ? selector(notifState) : notifState;
  useNotificationStore.getState = () => notifState;
  return { __esModule: true, useNotificationStore };
});

const SCROLL_CASES: Array<{ name: string; Screen: ComponentType; scrollTestId?: string }> = [
  { name: 'TodayScreen', Screen: TodayScreen, scrollTestId: 'kaizen-today-scroll' },
  { name: 'AssessScreen', Screen: AssessScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'AttemptHistoryScreen', Screen: AttemptHistoryScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'BookDetailScreen', Screen: BookDetailScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'BookQuizScreen', Screen: BookQuizScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'BookReaderScreen', Screen: BookReaderScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'BooksScreen', Screen: BooksScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'CareerHubScreen', Screen: CareerHubScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'CareerProgressScreen', Screen: CareerProgressScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'CareerSetupScreen', Screen: CareerSetupScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'CoachChatScreen', Screen: CoachChatScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'DeepWorkScreen', Screen: DeepWorkScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'HabitStackScreen', Screen: HabitStackScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'InsightsScreen', Screen: InsightsScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'InterviewPipelineScreen', Screen: InterviewPipelineScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'KaizenMoreScreen', Screen: KaizenMoreScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'LearnScreen', Screen: LearnScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'LearningPlanScreen', Screen: LearningPlanScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'MemorySettingsScreen', Screen: MemorySettingsScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'NotificationsScreen', Screen: NotificationsScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'OnboardingScreen', Screen: OnboardingScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'PracticeSessionScreen', Screen: PracticeSessionScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'QuestionBanksScreen', Screen: QuestionBanksScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'QuestionImportScreen', Screen: QuestionImportScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'ResumeReviewScreen', Screen: ResumeReviewScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'ReviewsScreen', Screen: ReviewsScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SettingsScreen', Screen: SettingsScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SkillAssessmentScreen', Screen: SkillAssessmentScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SkillDetailScreen', Screen: SkillDetailScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SystemConfigScreen', Screen: SystemConfigScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SystemDetailScreen', Screen: SystemDetailScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'SystemsHubScreen', Screen: SystemsHubScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
  { name: 'WeeklyRotationScreen', Screen: WeeklyRotationScreen, scrollTestId: KAIZEN_SCREEN_SCROLL_TEST_ID },
];

async function renderScreen(Screen: ComponentType) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <Screen />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
}

describe('Kaizen scroll contract — all screens', () => {
  SCROLL_CASES.forEach(({ name, Screen, scrollTestId }) => {
    it(`${name} renders a flex-bound vertical ScrollView`, async () => {
      const tree = await renderScreen(Screen);
      expectScrollableScreen(tree, scrollTestId);
    });
  });
});
