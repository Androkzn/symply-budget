import { useCallback, useEffect, useState } from 'react';

import {
  fetchControlPlaneState,
  lookupLocalFirstInviteById,
} from '@features/budget/local/controlPlaneClient';
import {
  abandonHouseholdEnrolment,
  getActiveBudgetHouseholdId,
  hasLocalBudgetHousehold,
  isAwaitingHouseholdEnrolment,
  isLocalBudgetSessionOpen,
  subscribeToLedgerChanges,
} from '@features/budget/local/engine';
import { useBudgetEnrolmentLive } from '@features/budget/local/enrolmentLive';
import { useBudgetEnrolmentSignal } from '@features/budget/local/enrolmentSignal';
import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { runBudgetLocalSync } from '@features/budget/local/sync/orchestrator';
import {
  forgetJoinSas,
  noteJoinOutcome,
  recallJoinSas,
  type JoinOutcome,
  type PendingJoin,
} from '@services/enrolment/inviteSecretStore';

/**
 * How often the waiting device re-asks what happened to its claim. Matched to
 * the owner's `PENDING_CLAIM_POLL_MS` — the two are halves of one hand-off.
 */
const JOIN_WAIT_POLL_MS = 10_000;

export type BudgetJoinWait = {
  /** This device has claimed an invite and is waiting to be let in. */
  awaiting: boolean;
  /** The six digits to read to the owner. Null when there is nothing to read. */
  sas: string | null;
  /** The wait ended without this device being told, and how. */
  outcome: JoinOutcome | null;
  /** Acknowledge a finished outcome. The only thing that clears the banner. */
  dismiss: () => void;
  /**
   * Re-ask what happened to this claim, now — what a pull-to-refresh calls.
   *
   * Worth having even with a socket and a timer behind it: this screen is where
   * somebody goes precisely when they believe it is stuck, and a person who has
   * just been told "it should update by itself" needs a way to test that claim.
   */
  refresh: () => Promise<void>;
};

/**
 * The invitee's half of the hand-off: am I still waiting, on what, and — when
 * the answer is "on nothing, any more" — getting this device out of the state
 * that wait left behind.
 *
 * Lifted out of `BudgetInviteScreen` so the hub and the Join screen can both
 * show it. Both must: the hub, because a push about this device's own claim
 * lands there and a screen with no trace of what the notification was about is
 * worse than no notification; the Join screen, because that is where the person
 * just tapped Join and is now standing.
 *
 * Three sources, and each answers something the others cannot:
 *
 *  - the ENGINE says whether the household key has arrived — that is what ends
 *    the wait, and it flips inside a sync run rather than from anything a
 *    screen does, so it is read on every ledger change;
 *  - the PERSISTED CLAIM, because joining rebinds the ledger and unmounts the
 *    screen that derived the digits — held in state alone the invitee comes
 *    back to nothing and has nothing to read out — and because it is where a
 *    finished outcome is kept, which is the only copy that outlives the
 *    household this hook is about to drop;
 *  - the CONTROL PLANE, for the two endings nobody tells this device about:
 *    the owner cancelled, or the invite expired. Without that the screen goes
 *    on saying "Waiting for approval…" about an invite that died yesterday.
 *
 * A lookup that fails leaves the wait alone rather than inventing an ending. A
 * wrong "it was cancelled" is worse than a stale "still waiting" — one of them
 * sends somebody to ask for a new invite they do not need.
 *
 * A terminal answer does two things beyond setting the banner. It is WRITTEN to
 * the claim record, so the next mount knows immediately instead of flashing the
 * dead invite's digits for the length of a round trip — the wrong state seen on
 * staging, on every visit to the screen. And it DROPS the half-joined
 * household (`abandonHouseholdEnrolment`), because a claim that can never be
 * approved leaves behind a household that 403s every request and a set of join
 * controls disabled by this very wait — a dead end the person cannot leave, on
 * the exact screen they need in order to claim the replacement invite.
 */
/** The claim this device is standing on, as the screen needs to describe it. */
type ClaimState = { inviteId: string; sas: string; outcome: JoinOutcome | null };

export function useBudgetJoinWait(): BudgetJoinWait {
  const [claim, setClaim] = useState<ClaimState | null>(null);

  // The gate flips inside the sync run, not from anything a screen does — so
  // re-read it whenever the ledger signals a change rather than only on mount.
  // Deliberately NOT filtered by household: a join ADDS one and makes it
  // active, and the event announcing that carries the new id.
  const [, bump] = useState(0);
  useEffect(() => subscribeToLedgerChanges(bump), []);
  const engineAwaiting =
    isBudgetLocalFirst() && isLocalBudgetSessionOpen() && isAwaitingHouseholdEnrolment();

  useEffect(() => {
    void (async () => {
      const pending = await recallJoinSas();
      setClaim((previous) => {
        // Nothing on disk: keep an outcome this hook learned a moment ago —
        // there is still a person owed the explanation — and otherwise show
        // nothing.
        if (!pending) return previous?.outcome ? previous : null;
        return {
          inviteId: pending.inviteId,
          sas: pending.sas,
          // The record wins, then this session's own answer for the SAME
          // invite: the write may have failed silently (the store swallows
          // that), and re-reading is not a reason to un-tell somebody their
          // invite is dead. A record naming a DIFFERENT invite is a new claim,
          // which clears the old outcome — that is how the banner leaves the
          // screen when the person joins again.
          outcome:
            pending.outcome ??
            (previous?.inviteId === pending.inviteId ? previous.outcome : null),
        };
      });
      if (!pending) return;
      if (pending.outcome) {
        // Retried here rather than only where the outcome is first learned: a
        // drop that failed once would otherwise never be attempted again, since
        // the recorded outcome stops the lookup path from running a second time.
        await dropClaimedHousehold(pending);
        return;
      }
      if (engineAwaiting || pending.outcome) return;
      // Only discard the record on a wait that ended WELL. `engineAwaiting`
      // reads the active household, which goes false for reasons that have
      // nothing to do with this claim — a household switch, a session
      // reopening mid-render — and forgetting on those took the digits away
      // from a device still waiting to read them out, permanently.
      if (isEnrolmentSettled(pending.householdId)) {
        await forgetJoinSas();
        setClaim(null);
      }
    })();
  }, [engineAwaiting]);

  const refreshOutcome = useCallback(async () => {
    if (!engineAwaiting) return;
    const pending = await recallJoinSas();
    if (!pending || pending.outcome) return;
    let ended: JoinOutcome | null = null;
    try {
      const claimed = await lookupLocalFirstInviteById(pending.inviteId);
      if (claimed.status === 'revoked') ended = 'revoked';
      else if (claimed.status === 'expired') ended = 'expired';
      else if (claimed.status === 'approved') {
        // Approved, and this device still has no key: FETCH, never drop.
        //
        // `enrolment.approved` fires from the coordinator the instant the
        // owner taps Approve, which is BEFORE D1 writes `lf_memberships`.
        // `/state` 403s in that window. Treating that 403 as "removed" is how
        // Sweet Home vanished from a phone that had just been let in — the
        // member stayed on their personal ledger, Device Sync said "not on
        // this phone", and the same iPhone showed "No longer has access".
        //
        // A real eviction is a revoked or expired invite (handled above), or
        // the member removing the household themselves. An approved invite
        // means keep the session and pull until the household key lands.
        const admitted = await isStillAdmitted(pending.householdId);
        if (admitted === 'no') {
          console.warn(
            `[BudgetLocal] join-wait hh=${pending.householdId} invite approved but /state refused — keeping the household and syncing`,
          );
        }
        if (admitted !== 'unknown') {
          void runBudgetLocalSync('join-wait-poll').catch(() => {
            /* the next tick of this poll tries again */
          });
        }
        return;
      }
    } catch {
      // Offline, or a Worker that cannot answer — see the header.
      return;
    }
    if (!ended) return;
    // Written before the drop: the drop is what makes this the only remaining
    // account of why the household went away.
    await noteJoinOutcome(ended);
    setClaim({ inviteId: pending.inviteId, sas: pending.sas, outcome: ended });
    await dropClaimedHousehold(pending);
  }, [engineAwaiting]);

  // Live for as long as this is on screen: the coordinator socket carries the
  // answer to THIS device's claim, which is the one thing it cannot ask for and
  // the only thing it is waiting on.
  useBudgetEnrolmentLive();

  const enrolmentRevision = useBudgetEnrolmentSignal((state) => state.revision);
  useEffect(() => {
    void refreshOutcome();
  }, [enrolmentRevision, refreshOutcome]);

  /**
   * …and a timer under it, because every other trigger here can fail to fire.
   *
   * The socket needs a network and an eligible claim; the push needs APNs,
   * which never delivers in the Simulator and is denied or throttled often
   * enough in the wild; the ledger subscription only speaks when a sync run
   * changes something, and a device waiting on a key it has not been given
   * syncs nothing. With none of them the screen had NO recurring trigger at all
   * — observed on Budget-B, stuck on "Waiting to be let in" for an invite that
   * had been answered an hour earlier, with the Join button disabled by that
   * same wait so the person could not even claim the replacement invite.
   *
   * Same ten seconds as the owner's side: the two are halves of one hand-off
   * and there is no reason for them to disagree about how long a stall lasts.
   */
  useEffect(() => {
    if (!engineAwaiting) return;
    const tick = setInterval(() => {
      void refreshOutcome();
    }, JOIN_WAIT_POLL_MS);
    return () => clearInterval(tick);
  }, [engineAwaiting, refreshOutcome]);

  const dismiss = useCallback(() => {
    setClaim(null);
    void forgetJoinSas();
  }, []);

  const outcome = claim?.outcome ?? null;
  return {
    awaiting: engineAwaiting && !outcome,
    // The digits are for a comparison that is still worth making. Once the wait
    // has an ending there is nothing left to verify, and the panel says the
    // ending instead.
    sas: outcome ? null : (claim?.sas ?? null),
    outcome,
    dismiss,
    refresh: refreshOutcome,
  };
}

/**
 * Does the household still admit this device?
 *
 * Three answers, not two. `unknown` is the whole reason this returns a string:
 * a household that cannot be reached has said nothing, and treating silence as
 * "you were removed" would take somebody's household off their device because
 * their train went into a tunnel. Only an explicit refusal counts.
 *
 * 401 is deliberately NOT a refusal: it means this device's token has expired,
 * which says nothing about its membership and is fixed by signing in again.
 */
async function isStillAdmitted(householdId: string | null): Promise<'yes' | 'no' | 'unknown'> {
  const id = householdId ?? getActiveBudgetHouseholdId();
  if (!id) return 'unknown';
  try {
    await fetchControlPlaneState(id);
    return 'yes';
  } catch (error) {
    const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
    return status === 403 || status === 404 ? 'no' : 'unknown';
  }
}

/**
 * Take the half-joined household off this device, for a claim that has ended.
 *
 * Falls back to the ACTIVE household when the record does not name one. Records
 * written before the household id was stored are exactly the devices that were
 * already stuck when this shipped, and they are the ones with the most to gain:
 * without the fallback the fix would arrive for everyone except the people
 * currently unable to join. The guess is safe because it is not really a
 * guess — `adoptJoinedHousehold` made the claimed household ACTIVE, and
 * `abandonHouseholdEnrolment` refuses any household that is not still awaiting
 * keys, so being wrong costs a no-op rather than somebody's budget.
 *
 * Never throws: the banner is already up and already recorded, which is the
 * half the person reads.
 */
async function dropClaimedHousehold(pending: PendingJoin): Promise<void> {
  const householdId = pending.householdId ?? getActiveBudgetHouseholdId();
  if (!householdId) return;
  try {
    await abandonHouseholdEnrolment(householdId);
  } catch {
    // Attempted again on the next mount rather than taking the screen down.
  }
}

/**
 * True when the claimed household is on this device and no longer waiting —
 * i.e. the key arrived and the enrolment finished.
 *
 * Both halves are load-bearing. `isAwaitingHouseholdEnrolment` alone answers
 * false for a household that was DROPPED as well as one that was let in, and
 * treating those alike discards the record that carries the only explanation
 * the person will ever get for the household disappearing.
 *
 * A record with no household id — written before the id was stored — is never
 * settled here: there is nothing to check it against, and keeping a spent
 * record costs one stale entry, while discarding a live one costs the invitee
 * the digits they are standing there to read out.
 */
function isEnrolmentSettled(householdId: string | null): boolean {
  if (!householdId) return false;
  return hasLocalBudgetHousehold(householdId) && !isAwaitingHouseholdEnrolment(householdId);
}
