import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { runBudgetBackgroundSync } from '../backgroundSync';
import { BUDGET_BACKGROUND_PUSH_TASK, BUDGET_BACKGROUND_SYNC_TASK, registerBudgetBackgroundTasks, syncWakeHousehold } from '../backgroundTasks';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isAvailableAsync: jest.fn(async () => true) }));
jest.mock('expo-background-task', () => ({ registerTaskAsync: jest.fn(async () => {}), BackgroundTaskResult: { Success: 1, Failed: 2 } }));
jest.mock('expo-notifications', () => ({ registerTaskAsync: jest.fn(async () => {}), BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 } }));
jest.mock('../flag', () => ({ isBudgetLocalFirst: () => true }));
jest.mock('../backgroundSync', () => ({ runBudgetBackgroundSync: jest.fn(async () => 'new-data') }));

it('defines both handlers before any React component mounts and registers both native schedulers', async () => {
  expect(TaskManager.defineTask).toHaveBeenCalledWith(BUDGET_BACKGROUND_PUSH_TASK, expect.any(Function));
  expect(TaskManager.defineTask).toHaveBeenCalledWith(BUDGET_BACKGROUND_SYNC_TASK, expect.any(Function));
  await registerBudgetBackgroundTasks();
  expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(BUDGET_BACKGROUND_PUSH_TASK);
  expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(BUDGET_BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
});

it('extracts iOS and Android opaque sync wakes, rejecting unrelated or malformed pushes', () => {
  expect(syncWakeHousehold({ notification: null, data: { type: 'budget_sync_wake', householdId: 'b' } })).toBe('b');
  expect(syncWakeHousehold({ notification: null, data: { dataString: JSON.stringify({ type: 'budget_sync_wake', householdId: 'b' }) } })).toBe('b');
  expect(syncWakeHousehold({ notification: null, data: { dataString: 'bad json' } })).toBeNull();
  expect(syncWakeHousehold({ notification: null, data: { type: 'house_sync_wake', householdId: 'b' } })).toBeNull();
});

it('awaits synchronization before completing a background notification', async () => {
  const handler = jest.mocked(TaskManager.defineTask).mock.calls.find(([name]) => name === BUDGET_BACKGROUND_PUSH_TASK)![1];
  const result = await handler({ data: { notification: null, data: { type: 'budget_sync_wake', householdId: 'b' } }, error: null, executionInfo: { eventId: 'test', taskName: BUDGET_BACKGROUND_PUSH_TASK } });
  expect(runBudgetBackgroundSync).toHaveBeenCalledWith('b');
  expect(result).toBe(Notifications.BackgroundNotificationTaskResult.NewData);
});
