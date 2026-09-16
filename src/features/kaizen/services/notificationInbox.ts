import * as Notifications from 'expo-notifications';

import { focusFilterSuppressesDailyCoreSurfaces } from './focusSurfaces';
import { storageHelpers } from './storage';

export interface KaizenInboxNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  data?: Record<string, unknown>;
}

const INBOX_KEY = 'kaizen.notifications.inbox';
const MAX_ITEMS = 100;

function readInbox(): KaizenInboxNotification[] {
  const raw = storageHelpers.getString(INBOX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as KaizenInboxNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeInbox(items: KaizenInboxNotification[]): void {
  storageHelpers.setString(INBOX_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function listInboxNotifications(): KaizenInboxNotification[] {
  return readInbox().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function unreadInboxCount(): number {
  return readInbox().filter(item => !item.read).length;
}

export function addInboxNotification(input: {
  id?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): KaizenInboxNotification {
  const item: KaizenInboxNotification = {
    id: input.id ?? `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    body: input.body,
    createdAt: new Date().toISOString(),
    read: false,
    data: input.data,
  };
  writeInbox([item, ...readInbox().filter(existing => existing.id !== item.id)]);
  return item;
}

export function markInboxRead(id: string): void {
  writeInbox(readInbox().map(item => (item.id === id ? { ...item, read: true } : item)));
}

export function markAllInboxRead(): void {
  writeInbox(readInbox().map(item => ({ ...item, read: true })));
}

export function clearInbox(): void {
  writeInbox([]);
}

/** Seed inbox from currently scheduled local reminders (for empty-state usefulness). */
export async function syncScheduledIntoInbox(): Promise<KaizenInboxNotification[]> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const kaizen = scheduled.filter(item => item.identifier.startsWith('kaizen-'));
  const existing = new Set(readInbox().map(item => item.id));
  const suppressDailyCore = focusFilterSuppressesDailyCoreSurfaces();

  for (const item of kaizen) {
    if (existing.has(item.identifier)) continue;
    const isDailyCoreNudge =
      item.identifier.startsWith('kaizen-action-') ||
      item.identifier.startsWith('kaizen.nudge.');
    if (suppressDailyCore && isDailyCoreNudge) continue;
    addInboxNotification({
      id: item.identifier,
      title: item.content.title ?? 'Kaizen reminder',
      body: item.content.body ?? '',
      data: (item.content.data as Record<string, unknown>) ?? undefined,
    });
  }
  return listInboxNotifications();
}

let listenerAttached = false;

export function attachNotificationInboxListener(): void {
  if (listenerAttached) return;
  listenerAttached = true;
  Notifications.addNotificationReceivedListener(notification => {
    const content = notification.request.content;
    addInboxNotification({
      id: notification.request.identifier,
      title: content.title ?? 'Kaizen',
      body: content.body ?? '',
      data: (content.data as Record<string, unknown>) ?? undefined,
    });
  });
  Notifications.addNotificationResponseReceivedListener(response => {
    const content = response.notification.request.content;
    addInboxNotification({
      id: response.notification.request.identifier,
      title: content.title ?? 'Kaizen',
      body: content.body ?? '',
      data: (content.data as Record<string, unknown>) ?? undefined,
    });
    markInboxRead(response.notification.request.identifier);
  });
}
