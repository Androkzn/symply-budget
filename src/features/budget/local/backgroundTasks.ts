import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { isBudgetLocalFirst } from './flag';

export const BUDGET_BACKGROUND_SYNC_TASK = 'symply-budget.background-sync';
export const BUDGET_BACKGROUND_PUSH_TASK = 'symply-budget.background-push';

export function syncWakeHousehold(payload?: Notifications.NotificationTaskPayload): string | null {
  if (!payload || typeof payload !== 'object') return null;
  let data: Record<string, unknown> | undefined;
  if ('actionIdentifier' in payload) {
    data = payload.notification?.request?.content?.data;
  } else {
    data = payload.data;
    if (typeof data?.dataString === 'string') {
      try { data = JSON.parse(data.dataString); } catch { return null; }
    }
  }
  return data?.type === 'budget_sync_wake' && typeof data.householdId === 'string' && data.householdId.length > 0
    ? data.householdId : null;
}

// Definitions must exist when iOS/Android loads JS without mounting React.
TaskManager.defineTask<Notifications.NotificationTaskPayload>(BUDGET_BACKGROUND_PUSH_TASK, async ({ data, error }) => {
  if (error || !isBudgetLocalFirst()) return Notifications.BackgroundNotificationTaskResult.NoData;
  const householdId = syncWakeHousehold(data);
  if (!householdId) return Notifications.BackgroundNotificationTaskResult.NoData;
  console.log(`[BudgetLocal] background push received t=${Date.now()}`, householdId);
  // Lazy load only when the OS actually runs the task; no UI startup side effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runBudgetBackgroundSync } = require('./backgroundSync') as typeof import('./backgroundSync');
  const outcome = await runBudgetBackgroundSync(householdId);
  return outcome === 'new-data' ? Notifications.BackgroundNotificationTaskResult.NewData
    : outcome === 'failed' ? Notifications.BackgroundNotificationTaskResult.Failed
    : Notifications.BackgroundNotificationTaskResult.NoData;
});

TaskManager.defineTask(BUDGET_BACKGROUND_SYNC_TASK, async ({ error }) => {
  if (error) return BackgroundTask.BackgroundTaskResult.Failed;
  if (!isBudgetLocalFirst()) return BackgroundTask.BackgroundTaskResult.Success;
  console.log('[BudgetLocal] background periodic task received');
  // Lazy load only when the OS actually runs the task; no UI startup side effects.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runBudgetBackgroundSync } = require('./backgroundSync') as typeof import('./backgroundSync');
  return await runBudgetBackgroundSync() === 'failed'
    ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
});

export async function registerBudgetBackgroundTasks(): Promise<void> {
  if (!isBudgetLocalFirst() || !await TaskManager.isAvailableAsync()) return;
  await Notifications.registerTaskAsync(BUDGET_BACKGROUND_PUSH_TASK);
  await BackgroundTask.registerTaskAsync(BUDGET_BACKGROUND_SYNC_TASK, { minimumInterval: 15 });
  console.log('[BudgetLocal] background push and periodic sync registered');
}
