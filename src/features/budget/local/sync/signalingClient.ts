import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

import {
  getActiveBudgetHouseholdId,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  subscribeToLedgerChanges,
} from '../engine';

export type SignalingEvent =
  | { type: 'presence.join'; deviceId: string; userId: string }
  | { type: 'presence.leave'; deviceId: string; userId: string }
  | { type: 'signal.offer'; fromDeviceId: string; toDeviceId?: string; sdp: string }
  | { type: 'signal.answer'; fromDeviceId: string; toDeviceId?: string; sdp: string }
  | { type: 'signal.ice'; fromDeviceId: string; toDeviceId?: string; candidate: unknown }
  | { type: 'sync_available'; fromDeviceId: string }
  /**
   * Enrolment moved in this household — somebody claimed an invite, or a claim
   * was answered. Carries an invite id and nothing else; the reader re-asks the
   * control plane, which is the tier that decides what it may see.
   *
   * The owner receives all four. A device still waiting to be let in receives
   * only the ones about its own claim — that socket is the one channel that can
   * reach it before it is a member (see `HouseholdCoordinatorDO`).
   */
  | { type: 'enrolment.claimed'; inviteId: string }
  | { type: 'enrolment.approved'; inviteId: string }
  | { type: 'enrolment.revoked'; inviteId: string }
  | { type: 'enrolment.expired'; inviteId: string }
  | { type: 'pong' };

type Handler = (event: SignalingEvent) => void;

/**
 * WebSocket client for HouseholdCoordinatorDO signaling (no financial payloads).
 *
 * ONE SOCKET, ONE HOUSEHOLD (BR-016)
 * ----------------------------------
 * The signaling URL names a household — `/v2/households/:id/signaling` — so a
 * socket is bound to whichever household it was opened for and cannot serve a
 * second one. With multiple households on the device that makes binding an
 * explicit piece of state rather than an implicit "whatever `getLocalLedger()`
 * returned when we last connected": the previous code read the active ledger at
 * connect time and then never looked again, so after a switch the client went on
 * announcing presence and relaying SDP/ICE inside the household the member had
 * left — WebRTC would then negotiate a data channel against a peer that is
 * carrying the OTHER household's ops.
 *
 * The rule this class enforces is the one BR-016 settled on: **WebRTC serves the
 * ACTIVE household only.** Background households sync over the mailbox, which is
 * per-household by construction and needs no live socket. So the client binds to
 * the active household, refuses a `connect()` aimed at any other, and tears the
 * socket down the moment the active household moves out from under it.
 */
export class LocalFirstSignalingClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The household this socket was opened for, or null when there is no socket.
   *
   * Kept next to `ws` and cleared with it, because the two are only ever
   * meaningful together: a live socket with a stale binding is exactly the
   * cross-household leak described above.
   */
  private boundHouseholdId: string | null = null;

  onEvent(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** The household this client is currently bound to, for callers that must not guess. */
  get householdId(): string | null {
    return this.boundHouseholdId;
  }

  /**
   * Connect (or keep) a socket for the ACTIVE household.
   *
   * `forHouseholdId` is how a background sync says which household it is running
   * for. Naming a non-active household is not an error — it is the normal case
   * for a background household — and returns false so the caller skips WebRTC
   * and stays on the mailbox. Returns true when signaling is (or is becoming)
   * live for the requested household.
   */
  connect(forHouseholdId?: string): boolean {
    if (!isLocalBudgetSessionOpen()) return false;
    const active = getActiveBudgetHouseholdId();
    if (!active) return false;
    // Refuse rather than rebind: a background sync must NOT drag the socket away
    // from the household whose screen the member is looking at.
    if (forHouseholdId && forHouseholdId !== active) return false;

    const token = useAuthStore.getState().token;
    if (!token) return false;

    // A switch may have landed while this socket was open — retire it first, so
    // the reuse check below can never match a stale binding.
    this.disconnectIfHouseholdChanged();

    // Reuse a socket that is already bound to this household instead of
    // reopening one per sync. The old code disconnected unconditionally here,
    // which made every sync a join/leave churn on the DO and — worse — meant the
    // `announceSyncAvailable()` the orchestrator sends immediately after
    // `connect()` always hit a CONNECTING socket and was dropped by `send()`, so
    // peers were never actually told to wake up.
    if (this.boundHouseholdId === active && this.isLive()) return true;

    // The active ledger, by definition — `getLocalLedger()` reads the active
    // session. The URL takes the id from the active POINTER rather than from the
    // ledger it returns, so a session whose two copies of the id ever disagree
    // cannot open a socket into the wrong room. `deviceId` is device-scoped and
    // identical across households.
    const ledger = getLocalLedger();
    const base = ENV.API_BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '');
    const url = `${base}/v2/households/${encodeURIComponent(active)}/signaling?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(ledger.deviceId)}`;

    this.disconnect();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.boundHouseholdId = active;

    ws.onmessage = (ev) => {
      // Late frames from a socket we have already replaced belong to the
      // household we just left — dropping them is the whole point of the check.
      if (this.ws !== ws) return;
      try {
        const data = JSON.parse(String(ev.data)) as SignalingEvent;
        // LIVE presence — the only real "is the other phone on right now"
        // signal there is. `lastSeenAt` on the control plane is a poll stamp
        // and can be minutes stale; these two frames are the moment a peer
        // actually arrives in or leaves the household room. Logged because
        // "their change never showed up" is nearly always answered by whether
        // the other device was ever present, and nothing recorded that.
        if (data.type === 'presence.join' || data.type === 'presence.leave') {
          console.log(
            `[budget.local] signaling: peer ${data.type === 'presence.join' ? 'ONLINE' : 'offline'} hh=${active} device=${data.deviceId} user=${data.userId}`,
          );
        }
        for (const h of this.handlers) h(data);
      } catch {
        /* ignore */
      }
    };

    ws.onopen = () => {
      if (this.ws !== ws) return;
      console.log(`[budget.local] signaling: connected hh=${active} device=${ledger.deviceId}`);
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' });
      }, 25_000);
    };

    // A signaling socket that never opens is silent by nature — there is no
    // error to catch, the WebRTC upgrade simply never happens and the mailbox
    // carries everything instead. That is a correct fallback and a completely
    // invisible one, so a household that has quietly lost peer-to-peer sync
    // looks the same as one that never had it. In production this failed with
    // a 401 against a household the socket should not have been bound to.
    ws.onerror = () => {
      if (this.ws !== ws) return;
      console.warn(
        `[budget.local] signaling: socket error hh=${active} — falling back to mailbox-only sync`,
      );
    };

    ws.onclose = () => {
      // `ws.close()` in `disconnect()` fires this asynchronously, so by the time
      // it runs a rebind may already have installed the NEXT socket. Without the
      // identity check this handler would clear the new socket's ping timer and
      // blank a binding that is live.
      if (this.ws !== ws) return;
      this.clearPing();
      this.ws = null;
      this.boundHouseholdId = null;
    };
    return true;
  }

  /**
   * Drop the socket when the active household has moved out from under it.
   *
   * Called on every ledger change (see `getSignalingClient`) so a switch takes
   * effect immediately rather than at the next sync: leaving the socket up would
   * keep this device present in the previous household's room, answering offers
   * and shipping ICE for a household it is no longer showing. Rebinding is
   * deliberately NOT done here — the next `connect()` does it, so a switch never
   * opens a socket the app had not otherwise asked for.
   */
  disconnectIfHouseholdChanged(): void {
    if (this.boundHouseholdId === null) return;
    if (this.boundHouseholdId === getActiveBudgetHouseholdId()) return;
    console.log('[budget.local] signaling: active household changed, dropping socket');
    this.disconnect();
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendOffer(toDeviceId: string, sdp: string): void {
    this.send({ type: 'signal.offer', toDeviceId, sdp });
  }

  sendAnswer(toDeviceId: string, sdp: string): void {
    this.send({ type: 'signal.answer', toDeviceId, sdp });
  }

  sendIce(toDeviceId: string, candidate: unknown): void {
    this.send({ type: 'signal.ice', toDeviceId, candidate });
  }

  announceSyncAvailable(): void {
    this.send({ type: 'sync_available' });
  }

  disconnect(): void {
    this.clearPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    // Cleared with the socket, always: a binding that outlives its socket would
    // let the reuse check in `connect()` skip opening a new one.
    this.boundHouseholdId = null;
  }

  /** Open, or on its way there — either way a second socket must not be opened. */
  private isLive(): boolean {
    const state = this.ws?.readyState;
    return state === WebSocket.OPEN || state === WebSocket.CONNECTING;
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}

let shared: LocalFirstSignalingClient | null = null;
let activeHouseholdWatch: (() => void) | null = null;

/**
 * The one signaling client, bound to the active household.
 *
 * The ledger subscription is created WITH the client rather than at module load
 * so a build that never syncs never registers a listener. It fires on every
 * ledger bump — including a background household's — and the check it runs is a
 * string comparison against the active pointer, which is why it can afford to.
 * Household switches are the events that matter: `activateLocalBudgetHousehold`
 * emits a whole-ledger change for the newly active household, and this is what
 * turns that into a torn-down socket without the engine having to know signaling
 * exists.
 */
export function getSignalingClient(): LocalFirstSignalingClient {
  if (shared) return shared;
  const client = new LocalFirstSignalingClient();
  shared = client;
  activeHouseholdWatch = subscribeToLedgerChanges(() => {
    client.disconnectIfHouseholdChanged();
  });
  return client;
}

/**
 * Drop the socket and stop watching for switches — sign-out and session
 * teardown, where the auth token in the socket's URL has just been invalidated
 * and the next sign-in may be a different account entirely.
 */
export function disposeSignalingClient(): void {
  activeHouseholdWatch?.();
  activeHouseholdWatch = null;
  shared?.disconnect();
  shared = null;
}
