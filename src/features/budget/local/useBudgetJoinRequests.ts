import { useFocusEffect } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  approveLocalFirstInvite,
  deriveJoinRequestSas,
  listPendingJoinRequests,
  type PendingJoinRequest,
} from '@features/budget/local/controlPlaneClient';
import { isLocalBudgetSessionOpen } from '@features/budget/local/engine';
import { useBudgetEnrolmentLive } from '@features/budget/local/enrolmentLive';
import { useBudgetEnrolmentSignal } from '@features/budget/local/enrolmentSignal';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { useNotificationStore } from '@stores/notificationStore';

/**
 * How often a screen showing this re-asks whether anyone has claimed an invite.
 *
 * Ten seconds is chosen against what the owner is doing: standing next to the
 * other person, waiting to read six digits aloud. Slower than that and the
 * hand-off stalls on a screen that looks broken; faster buys nothing, since the
 * claim itself takes longer than that to type.
 */
export const PENDING_CLAIM_POLL_MS = 10_000;

export type BudgetJoinRequests = {
  requests: PendingJoinRequest[] | null;
  /** Digits derived per invite; null = this device cannot derive them. */
  sas: Record<string, string | null>;
  isChecking: boolean;
  isApproving: boolean;
  /** Re-ask. `announce` answers a person who tapped, including with "nobody". */
  refresh: (options?: { announce?: boolean }) => Promise<PendingJoinRequest[] | null>;
  approve: (request: PendingJoinRequest) => void;
};

/**
 * Who is waiting to be let in — asked without being asked.
 *
 * Lifted out of `BudgetInviteScreen` when that screen became a hub with the
 * invite flow on a pushed screen of its own. Both places need this: the hub,
 * because a push ("X is waiting to join") lands there and the owner must find X
 * without hunting; and the Invite screen, because that is where the owner is
 * standing while the other person claims the code they just minted. A hook
 * rather than two copies of the polling — two copies is how one of them ends up
 * with the fix and the other does not.
 *
 * Every trigger is here: arriving (focus), a push while open (the enrolment
 * signal), and a timer, because the signal only ever fires for a push that
 * actually arrives. In the Simulator APNs never delivers at all, and in the
 * real world there is notifications-denied, a revoked token, a quiet network,
 * or simply the seconds before the push lands — in all of those the claim sits
 * on the server while the owner stares at a screen that will not change.
 */
export function useBudgetJoinRequests(options?: {
  /** Called after an approval lands, for lists the approval invalidates. */
  onApproved?: () => void;
}): BudgetJoinRequests {
  const [requests, setRequests] = useState<PendingJoinRequest[] | null>(null);
  const [sas, setSas] = useState<Record<string, string | null>>({});
  const [isChecking, setIsChecking] = useState(false);
  const [isApproving, setIsApproving] = useState(false);

  // Held in a ref so the callbacks below do not change identity when the caller
  // passes an inline arrow — which every caller does, and which would otherwise
  // restart the poll on every render.
  const onApproved = useRef(options?.onApproved);
  onApproved.current = options?.onApproved;

  const refresh = useCallback(
    async (opts?: { announce?: boolean }): Promise<PendingJoinRequest[] | null> => {
      // The control plane call resolves the ACTIVE household from the engine,
      // which throws when no session is open — a normal state here.
      if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return null;
      setIsChecking(true);
      try {
        const pending = await listPendingJoinRequests();
        setRequests(pending);
        // Derive every request's digits up front so the banner renders complete
        // — a number that appears a moment later invites the owner to start
        // reading before the check is on screen.
        const derived = await Promise.all(
          pending.map(
            async (request) => [request.inviteId, await deriveJoinRequestSas(request)] as const,
          ),
        );
        setSas(Object.fromEntries(derived));
        if (opts?.announce && pending.length === 0) {
          Alert.alert('Join requests', 'No one is waiting to join right now.');
        }
        return pending;
      } catch (error) {
        console.error('List join requests failed', error);
        if (opts?.announce) {
          Alert.alert('Error', 'Could not load join requests. Check you are online.');
        }
        // Left as-is on an automatic check: a banner already on screen is a
        // request the control plane confirmed a moment ago, and dropping it
        // because the network blinked would hide the approval the owner came
        // here to give.
        return null;
      } finally {
        setIsChecking(false);
      }
    },
    [],
  );

  /**
   * Live while this is on screen: the coordinator announces a claim the moment
   * it lands, which is the moment the owner is standing there waiting for it.
   * The timer below stays as the floor — see its comment.
   */
  useBudgetEnrolmentLive();

  /** Arriving is the ask. Every entry point — tab, deep link, tapped push. */
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useFocusEffect(
    useCallback(() => {
      const tick = setInterval(() => {
        void refresh();
        // The bell is stale for the same reason this list was: `refreshMovementFeed`
        // only runs on Home.
        void useNotificationStore.getState().refreshUnreadCount();
      }, PENDING_CLAIM_POLL_MS);
      return () => clearInterval(tick);
    }, [refresh]),
  );

  /**
   * …and again when a claim lands while the screen is already open, which is
   * the common case: the owner reads "X is waiting to join" WHILE looking at
   * this screen, and a tap that navigates to where you already are fires no
   * focus effect. The ref skips the mount run — the focus effect above has just
   * made that exact call.
   */
  const enrolmentRevision = useBudgetEnrolmentSignal((state) => state.revision);
  const handledRevision = useRef(enrolmentRevision);
  useEffect(() => {
    if (handledRevision.current === enrolmentRevision) return;
    handledRevision.current = enrolmentRevision;
    void refresh();
  }, [enrolmentRevision, refresh]);

  const approve = useCallback((request: PendingJoinRequest) => {
    void (async () => {
      setIsApproving(true);
      try {
        await approveLocalFirstInvite({ request });
        setRequests((current) => current?.filter((r) => r.inviteId !== request.inviteId) ?? null);
        onApproved.current?.();
        Alert.alert(
          'Device approved',
          'Their device is enrolled. It will pick up the household key on its next sync.',
        );
      } catch (error) {
        console.error('Approve invite failed', error);
        Alert.alert(
          'Not approved',
          'Could not approve this device. If their request changed while you were checking, load the list again and compare the numbers afresh.',
        );
      } finally {
        setIsApproving(false);
      }
    })();
  }, []);

  return { requests, sas, isChecking, isApproving, refresh, approve };
}
