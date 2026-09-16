jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn() }));
jest.mock('@services/notifications', () => ({ notificationService: {
  requestPermission: jest.fn(), registerWithServer: jest.fn(),
} }));

import * as Notifications from 'expo-notifications';
import React from 'react';
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { publishNotificationPermission } from '@services/notificationPermissionEvents';
import { notificationService } from '@services/notifications';

import { useNotificationPermission, type UseNotificationPermissionResult } from '../useNotificationPermission';
import { usePermissionSuccess } from '../usePermissionSuccess';

let permission: UseNotificationPermissionResult;
let success: boolean;
let tree: TestRenderer.ReactTestRenderer;
function Probe() {
  permission = useNotificationPermission();
  success = usePermissionSuccess(permission.state);
  return null;
}
const read = Notifications.getPermissionsAsync as jest.Mock;
const request = notificationService.requestPermission as jest.Mock;
const register = notificationService.registerWithServer as jest.Mock;
async function mount() {
  await act(async () => { tree = TestRenderer.create(<Probe />); });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  read.mockResolvedValue({ status: 'undetermined' });
  register.mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('receives an automatic login grant, shows success for three seconds, then hides it', async () => {
  await mount();
  act(() => publishNotificationPermission({ status: 'granted' }));
  expect(permission.state).toBe('granted');
  expect(success).toBe(true);
  act(() => jest.advanceTimersByTime(2999));
  expect(success).toBe(true);
  act(() => jest.advanceTimersByTime(1));
  expect(success).toBe(false);
});

it('does not show a success banner for permission already granted before launch', async () => {
  read.mockResolvedValue({ status: 'granted' });
  await mount();
  expect(permission.state).toBe('granted');
  expect(success).toBe(false);
});

it('does not wait for push registration to finish before reflecting the grant', async () => {
  await mount();
  request.mockImplementation(async () => {
    read.mockResolvedValue({ status: 'granted' });
    publishNotificationPermission({ status: 'granted' });
    return true;
  });
  register.mockReturnValue(new Promise(() => {}));
  await act(async () => { await permission.request(); });
  expect(permission.state).toBe('granted');
  expect(permission.busy).toBe(false);
  expect(success).toBe(true);
});

it('refreshes permission after returning from system settings', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener');
  read.mockResolvedValue({ status: 'denied', canAskAgain: false });
  await mount();
  read.mockResolvedValue({ status: 'granted' });
  await act(async () => { listener.mock.calls[0][1]('active'); });
  expect(permission.state).toBe('granted');
  expect(success).toBe(true);
});

it('ignores a stale initial read completed after the grant event', async () => {
  let finish!: (value: unknown) => void;
  read.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount();
  act(() => publishNotificationPermission({ status: 'granted' }));
  await act(async () => { finish({ status: 'undetermined' }); });
  expect(permission.state).toBe('granted');
});
