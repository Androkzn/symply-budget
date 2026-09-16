import { useEffect } from 'react';

import { isLocalBudgetSessionOpen } from '@features/budget/local/engine';
import { useBudgetEnrolmentSignal } from '@features/budget/local/enrolmentSignal';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { runBudgetLocalSync } from '@features/budget/local/sync/orchestrator';
import { getSignalingClient, type SignalingEvent } from '@features/budget/local/sync/signalingClient';

/**
 * How often a subscribed screen re-offers to open the socket.
 *
 * This is the reconnect, not a poll: `connect()` returns immediately when a
 * live socket is already bound, so the cost of a tick that finds one is a
 * string comparison. It exists because the things that stop a socket opening
 * are all temporary and none of them call back — no token yet, no session yet,
 * no household yet, or a network that dropped and took `onclose` with it.
 */
const RECONNECT_MS = 5_000;

function isEnrolmentEvent(
  event: SignalingEvent,
): event is Extract<SignalingEvent, { type: `enrolment.${string}` }> {
  return typeof event.type === 'string' && event.type.startsWith('enrolment.');
}

let subscribers = 0;
let unsubscribe: (() => void) | null = null;
let reconnect: ReturnType<typeof setInterval> | null = null;

function start(): void {
  if (unsubscribe) return;
  const client = getSignalingClient();

  unsubscribe = client.onEvent((event) => {
    if (!isEnrolmentEvent(event)) return;
    // One signal for all four. Every screen that cares is already listening to
    // it — the owner's request list, the invitee's wait — and each re-asks the
    // control plane for the part it is allowed to see. Routing per event type
    // here would put the same decision in two places and let them disagree.
    useBudgetEnrolmentSignal.getState().bump();

    // Approval is the one event where re-asking the control plane is not
    // enough: what ends the invitee's wait is the household KEY, and that
    // arrives in a sync run rather than in any answer this device can request.
    // Without this the socket tells the device it was let in and the screen
    // goes on saying "Waiting…" until the next scheduled sync.
    if (event.type === 'enrolment.approved') {
      void runBudgetLocalSync('enrolment-live').catch(() => {
        // The wait's own poll and the next scheduled sync both cover this.
      });
    }
  });

  const open = () => {
    if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;
    client.connect();
  };
  open();
  reconnect = setInterval(open, RECONNECT_MS);
}

function stop(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (reconnect) {
    clearInterval(reconnect);
    reconnect = null;
  }
  // The socket itself is deliberately left up. It is shared with sync, which
  // may be mid-run, and closing it here would make leaving the invite screen
  // tear down a peer session that has nothing to do with enrolment.
}

/**
 * Keep this screen live for enrolment while it is mounted.
 *
 * Enrolment is two people standing next to each other waiting on each other's
 * screens, which is the worst possible case for a poll: the owner cannot
 * approve what they cannot see, and the invitee cannot do anything at all until
 * they are told. Both sides used to find out from a push — undelivered in the
 * Simulator, denied or throttled in the wild — or from a timer, and the invitee
 * had neither.
 *
 * Reference-counted because the hub and the pushed Invite screen can both be
 * mounted at once (the hub stays behind the push): two subscriptions would
 * double every bump, and the first unmount would otherwise cancel the reconnect
 * out from under the screen still on top.
 */
export function useBudgetEnrolmentLive(): void {
  useEffect(() => {
    subscribers += 1;
    start();
    return () => {
      subscribers -= 1;
      if (subscribers <= 0) {
        subscribers = 0;
        stop();
      }
    };
  }, []);
}
