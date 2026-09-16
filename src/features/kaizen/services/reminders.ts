import * as Notifications from 'expo-notifications';

import { notificationService } from '@services/notifications';

import type { KaizenActionEntry, KaizenActionLogEntry } from '../types';

import {
  parseReminderPolicy,
  type ActionReminderPolicy,
  WAKE_RESPONSIVE_REQUIRED,
} from './reminderPolicy';
import { storageHelpers } from './storage';

/**
 * Local notification-payload shape (donor `@services/notifications` exported this; the
 * ecosystem's shared notification service does not, so it is defined feature-locally).
 * The shared `notificationService.cancelNotification` is API-compatible and reused as-is.
 */
interface KaizenNotificationData {
  destination?: string;
  type?: string;
  [key: string]: unknown;
}

const REQUEST_PREFIX = 'kaizen.nudge.';
const PENDING_KEY = 'kaizen.reminders.pending';

export const CATEGORY_WAKE = 'kaizen.category.wakeResponsive';
export const CATEGORY_ACTION = 'kaizen.category.action';
export const ACTION_DONE = 'kaizen.action.done';
export const ACTION_SKIP = 'kaizen.action.skip';
export const ACTION_SNOOZE_PREFIX = 'kaizen.action.snooze.';

const TIME_OF_DAY_HOUR: Record<string, number> = {
  morning: 8,
  midday: 12,
  afternoon: 15,
  evening: 19,
  anytime: 10,
};

export interface ScheduleDailyCoreOptions {
  wakeAnchor?: Date;
  autoCompletedActionIds?: Set<string>;
  completedOrSkippedActionIds?: Set<string>;
  focusFilterActive?: boolean;
}

function readPending(): Record<string, string[]> {
  try {
    return JSON.parse(storageHelpers.getString(PENDING_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
}

function writePending(map: Record<string, string[]>): void {
  storageHelpers.setString(PENDING_KEY, JSON.stringify(map));
}

export function actionIdFromRequestId(requestId: string): string | null {
  if (!requestId.startsWith(REQUEST_PREFIX)) return null;
  const parts = requestId.slice(REQUEST_PREFIX.length).split('.');
  // `split` always yields at least one element, so `parts[0]` is always a string.
  return parts[0];
}

export function snoozeMinutesFromActionId(identifier: string): number | null {
  if (!identifier.startsWith(ACTION_SNOOZE_PREFIX)) return null;
  const minutes = Number(identifier.slice(ACTION_SNOOZE_PREFIX.length));
  return Number.isFinite(minutes) ? minutes : null;
}

/** Register Done / Snooze / Skip categories (idempotent). */
export async function registerKaizenNotificationCategories(
  snoozeOptionsMinutes: number[] = WAKE_RESPONSIVE_REQUIRED.snoozeOptionsMinutes,
): Promise<void> {
  const snoozeActions = snoozeOptionsMinutes.map(minutes => ({
    identifier: `${ACTION_SNOOZE_PREFIX}${minutes}`,
    buttonTitle: `Snooze ${minutes} min`,
    options: { opensAppToForeground: false },
  }));

  await Notifications.setNotificationCategoryAsync(CATEGORY_WAKE, [
    { identifier: ACTION_DONE, buttonTitle: 'Done', options: { opensAppToForeground: true } },
    ...snoozeActions,
    { identifier: ACTION_SKIP, buttonTitle: 'Skip today', options: { opensAppToForeground: true } },
  ]);

  await Notifications.setNotificationCategoryAsync(CATEGORY_ACTION, [
    { identifier: ACTION_DONE, buttonTitle: 'Done', options: { opensAppToForeground: true } },
    { identifier: ACTION_SKIP, buttonTitle: 'Skip today', options: { opensAppToForeground: true } },
  ]);
}

function nudgeBody(action: KaizenActionEntry): string {
  return action.output_description ?? 'Tap to log this when you are ready.';
}

function dayEpoch(date: Date): number {
  const key = date.toISOString().slice(0, 10);
  return Math.floor(new Date(`${key}T00:00:00`).getTime() / 1000);
}

async function cancelRemindersForAction(actionId: string): Promise<void> {
  const pending = readPending();
  const ids = pending[actionId] ?? [];
  await Promise.all(ids.map(id => notificationService.cancelNotification(id)));
  delete pending[actionId];
  writePending(pending);
}

async function scheduleTimeOfDayFallback(
  action: KaizenActionEntry,
): Promise<void> {
  const hour = TIME_OF_DAY_HOUR[(action.time_of_day || 'anytime').toLowerCase()] ?? 10;
  const requestId = `kaizen-action-${action.id}`;
  await Notifications.scheduleNotificationAsync({
    identifier: requestId,
    content: {
      title: action.title,
      body: nudgeBody(action),
      categoryIdentifier: CATEGORY_ACTION,
      data: {
        destination: 'today',
        type: 'daily_core',
        actionId: action.id,
      } satisfies KaizenNotificationData,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
    },
  });
  writePending({ ...readPending(), [action.id]: [requestId] });
}

async function schedulePolicyNudges(
  action: KaizenActionEntry,
  policy: ActionReminderPolicy,
  wakeAnchor: Date,
  date: Date,
): Promise<void> {
  await cancelRemindersForAction(action.id);
  const epoch = dayEpoch(date);
  const requestIds: string[] = [];
  const totalNudges = Math.max(1, policy.maxNudges);

  for (let index = 0; index < totalNudges; index += 1) {
    let offsetMinutes: number;
    if (index === 0) {
      offsetMinutes = policy.initialDelayMinutes;
    } else if (policy.repeatEveryMinutes) {
      offsetMinutes = policy.initialDelayMinutes + policy.repeatEveryMinutes * index;
    } else {
      break;
    }

    const fireDate = new Date(wakeAnchor.getTime() + offsetMinutes * 60_000);
    if (policy.quietAfterHour != null && fireDate.getHours() >= policy.quietAfterHour) {
      break;
    }
    if (fireDate <= new Date()) continue;

    const requestId = `${REQUEST_PREFIX}${action.id}.${epoch}.${index}`;
    const categoryId =
      action.reminder_anchor === 'wakeResponsive' ? CATEGORY_WAKE : CATEGORY_ACTION;

    await Notifications.scheduleNotificationAsync({
      identifier: requestId,
      content: {
        title: action.title,
        body: nudgeBody(action),
        categoryIdentifier: categoryId,
        data: {
          destination: 'today',
          type: 'daily_core',
          actionId: action.id,
        } satisfies KaizenNotificationData,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireDate,
      },
    });
    requestIds.push(requestId);
  }

  if (requestIds.length) {
    writePending({ ...readPending(), [action.id]: requestIds });
  } else if (policy.anchor === 'timeOfDay') {
    await scheduleTimeOfDayFallback(action);
  }
}

/**
 * Policy-aware reminder orchestration — port of `KaizenReminderOrchestrationService`.
 */
export async function scheduleDailyCoreReminders(
  actions: KaizenActionEntry[],
  options: ScheduleDailyCoreOptions = {},
): Promise<void> {
  await registerKaizenNotificationCategories();
  const wakeAnchor = options.wakeAnchor ?? new Date();
  const autoDone = options.autoCompletedActionIds ?? new Set<string>();
  const doneOrSkipped = options.completedOrSkippedActionIds ?? new Set<string>();
  const today = new Date();

  // Cancel legacy daily identifiers
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    existing
      .filter(
        item =>
          item.identifier.startsWith('kaizen-action-') ||
          item.identifier.startsWith(REQUEST_PREFIX),
      )
      .map(item => notificationService.cancelNotification(item.identifier)),
  );
  writePending({});

  if (options.focusFilterActive) {
    return;
  }

  for (const action of actions) {
    if (!action.is_daily_core || action.is_archived) continue;
    const isDone =
      doneOrSkipped.has(action.id) || autoDone.has(action.id);
    if (isDone) {
      await cancelRemindersForAction(action.id);
      continue;
    }

    const policy = parseReminderPolicy(action.reminder_anchor, action.reminder_policy);
    if (!policy || policy.maxNudges === 0) {
      if (action.reminder_anchor === 'timeOfDay' || action.time_of_day) {
        await scheduleTimeOfDayFallback(action);
      }
      continue;
    }

    await schedulePolicyNudges(action, policy, wakeAnchor, today);
  }
}

export async function snoozeActionReminder(
  action: KaizenActionEntry,
  minutes: number,
  date: Date = new Date(),
): Promise<void> {
  const clamped = Math.max(1, Math.min(minutes, 720));
  const fireDate = new Date(Date.now() + clamped * 60_000);
  const epoch = dayEpoch(date);
  const requestId = `${REQUEST_PREFIX}${action.id}.${epoch}.snooze.${Math.floor(Date.now() / 1000)}`;
  const categoryId =
    action.reminder_anchor === 'wakeResponsive' ? CATEGORY_WAKE : CATEGORY_ACTION;

  await Notifications.scheduleNotificationAsync({
    identifier: requestId,
    content: {
      title: action.title,
      body: nudgeBody(action),
      categoryIdentifier: categoryId,
      data: { destination: 'today', type: 'daily_core', actionId: action.id },
      sound: true,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
  });

  const pending = readPending();
  pending[action.id] = [...(pending[action.id] ?? []), requestId];
  writePending(pending);
}

export async function cancelAllKaizenReminders(): Promise<void> {
  const pending = readPending();
  const allIds = Object.values(pending).flat();
  await Promise.all(allIds.map(id => notificationService.cancelNotification(id)));
  writePending({});
}

export function completedActionIdsFromLogs(logs: KaizenActionLogEntry[]): Set<string> {
  const today = new Date().toISOString().slice(0, 10);
  const ids = new Set<string>();
  for (const log of logs) {
    if (log.date === today && (log.completed_at || log.skipped)) {
      ids.add(log.action_id);
    }
  }
  return ids;
}
