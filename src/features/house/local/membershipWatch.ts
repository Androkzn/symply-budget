import { create } from 'zustand';

import { storageHelpers } from '@services/storage';
import { useAuthStore } from '@stores/authStore';

import { houseHouseholdWasRegistered, listControlPlaneHouseholds } from './controlPlaneClient';
import {
  createLocalHouseProperty,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  removeLocalHouseProperty,
  type HousePropertySummary,
} from './engine';
import { syncHouseholdStoreFromLocalLedger } from './ensureSession';
import { isHouseLocalFirst } from './flag';
import { syncHouseLocalReminders } from './reminders/houseLocalReminders';

/**
 * The other half of leaving a home: being taken out of one.
 *
 * `HousePropertiesScreen` already ends a membership and erases this phone's copy
 * in one confirmed act — but only for the person who taps Leave, and only on the
 * phone they tap it with. Two ways out of a home were left with no local half at
 * all:
 *
 *  - **an owner removes a member.** The removal happens on the OWNER's phone.
 *    The removed member's device is told nothing it can act on: its next sync
 *    starts failing, and every row of a home it is no longer in stays readable
 *    on disk — tasks, spaces, appliances, projects, documents, the lot — for as
 *    long as the app is installed. That is the case this module exists for, and
 *    it is a data-retention bug, not a stale-cache one.
 *  - **a member leaves from ONE of their devices.** Leaving revokes every device
 *    that account holds in the household (see `mirrorEndedMembership` on the
 *    Worker), so the second phone is out too — and the Worker deliberately sends
 *    the leaver no notification, because it is addressing the person who already
 *    knows. The second phone therefore learns nothing at all.
 *
 * Both end the same way and are detected the same way, which is the point: a
 * member who left and a member who was removed must leave the same home behind,
 * on every device either of them holds.
 *
 * Budget's `features/budget/local/membershipWatch.ts` is the same module against
 * the same `/v2` control plane, and the two are kept deliberately parallel: the
 * evidence rules below are the part that must not drift, because getting them
 * wrong deletes somebody's home.
 *
 * WHAT COUNTS AS EVIDENCE
 * -----------------------
 * `GET /v2/households` lists the households this ACCOUNT holds an ACTIVE
 * membership in (`listHouseholdsForUser` filters on exactly that). A property
 * that is on this device, was registered on the control plane, and is missing
 * from a SUCCESSFUL listing is a membership that has ended. Nothing weaker is
 * accepted:
 *
 *  - a **403 on one property** is not used. It is the ambiguous signal — a fresh
 *    install whose registration has not landed answers 403, and so does the
 *    window between the coordinator approving an enrolment and D1 writing the
 *    membership row. `useHouseJoinWait` documents what treating that as an
 *    eviction cost: a home that vanished from a phone which had just been let
 *    in. One 200 that enumerates every membership has no such window.
 *  - a **failed listing** removes nothing. Offline is silence, and silence is
 *    not an answer.
 *  - a **property with no registration marker** is never touched. It was never
 *    shared with anybody, so it is legitimately absent from the list — see
 *    `houseHouseholdWasRegistered`.
 *  - a **property awaiting enrolment** is never touched. It has claimed an
 *    invite and has not been approved, so it is absent from the list by
 *    definition. `useHouseJoinWait` owns that ending through
 *    `abandonHouseEnrolment`.
 *  - the **push** is not trusted to describe anything. `house_member_removed`
 *    only makes this run NOW; the control plane still decides.
 *
 * A REVOKED DEVICE IS NOT THIS
 * ----------------------------
 * Revoking a device takes one phone off a home and leaves the membership
 * standing — the person is still a member and may enrol again. The home stays in
 * their listing, so nothing here fires, which is correct: that act is about a
 * piece of hardware, this one is about a person.
 */

/** A home this device held and this account is no longer a member of. */
export type HouseMembershipLoss = {
  householdId: string;
  /** As this device knew it. The only name the member will recognise. */
  householdName: string;
  /** ISO — when the local copy went. */
  at: string;
};

/**
 * How long a notice is kept if nobody ever reads it. Long enough to survive the
 * "removed on Friday, opens the app on Monday" case, short enough that a device
 * does not carry an explanation for a home nobody remembers.
 */
const NOTICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const NOTICE_KEY = 'house-membership-losses-v1';

/**
 * The minimum gap between control-plane listings, for the callers that do not
 * force one.
 *
 * `runHouseLocalSync` is the check's home because it is the one path that runs
 * on session open, on every foreground, on Sync now and after a join. It is
 * ALSO polled every ten seconds by `useHouseJoinWait` while a device waits to be
 * let in, and one extra GET per sync would turn that wait into six requests a
 * minute for an answer that cannot have changed. The push path forces, so the
 * event that matters is never throttled.
 */
const LIST_MIN_INTERVAL_MS = 60_000;

let lastCheckedAt = 0;
/** Single-flight: two triggers landing together ask the list once. */
let inFlight: Promise<HouseMembershipLoss[]> | null = null;

type MembershipLossState = {
  /** Newest first. Empty until `hydrateHouseMembershipLosses` has run. */
  losses: HouseMembershipLoss[];
  hydrated: boolean;
};

/**
 * The notices, live.
 *
 * Persisted as well as in memory for the same reason `inviteSecretStore` keeps a
 * join outcome on disk: this is the only account the member will ever get of why
 * a home disappeared, and the home it describes is gone, so nothing in engine
 * state can re-derive it. A notice held in a component would die with the sync
 * run that created it — which is very often a background run on a screen nobody
 * is looking at.
 */
export const useHouseMembershipLosses = create<MembershipLossState>(() => ({
  losses: [],
  hydrated: false,
}));

function isLive(loss: HouseMembershipLoss, now: number): boolean {
  const at = Date.parse(loss.at);
  return Number.isNaN(at) || now - at < NOTICE_TTL_MS;
}

async function readNotices(): Promise<HouseMembershipLoss[]> {
  try {
    const raw = await storageHelpers.getString(NOTICE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as HouseMembershipLoss[]).filter(
      (loss) => loss && typeof loss.householdId === 'string' && isLive(loss, now),
    );
  } catch {
    // An unreadable store costs the member an explanation, not their app.
    return [];
  }
}

async function writeNotices(losses: HouseMembershipLoss[]): Promise<void> {
  useHouseMembershipLosses.setState({ losses, hydrated: true });
  try {
    await storageHelpers.setString(NOTICE_KEY, JSON.stringify(losses));
  } catch {
    // In memory is enough for this session, which is the session the member is
    // most likely to be looking at.
  }
}

/** Load the persisted notices into the store. Safe to call on every mount. */
export async function hydrateHouseMembershipLosses(): Promise<void> {
  if (useHouseMembershipLosses.getState().hydrated) return;
  const losses = await readNotices();
  useHouseMembershipLosses.setState({ losses, hydrated: true });
}

/** The member has read it. The home is long gone either way. */
export async function dismissHouseMembershipLoss(householdId: string): Promise<void> {
  const kept = useHouseMembershipLosses
    .getState()
    .losses.filter((loss) => loss.householdId !== householdId);
  await writeNotices(kept);
}

/**
 * Sign-out and account switch — the next account must not inherit this one's
 * throttle window or its notices. Mirrors `resetHouseControlPlaneCache`, and is
 * called from the same place.
 */
export function resetHouseMembershipWatch(): void {
  lastCheckedAt = 0;
  inFlight = null;
  useHouseMembershipLosses.setState({ losses: [], hydrated: false });
}

/**
 * Take off this device every home this account has been removed from.
 *
 * Returns what was removed — empty when nothing was, when the list could not be
 * loaded, or when the throttle window has not elapsed.
 *
 * NEVER throws, and the catch here is what makes that true rather than a
 * comment. `runHouseLocalSync` awaits this before its fan-out: an exception
 * escaping would take down the sync of every property on the device, including
 * the ones nobody has been removed from. This check finding nothing — or failing
 * outright — must cost a log line and nothing else.
 */
export function purgeRevokedHouseProperties(
  trigger: string,
  options?: { force?: boolean },
): Promise<HouseMembershipLoss[]> {
  if (inFlight) return inFlight;
  const run = check(trigger, options?.force === true)
    .catch((error: unknown) => {
      console.warn(`[HouseLocal] membership/check trigger=${trigger} failed`, error);
      return [] as HouseMembershipLoss[];
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

async function check(trigger: string, force: boolean): Promise<HouseMembershipLoss[]> {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return [];
  if (!force && Date.now() - lastCheckedAt < LIST_MIN_INTERVAL_MS) return [];
  if (!answersForThisAccount(trigger)) return [];

  // Registered, and not mid-enrolment — see the header for why each exclusion
  // is load-bearing. Done BEFORE the network call so a device holding only
  // private homes never makes one.
  const candidates: HousePropertySummary[] = [];
  for (const property of listLocalHouseProperties()) {
    if (property.awaitingEnrolment) continue;
    if (!(await houseHouseholdWasRegistered(property.householdId))) continue;
    candidates.push(property);
  }
  if (candidates.length === 0) return [];

  let remoteIds: Set<string>;
  try {
    remoteIds = new Set((await listControlPlaneHouseholds()).map((household) => household.id));
  } catch (error) {
    // Deliberately NOT stamping `lastCheckedAt`: a listing that failed has not
    // been made, and the next trigger must be allowed to try.
    console.warn(
      `[HouseLocal] membership/check trigger=${trigger} — the household list did not load; nothing removed`,
      error,
    );
    return [];
  }
  lastCheckedAt = Date.now();

  const revoked = candidates.filter((property) => !remoteIds.has(property.householdId));
  if (revoked.length === 0) {
    console.log(
      `[HouseLocal] membership/check trigger=${trigger} shared=${candidates.length} all memberships still stand`,
    );
    return [];
  }

  const losses: HouseMembershipLoss[] = [];
  for (const property of revoked) {
    // Said loudly and BEFORE the act, because the act is irreversible and this
    // line is the only trace of it left on the device afterwards.
    console.warn(
      `[HouseLocal] membership/revoked trigger=${trigger} hh=${property.householdId} "${property.name}" — this account is no longer a member; erasing the local copy`,
    );
    try {
      await purgeRevokedProperty(property.householdId);
      losses.push({
        householdId: property.householdId,
        householdName: property.name,
        at: new Date().toISOString(),
      });
    } catch (error) {
      // One property failing must not cost the others theirs, and a failure here
      // is retried on the next run — the list will still be missing it.
      console.error(`[HouseLocal] membership/purge hh=${property.householdId} failed`, error);
    }
  }
  if (losses.length === 0) return [];

  // Read what is on disk BEFORE writing over it. This runs from a background
  // sync, which is very often the first thing that touches this store in a
  // launch — no panel has mounted, so the in-memory list is empty, and merging
  // against it would throw away the notice for a home removed last week that the
  // member has not seen yet.
  await hydrateHouseMembershipLosses();
  const now = Date.now();
  await writeNotices([
    ...losses,
    ...useHouseMembershipLosses
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
 * households — and every property on this device would look revoked. That is the
 * one shape of "successful but incomplete" that could erase a home nobody has
 * been removed from.
 *
 * The ledger's `memberId` IS the user id (`engine.ts` — `memberId: input.userId`),
 * and a cold open reads it back off disk, so the comparison is between what the
 * ledgers on this device belong to and who the next request will be sent as.
 * They disagree only in the gap; refusing to answer in it costs one skipped
 * round.
 */
function answersForThisAccount(trigger: string): boolean {
  const userId = useAuthStore.getState().user?.id;
  const ledgerMemberId = getLocalHouseLedger().memberId;
  if (userId && userId === ledgerMemberId) return true;
  console.warn(
    `[HouseLocal] membership/check trigger=${trigger} skipped — the signed-in account (${userId ?? 'none'}) is not the one these ledgers belong to (${ledgerMemberId}); a household list for another account must never decide this`,
  );
  return false;
}

/**
 * Erase one property, keeping the app in a state it can render.
 *
 * `removeLocalHouseProperty` refuses to drop the LAST property — every House
 * screen reads the active ledger and a device with none at all throws on the
 * next render. That refusal is right for the member-initiated paths, which is
 * why both Delete and Leave stop at the confirm and say so; it cannot apply
 * here, because nobody is choosing this and "you were removed, so your home
 * stays on the phone" is exactly the outcome that must not happen.
 *
 * So a fresh empty property is minted FIRST and the revoked one dropped against
 * it: an empty home, named after the member, ready to be used or to have an
 * invite claimed into it. `createLocalHouseProperty` deliberately does not
 * activate, and it does not need to — the removal below activates the survivor
 * when the property it drops was the active one.
 *
 * The new property is local-only: it earns a control-plane row the first time it
 * needs a peer to find it, and not before.
 */
async function purgeRevokedProperty(householdId: string): Promise<void> {
  if (listLocalHouseProperties().length === 1) {
    const user = useAuthStore.getState().user;
    await createLocalHouseProperty({
      displayName: user?.display_name ?? user?.email ?? null,
    });
  }
  await removeLocalHouseProperty(householdId);
}

/**
 * The three things that are stale the moment a property leaves the device.
 *
 *  - the **household store** is what every domain API is called with, and
 *    `removeLocalHouseProperty` only emits a ledger change when it drops the
 *    ACTIVE property — so a background property purged here would stay in the
 *    switcher, exactly as it would on the Leave path, which makes the same
 *    explicit republish for the same reason;
 *  - the **reminders** are notifications scheduled off rows that no longer
 *    exist, and cancelling them is a wholesale reschedule. `includeColdProperties`
 *    because the purge can happen while the member is looking at a different
 *    home, and the cold ones are exactly the ones whose reminders nobody has
 *    re-derived this session;
 *  - the **push registration** is a snapshot of the property list taken when it
 *    last ran (see `registerHouseLocalPushToken`).
 *
 * Each is swallowed on its own: the erasure has already happened and is the part
 * that had to succeed, and a home this device is not in must not stay on it
 * because a notification could not be rescheduled.
 *
 * `pushWake` is the one reached DYNAMICALLY, and it has to be: it imports
 * `sync/orchestrator`, which imports this module, so a static import here would
 * close that loop. The other two reach nothing that comes back.
 */
async function settleAfterPurge(): Promise<void> {
  try {
    syncHouseholdStoreFromLocalLedger();
  } catch (error) {
    console.warn('[HouseLocal] membership/purge store republish skipped', error);
  }
  try {
    await syncHouseLocalReminders({ includeColdProperties: true });
  } catch (error) {
    console.warn('[HouseLocal] membership/purge reminder resync skipped', error);
  }
  await import('./pushWake')
    .then((m) => m.registerHouseLocalPushToken())
    .catch((error: unknown) => {
      console.warn('[HouseLocal] membership/purge push re-register skipped', error);
    });
}
