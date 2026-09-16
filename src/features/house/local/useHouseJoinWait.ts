import { useCallback, useEffect, useState } from 'react';

import {
  fetchControlPlaneState,
  lookupLocalFirstInviteById,
} from '@features/house/local/controlPlaneClient';
import {
  abandonHouseEnrolment,
  getActiveHouseholdId,
  hasLocalHouseProperty,
  isAwaitingHouseEnrolment,
  isLocalHouseSessionOpen,
  subscribeToHouseLedgerChanges,
} from '@features/house/local/engine';
import { useHouseEnrolmentLive } from '@features/house/local/enrolmentLive';
import { useHouseEnrolmentSignal } from '@features/house/local/enrolmentSignal';
import { isHouseLocalFirst } from '@features/house/local/flag';
import { runHouseLocalSync } from '@features/house/local/sync/orchestrator';
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

export type HouseJoinWait = {
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

/** The claim this device is standing on, as the screen needs to describe it. */
type ClaimState = { inviteId: string; sas: string; outcome: JoinOutcome | null };

/**
 * The invitee's half of the hand-off: am I still waiting, on what, and — when
 * the answer is "on nothing, any more" — getting this device out of the state
 * that wait left behind.
 *
 * Shown on the hub and on the Join screen. Both must: the hub, because a push
 * about this device's own claim lands there and a screen with no trace of what
 * the notification was about is worse than no notification; the Join screen,
 * because that is where the person just tapped Join and is now standing.
 *
 * Three sources, and each answers something the others cannot:
 *
 *  - the ENGINE says whether the home key has arrived — that is what ends the
 *    wait, and it flips inside a sync run rather than from anything a screen
 *    does, so it is read on every ledger change;
 *  - the PERSISTED CLAIM, because joining switches property and unmounts the
 *    screen that derived the digits — held in state alone the invitee comes back
 *    to nothing and has nothing to read out — and because it is where a finished
 *    outcome is kept, which is the only copy that outlives the property this
 *    hook is about to drop;
 *  - the CONTROL PLANE, for the two endings nobody tells this device about: the
 *    owner cancelled, or the invite expired. Without that the screen goes on
 *    saying "Waiting for approval…" about an invite that died yesterday.
 *
 * A lookup that fails leaves the wait alone rather than inventing an ending. A
 * wrong "it was cancelled" is worse than a stale "still waiting" — one of them
 * sends somebody to ask for a new invite they do not need.
 *
 * A terminal answer does two things beyond setting the banner. It is WRITTEN to
 * the claim record, so the next mount knows immediately instead of flashing the
 * dead invite's digits for the length of a round trip. And it DROPS the
 * half-joined property (`abandonHouseEnrolment`), because a claim that can never
 * be approved leaves behind a home that 403s every request and a set of join
 * controls disabled by this very wait — a dead end the person cannot leave, on
 * the exact screen they need in order to claim the replacement invite.
 */
export function useHouseJoinWait(): HouseJoinWait {
  const [claim, setClaim] = useState<ClaimState | null>(null);

  /**
   * Has the on-disk claim record been read yet?
   *
   * Needed because "no claim" and "not looked yet" are both `claim === null`,
   * and they must gate the Join button in OPPOSITE directions — see `awaiting`
   * at the end of this hook. Starts false so the very first render is the
   * conservative one.
   */
  const [claimLoaded, setClaimLoaded] = useState(false);

  // The gate flips inside the sync run, not from anything a screen does — so
  // re-read it whenever the ledger signals a change rather than only on mount.
  // Deliberately NOT filtered by property: a join ADDS one and makes it active,
  // and the event announcing that carries the new id.
  const [, bump] = useState(0);
  useEffect(() => subscribeToHouseLedgerChanges(() => bump((n) => n + 1)), []);
  const engineAwaiting =
    isHouseLocalFirst() && isLocalHouseSessionOpen() && isAwaitingHouseEnrolment();

  useEffect(() => {
    void (async () => {
      const pending = await recallJoinSas();
      setClaimLoaded(true);
      setClaim((previous) => {
        // Nothing on disk: keep an outcome this hook learned a moment ago —
        // there is still a person owed the explanation — and otherwise show
        // nothing.
        if (!pending) return previous?.outcome ? previous : null;
        return {
          inviteId: pending.inviteId,
          sas: pending.sas,
          // The record wins, then this session's own answer for the SAME invite:
          // the write may have failed silently (the store swallows that), and
          // re-reading is not a reason to un-tell somebody their invite is dead.
          // A record naming a DIFFERENT invite is a new claim, which clears the
          // old outcome — that is how the banner leaves the screen when the
          // person joins again.
          outcome:
            pending.outcome ?? (previous?.inviteId === pending.inviteId ? previous.outcome : null),
        };
      });
      if (!pending) return;
      if (pending.outcome) {
        // Retried here rather than only where the outcome is first learned: a
        // drop that failed once would otherwise never be attempted again, since
        // the recorded outcome stops the lookup path from running a second time.
        await dropClaimedProperty(pending);
        return;
      }
      if (engineAwaiting) return;
      // Only discard the record on a wait that ended WELL. `engineAwaiting`
      // reads the active property, which goes false for reasons that have
      // nothing to do with this claim — a property switch, a session reopening
      // mid-render — and forgetting on those takes the digits away from a device
      // still waiting to read them out, permanently.
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

    /**
     * Adopt a claim this hook has not seen yet, so refreshing SHOWS THE DIGITS.
     *
     * The loader effect above reads the record only when `engineAwaiting`
     * changes. A device that was ALREADY awaiting keys when it claimed — the
     * second phone that adopted a key-less home and then used an invite to get
     * the key — never changes that flag, so the effect does not re-run and the
     * SAS stays null. The member is then told "read the number below" with no
     * number below it, which is unusable: the owner's screen refuses to approve
     * until somebody reads six digits out.
     *
     * Doing it here rather than only in the effect also gives pull-to-refresh
     * its obvious meaning — re-read everything about my claim, not just whether
     * it has ended.
     */
    setClaim((previous) =>
      previous?.inviteId === pending.inviteId
        ? previous
        : { inviteId: pending.inviteId, sas: pending.sas, outcome: null },
    );

    let ended: JoinOutcome | null = null;
    try {
      const claimed = await lookupLocalFirstInviteById(pending.inviteId);
      if (claimed.status === 'revoked') ended = 'revoked';
      else if (claimed.status === 'expired') ended = 'expired';
      else if (claimed.status === 'approved') {
        // Approved, and this device still has no key: FETCH, never drop.
        //
        // `enrolment.approved` fires from the coordinator the instant the owner
        // taps Approve, which is BEFORE D1 writes the membership row. `/state`
        // 403s in that window. Treating that 403 as "removed" is how a home
        // vanishes from a phone that had just been let in.
        //
        // A real eviction is a revoked or expired invite (handled above), or the
        // member removing the property themselves. An approved invite means keep
        // the session and pull until the home key lands.
        const admitted = await isStillAdmitted(pending.householdId);
        if (admitted === 'no') {
          console.warn(
            `[HouseLocal] join-wait hh=${pending.householdId} invite approved but /state refused — keeping the property and syncing`,
          );
        }
        if (admitted !== 'unknown') {
          void runHouseLocalSync('join-wait-poll').catch(() => {
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
    // account of why the property went away.
    await noteJoinOutcome(ended);
    setClaim({ inviteId: pending.inviteId, sas: pending.sas, outcome: ended });
    await dropClaimedProperty(pending);
  }, [engineAwaiting]);

  // Live for as long as this is on screen: the coordinator socket carries the
  // answer to THIS device's claim, which is the one thing it cannot ask for and
  // the only thing it is waiting on.
  useHouseEnrolmentLive();

  const enrolmentRevision = useHouseEnrolmentSignal((state) => state.revision);
  useEffect(() => {
    void refreshOutcome();
  }, [enrolmentRevision, refreshOutcome]);

  /**
   * …and a timer under it, because every other trigger here can fail to fire.
   *
   * The socket needs a network and an eligible claim; the push needs APNs, which
   * never delivers in the Simulator and is denied or throttled often enough in
   * the wild; the ledger subscription only speaks when a sync run changes
   * something, and a device waiting on a key it has not been given syncs
   * nothing. With none of them the screen has NO recurring trigger at all — and
   * the Join button is disabled by that same wait, so the person cannot even
   * claim the replacement invite.
   *
   * Same ten seconds as the owner's side: the two are halves of one hand-off and
   * there is no reason for them to disagree about how long a stall lasts.
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
    /**
     * Waiting on an approval THIS DEVICE ASKED FOR — not merely holding a home
     * it has no key for.
     *
     * The distinction is what makes the Join button reachable. `engineAwaiting`
     * is true for two quite different devices:
     *
     *   1. one that claimed an invite and is waiting for the owner to approve —
     *      it has a claim record on disk, and Join must stay disabled so the
     *      person does not claim twice;
     *   2. one that signed in on a second phone, DISCOVERED a home already on
     *      the account, and adopted a key-less placeholder. It has no claim
     *      record and nothing in flight.
     *
     * Case 2 had Join disabled too, which is a dead end: the placeholder sets
     * `awaitingKeys`, `awaitingKeys` disabled the only control that could
     * resolve it, and no poll could ever help because there was no claim to
     * find an outcome for. The device sat on "Waiting for approval…" for an
     * approval nobody had been asked for — observed on House-C against staging,
     * where the invite stayed `status=active, claimed_device=NULL` however many
     * times Join was pressed. The header above already warns about the same
     * trap for an abandoned claim; this is the version of it that needs no
     * mistake to reach, just a second phone.
     *
     * `claimLoaded` keeps the FIRST render conservative. Until the record has
     * been read, `claim === null` means "not looked yet", and treating that as
     * "no claim" would flash Join enabled on a device that has in fact already
     * claimed — the race `mm-03-member-join` guards against by waiting for this
     * very label before it branches.
     */
    awaiting: engineAwaiting && (!claimLoaded || claim !== null) && !outcome,
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
 * Does the home still admit this device?
 *
 * Three answers, not two. `unknown` is the whole reason this returns a string: a
 * home that cannot be reached has said nothing, and treating silence as "you
 * were removed" would take somebody's home off their device because their train
 * went into a tunnel. Only an explicit refusal counts.
 *
 * 401 is deliberately NOT a refusal: it means this device's token has expired,
 * which says nothing about its membership and is fixed by signing in again.
 */
async function isStillAdmitted(householdId: string | null): Promise<'yes' | 'no' | 'unknown'> {
  const id = householdId ?? getActiveHouseholdId();
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
 * Take the half-joined property off this device, for a claim that has ended.
 *
 * Falls back to the ACTIVE property when the record does not name one. Records
 * written before the household id was stored are exactly the devices that were
 * already stuck, and they are the ones with the most to gain. The guess is safe
 * because it is not really a guess — `adoptJoinedHousehold` made the claimed
 * property ACTIVE, and `abandonHouseEnrolment` refuses any property that is not
 * still awaiting keys, so being wrong costs a no-op rather than somebody's home.
 *
 * Never throws: the banner is already up and already recorded, which is the half
 * the person reads.
 */
async function dropClaimedProperty(pending: PendingJoin): Promise<void> {
  const householdId = pending.householdId ?? getActiveHouseholdId();
  if (!householdId) return;
  try {
    await abandonHouseEnrolment(householdId);
  } catch {
    // Attempted again on the next mount rather than taking the screen down.
  }
}

/**
 * True when the claimed property is on this device and no longer waiting — i.e.
 * the key arrived and the enrolment finished.
 *
 * Both halves are load-bearing. `isAwaitingHouseEnrolment` alone answers false
 * for a property that was DROPPED as well as one that was let in, and treating
 * those alike discards the record that carries the only explanation the person
 * will ever get for the home disappearing.
 *
 * A record with no household id — written before the id was stored — is never
 * settled here: there is nothing to check it against, and keeping a spent record
 * costs one stale entry, while discarding a live one costs the invitee the
 * digits they are standing there to read out.
 */
function isEnrolmentSettled(householdId: string | null): boolean {
  if (!householdId) return false;
  return hasLocalHouseProperty(householdId) && !isAwaitingHouseEnrolment(householdId);
}
