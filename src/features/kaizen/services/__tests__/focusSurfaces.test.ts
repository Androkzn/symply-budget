import { isDeepWorkFocusFilterActive } from '../focusMode';
import {
  effectiveUnreadCount,
  focusFilterSuppressesDailyCoreSurfaces,
  isDeepWorkInboxItem,
  shouldShowInboxItemWhileFocusActive,
} from '../focusSurfaces';

jest.mock('../focusMode', () => ({ isDeepWorkFocusFilterActive: jest.fn() }));

const mockActive = isDeepWorkFocusFilterActive as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('isDeepWorkInboxItem', () => {
  it('recognizes deep-work destination and category', () => {
    expect(isDeepWorkInboxItem({ destination: 'deep-work' })).toBe(true);
    expect(isDeepWorkInboxItem({ categoryId: 'kaizen.category.deepWork' })).toBe(true);
    expect(isDeepWorkInboxItem({ category: 'kaizen.category.deepWork' })).toBe(true);
  });

  it('is false for other items or missing data', () => {
    expect(isDeepWorkInboxItem({ destination: 'today' })).toBe(false);
    expect(isDeepWorkInboxItem(undefined)).toBe(false);
  });
});

describe('focus filter gating', () => {
  it('shows everything when the filter is off', () => {
    mockActive.mockReturnValue(false);
    expect(focusFilterSuppressesDailyCoreSurfaces()).toBe(false);
    expect(shouldShowInboxItemWhileFocusActive({ destination: 'today' })).toBe(true);
  });

  it('only shows deep-work items when the filter is on', () => {
    mockActive.mockReturnValue(true);
    expect(shouldShowInboxItemWhileFocusActive({ destination: 'today' })).toBe(false);
    expect(shouldShowInboxItemWhileFocusActive({ destination: 'deep-work' })).toBe(true);
  });
});

describe('effectiveUnreadCount', () => {
  const inbox = [
    { read: false, data: { destination: 'today' } },
    { read: false, data: { destination: 'deep-work' } },
    { read: true, data: { destination: 'deep-work' } },
  ];

  it('returns the raw count when the filter is off', () => {
    mockActive.mockReturnValue(false);
    expect(effectiveUnreadCount(2, inbox)).toBe(2);
  });

  it('counts only visible unread items when the filter is on', () => {
    mockActive.mockReturnValue(true);
    // Only the unread deep-work item survives the filter.
    expect(effectiveUnreadCount(2, inbox)).toBe(1);
  });
});
