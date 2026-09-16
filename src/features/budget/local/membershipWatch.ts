import { create } from 'zustand';

import { storageHelpers } from '@services/storage';
import { useAuthStore } from '@stores/authStore';

import {
  budgetHouseholdWasRegistered,
  listControlPlaneHouseholds,
  type ControlPlaneHousehold,
} from './controlPlaneClient';
import {
  createLocalBudgetHousehold,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  reconcileLocalHouseholdRole,
  removeLocalBudgetHousehold,
  type BudgetHouseholdSummary,
} from './engine';
import { syncHouseholdStoreFromLocalLedger } from './ensureSession';
import { isBudgetLocalFirst } from './flag';
import { syncBudgetLocalReminders } from './reminders/budgetLocalReminders';

/**
 * The other half of leaving a household: being taken out of one.
 *
 * `BudgetHouseholdScreen` already ends a membership and erases this phone's
 * copy in one confirmed act — but only for the person who taps Leave, and only
 * on the phone they tap it with. Two ways out of a household were left with no
 * local half at all:
 *
 *  - **an owner removes a member.** The removal happens on the OWNER's phone.
 *    The removed member's device is told nothing it can act on: its next sync
 *    starts failing, and every row of a household it is no longer in stays
 *    readable on disk — the budget, the spending, the savings, the history —
 *    for as long as the app is installed. That is the case this module exists
 *    for, and it is a data-retention bug, not a stale-cache one.
 *  - **a member leaves from ONE of their devices.** Leaving revokes every
 *    device that account holds in the household (see `mirrorEndedMembership`),
 *    so the second phone is out too — and the Worker deliberately sends the
 *    leaver no notification, because it is addressing the person who already
 *    knows. The second phone therefore learns nothing at all.
 *
 * Both end the same way and are detected the same way, which is the point: a
 * member who left and a member who was removed must leave the same household
 * behind, on every device either of them holds.
 *
 * WHAT COUNTS AS EVIDENCE
 * -----------------------
 * `GET /v2/households` lists the households this ACCOUNT holds an ACTIVE
 * membership in (`listHouseholdsForUser` filters on exactly that). A household
 * that is on this device, was registered on the control plane, and is missing
 * from a SUCCESSFUL listing is a membership that has ended. Nothing weaker is
 * accepted:
 *
 *  - a **403 on one household** is not used. It is the ambiguous signal — a
 *    fresh install whose registration has not landed answers 403, and so does
 *    the window between the coordinator approving an enrolment and D1 writing
 *    the membership row. `useBudgetJoinWait` documents what treating that as an
 *    eviction cost: a home that vanished from a phone which had just been let
 *    in. One 200 that enumerates every membership has no such window.
 *  - a **failed listing** removes nothing. Offline is silence, and silence is
 *    not an answer — the same rule `isStillAdmitted` and
 *    `budgetHouseholdControlPlaneStatus` are built on.
 *  - a **household with no registration marker** is never touched. It was never
 *    shared with anybody, so it is legitimately absent from the list, and it is
 *    the case the marker exists to keep separate — see
 *    `budgetHouseholdWasRegistered`.
 *  - a **household awaiting enrolment** is never touched. It has claimed an
 *    invite and has not been approved, so it is absent from the list by
 *    definition. `useBudgetJoinWait` owns that ending and drops it through
 *    `abandonHouseholdEnrolment`.
 *  - the **push** is not trusted to describe anything. `budget_member_removed`
 *    only makes this run NOW; the control plane still decides. A push is
 *    best-effort, can arrive out of order, and is the input to this flow an
 *    attacker can most easily make noise on.
 *
 * A REVOKED DEVICE IS NOT THIS
 * ----------------------------
 * `revokeLocalFirstDevice` takes one phone off a household and leaves the
 * membership standing — the person is still a member and may enrol again. The
 * household stays in their listing, so nothing here fires, which is correct:
 * that act is about a piece of hardware, this one is about a person.
 */

/** A household this device held and this account is no longer a member of. */
export type BudgetMembershipLoss = {
  householdId: string;
  /** As this device knew it. The only name the member will recognise. */
  householdName: string;
  /** ISO — when the local copy went. */
  at: string;
};

/**
 * How long a notice is kept if nobody ever reads it. Long enough to survive the
 * "removed on Friday, opens the app on Monday" case, short enough that a device
 * does not carry an explanation for a household nobody remembers.
 */
const NOTICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const NOTICE_KEY = 'budget-membership-losses-v1';

/**
 * The minimum gap between control-plane listings, for the callers that do not
 * force one.
 *
 * `runBudgetLocalSync` is the check's home because it is the one path that runs
 * on session open, on every foreground, on Sync now and after a join. It is
 * ALSO polled every ten seconds by `useBudgetJoinWait` and `enrolmentLive`
 * while a device waits to be let in, and one extra GET per sync would turn that
 * wait into six requests a minute for an answer that cannot have changed. The
 * push path and the pull-to-refresh path force, so nothing a member does by
 * hand is throttled.
 */
const LIST_MIN_INTERVAL_MS = 60_000;

let lastCheckedAt = 0;
/** Single-flight: two triggers landing together ask the list once. */
let inFlight: Promise<BudgetMembershipLoss[]> | null = null;

type MembershipLossState = {
  /** Newest first. Empty until `hydrateBudgetMembershipLosses` has run. */
  losses: BudgetMembershipLoss[];
  hydrated: boolean;
};

/**
 * The notices, live.
 *
 * Persisted as well as in memory for the same reason `inviteSecretStore` keeps
 * a join outcome on disk: this is the only account the member will ever get of
 * why a household disappeared, and the household it describes is gone, so
 * nothing in engine state can re-derive it. A notice held in a component would
 * die with the sync run that created it — which is very often a background run
 * on a screen nobody is looking at.
 */
export const useBudgetMembershipLosses = create<MembershipLossState>(() => ({
  losses: [],
  hydrated: false,
}));

function isLive(loss: BudgetMembershipLoss, now: number): boolean {
  const at = Date.parse(loss.at);
  return Number.isNaN(at) || now - at < NOTICE_TTL_MS;
}

async function readNotices(): Promise<BudgetMembershipLoss[]> {
  try {
    const raw = await storageHelpers.getString(NOTICE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as BudgetMembershipLoss[]).filter(
      (loss) => loss && typeof loss.householdId === 'string' && isLive(loss, now),
    );
  } catch {
    // An unreadable store costs the member an explanation, not their app.
    return [];
  }
}

async function writeNotices(losses: BudgetMembershipLoss[]): Promise<void> {
  useBudgetMembershipLosses.setState({ losses, hydrated: true });
  try {
    await storageHelpers.setString(NOTICE_KEY, JSON.stringify(losses));
  } catch {
    // In memory is enough for this session, which is the session the member is
    // most likely to be looking at.
  }
}

/** Load the persisted notices into the store. Safe to call on every mount. */
export async function hydrateBudgetMembershipLosses(): Promise<void> {
  if (useBudgetMembershipLosses.getState().hydrated) return;
  const losses = await readNotices();
  useBudgetMembershipLosses.setState({ losses, hydrated: true });
}

/** The member has read it. The household is long gone either way. */
export async function dismissBudgetMembershipLoss(householdId: string): Promise<void> {
  const kept = useBudgetMembershipLosses
    .getState()
    .losses.filter((loss) => loss.householdId !== householdId);
  await writeNotices(kept);
}

/**
 * Sign-out and account switch — the next account must not inherit this one's
 * throttle window or its notices. Mirrors `resetBudgetControlPlaneCache`, and is
 * called from the same place.
 */
export function resetBudgetMembershipWatch(): void {
  lastCheckedAt = 0;
  inFlight = null;
  useBudgetMembershipLosses.setState({ losses: [], hydrated: false });
}

/**
 * Take off this device every household this account has been removed from.
 *
 * Returns what was removed — empty when nothing was, when the list could not be
 * loaded, or when the throttle window has not elapsed.
 *
 * NEVER throws, and the catch here is what makes that true rather than a
 * comment. `runBudgetLocalSync` awaits this before its fan-out: an exception
 * escaping would take down the sync of every household on the device, including
 * the ones nobody has been removed from. This check finding nothing — or
 * failing outright — must cost a log line and nothing else.
 */
export function purgeRevokedBudgetHouseholds(
  trigger: string,
  options?: { force?: boolean },
): Promise<BudgetMembershipLoss[]> {
  if (inFlight) return inFlight;
  const run = check(trigger, options?.force === true)
    .catch((error: unknown) => {
      console.warn(`[BudgetLocal] membership/check trigger=${trigger} failed`, error);
      return [] as BudgetMembershipLoss[];
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

/**
 * The role half of the check: what this account IS in each household it kept.
 *
 * A membership can end — that is everything above — but it can also change
 * shape, and the second was never mirrored anywhere. `my_role` is sealed into
 * the local record at join and never rewritten, so an owner who promotes
 * somebody does it entirely on their own phone: the promoted member's device
 * goes on believing what the invite said, indefinitely.
 *
 * The cost is not a mislabelled row. `maybePublishCheckpoint` is owner-only and
 * reads the local field, so a promoted member keeps declining to publish the
 * household snapshot on every sync — and a joining member has nothing else that
 * can give them the months predating their join. `Sweet Home` sat that way with
 * one member holding 144 of 586 records and both phones reporting a healthy
 * sync, because a device cannot tell from the inside that it is missing history.
 *
 * Best-effort per household: a session that is not open cannot be written, and
 * a failure here must never cost the revocation check that follows.
 */
async function reconcileRoles(
  remote: readonly ControlPlaneHousehold[],
  candidates: readonly BudgetHouseholdSummary[],
  trigger: string,
): Promise<void> {
  const held = new Set(candidates.map((household) => household.householdId));
  let changed = false;
  for (const household of remote) {
    if (!held.has(household.id)) continue;
    try {
      if (await reconcileLocalHouseholdRole(household.id, household.role)) {
        changed = true;
        // Loud, because it silently changes what this device will do on every
        // subsequent sync — a device that starts publishing checkpoints, or
        // stops, and no screen says so.
        console.log(
          `[BudgetLocal] membership/role trigger=${trigger} hh=${household.id} is now ${household.role} on the control plane`,
        );
      }
    } catch (error) {
      console.warn(`[BudgetLocal] membership/role hh=${household.id} not applied`, error);
    }
  }
  // One republish for the whole pass: the switcher and every screen reading
  // `my_role` are downstream of this store, and nothing else notifies them.
  if (changed) syncHouseholdStoreFromLocalLedger();
}

async function check(trigger: string, force: boolean): Promise<BudgetMembershipLoss[]> {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return [];
  if (!force && Date.now() - lastCheckedAt < LIST_MIN_INTERVAL_MS) return [];
  if (!answersForThisAccount(trigger)) return [];

  // Registered, and not mid-enrolment — see the header for why each exclusion
  // is load-bearing. Done BEFORE the network call so a device holding only
  // solo households never makes one.
  const candidates: BudgetHouseholdSummary[] = [];
  for (const household of listLocalBudgetHouseholds()) {
    if (household.awaitingEnrolment) continue;
    if (!(await budgetHouseholdWasRegistered(household.householdId))) continue;
    candidates.push(household);
  }
  if (candidates.length === 0) return [];

  let remote: ControlPlaneHousehold[];
  try {
    remote = await listControlPlaneHouseholds();
  } catch (error) {
    // Deliberately NOT stamping `lastCheckedAt`: a listing that failed has not
    // been made, and the next trigger must be allowed to try.
    console.warn(
      `[BudgetLocal] membership/check trigger=${trigger} — the household list did not load; nothing removed`,
      error,
    );
    return [];
  }
  lastCheckedAt = Date.now();
  const remoteIds = new Set(remote.map((household) => household.id));

  // The same listing answers "what am I in this household now", and it is the
  // only repeating call that does — so the role reconcile rides along here
  // rather than costing a GET of its own. Before the revocation check, because
  // it is the half that must not be skipped by an early return below.
  await reconcileRoles(remote, candidates, trigger);

  const revoked = candidates.filter((household) => !remoteIds.has(household.householdId));
  if (revoked.length === 0) {
    console.log(
      `[BudgetLocal] membership/check trigger=${trigger} shared=${candidates.length} all memberships still stand`,
    );
    return [];
  }

  const losses: BudgetMembershipLoss[] = [];
  for (const household of revoked) {
    // Said loudly and BEFORE the act, because the act is irreversible and this
    // line is the only trace of it left on the device afterwards.
    console.warn(
      `[BudgetLocal] membership/revoked trigger=${trigger} hh=${household.householdId} "${household.name}" — this account is no longer a member; erasing the local copy`,
    );
    try {
      await purgeRevokedHousehold(household.householdId);
      losses.push({
        householdId: household.householdId,
        householdName: household.name,
        at: new Date().toISOString(),
      });
    } catch (error) {
      // One household failing must not cost the others theirs, and a failure
      // here is retried on the next run — the list will still be missing it.
      console.error(
        `[BudgetLocal] membership/purge hh=${household.householdId} failed`,
        error,
      );
    }
  }
  if (losses.length === 0) return [];

  // Read what is on disk BEFORE writing over it. This runs from a background
  // sync, which is very often the first thing that touches this store in a
  // launch — no panel has mounted, so the in-memory list is empty, and merging
  // against it would throw away the notice for a household removed last week
  // that the member has not seen yet.
  await hydrateBudgetMembershipLosses();
  const now = Date.now();
  await writeNotices([
    ...losses,
    ...useBudgetMembershipLosses
      .getState()
      .losses.filter(
        (loss) => isLive(loss, now) && !losses.some((l) => l.householdId === loss.householdId),
      ),
  ]);
  await settleAfterPurge();
  return losses;
}

/**
 * Is the account that will be asked the same one that owns these ledgers?
 *
 * The remaining way `GET /v2/households` can be COMPLETE and still wrong. The
 * other two are closed by construction: the query behind it has no LIMIT and no
 * pagination — one statement, every active membership — and a device that is
 * mid-enrolment is excluded by `awaitingEnrolment` above and could not be
 * missing from the list anyway, because `approveInvite` writes `lf_memberships`
 * inside the approving request, while the joining device only stops awaiting
 * after a later mailbox round fetches the wrapped key. Non-awaiting therefore
 * implies the membership row exists.
 *
 * An ACCOUNT SWITCH is not closed that way. `apiClient` sends whatever token the
 * auth store currently holds, and the engine's sessions are torn down and
 * reopened around a switch rather than atomically with it. Ask during that gap
 * and the answer is a complete, correct, 200 listing — of somebody else's
 * households — and every household on this device would look revoked. That is
 * the one shape of "successful but incomplete" that could erase a budget nobody
 * has been removed from.
 *
 * The ledger's `memberId` IS the user id (`engine.ts` — `memberId: input.userId`),
 * and a cold open reads it back off disk, so the comparison is between what the
 * ledgers on this device belong to and who the next request will be sent as.
 * They disagree only in the gap; refusing to answer in it costs one skipped
 * round.
 */
function answersForThisAccount(trigger: string): boolean {
  const userId = useAuthStore.getState().user?.id;
  const ledgerMemberId = getLocalLedger().memberId;
  if (userId && userId === ledgerMemberId) return true;
  console.warn(
    `[BudgetLocal] membership/check trigger=${trigger} skipped — the signed-in account (${userId ?? 'none'}) is not the one these ledgers belong to (${ledgerMemberId}); a household list for another account must never decide this`,
  );
  return false;
}

/**
 * Erase one household, keeping the app in a state it can render.
 *
 * `removeLocalBudgetHousehold` refuses to drop the LAST household — every
 * Budget screen reads `requireEngine()` and a device with no ledger at all
 * throws on the next render. That refusal is right for the member-initiated
 * paths, which is why both Delete and Leave stop at the confirm and say so; it
 * cannot apply here, because nobody is choosing this and "you were removed, so
 * your budget stays on the phone" is exactly the outcome that must not happen.
 *
 * So a fresh empty household is minted FIRST and the revoked one dropped
 * against it. That is the same landing `eraseLocalBudgetData` gives the Danger
 * Zone: an empty ledger, named after the member, ready to be used or to have an
 * invite claimed into it. `createLocalBudgetHousehold` deliberately does not
 * activate, and it does not need to — the removal below activates the survivor
 * when the household it drops was the active one.
 *
 * The new household is local-only: it earns a control-plane row the first time
 * it needs a peer to find it, and not before.
 */
async function purgeRevokedHousehold(householdId: string): Promise<void> {
  if (listLocalBudgetHouseholds().length === 1) {
    const user = useAuthStore.getState().user;
    await createLocalBudgetHousehold({
      displayName: user?.display_name ?? user?.email ?? null,
    });
  }
  await removeLocalBudgetHousehold(householdId);
}

/**
 * The three things that are stale the moment a household leaves the device.
 *
 *  - the **household store** is what every domain API is called with, and
 *    `removeLocalBudgetHousehold` only emits a ledger change when it drops the
 *    ACTIVE household — so a background household purged here would stay in the
 *    switcher, exactly as it would on the Leave path, which makes the same
 *    explicit republish for the same reason;
 *  - the **reminders** are notifications scheduled off rows that no longer
 *    exist, and cancelling them is a wholesale reschedule;
 *  - the **push registration** is a snapshot of the household list taken when it
 *    last ran (see `registerBudgetLocalPushToken`).
 *
 * Each is swallowed on its own: the erasure has already happened and is the
 * part that had to succeed, and a household this device is not in must not stay
 * on it because a notification could not be rescheduled.
 *
 * `pushWake` is the one reached DYNAMICALLY, and it has to be: it imports
 * `sync/orchestrator`, which imports this module, so a static import here would
 * close that loop. The other two reach nothing that comes back.
 */
async function settleAfterPurge(): Promise<void> {
  try {
    syncHouseholdStoreFromLocalLedger();
  } catch (error) {
    console.warn('[BudgetLocal] membership/purge store republish skipped', error);
  }
  try {
    await syncBudgetLocalReminders();
  } catch (error) {
    console.warn('[BudgetLocal] membership/purge reminder resync skipped', error);
  }
  await import('./pushWake')
    .then((m) => m.registerBudgetLocalPushToken())
    .catch((error: unknown) => {
      console.warn('[BudgetLocal] membership/purge push re-register skipped', error);
    });
}
