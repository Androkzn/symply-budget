import { router } from 'expo-router';

import { appIntents } from '../appIntents';
import { handleKaizenDeepLink, intentFromDeepLink } from '../deepLinks';

jest.mock('../appIntents', () => ({ appIntents: { handle: jest.fn() } }));

const mockPush = router.push as jest.Mock;
const mockHandle = appIntents.handle as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('handleKaizenDeepLink route mapping', () => {
  it.each([
    ['kaizen://today', '/'],
    ['kaizen://', '/'],
    ['kaizen://career/progress', '/kaizen/career-progress'],
    ['kaizen://career/import', '/kaizen/question-import'],
    ['kaizen://career/assessment', '/kaizen-assess'],
    ['kaizen://career/practice', '/kaizen/practice'],
    ['kaizen://career/dashboard', '/kaizen/career-progress'],
    ['kaizen://career', '/kaizen-career'],
    ['kaizen://assess', '/kaizen-assess'],
    ['kaizen://skill/s1', '/kaizen/skill?skillId=s1'],
    ['kaizen://skill', '/kaizen-assess'],
    ['kaizen://assessment/s2', '/kaizen/skill-assessment?skillId=s2'],
    ['kaizen://assessment', '/kaizen-assess'],
    ['kaizen://import', '/kaizen/question-import'],
    ['kaizen://question-import', '/kaizen/question-import'],
    ['kaizen://books', '/kaizen/books'],
    ['kaizen://resume-review', '/kaizen/resume-review'],
    ['kaizen://deep-work', '/kaizen/deep-work'],
    ['kaizen://practice', '/kaizen/practice'],
    ['kaizen://banks', '/kaizen/banks'],
    ['kaizen://questions', '/kaizen/banks'],
    ['kaizen://learn', '/kaizen-learn'],
    ['kaizen://gtd', '/kaizen-learn'],
    ['kaizen://reviews', '/kaizen/reviews'],
    ['kaizen://coach', '/mira'],
    ['kaizen://settings', '/kaizen/settings'],
    ['kaizen://pipeline', '/kaizen/pipeline'],
  ])('%s -> %s', (url, route) => {
    expect(handleKaizenDeepLink(url)).toBe(true);
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('passes the questionId query through to practice', () => {
    expect(handleKaizenDeepLink('kaizen://practice?questionId=q9')).toBe(true);
    expect(mockPush).toHaveBeenCalledWith('/kaizen/practice?questionId=q9');
  });

  it('routes system-detail with the system query param', () => {
    expect(handleKaizenDeepLink('kaizen://system-detail?system=career')).toBe(true);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/system-detail',
      params: { system: 'career' },
    });
  });

  it('routes kaizen/question-import with e2e query params', () => {
    expect(
      handleKaizenDeepLink(
        'kaizen:///kaizen/question-import?e2eText=What%20is%20a%20closure%3F&e2eSubmit=1',
      ),
    ).toBe(true);
    // Under __DEV__ the text is handed to queueE2EQuestionImport and the route
    // carries `e2eText` only. `e2eSubmit` is inert — no screen and no Maestro
    // flow reads it — so the dev/queue path deliberately does not forward it.
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/kaizen/question-import',
      params: { e2eText: 'What is a closure?' },
    });
  });

  it('accepts a path-only form that contains "kaizen" (non-kaizen protocol)', () => {
    // protocol !== 'kaizen:' and hostname has no "kaizen", but the URL string does,
    // so it is NOT rejected early — it falls through to route parsing.
    expect(handleKaizenDeepLink('https://links.example.com/kaizen/today')).toBe(false);
  });

  it('confirm-wake dispatches an intent and opens today', () => {
    expect(handleKaizenDeepLink('kaizen://wake')).toBe(true);
    expect(mockHandle).toHaveBeenCalledWith({ type: 'confirm-wake' });
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('log dispatches a quick-log intent without navigating', () => {
    expect(handleKaizenDeepLink('kaizen://log?actionId=a1')).toBe(true);
    expect(mockHandle).toHaveBeenCalledWith({ type: 'quick-log', actionId: 'a1' });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('snooze dispatches a snooze intent with a default duration', () => {
    expect(handleKaizenDeepLink('kaizen://snooze?actionId=a1')).toBe(true);
    expect(mockHandle).toHaveBeenCalledWith({ type: 'snooze', reminderId: 'a1', durationMinutes: 30 });
  });

  it('snooze honours an explicit minutes value', () => {
    expect(handleKaizenDeepLink('kaizen://snooze?actionId=a1&minutes=15')).toBe(true);
    expect(mockHandle).toHaveBeenCalledWith({ type: 'snooze', reminderId: 'a1', durationMinutes: 15 });
  });

  it('log without an actionId is a no-op that still returns true', () => {
    expect(handleKaizenDeepLink('kaizen://log')).toBe(true);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('snooze without an actionId is a no-op that still returns true', () => {
    expect(handleKaizenDeepLink('kaizen://snooze')).toBe(true);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('capture with text dispatches capture-gtd and opens learn', () => {
    expect(handleKaizenDeepLink('kaizen://capture?text=call%20mom')).toBe(true);
    expect(mockHandle).toHaveBeenCalledWith({ type: 'capture-gtd', text: 'call mom' });
    expect(mockPush).toHaveBeenCalledWith('/kaizen-learn');
  });

  it('capture without text still opens learn', () => {
    expect(handleKaizenDeepLink('kaizen://capture')).toBe(true);
    expect(mockHandle).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/kaizen-learn');
  });

  it('returns false for unknown kaizen routes and non-kaizen urls', () => {
    expect(handleKaizenDeepLink('kaizen://totally-unknown')).toBe(false);
    expect(handleKaizenDeepLink('https://example.com/foo')).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('returns false when the URL cannot be parsed', () => {
    // `new URL()` throws for a bare token, hitting the try/catch guard.
    expect(handleKaizenDeepLink('::::not-a-url')).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('intentFromDeepLink', () => {
  it('maps wake / log / capture urls to intents', () => {
    expect(intentFromDeepLink('kaizen://wake')).toEqual({ type: 'confirm-wake' });
    expect(intentFromDeepLink('kaizen://log?actionId=a1')).toEqual({ type: 'quick-log', actionId: 'a1' });
    expect(intentFromDeepLink('kaizen://capture?text=call%20mom')).toEqual({ type: 'capture-gtd', text: 'call mom' });
  });

  it('returns null for urls without an intent', () => {
    expect(intentFromDeepLink('kaizen://today')).toBeNull();
    expect(intentFromDeepLink('kaizen://log')).toBeNull();
    // capture without text has no intent either.
    expect(intentFromDeepLink('kaizen://capture')).toBeNull();
  });

  it('returns null when the URL cannot be parsed', () => {
    expect(intentFromDeepLink('::::not-a-url')).toBeNull();
  });
});
