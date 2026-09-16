import { isDeepWorkFocusFilterActive } from './focusMode';

/** Non-deep-work reminder / inbox identifiers muted while Focus filter is on. */
export function focusFilterSuppressesDailyCoreSurfaces(): boolean {
  return isDeepWorkFocusFilterActive();
}

export function isDeepWorkInboxItem(data?: Record<string, unknown>): boolean {
  if (!data) return false;
  const destination = data.destination;
  if (destination === 'deep-work') return true;
  const category = data.categoryId ?? data.category;
  return category === 'kaizen.category.deepWork';
}

export function shouldShowInboxItemWhileFocusActive(data?: Record<string, unknown>): boolean {
  if (!focusFilterSuppressesDailyCoreSurfaces()) return true;
  return isDeepWorkInboxItem(data);
}

export function effectiveUnreadCount(rawCount: number, inbox: Array<{ read: boolean; data?: Record<string, unknown> }>): number {
  if (!focusFilterSuppressesDailyCoreSurfaces()) return rawCount;
  return inbox.filter(item => !item.read && shouldShowInboxItemWhileFocusActive(item.data)).length;
}
