/**
 * Shared household-chat unread refresh. Refreshes an app's chat rooms (with
 * per-room unread counts) into its store so the unread badge reflects activity
 * WITHOUT opening chat first. Called on app foreground and when a chat push
 * arrives. Best-effort: a no-op with no household, and swallows errors (a stale
 * badge beats a crash on a transient blip). The app is selected by its
 * {@link ChatConfig} (its API client + store).
 */
import { useHouseholdStore } from '@stores/householdStore';

import type { ChatConfig } from './ChatConfig';

export async function refreshChatUnread(config: ChatConfig, householdId?: string): Promise<void> {
  const hid = householdId ?? useHouseholdStore.getState().currentHousehold?.id;
  if (!hid) return;
  try {
    const rooms = await config.api.listRooms(hid);
    config.store.getState().setRooms(rooms);
  } catch {
    /* best-effort — leave the last-known badge in place */
  }
}
