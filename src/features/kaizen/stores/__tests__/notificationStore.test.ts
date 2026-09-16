/**
 * Unit coverage for the Kaizen notification store.
 *
 * The inbox service, the shared push `notificationService`, and the focus-surface
 * unread calculator are mocked so the store's orchestration (permission wiring,
 * inbox refresh, read-state transitions) can be asserted without native modules.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../services/notificationInbox', () => ({
  attachNotificationInboxListener: jest.fn(),
  listInboxNotifications: jest.fn(() => []),
  unreadInboxCount: jest.fn(() => 0),
  markInboxRead: jest.fn(),
  markAllInboxRead: jest.fn(),
  clearInbox: jest.fn(),
  syncScheduledIntoInbox: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/focusSurfaces', () => ({
  effectiveUnreadCount: jest.fn((raw: number) => raw),
}));

jest.mock('@services/notifications', () => ({
  notificationService: {
    initialize: jest.fn(),
    hasPermission: jest.fn(),
    registerWithServer: jest.fn().mockResolvedValue(undefined),
  },
}));

import { notificationService } from '@services/notifications';

import { effectiveUnreadCount } from '../../services/focusSurfaces';
import {
  attachNotificationInboxListener,
  clearInbox,
  listInboxNotifications,
  markAllInboxRead,
  markInboxRead,
  syncScheduledIntoInbox,
  unreadInboxCount,
} from '../../services/notificationInbox';
import { useNotificationStore } from '../notificationStore';

const s = () => useNotificationStore.getState();

const sampleInbox = [
  { id: 'n1', title: 'A', body: 'b', createdAt: '2026-07-15T00:00:00Z', read: false },
  { id: 'n2', title: 'B', body: 'b', createdAt: '2026-07-14T00:00:00Z', read: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  (notificationService.initialize as jest.Mock).mockResolvedValue('ExponentPushToken[test]');
  (notificationService.hasPermission as jest.Mock).mockResolvedValue(true);
  (notificationService.registerWithServer as jest.Mock).mockResolvedValue(undefined);
  (listInboxNotifications as jest.Mock).mockReturnValue([]);
  (unreadInboxCount as jest.Mock).mockReturnValue(0);
  (syncScheduledIntoInbox as jest.Mock).mockResolvedValue([]);
  (effectiveUnreadCount as jest.Mock).mockImplementation((raw: number) => raw);
  s().reset();
});

describe('initialize', () => {
  it('attaches the listener, records permission, registers the token and loads the inbox', async () => {
    (listInboxNotifications as jest.Mock).mockReturnValue(sampleInbox);
    (unreadInboxCount as jest.Mock).mockReturnValue(1);

    await s().initialize();

    expect(attachNotificationInboxListener).toHaveBeenCalled();
    expect(notificationService.registerWithServer).toHaveBeenCalled();
    expect(s().permissionGranted).toBe(true);
    expect(s().isRegistering).toBe(false);
    expect(s().error).toBeNull();
    expect(s().inbox).toEqual(sampleInbox);
    expect(s().unreadCount).toBe(1);
  });

  it('grants permission but skips server registration when there is no push token', async () => {
    (notificationService.initialize as jest.Mock).mockResolvedValue(null);
    (notificationService.hasPermission as jest.Mock).mockResolvedValue(true);

    await s().initialize();

    expect(s().permissionGranted).toBe(true);
    expect(notificationService.registerWithServer).not.toHaveBeenCalled();
  });

  it('captures errors and clears the registering flag', async () => {
    (notificationService.initialize as jest.Mock).mockRejectedValue(new Error('no device'));

    await s().initialize();

    expect(s().error).toBe('no device');
    expect(s().isRegistering).toBe(false);
  });
});

describe('registerPushToken', () => {
  it('records permission and registers the token with the server', async () => {
    (notificationService.initialize as jest.Mock).mockResolvedValue('ExponentPushToken[x]');
    (notificationService.hasPermission as jest.Mock).mockResolvedValue(true);

    await s().registerPushToken();

    expect(notificationService.registerWithServer).toHaveBeenCalled();
    expect(s().permissionGranted).toBe(true);
    expect(s().isRegistering).toBe(false);
    expect(s().error).toBeNull();
  });

  it('skips server registration when no push token is issued', async () => {
    (notificationService.initialize as jest.Mock).mockResolvedValue(null);
    (notificationService.hasPermission as jest.Mock).mockResolvedValue(false);

    await s().registerPushToken();

    expect(notificationService.registerWithServer).not.toHaveBeenCalled();
    expect(s().permissionGranted).toBe(false);
    expect(s().isRegistering).toBe(false);
  });

  it('captures an Error message and clears the registering flag', async () => {
    (notificationService.initialize as jest.Mock).mockRejectedValue(new Error('no device'));

    await s().registerPushToken();

    expect(s().error).toBe('no device');
    expect(s().isRegistering).toBe(false);
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    (notificationService.initialize as jest.Mock).mockRejectedValue('string failure');

    await s().registerPushToken();

    expect(s().error).toBe('Could not register notifications');
    expect(s().isRegistering).toBe(false);
  });
});

describe('initialize — non-Error rejection', () => {
  it('falls back to the generic error message', async () => {
    (notificationService.initialize as jest.Mock).mockRejectedValue('boom');

    await s().initialize();

    expect(s().error).toBe('Could not register notifications');
    expect(s().isRegistering).toBe(false);
  });
});

describe('refreshInbox', () => {
  it('syncs scheduled reminders into the inbox and recomputes unread count', async () => {
    (listInboxNotifications as jest.Mock).mockReturnValue(sampleInbox);
    (unreadInboxCount as jest.Mock).mockReturnValue(1);

    await s().refreshInbox();

    expect(syncScheduledIntoInbox).toHaveBeenCalled();
    expect(s().inbox).toEqual(sampleInbox);
    expect(effectiveUnreadCount).toHaveBeenCalledWith(1, sampleInbox);
    expect(s().unreadCount).toBe(1);
  });
});

describe('read-state transitions', () => {
  it('markRead marks a single item and refreshes the inbox', () => {
    (listInboxNotifications as jest.Mock).mockReturnValue([{ ...sampleInbox[0], read: true }, sampleInbox[1]]);
    (unreadInboxCount as jest.Mock).mockReturnValue(0);

    s().markRead('n1');

    expect(markInboxRead).toHaveBeenCalledWith('n1');
    expect(s().unreadCount).toBe(0);
    expect(s().inbox[0].read).toBe(true);
  });

  it('markAllRead clears the unread count', () => {
    (listInboxNotifications as jest.Mock).mockReturnValue(sampleInbox.map(n => ({ ...n, read: true })));

    s().markAllRead();

    expect(markAllInboxRead).toHaveBeenCalled();
    expect(s().unreadCount).toBe(0);
  });

  it('clearAll empties the inbox', () => {
    useNotificationStore.setState({ inbox: sampleInbox as any, unreadCount: 2 });

    s().clearAll();

    expect(clearInbox).toHaveBeenCalled();
    expect(s().inbox).toEqual([]);
    expect(s().unreadCount).toBe(0);
  });
});

describe('local state helpers', () => {
  it('setUnreadCount floors negative values at zero', () => {
    s().setUnreadCount(5);
    expect(s().unreadCount).toBe(5);
    s().setUnreadCount(-3);
    expect(s().unreadCount).toBe(0);
  });

  it('reset restores the initial state', () => {
    useNotificationStore.setState({ permissionGranted: true, unreadCount: 9, inbox: sampleInbox as any });
    s().reset();
    expect(s().permissionGranted).toBe(false);
    expect(s().unreadCount).toBe(0);
    expect(s().inbox).toEqual([]);
  });
});
