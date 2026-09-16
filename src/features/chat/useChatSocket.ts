/**
 * Shared household-chat WebSocket hook. Opens a read-only live feed to a chat
 * room over the stateless ChatRoomDO (keyed by room id) at
 * `/households/:hid/<routeSegment>/:roomId/ws`, and pipes events into the app's
 * chat store. Both the route segment and the target store come from the
 * {@link ChatConfig}, so one hook serves every app. Sending still goes over REST.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { ENV } from '@config/env';
import {
  e2eLogChatWsClose,
  e2eLogChatWsConnect,
  e2eLogChatWsError,
  e2eLogChatWsMessage,
  e2eLogChatWsOpen,
  e2eLogChatWsSend,
} from '@hooks/e2eChatSocketObservability';
import { useAuthStore } from '@stores/authStore';

import type { ChatConfig } from './ChatConfig';
import {
  chatMessageMutatedBudget,
  refreshBudgetAfterChatMutation,
} from './refreshBudgetAfterChatMutation';
import type { ChatMessage } from './types';

type SocketStatus = 'connecting' | 'open' | 'closed';

interface ServerEvent {
  type:
    | 'message'
    | 'message_updated'
    | 'message_deleted'
    | 'room_deleted'
    | 'room_renamed'
    | 'history_cleared'
    | 'typing'
    | 'pong';
  message?: ChatMessage;
  roomId?: string;
  name?: string;
  sender?: string;
  userId?: string;
}

/**
 * WHO the live typing indicator is about. The server sends two different things
 * under one `typing` frame — the ChatRoomDO relays a member's keystrokes
 * (`userId`), and the chat service fires one when the assistant starts
 * generating (`sender: 'ai'`) — and the screen has to label them differently.
 */
export type TypingActor = 'ai' | 'member';

interface TypingState {
  actor: TypingActor;
  /** The typing member's id when the server named them; null for the assistant. */
  userId: string | null;
}

interface UseChatSocketResult {
  status: SocketStatus;
  /** True briefly after the assistant/another member emits a typing event. */
  isPeerTyping: boolean;
  /** Whether the indicator is the assistant thinking or a member typing. */
  typingActor: TypingActor | null;
  /** The typing member's user id, when the relay named them. */
  typingUserId: string | null;
  /** Send a lightweight typing indicator to peers (no DB write). */
  sendTyping: () => void;
}

// Derive the wss:// origin from the configured https:// API base.
function wsBase(): string {
  return ENV.API_BASE_URL.replace(/^http/, 'ws');
}

const PING_INTERVAL_MS = 25_000;
const TYPING_TIMEOUT_MS = 4_000;
/**
 * The assistant emits ONE typing frame, when generation starts — and the reply
 * that clears it can be a long chain of tool calls away. The member timeout
 * would blank the indicator while the model is still working, so the assistant
 * gets a long backstop instead. It is only a backstop: every terminal path on
 * the server (the reply, the empty-turn notice, the error notice) broadcasts a
 * message, and that is what actually clears it.
 */
const AI_TYPING_TIMEOUT_MS = 90_000;
// Exponential backoff bounds for reconnects.
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Opens a read-only WebSocket to a chat room and pipes incoming events into the
 * app's chat store. The socket is purely a live feed — sending messages still
 * goes through the authenticated REST endpoint.
 *
 * The access token is passed as a query param because React Native's WebSocket
 * can't set Authorization headers; the Worker verifies it before upgrading.
 */
export function useChatSocket(
  config: ChatConfig,
  householdId: string | undefined,
  roomId: string | undefined
): UseChatSocketResult {
  const { routeSegment, socketLabel, store } = config;
  const appendMessage = store((s) => s.appendMessage);
  const updateMessage = store((s) => s.updateMessage);
  const removeRoom = store((s) => s.removeRoom);
  const renameRoom = store((s) => s.renameRoom);
  const clearMessages = store((s) => s.clearMessages);
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [typing, setTyping] = useState<TypingState | null>(null);
  // Mirrored in a ref because the socket callbacks are built once per connect
  // and would otherwise read a stale `typing` from their closure.
  const typingRef = useRef<TypingState | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(MIN_BACKOFF_MS);
  // Guards against reconnect attempts after the hook has unmounted.
  const closedByUsRef = useRef(false);

  useEffect(() => {
    if (!householdId || !roomId) return;
    closedByUsRef.current = false;

    const clearTimers = () => {
      if (pingRef.current) clearInterval(pingRef.current);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      pingRef.current = null;
      reconnectRef.current = null;
    };

    const applyTyping = (next: TypingState | null) => {
      typingRef.current = next;
      setTyping(next);
    };

    /** (Re)arm the auto-clear so a stalled indicator can't hang forever. */
    const armTypingClear = (ms: number) => {
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = setTimeout(() => applyTyping(null), ms);
    };

    const connect = () => {
      const token = useAuthStore.getState().token;
      if (!token) {
        setStatus('closed');
        return;
      }

      const wsPath = `/households/${householdId}/${routeSegment}/${roomId}/ws`;
      e2eLogChatWsConnect(socketLabel, wsPath);

      setStatus('connecting');
      const url = `${wsBase()}${wsPath}?token=${encodeURIComponent(token)}`;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        e2eLogChatWsOpen(socketLabel, wsPath);
        backoffRef.current = MIN_BACKOFF_MS;
        setStatus('open');
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          try {
            e2eLogChatWsSend(socketLabel, wsPath, 'ping');
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            /* ignore */
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (evt) => {
        let data: ServerEvent | null = null;
        try {
          data = JSON.parse(typeof evt.data === 'string' ? evt.data : '');
        } catch {
          return;
        }
        if (!data) return;

        if (data.type) {
          e2eLogChatWsMessage(socketLabel, wsPath, data.type);
        }

        if (data.type === 'message' && data.message) {
          appendMessage(data.message.room_id, data.message);
          // A real message supersedes the typing indicator it belongs to. The
          // assistant's reply ends its "thinking"; a MEMBER's message ends only
          // a member's typing — it must not blank an assistant still working on
          // the reply that very message just asked for.
          if (data.message.sender_type === 'ai' || typingRef.current?.actor === 'member') {
            applyTyping(null);
          }
          // Budget assistant mutations (receipt / expense tools) → refetch every
          // budget screen that watches dataRevision / insightsDirty.
          if (config.id === 'budget' && chatMessageMutatedBudget(data.message)) {
            refreshBudgetAfterChatMutation(householdId);
          }
        } else if (
          (data.type === 'message_updated' || data.type === 'message_deleted') &&
          data.message
        ) {
          updateMessage(data.message.room_id, data.message);
        } else if (data.type === 'room_deleted' && data.roomId) {
          removeRoom(data.roomId);
        } else if (data.type === 'room_renamed' && data.roomId && data.name) {
          renameRoom(data.roomId, data.name);
        } else if (data.type === 'history_cleared' && data.roomId) {
          clearMessages(data.roomId);
        } else if (data.type === 'typing') {
          if (data.sender === 'ai') {
            applyTyping({ actor: 'ai', userId: null });
            armTypingClear(AI_TYPING_TIMEOUT_MS);
            return;
          }
          // Ignore our own typing echoed back over a second connection (a
          // reconnect leftover or the same account on another device) — the
          // indicator is for *peers* only.
          const myId = useAuthStore.getState().user?.id;
          if (data.userId && myId && data.userId === myId) return;
          // The assistant's reply is what the member is waiting for; a peer
          // tapping away meanwhile must not relabel it — or shorten it to the
          // member timeout and blank it mid-generation.
          if (typingRef.current?.actor === 'ai') return;
          // The DO sends 'unknown' when the socket carries no user id; that
          // names nobody, so keep it out of the label.
          applyTyping({
            actor: 'member',
            userId: data.userId && data.userId !== 'unknown' ? data.userId : null,
          });
          armTypingClear(TYPING_TIMEOUT_MS);
        }
      };

      ws.onerror = () => {
        e2eLogChatWsError(socketLabel, wsPath);
        // onclose will follow and handle reconnect.
      };

      ws.onclose = (event) => {
        e2eLogChatWsClose(socketLabel, wsPath, event.code);
        setStatus('closed');
        if (!closedByUsRef.current) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUsRef.current) return;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      reconnectRef.current = setTimeout(connect, delay);
    };

    // Reconnect immediately when the app returns to the foreground.
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') {
        const ws = socketRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          backoffRef.current = MIN_BACKOFF_MS;
          connect();
        }
      }
    };
    const appStateSub = AppState.addEventListener('change', onAppState);

    connect();

    return () => {
      closedByUsRef.current = true;
      clearTimers();
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      appStateSub.remove();
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    };
  }, [
    config.id,
    householdId,
    roomId,
    routeSegment,
    socketLabel,
    appendMessage,
    updateMessage,
    removeRoom,
    renameRoom,
    clearMessages,
  ]);

  const sendTyping = () => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && householdId && roomId) {
      const wsPath = `/households/${householdId}/${routeSegment}/${roomId}/ws`;
      try {
        e2eLogChatWsSend(socketLabel, wsPath, 'typing');
        ws.send(JSON.stringify({ type: 'typing' }));
      } catch {
        /* ignore */
      }
    }
  };

  return {
    status,
    isPeerTyping: typing !== null,
    typingActor: typing?.actor ?? null,
    typingUserId: typing?.userId ?? null,
    sendTyping,
  };
}
