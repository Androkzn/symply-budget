/**
 * useBudgetChatSocket — unit tests for the Budget chat WebSocket hook. Drives a
 * controllable fake WebSocket (open/message/close/error + send/close) through the
 * full socket lifecycle: connect gating (missing ids / token), the live event
 * pipeline into the store, typing indicator + timeout, ping keep-alive, reconnect
 * backoff, AppState foreground re-connect, sendTyping, and unmount teardown.
 *
 * Conventions mirror the sibling chat suites: react-test-renderer + `act`, plain
 * `mock`-prefixed jest.fn()s referenced lazily inside hoisted mock factories, no
 * @testing-library/react-native.
 */
const mockAppendMessage = jest.fn();
const mockUpdateMessage = jest.fn();
const mockRemoveRoom = jest.fn();
const mockRenameRoom = jest.fn();
const mockClearMessages = jest.fn();
let mockToken: string | null = 'tok-123';
const mockCurrentUserId = 'me-1';

// Deterministic API base so the derived wss:// URL is assertable.
jest.mock('@config/env', () => ({ ENV: { API_BASE_URL: 'https://api.example.test' } }));

// Auth token source — read lazily via getState() at connect time.
jest.mock('@stores/authStore', () => ({
  useAuthStore: { getState: () => ({ token: mockToken, user: { id: mockCurrentUserId } }) },
}));

import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

import type { ChatConfig } from '../ChatConfig';
import { useChatSocket } from '../useChatSocket';

// The hook pulls store actions from config.store via selectors; a minimal config
// bound to the Budget route segment drives this suite (the WS path assertions
// expect `budget-chat-rooms`).
const storeState = {
  appendMessage: (...a: unknown[]) => mockAppendMessage(...a),
  updateMessage: (...a: unknown[]) => mockUpdateMessage(...a),
  removeRoom: (...a: unknown[]) => mockRemoveRoom(...a),
  renameRoom: (...a: unknown[]) => mockRenameRoom(...a),
  clearMessages: (...a: unknown[]) => mockClearMessages(...a),
};
const testConfig = {
  routeSegment: 'budget-chat-rooms',
  socketLabel: 'budget-chat',
  store: (selector: (s: typeof storeState) => unknown) => selector(storeState),
} as unknown as ChatConfig;

// ---- Controllable fake WebSocket -------------------------------------------

type WsEvent = { data: unknown };

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static throwOnConstruct = false;

  url = '';
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((evt: WsEvent) => void) | null = null;
  onclose: ((evt: { code: number }) => void) | null = null;
  onerror: ((err?: unknown) => void) | null = null;
  sent: string[] = [];
  throwOnSend = false;
  throwOnClose = false;
  closeCount = 0;

  constructor(url: string) {
    if (MockWebSocket.throwOnConstruct) throw new Error('construct failed');
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.throwOnSend) throw new Error('send failed');
    this.sent.push(data);
  }

  close() {
    this.closeCount += 1;
    if (this.throwOnClose) throw new Error('close failed');
    this.readyState = MockWebSocket.CLOSED;
  }
}

function lastWs(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

// ---- Hook harness -----------------------------------------------------------

let hookResult: ReturnType<typeof useChatSocket>;

function Harness({ householdId, roomId }: { householdId?: string; roomId?: string }) {
  hookResult = useChatSocket(testConfig, householdId, roomId);
  return null;
}

let tree: ReactTestRenderer.ReactTestRenderer;

function renderHook(householdId?: string, roomId?: string) {
  act(() => {
    tree = ReactTestRenderer.create(React.createElement(Harness, { householdId, roomId }));
  });
}

function rerender(householdId?: string, roomId?: string) {
  act(() => {
    tree.update(React.createElement(Harness, { householdId, roomId }));
  });
}

// Fire socket events inside act() so hook state settles synchronously.
function fireOpen(ws = lastWs()) {
  act(() => {
    ws.readyState = MockWebSocket.OPEN;
    ws.onopen?.();
  });
}

function fireClose(ws = lastWs(), code = 1006) {
  act(() => {
    ws.readyState = MockWebSocket.CLOSED;
    ws.onclose?.({ code });
  });
}

function fireMessage(payload: unknown, ws = lastWs()) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  act(() => {
    ws.onmessage?.({ data });
  });
}

function fireRawMessage(data: unknown, ws = lastWs()) {
  act(() => {
    ws.onmessage?.({ data });
  });
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

// ---- AppState capture -------------------------------------------------------

let appStateHandler: ((s: string) => void) | undefined;
let appStateRemove: jest.Mock;
let addEventListenerSpy: jest.SpyInstance;
let originalWebSocket: unknown;

beforeAll(() => {
  originalWebSocket = (global as { WebSocket?: unknown }).WebSocket;
});

afterAll(() => {
  (global as { WebSocket?: unknown }).WebSocket = originalWebSocket;
});

beforeEach(() => {
  jest.useFakeTimers();
  mockAppendMessage.mockReset();
  mockUpdateMessage.mockReset();
  mockRemoveRoom.mockReset();
  mockRenameRoom.mockReset();
  mockClearMessages.mockReset();
  mockToken = 'tok-123';

  MockWebSocket.instances = [];
  MockWebSocket.throwOnConstruct = false;
  (global as { WebSocket?: unknown }).WebSocket = MockWebSocket;

  appStateHandler = undefined;
  appStateRemove = jest.fn();
  addEventListenerSpy = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation(((_type: string, handler: (s: string) => void) => {
      appStateHandler = handler;
      return { remove: appStateRemove };
    }) as never);
});

afterEach(() => {
  act(() => tree?.unmount());
  addEventListenerSpy.mockRestore();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ---- Connect gating ---------------------------------------------------------

describe('connect gating', () => {
  it('does nothing when householdId is missing (no socket, no AppState listener)', () => {
    renderHook(undefined, 'r1');
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(addEventListenerSpy).not.toHaveBeenCalled();
    expect(hookResult.status).toBe('connecting');
  });

  it('does nothing when roomId is missing', () => {
    renderHook('hh1', undefined);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(hookResult.status).toBe('connecting');
  });

  it('goes straight to closed and opens no socket when there is no token', () => {
    mockToken = null;
    renderHook('hh1', 'r1');
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(hookResult.status).toBe('closed');
    // AppState listener is still registered before the token check.
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
  });

  it('opens a socket at the token-authenticated wss URL', () => {
    renderHook('hh1', 'r1');
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(lastWs().url).toBe(
      'wss://api.example.test/households/hh1/budget-chat-rooms/r1/ws?token=tok-123',
    );
    expect(hookResult.status).toBe('connecting');
  });
});

// ---- Open + ping keep-alive -------------------------------------------------

describe('open + ping', () => {
  it('flips to open and sends a ping every 25s', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    expect(hookResult.status).toBe('open');

    advance(25_000);
    expect(lastWs().sent).toContain('{"type":"ping"}');
    advance(25_000);
    expect(lastWs().sent.filter((m) => m === '{"type":"ping"}')).toHaveLength(2);
  });

  it('swallows a throwing ping send', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    lastWs().throwOnSend = true;
    expect(() => advance(25_000)).not.toThrow();
    expect(lastWs().sent).toHaveLength(0);
  });

  it('clears a prior ping interval when re-opening the same socket', () => {
    renderHook('hh1', 'r1');
    const ws = lastWs();
    fireOpen(ws);
    // Re-fire onopen (simulates a second open) — the old interval is cleared so
    // pings do not double up.
    fireOpen(ws);
    advance(25_000);
    expect(ws.sent.filter((m) => m === '{"type":"ping"}')).toHaveLength(1);
  });
});

// ---- Incoming message pipeline ----------------------------------------------

describe('incoming events', () => {
  it('appends a new message and clears any pending typing indicator', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing' });
    expect(hookResult.isPeerTyping).toBe(true);

    const message = { id: 'm1', room_id: 'r1', body: 'hi' };
    fireMessage({ type: 'message', message });
    expect(mockAppendMessage).toHaveBeenCalledWith('r1', expect.objectContaining({ id: 'm1' }));
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('routes message_updated and message_deleted through updateMessage', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'message_updated', message: { id: 'm1', room_id: 'r1', body: 'edited' } });
    fireMessage({ type: 'message_deleted', message: { id: 'm1', room_id: 'r1', deleted_at: 'x' } });
    expect(mockUpdateMessage).toHaveBeenCalledTimes(2);
    expect(mockUpdateMessage).toHaveBeenLastCalledWith('r1', expect.objectContaining({ deleted_at: 'x' }));
  });

  it('removes a room on room_deleted', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    fireMessage({ type: 'room_deleted', roomId: 'r1' });
    expect(mockRemoveRoom).toHaveBeenCalledWith('r1');
  });

  it('renames a room on room_renamed', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    fireMessage({ type: 'room_renamed', roomId: 'r1', name: 'Renamed' });
    expect(mockRenameRoom).toHaveBeenCalledWith('r1', 'Renamed');
  });

  it('clears a room’s messages on history_cleared', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    fireMessage({ type: 'history_cleared', roomId: 'r1' });
    expect(mockClearMessages).toHaveBeenCalledWith('r1');
  });

  it('sets and auto-clears the typing indicator after 4s', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing' });
    expect(hookResult.isPeerTyping).toBe(true);
    // A second typing event resets the pending clear timer.
    fireMessage({ type: 'typing' });
    expect(hookResult.isPeerTyping).toBe(true);

    advance(4_000);
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('surfaces a peer typing event but ignores our own echoed back', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    // Our own typing echoed over a second connection must not show the banner.
    fireMessage({ type: 'typing', userId: mockCurrentUserId });
    expect(hookResult.isPeerTyping).toBe(false);

    // A different member typing does surface the indicator, named.
    fireMessage({ type: 'typing', userId: 'peer-2' });
    expect(hookResult.isPeerTyping).toBe(true);
    expect(hookResult.typingActor).toBe('member');
    expect(hookResult.typingUserId).toBe('peer-2');
  });

  it('reports the assistant as the typing actor, not a nameless peer', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing', sender: 'ai' });
    expect(hookResult.typingActor).toBe('ai');
    expect(hookResult.typingUserId).toBeNull();
  });

  it('holds the assistant indicator past the member timeout', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing', sender: 'ai' });
    // The reply can be a long chain of tool calls away — the 4s member timeout
    // would blank the indicator while the model is still working.
    advance(4_000);
    expect(hookResult.isPeerTyping).toBe(true);

    advance(90_000);
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('keeps the assistant indicator through a member’s typing and message', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing', sender: 'ai' });
    // A peer tapping away must not relabel the assistant — nor shorten it to
    // the member timeout.
    fireMessage({ type: 'typing', userId: 'peer-2' });
    expect(hookResult.typingActor).toBe('ai');
    advance(4_000);
    expect(hookResult.typingActor).toBe('ai');

    // Nor does a member's message: the assistant is still writing the reply
    // that message may itself have asked for.
    fireMessage({ type: 'message', message: { id: 'm9', room_id: 'r1', sender_type: 'user' } });
    expect(hookResult.typingActor).toBe('ai');

    // Its own reply is what ends it.
    fireMessage({ type: 'message', message: { id: 'm10', room_id: 'r1', sender_type: 'ai' } });
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('drops the assistant indicator when the reply is an error notice', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage({ type: 'typing', sender: 'ai' });
    // Every terminal server path posts an AI message — including the failure
    // notices — so the indicator never outlives a failed generation.
    fireMessage({
      type: 'message',
      message: { id: 'm11', room_id: 'r1', sender_type: 'ai', metadata: { notice: true } },
    });
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('ignores unparseable, empty-object, null, and unmatched events', () => {
    renderHook('hh1', 'r1');
    fireOpen();

    fireMessage('not-json'); // JSON.parse throws → caught
    fireRawMessage({ some: 'object' }); // non-string data → JSON.parse('') throws
    fireMessage('null'); // parses to null → guarded out
    fireMessage({ type: 'pong' }); // known type, no side effect
    fireMessage({ type: 'message' }); // missing message payload
    fireMessage({ type: 'message_updated' }); // missing message payload
    fireMessage({ type: 'room_deleted' }); // missing roomId

    expect(mockAppendMessage).not.toHaveBeenCalled();
    expect(mockUpdateMessage).not.toHaveBeenCalled();
    expect(mockRemoveRoom).not.toHaveBeenCalled();
    expect(hookResult.isPeerTyping).toBe(false);
  });

  it('has an inert onerror handler', () => {
    renderHook('hh1', 'r1');
    expect(() => act(() => lastWs().onerror?.(new Error('boom')))).not.toThrow();
  });
});

// ---- Reconnect --------------------------------------------------------------

describe('reconnect', () => {
  it('reconnects with backoff after an unexpected close', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    fireClose();
    expect(hookResult.status).toBe('closed');

    // First backoff is 1000ms.
    advance(999);
    expect(MockWebSocket.instances).toHaveLength(1);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(2);

    // Second close → backoff doubled to 2000ms.
    fireClose();
    advance(1_999);
    expect(MockWebSocket.instances).toHaveLength(2);
    advance(1);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('reschedules (clearing the prior timer) when close fires twice before the timer', () => {
    renderHook('hh1', 'r1');
    const ws = lastWs();
    fireOpen(ws);
    fireClose(ws); // schedules reconnect (delay 1000, backoff → 2000)
    fireClose(ws); // reschedules — clears the pending timer, new delay 2000
    // The first (cleared) 1000ms timer must NOT fire a reconnect...
    advance(1_000);
    expect(MockWebSocket.instances).toHaveLength(1);
    // ...only the rescheduled 2000ms timer does, exactly once.
    advance(1_000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('schedules a reconnect when the WebSocket constructor throws', () => {
    MockWebSocket.throwOnConstruct = true;
    renderHook('hh1', 'r1');
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(hookResult.status).toBe('connecting');

    MockWebSocket.throwOnConstruct = false;
    advance(1_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

// ---- AppState foreground reconnect -----------------------------------------

describe('AppState foreground reconnect', () => {
  it('reconnects when returning to active with a closed socket', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    // Mark the socket closed WITHOUT firing onclose (so no reconnect is scheduled).
    lastWs().readyState = MockWebSocket.CLOSED;

    act(() => appStateHandler?.('active'));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects when active with a socket in the CLOSING state', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    lastWs().readyState = MockWebSocket.CLOSING;
    act(() => appStateHandler?.('active'));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect when active with a healthy open socket', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    act(() => appStateHandler?.('active'));
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('ignores non-active app states', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    act(() => appStateHandler?.('background'));
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reconnects when active with no socket yet (token became available)', () => {
    mockToken = null;
    renderHook('hh1', 'r1');
    expect(MockWebSocket.instances).toHaveLength(0);

    mockToken = 'tok-123';
    act(() => appStateHandler?.('active'));
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});

// ---- sendTyping -------------------------------------------------------------

describe('sendTyping', () => {
  it('sends a typing frame when the socket is open', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    act(() => hookResult.sendTyping());
    expect(lastWs().sent).toContain('{"type":"typing"}');
  });

  it('is a no-op when the socket is not open', () => {
    renderHook('hh1', 'r1'); // still CONNECTING
    act(() => hookResult.sendTyping());
    expect(lastWs().sent).toHaveLength(0);
  });

  it('swallows a throwing send', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    lastWs().throwOnSend = true;
    expect(() => act(() => hookResult.sendTyping())).not.toThrow();
  });
});

// ---- Teardown ---------------------------------------------------------------

describe('teardown', () => {
  it('clears timers, removes the AppState listener, and closes the socket on unmount', () => {
    renderHook('hh1', 'r1');
    fireOpen(); // sets the ping interval
    fireMessage({ type: 'typing' }); // sets the typing-clear timer
    fireClose(); // schedules a reconnect timer
    const ws = lastWs();

    act(() => tree.unmount());
    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(ws.closeCount).toBe(1);

    // No reconnect fires after unmount (closedByUs guard).
    advance(60_000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('swallows a throwing close during teardown', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    lastWs().throwOnClose = true;
    expect(() => act(() => tree.unmount())).not.toThrow();
  });

  it('unmounts cleanly when no socket was ever opened (no token)', () => {
    mockToken = null;
    renderHook('hh1', 'r1');
    expect(() => act(() => tree.unmount())).not.toThrow();
    expect(appStateRemove).toHaveBeenCalledTimes(1);
  });

  it('tears down the old socket and reconnects when the room changes', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    const first = lastWs();

    rerender('hh1', 'r2');
    expect(first.closeCount).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(lastWs().url).toContain('/budget-chat-rooms/r2/ws');
  });

  it('tears down and opens nothing when the room becomes undefined', () => {
    renderHook('hh1', 'r1');
    fireOpen();
    const first = lastWs();
    rerender('hh1', undefined);
    expect(first.closeCount).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
