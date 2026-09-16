/**
 * budgetChatStore — unit tests for the Budget chat Zustand store (a
 * 100%-independent fork of chatStore). Pure store logic — no rendering, no
 * native modules. Also covers the floating-chat unread selector.
 */

import { createChatStore, selectTotalUnread } from '../createChatStore';
import type { ChatMessage, ChatRoom } from '../types';

// A single shared-factory store instance drives this suite (reset per test).
const useBudgetChatStore = createChatStore();
const selectBudgetTotalUnread = selectTotalUnread;

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    room_id: 'r1',
    sender_type: 'user',
    sender_user_id: 'u1',
    sender_name: 'Adam',
    body: 'hello',
    attachments: null,
    mentions: null,
    reply_to: null,
    metadata: null,
    edited_at: null,
    deleted_at: null,
    created_at: '2026-07-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: 'r1',
    name: 'General',
    ai_enabled: true,
    is_default: true,
    is_assistant: false,
    restricted: false,
    created_by: 'u1',
    created_at: '2026-07-09T00:00:00.000Z',
    updated_at: '2026-07-09T00:00:00.000Z',
    last_message: null,
    unread_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  useBudgetChatStore.getState().reset();
});

describe('appendMessage', () => {
  it('appends a message and de-dupes by id', () => {
    const store = useBudgetChatStore.getState();
    const msg = makeMessage();
    store.appendMessage('r1', msg);
    store.appendMessage('r1', msg); // duplicate — ignored
    expect(useBudgetChatStore.getState().messagesByRoom.r1).toHaveLength(1);
  });

  it('updates the room preview + ordering to the latest message', () => {
    useBudgetChatStore.getState().setRooms([makeRoom()]);
    const msg = makeMessage({ id: 'm2', body: 'newest', created_at: '2026-07-09T01:00:00.000Z' });
    useBudgetChatStore.getState().appendMessage('r1', msg);
    const room = useBudgetChatStore.getState().rooms.find((r) => r.id === 'r1');
    expect(room?.last_message?.id).toBe('m2');
    expect(room?.updated_at).toBe('2026-07-09T01:00:00.000Z');
  });
});

describe('updateMessage', () => {
  it('replaces a message in place (edit)', () => {
    const store = useBudgetChatStore.getState();
    store.appendMessage('r1', makeMessage());
    store.updateMessage('r1', makeMessage({ body: 'edited', edited_at: '2026-07-09T02:00:00.000Z' }));
    const list = useBudgetChatStore.getState().messagesByRoom.r1;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('edited');
    expect(list[0].edited_at).toBe('2026-07-09T02:00:00.000Z');
  });

  it('reflects a soft-delete in place', () => {
    const store = useBudgetChatStore.getState();
    store.appendMessage('r1', makeMessage());
    store.updateMessage('r1', makeMessage({ body: '', deleted_at: '2026-07-09T02:00:00.000Z' }));
    const list = useBudgetChatStore.getState().messagesByRoom.r1;
    expect(list[0].deleted_at).toBeTruthy();
    expect(list[0].body).toBe('');
  });

  it('is a no-op when the message is not present', () => {
    const store = useBudgetChatStore.getState();
    store.appendMessage('r1', makeMessage());
    store.updateMessage('r1', makeMessage({ id: 'does-not-exist', body: 'ghost' }));
    const list = useBudgetChatStore.getState().messagesByRoom.r1;
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe('hello');
  });

  it('is a no-op when the room has no cached messages at all', () => {
    useBudgetChatStore.getState().updateMessage('never-loaded', makeMessage());
    expect(useBudgetChatStore.getState().messagesByRoom['never-loaded']).toBeUndefined();
  });
});

describe('removeRoom', () => {
  it('drops the room and its cached messages', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom({ id: 'r1' }), makeRoom({ id: 'r2', is_default: false })]);
    store.appendMessage('r1', makeMessage());
    store.removeRoom('r1');
    const state = useBudgetChatStore.getState();
    expect(state.rooms.find((r) => r.id === 'r1')).toBeUndefined();
    expect(state.rooms.find((r) => r.id === 'r2')).toBeDefined();
    expect(state.messagesByRoom.r1).toBeUndefined();
  });
});

describe('renameRoom', () => {
  it('renames the room in place', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom({ id: 'r1', name: 'General' })]);
    store.renameRoom('r1', 'Grocery split');
    expect(useBudgetChatStore.getState().rooms.find((r) => r.id === 'r1')?.name).toBe(
      'Grocery split'
    );
  });

  it('is a no-op for an unknown room', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom({ id: 'r1' })]);
    store.renameRoom('nope', 'X');
    expect(useBudgetChatStore.getState().rooms.find((r) => r.id === 'r1')?.name).toBe('General');
  });
});

describe('clearMessages', () => {
  it('purges a room’s messages and resets its preview + unread', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom({ id: 'r1', unread_count: 3 })]);
    store.appendMessage('r1', makeMessage());
    store.appendMessage('r1', makeMessage({ id: 'm2' }));
    store.clearMessages('r1');
    const state = useBudgetChatStore.getState();
    expect(state.messagesByRoom.r1).toHaveLength(0);
    const room = state.rooms.find((r) => r.id === 'r1');
    expect(room?.last_message).toBeNull();
    expect(room?.unread_count).toBe(0);
  });
});

describe('selectBudgetTotalUnread', () => {
  it('sums unread counts across rooms (drives the floating-chat badge)', () => {
    useBudgetChatStore.getState().setRooms([
      makeRoom({ id: 'r1', unread_count: 2 }),
      makeRoom({ id: 'r2', is_default: false, unread_count: 3 }),
    ]);
    expect(selectBudgetTotalUnread(useBudgetChatStore.getState())).toBe(5);
  });

  it('clears a room’s unread locally', () => {
    useBudgetChatStore.getState().setRooms([makeRoom({ id: 'r1', unread_count: 4 })]);
    useBudgetChatStore.getState().clearUnread('r1');
    expect(selectBudgetTotalUnread(useBudgetChatStore.getState())).toBe(0);
  });

  it('clearUnread is a no-op for an unknown room', () => {
    useBudgetChatStore.getState().setRooms([makeRoom({ id: 'r1', unread_count: 4 })]);
    useBudgetChatStore.getState().clearUnread('nope');
    expect(selectBudgetTotalUnread(useBudgetChatStore.getState())).toBe(4);
  });
});

describe('setLoadingRooms / setMessages', () => {
  it('toggles the rooms-loading flag', () => {
    useBudgetChatStore.getState().setLoadingRooms(true);
    expect(useBudgetChatStore.getState().isLoadingRooms).toBe(true);
    useBudgetChatStore.getState().setLoadingRooms(false);
    expect(useBudgetChatStore.getState().isLoadingRooms).toBe(false);
  });

  it('replaces a room’s message list wholesale', () => {
    const msgs = [makeMessage({ id: 'm1' }), makeMessage({ id: 'm2' })];
    useBudgetChatStore.getState().setMessages('r1', msgs);
    expect(useBudgetChatStore.getState().messagesByRoom.r1).toHaveLength(2);
    useBudgetChatStore.getState().setMessages('r1', []);
    expect(useBudgetChatStore.getState().messagesByRoom.r1).toEqual([]);
  });
});

describe('prependMessages', () => {
  it('prepends older messages ahead of the current list, de-duping by id', () => {
    const store = useBudgetChatStore.getState();
    store.setMessages('r1', [makeMessage({ id: 'm3' })]);
    store.prependMessages('r1', [
      makeMessage({ id: 'm1' }),
      makeMessage({ id: 'm2' }),
      makeMessage({ id: 'm3' }), // already present — dropped
    ]);
    const ids = useBudgetChatStore.getState().messagesByRoom.r1.map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3']);
  });

  it('seeds an empty room from pagination', () => {
    useBudgetChatStore.getState().prependMessages('r9', [makeMessage({ id: 'm1' })]);
    expect(useBudgetChatStore.getState().messagesByRoom.r9).toHaveLength(1);
  });
});

describe('updateMessage — room preview', () => {
  it('refreshes the room last_message when the edited message is the latest', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom()]);
    store.appendMessage('r1', makeMessage({ id: 'm5', body: 'orig', created_at: '2026-07-09T03:00:00.000Z' }));
    store.updateMessage(
      'r1',
      makeMessage({ id: 'm5', body: 'edited-preview', created_at: '2026-07-09T03:00:00.000Z' }),
    );
    const room = useBudgetChatStore.getState().rooms.find((r) => r.id === 'r1');
    expect(room?.last_message?.body).toBe('edited-preview');
  });
});

describe('reset', () => {
  it('returns the store to its initial empty state', () => {
    const store = useBudgetChatStore.getState();
    store.setRooms([makeRoom({ unread_count: 3 })]);
    store.appendMessage('r1', makeMessage());
    store.setLoadingRooms(true);
    store.reset();
    const state = useBudgetChatStore.getState();
    expect(state.rooms).toEqual([]);
    expect(state.messagesByRoom).toEqual({});
    expect(state.isLoadingRooms).toBe(false);
  });
});
