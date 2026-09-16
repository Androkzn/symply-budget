/**
 * When the assistant's writes actually run, and on whose device.
 *
 * ## Exactly one device applies, exactly once
 *
 * Two things make this harder than "run the actions when the message arrives".
 *
 * **Every member of the room gets the message.** A project chat is shared. If
 * each device applied what it received, one "add the oak flooring" would add it
 * once per member online — none of these writes is idempotent. So the server
 * stamps `metadata.actor_user_id` with the member whose message produced the
 * reply, and only that device runs it. Everyone else renders the same card as a
 * record of what was done.
 *
 * **The same device sees the same message many times.** A socket reconnect
 * replays it, a scroll back re-mounts the bubble, a cold start refetches the
 * history. So an applied message is recorded in {@link APPLIED_KEY} and never
 * applied again. The ledger is per room, capped, and survives a restart —
 * which is the case that matters, because that is exactly when a re-apply would
 * be silent.
 *
 * ## Additive writes apply themselves; destructive ones wait
 *
 * `add_material` runs on arrival: the member asked for it in the sentence
 * immediately before, a confirmation tap on something you just requested is
 * friction with no signal in it, and the result is one row they can edit or
 * delete on the hub. `remove_material` and `update_project` carry
 * `confirm: true` from the server and sit as a card until tapped — they destroy
 * or overwrite work, and in a SHARED chat the member who typed the request is
 * not necessarily the one who created the thing being removed.
 *
 * The policy lives on the server (each action's `confirm` flag) rather than
 * here, so both halves agree about what the model was told would happen — the
 * tool result it reads says "done" or "ready for them to confirm", and the card
 * must not contradict it.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { homeProjectKeys } from '@api/home-projects';

import { storageHelpers } from '../../../services/storage';

import { runChatActions } from './homeProjectActionRunner';
import { chatActionActor, parseChatActions, type ChatAction, type ChatActionStatus } from './types';

/** Applied-message ledger, one key per room. */
const APPLIED_KEY = (roomId: string) => `chat:actions:applied:${roomId}`;
/**
 * How many message ids the ledger keeps. A room's assistant does not produce
 * hundreds of writes, and the ones far enough back to be evicted are far enough
 * back that they are not being re-delivered either.
 */
const APPLIED_LIMIT = 200;

/** Per-action UI state for one message. */
export interface ChatActionState {
  status: ChatActionStatus;
  error?: string;
}

export interface ChatMessageActions {
  actions: ChatAction[];
  /** Keyed by action id. */
  states: Record<string, ChatActionState>;
  /** True on the device that owns these writes — the only one showing controls. */
  isActor: boolean;
}

/** The minimum a message needs to look like, so this hook does not import the screen's type. */
interface ActionableMessage {
  id: string;
  sender_type: string;
  metadata: Record<string, unknown> | null;
}

async function readApplied(roomId: string): Promise<Set<string>> {
  try {
    const raw = await storageHelpers.getString(APPLIED_KEY(roomId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    // A corrupt ledger must not block the assistant. The cost of reading it as
    // empty is at worst one duplicate write; the cost of throwing here is that
    // no action in this room ever runs again.
    return new Set();
  }
}

async function writeApplied(roomId: string, ids: Set<string>): Promise<void> {
  try {
    const trimmed = Array.from(ids).slice(-APPLIED_LIMIT);
    await storageHelpers.setString(APPLIED_KEY(roomId), JSON.stringify(trimmed));
  } catch (error) {
    console.warn('[chat-actions] could not persist applied ledger:', error);
  }
}

export function useChatActions(
  roomId: string | undefined,
  householdId: string | undefined,
  currentUserId: string | undefined,
  messages: ActionableMessage[]
): {
  /** Per-message action state, keyed by message id. Empty for ordinary messages. */
  byMessage: Record<string, ChatMessageActions>;
  /** Run the actions on a message the member has just confirmed. */
  confirm: (messageId: string) => void;
  /** Dismiss them without running anything. */
  decline: (messageId: string) => void;
} {
  const qc = useQueryClient();
  const [states, setStates] = useState<Record<string, Record<string, ChatActionState>>>({});
  /**
   * Message ids already applied (or in flight) on this device. A ref, not
   * state: the auto-apply effect reads it to decide whether to fire, and making
   * it state would re-run the effect on every write to it.
   */
  const applied = useRef<Set<string>>(new Set());
  const [ledgerLoaded, setLedgerLoaded] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLedgerLoaded(false);
    void readApplied(roomId).then((ids) => {
      if (cancelled) return;
      applied.current = ids;
      setLedgerLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  /** AI messages that carry actions, with the actor resolved. */
  const actionable = useMemo(
    () =>
      messages
        .filter((m) => m.sender_type === 'ai')
        .map((m) => ({
          id: m.id,
          actions: parseChatActions(m.metadata),
          actor: chatActionActor(m.metadata),
        }))
        .filter((m) => m.actions.length > 0),
    [messages]
  );

  const perform = useCallback(
    async (messageId: string, actions: ChatAction[]) => {
      if (!householdId || !roomId || actions.length === 0) return;

      applied.current.add(messageId);
      void writeApplied(roomId, applied.current);

      setStates((prev) => ({
        ...prev,
        [messageId]: Object.fromEntries(
          actions.map((a) => [a.id, { status: 'running' as ChatActionStatus }])
        ),
      }));

      const results = await runChatActions(householdId, actions);

      setStates((prev) => ({
        ...prev,
        [messageId]: Object.fromEntries(
          results.map((r) => [
            r.id,
            r.ok
              ? { status: 'applied' as ChatActionStatus }
              : { status: 'failed' as ChatActionStatus, error: r.error },
          ])
        ),
      }));

      // Refresh every screen these rows feed. The hub is the one the member is
      // most likely to open next; the list carries the rollups on its cards.
      if (results.some((r) => r.ok)) {
        const projectIds = new Set(actions.map((a) => a.project_id));
        for (const projectId of projectIds) {
          void qc.invalidateQueries({ queryKey: homeProjectKeys.hub(projectId) });
          void qc.invalidateQueries({ queryKey: homeProjectKeys.activity(projectId) });
        }
        void qc.invalidateQueries({ queryKey: homeProjectKeys.all(householdId) });
      }
    },
    [householdId, qc, roomId]
  );

  /**
   * Auto-apply pass.
   *
   * Gated on the ledger having loaded — firing before it is read would apply
   * every action in the room's history on every cold start, which is the worst
   * bug this feature could have.
   */
  useEffect(() => {
    if (!ledgerLoaded || !householdId || !currentUserId) return;
    for (const message of actionable) {
      if (message.actor !== currentUserId) continue;
      if (applied.current.has(message.id)) continue;
      const auto = message.actions.filter((a) => !a.confirm);
      if (auto.length === 0) continue;
      void perform(message.id, auto);
    }
  }, [actionable, currentUserId, householdId, ledgerLoaded, perform]);

  const confirm = useCallback(
    (messageId: string) => {
      const message = actionable.find((m) => m.id === messageId);
      if (!message) return;
      void perform(messageId, message.actions);
    },
    [actionable, perform]
  );

  const decline = useCallback(
    (messageId: string) => {
      const message = actionable.find((m) => m.id === messageId);
      if (!message || !roomId) return;
      applied.current.add(messageId);
      void writeApplied(roomId, applied.current);
      setStates((prev) => ({
        ...prev,
        [messageId]: Object.fromEntries(
          message.actions.map((a) => [a.id, { status: 'declined' as ChatActionStatus }])
        ),
      }));
    },
    [actionable, roomId]
  );

  const byMessage = useMemo(() => {
    const out: Record<string, ChatMessageActions> = {};
    for (const message of actionable) {
      const known = states[message.id] ?? {};
      out[message.id] = {
        actions: message.actions,
        isActor: !!currentUserId && message.actor === currentUserId,
        states: Object.fromEntries(
          message.actions.map((a) => [
            a.id,
            known[a.id] ?? {
              // An auto-apply action with no recorded state on THIS device has
              // already run on the actor's — say nothing rather than showing a
              // pending spinner that will never resolve here.
              status: a.confirm ? ('pending' as ChatActionStatus) : ('applied' as ChatActionStatus),
            },
          ])
        ),
      };
    }
    return out;
  }, [actionable, currentUserId, states]);

  return { byMessage, confirm, decline };
}
