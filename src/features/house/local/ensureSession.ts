// Side-effect BEFORE engine/@symply/local-first — noble caches crypto at import.
import './cryptoPolyfill';

import type { Household } from '@api/households';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import type { ControlPlaneHousehold } from './controlPlaneClient';
import {
  activateLocalHouseProperty,
  closeLocalHouseSession,
  createLocalHouseProperty,
  getActiveHouseholdId,
  getLocalHouseLedger,
  isLocalHouseSessionOpen,
  listLocalHouseProperties,
  openLocalHouseSession,
  openLocalHouseSessionWithMintDecision,
  resetLocalHouseSession,
  subscribeToHouseLedgerChanges,
  type HouseEmptyDeviceDecision,
  type HousePropertySummary,
} from './engine';
import { HouseLocalNotReadyError } from './errors';
import { isHouseLocalFirst } from './flag';
import {
  refreshHouseHouseholdRoster,
  republishActiveHouseRoster,
  resetHouseRosters,
} from './householdRoster';
import { syncHouseLocalReminders, cancelHouseLocalReminders } from './reminders/houseLocalReminders';
import {
  clearHouseWidgetProjection,
  startHouseWidgetProjection,
  stopHouseWidgetProjection,
} from './reminders/widgetProjection';
import { startHouseAutoSync, stopHouseAutoSync } from './sync/autoSync';
import { startHouseLedgerRefreshBridge } from './sync/ledgerRefresh';

/** The ledger row's role is free text; the store's is a two-value union. */
function toStoreRole(role: string): 'owner' | 'member' {
  return role.trim().toLowerCase() === 'owner' ? 'owner' : 'member';
}

/**
 * A store record for a property this device holds but has NOT hydrated.
 *
 * `listLocalHouseProperties()` is synchronous and cold on purpose: it reads only
 * the fields a switcher needs, so listing every property costs no row
 * decryption. That matters — a member with three homes must not pay a cold open
 * three times over just to see three names — but it means the full `Household`
 * of a background property is not reachable without hydrating it.
 *
 * So the previously published record is reused where there is one. It survives
 * relaunches (the store persists `households`) and it was published from that
 * property's real ledger the last time it was active, which makes it the best
 * copy available; only the two fields the summary is authoritative about are
 * refreshed over it, so a rename lands without a hydration.
 */
function householdFromSummary(
  summary: HousePropertySummary,
  previous: Household | undefined,
): Household {
  const role = toStoreRole(summary.role);
  if (previous) {
    return { ...previous, name: summary.name, my_role: role };
  }
  // First sighting of a property that has never been active while this store
  // existed — a signed-out-and-back-in device whose persisted list was reset
  // while the ledgers stayed on disk. `created_at` is left EMPTY rather than
  // stamped with now: an invented timestamp would jump a years-old home to the
  // top of a newest-first list. The real record replaces this the moment the
  // member switches into it.
  return {
    id: summary.householdId,
    name: summary.name,
    address_line1: null,
    address_line2: null,
    city: null,
    state_province: null,
    postal_code: null,
    country: null,
    unit_system: null,
    photo_key: null,
    photo_url: null,
    purchase_price: null,
    purchase_date: null,
    created_at: '',
    updated_at: '',
    member_count: 1,
    my_role: role,
  };
}

/**
 * Publish the local engine's property set into `householdStore`.
 *
 * Two jobs, and the second one is what multi-property needs.
 *
 * 1. Point `currentHousehold` at the open ledger's property. Required after a
 *    backup restore that replaces `hh_local_*` with a migrated id — otherwise
 *    every household-scoped facade throws a mismatch and screens look empty.
 * 2. Publish the REAL list. This used to force `households` to
 *    `[ledger.household]`, which was true when a device held one ledger and is a
 *    lie now: it hid every other home from the switcher, and — because it runs
 *    on every screen focus — it deleted a just-joined home from the list moments
 *    after it appeared.
 *
 * Synchronous, and it stays that way: it publishes what the engine already holds
 * in memory. Making it async to fetch the full `Household` of every cold
 * property would put N row-decryptions on a path that runs on every focus.
 */
export function syncHouseholdStoreFromLocalLedger(): void {
  if (!isHouseLocalFirst() || !isLocalHouseSessionOpen()) return;
  const ledger = getLocalHouseLedger();
  const activeHouseholdId = getActiveHouseholdId() ?? ledger.household.id;
  const previous = new Map(
    useHouseholdStore.getState().households.map((household) => [household.id, household]),
  );

  const summaries = listLocalHouseProperties();
  // The ACTIVE property is taken from the live ledger — hydrated, authoritative,
  // and the only one whose full record is in memory.
  //
  // COPY, never the live object. `useHouseholdStore` runs through
  // `zustand/middleware/immer`, which DEEP-FREEZES everything it stores — and
  // `ledger.household` is the engine's own mutable record, not a snapshot.
  // Publishing it by reference freezes it in place, so the next local write
  // (which stamps `ledger.household.updated_at` on every create / update /
  // delete) throws `TypeError: Cannot assign to read-only property`. That
  // surfaces as "Save does nothing": the form's save throws, the screen never
  // closes and nothing is persisted.
  const activeHouseholdRecord: Household = { ...ledger.household };
  const households: Household[] =
    summaries.length > 0
      ? summaries.map((summary) =>
          summary.householdId === activeHouseholdId
            ? activeHouseholdRecord
            : householdFromSummary(summary, previous.get(summary.householdId)),
        )
      : [activeHouseholdRecord];
  const currentHousehold =
    households.find((household) => household.id === activeHouseholdId) ?? activeHouseholdRecord;
  // Swap the member list to whichever property is now active BEFORE the store
  // update, and re-set the same array inside it, so no subscriber can observe
  // property A's `currentHousehold` next to property B's members. The roster
  // cache lives in `householdRoster` — the module the control plane publishes
  // through — because two caches for one screen slot is how they drift.
  const currentHouseholdMembers = republishActiveHouseRoster();

  useHouseholdStore.setState({
    households,
    currentHousehold,
    currentHouseholdMembers,
    isLoading: false,
    error: null,
  });
  console.log('[HouseLocal] householdStore synced', {
    householdId: currentHousehold.id,
    name: currentHousehold.name,
    households: households.length,
  });
}

/** Live only while a session is open, and only ever one — see below. */
let unwatchPropertySet: (() => void) | null = null;

/**
 * Keep `householdStore` in step with the engine's property set, whoever moved it.
 *
 * Every change to that set is an engine act that already emits a ledger change:
 * `activateLocalHouseProperty` switches, `createLocalHouseProperty` adds,
 * `removeLocalHouseProperty` drops and falls back, `adoptJoinedHousehold` adds
 * and activates, `renameLocalHouseProperty` renames. Following that event beats
 * trusting five call sites to each remember `syncHouseholdStoreFromLocalLedger()`,
 * and the cost of one forgetting is not a stale label but an outage:
 * `currentHousehold.id` is what every household-scoped API is called with, and
 * the local facades throw on a mismatch — so a store still pointing at the home
 * the member just left renders their screens empty while the data sits on disk,
 * decrypted and one id away.
 *
 * Deliberately NOT filtered on `change.householdId`. That filter is right for
 * `ledgerRefresh`, which repaints the foreground property's screens; here a
 * background property's very first op is exactly the event that must be noticed,
 * because it is a home the switcher is not yet showing.
 *
 * Cheap by construction: the common case is three comparisons over state already
 * in memory, and only a genuine disagreement publishes.
 */
function startPropertySetWatch(): void {
  if (unwatchPropertySet) return;
  unwatchPropertySet = subscribeToHouseLedgerChanges(() => {
    if (!isLocalHouseSessionOpen()) return;
    // BEFORE the in-step early return, not after: enrolment completing changes
    // no name and no count, so the one event that ends "recover this home" is
    // precisely the one the store check dismisses as nothing to do.
    publishBootstrapStateFromEngine();
    const { currentHousehold, households } = useHouseholdStore.getState();
    const inStep =
      currentHousehold?.id === getActiveHouseholdId() &&
      currentHousehold.name === getLocalHouseLedger().household.name &&
      households.length === listLocalHouseProperties().length;
    if (inStep) return;
    syncHouseholdStoreFromLocalLedger();
  });
}

// ---------------------------------------------------------------------------
// Adopt before you mint
// ---------------------------------------------------------------------------

/**
 * Why the member is — or is not — looking at their own home.
 *
 * A device with no local ledger used to mint one, silently, and the member found
 * out by noticing that "My Properties" now held one empty home named after them
 * where their real one had been. There was no state to render and therefore no
 * screen that could explain it. This is that state.
 */
export type HouseLocalBootstrapState =
  /** Signed out, local-first off, or nothing attempted yet. */
  | { status: 'idle' }
  /** A real ledger this device holds and can write to. */
  | { status: 'open'; householdId: string }
  /**
   * The account owns these homes; this device holds none of their keys yet.
   * The routes out are device-sync enrolment (`HouseDeviceSyncScreen`) and the
   * recovery-phrase restore (`screens/house-v2/backup/`).
   */
  | { status: 'recover-this-home'; households: Array<{ id: string; name: string }> }
  /**
   * A new account: the control plane answered, and it owns no homes anywhere.
   *
   * Nothing is minted for it. Signing up is not the same act as setting up a
   * home, and treating it as one gave every new member a property named after
   * themselves that they had not asked for — which then sat in "My Properties"
   * beside the one they went on to create in onboarding. The home arrives when
   * a person asks for one: the onboarding create form, `HouseJoin`, or
   * `startNewHouseholdOnThisDevice`.
   *
   * Distinct from `undecided-offline` because it is a KNOWN answer, not a
   * missing one — nothing here needs retrying, and no screen should tell the
   * member their phone could not reach us.
   */
  | { status: 'awaiting-first-home' }
  /**
   * No ledger here and no answer from the control plane, so nothing was opened
   * and — the whole point — nothing was minted. Retried on the next rehydrate.
   */
  | { status: 'undecided-offline' };

let bootstrapState: HouseLocalBootstrapState = { status: 'idle' };
const bootstrapListeners = new Set<(state: HouseLocalBootstrapState) => void>();

export function getHouseLocalBootstrapState(): HouseLocalBootstrapState {
  return bootstrapState;
}

export function subscribeToHouseLocalBootstrapState(
  listener: (state: HouseLocalBootstrapState) => void,
): () => void {
  bootstrapListeners.add(listener);
  return () => {
    bootstrapListeners.delete(listener);
  };
}

function setBootstrapState(next: HouseLocalBootstrapState): void {
  // Compared by value, not by identity: this is republished on every ledger
  // change, and waking every subscriber for an unchanged state would put a
  // re-render on a path that already runs on every screen focus.
  if (JSON.stringify(next) === JSON.stringify(bootstrapState)) return;
  bootstrapState = next;
  for (const listener of bootstrapListeners) listener(next);
}

/**
 * Derive the state from what the engine holds, rather than remembering what the
 * bootstrap decided.
 *
 * The distinction matters at exactly one moment: enrolment completing.
 * `installHouseholdKeys` clears `awaitingKeys` and emits a ledger change, and
 * because this is recomputed from the property set the member's screen leaves
 * "recover this home" by itself — nothing has to remember to clear a flag.
 *
 * "Every property is awaiting enrolment" is the recovery case and only the
 * recovery case: joining ADDS a pending property beside a real one, and it
 * cannot do otherwise — `adoptJoinedHousehold` needs an open session to adopt
 * beside.
 */
function publishBootstrapStateFromEngine(): void {
  if (!isLocalHouseSessionOpen()) return;
  const properties = listLocalHouseProperties();
  const awaiting = properties.filter((property) => property.awaitingEnrolment);
  if (properties.length > 0 && awaiting.length === properties.length) {
    setBootstrapState({
      status: 'recover-this-home',
      households: awaiting.map((property) => ({ id: property.householdId, name: property.name })),
    });
    return;
  }
  setBootstrapState({
    status: 'open',
    householdId: getActiveHouseholdId() ?? getLocalHouseLedger().household.id,
  });
}

/**
 * What an EMPTY device may do — asked once, and only when the device is empty.
 *
 * The single question that separates a first run from a reinstall, and the
 * engine cannot ask it: it is a GET against the control plane, and a GET is the
 * entire point. The old code went straight to `POST /v2/households` with a
 * freshly minted random id, which CREATES the row rather than discovering it.
 *
 * Any failure is "I do not know", never "this account owns nothing" — an
 * expired token and a dead network both throw here, and reading either as
 * "first run" is what mints the orphan.
 */
/**
 * Why the last empty-device decision refused to mint.
 *
 * The engine's answer is the same in both cases — nothing opened — but the
 * member's situation is not: one is a new account with no home yet, the other is
 * a phone that could not reach us. Only the decision knows which, and only the
 * bootstrap state can say so, so the reason is carried the short distance
 * between them rather than re-derived from an absence.
 */
type EmptyDeviceRefusal = 'no-homes' | 'unknown';

let lastEmptyDeviceRefusal: EmptyDeviceRefusal = 'unknown';

async function decideWhatAnEmptyDeviceMayDo(): Promise<HouseEmptyDeviceDecision> {
  let remote: ControlPlaneHousehold[];
  try {
    // A lazy `require`, not `await import(...)`, and not a static import.
    //
    // Static is impossible: `controlPlaneClient` imports
    // `syncHouseholdStoreFromLocalLedger` from this file, so the two are a
    // cycle. `await import(...)` is what the floated calls below use and it
    // throws "A dynamic import callback was invoked without
    // --experimental-vm-modules" under Jest — harmless there because those
    // callers swallow it, and NOT harmless here: swallowed, it reads as
    // "control plane unreachable", which turns every test of this decision into
    // the offline branch and would mask a real failure the same way in any
    // runtime where dynamic import is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const controlPlane = require('./controlPlaneClient') as typeof import('./controlPlaneClient');
    remote = await controlPlane.listControlPlaneHouseholds();
  } catch (error) {
    console.warn('[HouseLocal] control plane unreachable — not minting a home', error);
    lastEmptyDeviceRefusal = 'unknown';
    return { allowMint: false };
  }

  if (remote.length === 0) {
    // A genuinely new account — and it does NOT get a home for signing up.
    //
    // This used to mint one, on the reasoning that a first run must cost no
    // extra taps. It cost worse than taps: the minted home was named after the
    // member, had no address, and stayed in "My Properties" beside the home
    // they then created on the very next onboarding screen. Two homes out of
    // one sign-up, and the empty one is indistinguishable from a real one.
    //
    // Nothing is lost by waiting. Onboarding's create form is the next screen
    // after permissions, `HouseJoin` covers the invitee who has no home of
    // their own, and both mint through paths that carry a name and an address
    // the member actually chose.
    console.log('[HouseLocal] new account — no home until one is asked for');
    lastEmptyDeviceRefusal = 'no-homes';
    return { allowMint: false };
  }

  console.log('[HouseLocal] account already owns homes — adopting rather than minting', {
    households: remote.length,
  });
  return {
    allowMint: false,
    adopt: remote.map((household) => ({
      householdId: household.id,
      displayName: household.display_name,
    })),
  };
}

/**
 * The member's explicit "start a new home on this phone".
 *
 * Since sign-up mints nothing, this is now the ORDINARY route to a first home,
 * not only an escape hatch: onboarding's create form comes through here (via
 * `localHouseholdsApi.create`), as does a device that is offline, and one
 * holding only key-less placeholders it can never enrol (the other phone is
 * gone, the invite can never be approved). All three would otherwise have
 * nowhere to go — and "mint quietly and hope" is the behaviour this whole
 * change exists to remove. Minting is still available; it just has to be asked
 * for by a person.
 */
export async function startNewHouseholdOnThisDevice(displayName?: string | null): Promise<void> {
  const { user } = useAuthStore.getState();
  if (!user?.id) throw new HouseLocalNotReadyError();
  const name = displayName?.trim() || null;

  if (isLocalHouseSessionOpen()) {
    // Beside the placeholders, never instead of them: the member may still
    // recover those later from another device, and dropping them here would
    // take that away.
    const created = await createLocalHouseProperty({ displayName: name });
    await activateLocalHouseProperty(created.household.id);
  } else {
    await openLocalHouseSession({
      userId: user.id,
      displayName: name ?? user.display_name ?? user.email ?? null,
    });
  }
  await ensureHouseLocalSession();
}

/** Test seam — the bootstrap state is process-global, like the session it describes. */
export function __resetHouseLocalBootstrapStateForTests(): void {
  bootstrapState = { status: 'idle' };
  lastEmptyDeviceRefusal = 'unknown';
  bootstrapListeners.clear();
}

/**
 * Open (or reopen) the encrypted local ledger after sign-in / hydration.
 *
 * Everything after the session open is best-effort and offline-safe: a device
 * with no network still gets a fully usable ledger, and the control-plane
 * registration, push token and first sync all retry on the next foreground.
 */
export async function ensureHouseLocalSession(): Promise<void> {
  if (!isHouseLocalFirst()) return;

  const { user, isAuthenticated, hasHydrated } = useAuthStore.getState();
  if (!hasHydrated || !isAuthenticated || !user?.id) return;

  // `decideWhatAnEmptyDeviceMayDo` runs ONLY when the device holds no ledger.
  // This function is called on every sign-in and every auth rehydrate, so an
  // unconditional round trip here would be a network call on every launch.
  const result = await openLocalHouseSessionWithMintDecision({
    userId: user.id,
    displayName: user.display_name ?? user.email ?? null,
    decideEmptyDevice: decideWhatAnEmptyDeviceMayDo,
  });

  if (result.status !== 'open') {
    // Nothing on this device, and nothing minted for it. Either the account is
    // new and has not asked for a home yet, or we could not find out — and the
    // two must not read the same to the member. Everything below needs a
    // session; the new-account case gets one from the create/join screens, and
    // the unknown case from the next rehydrate, a foreground away.
    if (lastEmptyDeviceRefusal === 'no-homes') {
      setBootstrapState({ status: 'awaiting-first-home' });
      console.log('[HouseLocal] session deferred — new account, no home asked for yet');
      return;
    }
    setBootstrapState({ status: 'undecided-offline' });
    console.log('[HouseLocal] session deferred — device empty, account unknown');
    return;
  }
  const ledger = result.ledger;
  console.log('[HouseLocal] session open', {
    householdId: ledger.household.id,
    deviceId: ledger.deviceId,
  });

  // Repaint House screens whenever a peer's op merges in — targeted per table,
  // never a blanket invalidate (plan §5.2).
  startHouseLedgerRefreshBridge();
  // And make sync happen BY ITSELF: push what this device writes, react to a
  // peer's announcement, and keep a heartbeat under both. Without this the only
  // automatic trigger in the app is the `session-open` run below, which is why a
  // task used to sit on its author's phone until relaunch.
  startHouseAutoSync();

  syncHouseholdStoreFromLocalLedger();
  // …and keep it in step afterwards, whoever moves the property set. A join adds
  // one from a screen that does not call the publisher.
  startPropertySetWatch();
  publishBootstrapStateFromEngine();

  // H7-lite. Under local-first the server cannot schedule a task reminder — it
  // holds no plaintext — and the widget extension holds no DEK, so both are
  // projected from the ledger on this device or they do not happen at all.
  // `includeColdProperties` because a reminder for a property the member is not
  // currently looking at is still their reminder.
  startHouseWidgetProjection();
  void syncHouseLocalReminders({ includeColdProperties: true });

  void import('./controlPlaneClient')
    // EVERY property, not just the active one: a peer discovers this device's
    // public keys from its registration, so a background home that never
    // registers syncs nothing, for ever, with no error on any screen.
    .then((m) => m.syncAllLocalHouseholdsToControlPlane())
    .then(() => import('./pushWake'))
    .then((m) => m.registerHouseLocalPushToken())
    .then(() => import('./sync/orchestrator'))
    .then((m) => m.runHouseLocalSync('session-open'))
    .catch(() => undefined);

  // Who shares this home, by name and face. Best-effort and last: it is a
  // display concern, and the self row published above is what the member sees
  // until the control plane answers.
  void refreshHouseHouseholdRoster();
}

export async function teardownHouseLocalSession(options?: { wipe?: boolean }): Promise<void> {
  // First, before anything is torn down underneath them: the write listener, the
  // heartbeat and the debounced pushes all reach for a session, and a timer that
  // fires after teardown would try to sync the account that just signed out.
  stopHouseAutoSync();
  const { stopHouseLedgerRefreshBridge } = await import('./sync/ledgerRefresh');
  stopHouseLedgerRefreshBridge();
  // "This device does not hold your home yet" is a fact about ONE account, and
  // the next sign-in may be a different person entirely.
  setBootstrapState({ status: 'idle' });
  stopHouseWidgetProjection();
  unwatchPropertySet?.();
  unwatchPropertySet = null;
  // Names and faces from one account must not outlive it, and neither must the
  // "this home is on the control plane" answers cached for it — the next sign-in
  // may be a different person entirely.
  resetHouseRosters();
  await import('./controlPlaneClient').then((m) => m.resetHouseControlPlaneCache());
  // And the membership watch built on that answer: its throttle window and its
  // "you were removed from X" notices are both about the account that is
  // leaving, and the next one must not be shown either.
  await import('./membershipWatch')
    .then((m) => m.resetHouseMembershipWatch())
    .catch(() => undefined);
  // The signaling socket carries the auth token that is about to be invalidated.
  await import('./sync/signalingClient').then((m) => m.disposeHouseSignalingClient());
  // The wipe-on-logout seam the H7 DoD names. `app/_layout.tsx` already clears
  // the App Group on an auth drop, but this teardown also runs WITHOUT one —
  // account switch, wipe-and-reopen — and a stale widget showing the previous
  // household's tasks is exactly the leak the projection has to not have.
  clearHouseWidgetProjection();
  void cancelHouseLocalReminders();
  if (options?.wipe) {
    await resetLocalHouseSession();
    return;
  }
  if (isLocalHouseSessionOpen()) {
    await closeLocalHouseSession();
  }
}
