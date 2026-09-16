/**
 * The rooms list, as ONE query every screen shares.
 *
 * The chat tab was the only reader while chat lived in one place. Now a project
 * hub and a material screen also want it — not to list rooms, but to know
 * whether THEIR conversation has anything unread. Three screens issuing three
 * copies of the same request, each writing the same store, is how a badge ends
 * up showing a different number depending on which screen you came from.
 *
 * The key is namespaced by `config.id`. House chat and Budget chat are separate
 * data sets served by separate tables, and keying both on `['chat','rooms',hid]`
 * meant whichever loaded second overwrote the other's cache entry with rooms
 * from a different app.
 */
import { useQuery } from '@tanstack/react-query';

import { useHouseholdStore } from '@stores/householdStore';

import type { ChatConfig } from './ChatConfig';
import type { ChatRoom } from './types';

/** Cache key for one app's rooms list. Exported so callers can invalidate it. */
export function chatRoomsQueryKey(config: ChatConfig, householdId: string | undefined) {
  return ['chat', config.id, 'rooms', householdId] as const;
}

export interface UseChatRoomsResult {
  rooms: ChatRoom[];
  householdId: string | undefined;
  isLoading: boolean;
  isRefetching: boolean;
  refetch: () => void;
}

export function useChatRooms(
  config: ChatConfig,
  options: { enabled?: boolean } = {}
): UseChatRoomsResult {
  const householdId = useHouseholdStore((s) => s.currentHousehold?.id);
  const rooms = config.store((s) => s.rooms);
  const setRooms = config.store((s) => s.setRooms);

  const { isLoading, isRefetching, refetch } = useQuery({
    queryKey: chatRoomsQueryKey(config, householdId),
    enabled: !!householdId && (options.enabled ?? true),
    queryFn: async () => {
      const list = await config.api.listRooms(householdId!);
      setRooms(list);
      return list;
    },
  });

  return { rooms, householdId, isLoading, isRefetching, refetch: () => void refetch() };
}
