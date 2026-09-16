import { ENV } from '@config/env';
import { useAuthStore } from '@stores/authStore';

import {
  getActiveHouseholdId,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  subscribeToHouseLedgerChanges,
} from '../engine';

export type SignalingEvent =
  | { type: 'presence.join'; deviceId: string; userId: string }
  | { type: 'presence.leave'; deviceId: string; userId: string }
  | { type: 'sync_available'; fromDeviceId: string }
  /**
   * Enrolment moved in this home — somebody claimed an invite, or a claim was
   * answered. Carries an invite id and nothing else; the reader re-asks the
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
 * WebSocket client for `HouseholdCoordinatorDO` signaling (no home payloads).
 *
 * House does not run WebRTC — every byte of home data moves over the mailbox —
 * so this carries only the two things a socket is genuinely better at than a
 * poll: presence, and the enrolment frames that answer somebody who is standing
 * there waiting. The offer/answer/ICE frames in the shared protocol are simply
 * never sent from here.
 *
 * ONE SOCKET, ONE PROPERTY
 * ------------------------
 * The signaling URL names a household — `/v2/households/:id/signaling` — so a
 * socket is bound to whichever property it was opened for and cannot serve a
 * second one. With several properties on the device that makes binding an
 * explicit piece of state rather than an implicit "whatever `getLocalHouseLedger()`
 * returned when we last connected": reading the active ledger at connect time
 * and never looking again leaves the client announcing presence inside the home
 * the member has left.
 */
export class HouseSignalingClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The property this socket was opened for, or null when there is no socket.
   *
   * Kept next to `ws` and cleared with it, because the two are only ever
   * meaningful together: a live socket with a stale binding is exactly the
   * cross-property leak described above.
   */
  private boundHouseholdId: string | null = null;

  onEvent(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** The property this client is bound to, for callers that must not guess. */
  get householdId(): string | null {
    return this.boundHouseholdId;
  }

  /**
   * Connect (or keep) a socket for the ACTIVE property.
   *
   * `forHouseholdId` is how a background sync says which property it is running
   * for. Naming a non-active property is not an error — it is the normal case
   * for a background property — and returns false so the caller stays on the
   * mailbox. Returns true when signaling is (or is becoming) live for the
   * requested property.
   */
  connect(forHouseholdId?: string): boolean {
    if (!isLocalHouseSessionOpen()) return false;
    const active = getActiveHouseholdId();
    if (!active) return false;
    // Refuse rather than rebind: a background sync must NOT drag the socket away
    // from the property whose screen the member is looking at.
    if (forHouseholdId && forHouseholdId !== active) return false;

    const token = useAuthStore.getState().token;
    if (!token) return false;

    // A switch may have landed while this socket was open — retire it first, so
    // the reuse check below can never match a stale binding.
    this.disconnectIfHouseholdChanged();

    // Reuse a socket already bound to this property rather than reopening one
    // per call: an unconditional disconnect here makes every reconnect tick a
    // join/leave churn on the DO.
    if (this.boundHouseholdId === active && this.isLive()) return true;

    // The URL takes the id from the active POINTER rather than from the ledger
    // it returns, so a session whose two copies of the id ever disagree cannot
    // open a socket into the wrong room. `deviceId` is device-scoped and
    // identical across properties.
    const ledger = getLocalHouseLedger();
    const base = ENV.API_BASE_URL.replace(/^http/, 'ws').replace(/\/$/, '');
    const url = `${base}/v2/households/${encodeURIComponent(active)}/signaling?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(ledger.deviceId)}`;

    this.disconnect();
    const ws = new WebSocket(url);
    this.ws = ws;
    this.boundHouseholdId = active;

    ws.onmessage = (ev) => {
      // Late frames from a socket we have already replaced belong to the
      // property we just left — dropping them is the whole point of the check.
      if (this.ws !== ws) return;
      try {
        const data = JSON.parse(String(ev.data)) as SignalingEvent;
        if (data.type === 'presence.join' || data.type === 'presence.leave') {
          console.log(
            `[house.local] signaling: peer ${data.type === 'presence.join' ? 'ONLINE' : 'offline'} hh=${active} device=${data.deviceId} user=${data.userId}`,
          );
        }
        for (const h of this.handlers) h(data);
      } catch {
        /* ignore */
      }
    };

    ws.onopen = () => {
      if (this.ws !== ws) return;
      console.log(`[house.local] signaling: connected hh=${active} device=${ledger.deviceId}`);
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' });
      }, 25_000);
    };

    // A signaling socket that never opens is silent by nature — there is no
    // error to catch, and the mailbox carries everything instead. That is a
    // correct fallback and a completely invisible one, so say so once.
    ws.onerror = () => {
      if (this.ws !== ws) return;
      console.warn(
        `[house.local] signaling: socket error hh=${active} — falling back to mailbox-only sync`,
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
   * Drop the socket when the active property has moved out from under it.
   *
   * Called on every ledger change (see `getHouseSignalingClient`) so a switch
   * takes effect immediately rather than at the next connect: leaving the socket
   * up would keep this device present in the previous property's room. Rebinding
   * is deliberately NOT done here — the next `connect()` does it, so a switch
   * never opens a socket the app had not otherwise asked for.
   */
  disconnectIfHouseholdChanged(): void {
    if (this.boundHouseholdId === null) return;
    if (this.boundHouseholdId === getActiveHouseholdId()) return;
    console.log('[house.local] signaling: active property changed, dropping socket');
    this.disconnect();
  }

  send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
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

let shared: HouseSignalingClient | null = null;
let activeHouseholdWatch: (() => void) | null = null;

/**
 * The one signaling client, bound to the active property.
 *
 * The ledger subscription is created WITH the client rather than at module load
 * so a build that never opens an enrolment screen never registers a listener. It
 * fires on every ledger bump — including a background property's — and the check
 * it runs is a string comparison against the active pointer, which is why it can
 * afford to.
 */
export function getHouseSignalingClient(): HouseSignalingClient {
  if (shared) return shared;
  const client = new HouseSignalingClient();
  shared = client;
  activeHouseholdWatch = subscribeToHouseLedgerChanges(() => {
    client.disconnectIfHouseholdChanged();
  });
  return client;
}

/**
 * Drop the socket and stop watching for switches — sign-out and session
 * teardown, where the auth token in the socket's URL has just been invalidated
 * and the next sign-in may be a different account entirely.
 */
export function disposeHouseSignalingClient(): void {
  activeHouseholdWatch?.();
  activeHouseholdWatch = null;
  shared?.disconnect();
  shared = null;
}
