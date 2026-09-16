import * as Notifications from 'expo-notifications';

import { focusFilterSuppressesDailyCoreSurfaces } from '../focusSurfaces';
import {
  addInboxNotification,
  attachNotificationInboxListener,
  clearInbox,
  listInboxNotifications,
  markAllInboxRead,
  markInboxRead,
  syncScheduledIntoInbox,
  unreadInboxCount,
} from '../notificationInbox';

const INBOX_KEY = 'kaizen.notifications.inbox';

const store: Record<string, string> = {};
jest.mock('../storage', () => ({
  storageHelpers: {
    getString: jest.fn((k: string) => store[k] ?? null),
    setString: jest.fn((k: string, v: string) => {
      store[k] = v;
    }),
    remove: jest.fn((k: string) => {
      delete store[k];
    }),
  },
}));

jest.mock('../focusSurfaces', () => ({
  focusFilterSuppressesDailyCoreSurfaces: jest.fn(() => false),
}));

jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const mockAddReceived = Notifications.addNotificationReceivedListener as jest.Mock;
const mockAddResponse = Notifications.addNotificationResponseReceivedListener as jest.Mock;
const mockGetScheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const mockSuppresses = focusFilterSuppressesDailyCoreSurfaces as jest.Mock;

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  jest.clearAllMocks();
  mockSuppresses.mockReturnValue(false);
});

describe('notification inbox CRUD', () => {
  it('adds notifications and tracks unread count', () => {
    addInboxNotification({ id: 'n1', title: 'A', body: 'body a' });
    addInboxNotification({ id: 'n2', title: 'B', body: 'body b' });

    const list = listInboxNotifications();
    expect(list.map(i => i.id).sort()).toEqual(['n1', 'n2']);
    expect(list.every(i => i.read === false)).toBe(true);
    expect(unreadInboxCount()).toBe(2);
  });

  it('deduplicates by id, keeping the newest entry', () => {
    addInboxNotification({ id: 'dup', title: 'first', body: 'x' });
    addInboxNotification({ id: 'dup', title: 'second', body: 'y' });

    const list = listInboxNotifications();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('second');
  });

  it('marks a single item and all items as read', () => {
    addInboxNotification({ id: 'n1', title: 'A', body: 'a' });
    addInboxNotification({ id: 'n2', title: 'B', body: 'b' });

    markInboxRead('n1');
    expect(unreadInboxCount()).toBe(1);
    expect(listInboxNotifications().find(i => i.id === 'n1')?.read).toBe(true);

    markAllInboxRead();
    expect(unreadInboxCount()).toBe(0);
  });

  it('clears the inbox', () => {
    addInboxNotification({ id: 'n1', title: 'A', body: 'a' });
    clearInbox();
    expect(listInboxNotifications()).toEqual([]);
  });

  it('generates an id when none is supplied', () => {
    const item = addInboxNotification({ title: 'auto', body: 'b' });
    expect(item.id).toMatch(/^inbox-/);
    expect(listInboxNotifications()[0].id).toBe(item.id);
  });

  it('treats corrupt JSON as an empty inbox', () => {
    store[INBOX_KEY] = '{not-json';
    expect(listInboxNotifications()).toEqual([]);
    expect(unreadInboxCount()).toBe(0);
  });

  it('treats non-array JSON as an empty inbox', () => {
    store[INBOX_KEY] = JSON.stringify({ not: 'an array' });
    expect(listInboxNotifications()).toEqual([]);
  });
});

describe('syncScheduledIntoInbox', () => {
  it('seeds the inbox from scheduled kaizen reminders (Focus filter off)', async () => {
    mockSuppresses.mockReturnValue(false);
    // Pre-seed one item so the existing-id `continue` branch is exercised.
    addInboxNotification({ id: 'kaizen-dup', title: 'Existing', body: 'x' });

    mockGetScheduled.mockResolvedValue([
      { identifier: 'kaizen-action-1', content: { title: 'Core', body: 'do it', data: { type: 'core' } } },
      { identifier: 'kaizen-reminder-2', content: { title: 'Rem', body: 'later' } },
      { identifier: 'kaizen-empty', content: {} }, // title/body/data defaults
      { identifier: 'kaizen-dup', content: { title: 'Dup again', body: 'y' } }, // already present
      { identifier: 'other-3', content: { title: 'Skip', body: 'not kaizen' } }, // filtered out
    ]);

    const out = await syncScheduledIntoInbox();
    const ids = out.map(i => i.id).sort();

    expect(ids).toEqual(['kaizen-action-1', 'kaizen-dup', 'kaizen-empty', 'kaizen-reminder-2']);
    expect(out.find(i => i.id === 'other-3')).toBeUndefined();

    const empty = out.find(i => i.id === 'kaizen-empty');
    expect(empty).toMatchObject({ title: 'Kaizen reminder', body: '' });
    expect(empty?.data).toBeUndefined();

    // Existing entry kept (not overwritten by the scheduled duplicate).
    expect(out.find(i => i.id === 'kaizen-dup')?.title).toBe('Existing');
  });

  it('suppresses daily-core nudges while the Focus filter is active', async () => {
    mockSuppresses.mockReturnValue(true);
    mockGetScheduled.mockResolvedValue([
      { identifier: 'kaizen-action-9', content: { title: 'Core', body: 'do it' } }, // daily-core → skipped
      { identifier: 'kaizen-reminder-9', content: { title: 'Rem', body: 'keep' } }, // not core → kept
    ]);

    const out = await syncScheduledIntoInbox();
    const ids = out.map(i => i.id);

    expect(ids).toContain('kaizen-reminder-9');
    expect(ids).not.toContain('kaizen-action-9');
  });
});

describe('attachNotificationInboxListener', () => {
  it('registers received + response listeners and funnels them into the inbox', () => {
    attachNotificationInboxListener();

    expect(mockAddReceived).toHaveBeenCalledTimes(1);
    expect(mockAddResponse).toHaveBeenCalledTimes(1);

    const receivedHandler = mockAddReceived.mock.calls[0][0] as (n: unknown) => void;
    receivedHandler({ request: { identifier: 'recv-1', content: { title: 'Ping', body: 'hi', data: { type: 'x' } } } });
    expect(listInboxNotifications().find(i => i.id === 'recv-1')).toMatchObject({ title: 'Ping', read: false });

    const responseHandler = mockAddResponse.mock.calls[0][0] as (r: unknown) => void;
    responseHandler({ notification: { request: { identifier: 'resp-1', content: { title: 'Tapped', body: 'b' } } } });
    // A tapped notification is recorded and marked read.
    expect(listInboxNotifications().find(i => i.id === 'resp-1')).toMatchObject({ title: 'Tapped', read: true });

    // Empty content exercises the title/body/data default fallbacks in both handlers.
    receivedHandler({ request: { identifier: 'recv-empty', content: {} } });
    expect(listInboxNotifications().find(i => i.id === 'recv-empty')).toMatchObject({
      title: 'Kaizen',
      body: '',
      read: false,
    });

    responseHandler({ notification: { request: { identifier: 'resp-empty', content: {} } } });
    expect(listInboxNotifications().find(i => i.id === 'resp-empty')).toMatchObject({
      title: 'Kaizen',
      body: '',
      read: true,
    });
  });

  it('is idempotent — attaching again does not double-register', () => {
    // Listener was already attached by the previous test (module-level guard).
    attachNotificationInboxListener();
    expect(mockAddReceived).not.toHaveBeenCalled();
  });
});
