/**
 * Shared household-chat store factory. `createChatStore()` builds one in-memory
 * (non-persistent) Zustand store holding an app's chat rooms + messages and
 * driving its unread badge. Each app creates its OWN instance (House, Budget, …)
 * so their data stays isolated; the store SHAPE + actions are shared.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { ChatMessage, ChatRoom } from './types';

interface ChatState {
  rooms: ChatRoom[];
  // roomId → messages (oldest → newest)
  messagesByRoom: Record<string, ChatMessage[]>;
  isLoadingRooms: boolean;
}

interface ChatActions {
  setRooms: (rooms: ChatRoom[]) => void;
  setLoadingRooms: (loading: boolean) => void;
  setMessages: (roomId: string, messages: ChatMessage[]) => void;
  /** Append a message (from the socket or an optimistic send), de-duping by id. */
  appendMessage: (roomId: string, message: ChatMessage) => void;
  /** Replace an existing message in place (edit / soft-delete from socket or REST). */
  updateMessage: (roomId: string, message: ChatMessage) => void;
  /** Prepend older messages fetched via pagination. */
  prependMessages: (roomId: string, older: ChatMessage[]) => void;
  /** Drop an entire room (e.g. an owner deleted it). */
  removeRoom: (roomId: string) => void;
  /** Rename a room in place (from Settings or a `room_renamed` socket event). */
  renameRoom: (roomId: string, name: string) => void;
  /** Purge a room's loaded messages (after an owner cleared history). */
  clearMessages: (roomId: string) => void;
  /** Zero out a room's unread badge locally (after markRead). */
  clearUnread: (roomId: string) => void;
  reset: () => void;
}

export type ChatStoreState = ChatState & ChatActions;

const initialState: ChatState = {
  rooms: [],
  messagesByRoom: {},
  isLoadingRooms: false,
};

export function createChatStore() {
  return create<ChatStoreState>()(
    immer((set) => ({
      ...initialState,

      setRooms: (rooms) =>
        set((state) => {
          state.rooms = rooms;
        }),

      setLoadingRooms: (loading) =>
        set((state) => {
          state.isLoadingRooms = loading;
        }),

      setMessages: (roomId, messages) =>
        set((state) => {
          state.messagesByRoom[roomId] = messages;
        }),

      appendMessage: (roomId, message) =>
        set((state) => {
          const list = state.messagesByRoom[roomId] ?? [];
          if (list.some((m) => m.id === message.id)) return;
          state.messagesByRoom[roomId] = [...list, message];

          // Keep the room list preview + ordering in sync with live activity.
          const room = state.rooms.find((r) => r.id === roomId);
          if (room) {
            room.last_message = message;
            room.updated_at = message.created_at;
          }
        }),

      updateMessage: (roomId, message) =>
        set((state) => {
          const list = state.messagesByRoom[roomId];
          if (!list) return;
          const idx = list.findIndex((m) => m.id === message.id);
          if (idx === -1) return;
          list[idx] = message;

          const room = state.rooms.find((r) => r.id === roomId);
          if (room && room.last_message?.id === message.id) {
            room.last_message = message;
          }
        }),

      prependMessages: (roomId, older) =>
        set((state) => {
          const list = state.messagesByRoom[roomId] ?? [];
          const seen = new Set(list.map((m) => m.id));
          const fresh = older.filter((m) => !seen.has(m.id));
          state.messagesByRoom[roomId] = [...fresh, ...list];
        }),

      removeRoom: (roomId) =>
        set((state) => {
          state.rooms = state.rooms.filter((r) => r.id !== roomId);
          delete state.messagesByRoom[roomId];
        }),

      renameRoom: (roomId, name) =>
        set((state) => {
          const room = state.rooms.find((r) => r.id === roomId);
          if (room) room.name = name;
        }),

      clearMessages: (roomId) =>
        set((state) => {
          state.messagesByRoom[roomId] = [];
          const room = state.rooms.find((r) => r.id === roomId);
          if (room) {
            room.last_message = null;
            room.unread_count = 0;
          }
        }),

      clearUnread: (roomId) =>
        set((state) => {
          const room = state.rooms.find((r) => r.id === roomId);
          if (room) room.unread_count = 0;
        }),

      reset: () => set(() => ({ ...initialState, messagesByRoom: {} })),
    }))
  );
}

export type ChatStoreHook = ReturnType<typeof createChatStore>;

/** Total unread across all of an app's chat rooms — drives its unread badge. */
export const selectTotalUnread = (state: ChatStoreState): number =>
  state.rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0);
