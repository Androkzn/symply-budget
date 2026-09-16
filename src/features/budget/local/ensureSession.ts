// Side-effect BEFORE engine/@symply/local-first — noble caches crypto at import.
import './cryptoPolyfill';

import type { Household } from '@api/households';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';

import {
  startBudgetCategoryReconcileBridge,
  stopBudgetCategoryReconcileBridge,
} from './categoryReconcile';
import {
  closeAllLocalBudgetSessions,
  getActiveBudgetHouseholdId,
  getLocalLedger,
  isLocalBudgetSessionOpen,
  listLocalBudgetHouseholds,
  openLocalBudgetSession,
  type BudgetEmptyDeviceDecision,
  resetLocalBudgetSession,
  subscribeToLedgerChanges,
  type BudgetHouseholdSummary,
} from './engine';
import { isBudgetLocalFirst } from './flag';
import {
  refreshBudgetHouseholdRoster,
  republishActiveBudgetRoster,
  resetBudgetRosters,
} from './householdRoster';
import { syncBudgetLocalReminders } from './reminders/budgetLocalReminders';
import { startBudgetAutoSync, stopBudgetAutoSync } from './sync/autoSync';
import { startBudgetLedgerRefreshBridge } from './sync/ledgerRefresh';
import { disposeSignalingClient } from './sync/signalingClient';

/** The ledger row's role is free text; the store's is a two-value union. */
function toStoreRole(role: string): 'owner' | 'member' {
  return role.trim().toLowerCase() === 'owner' ? 'owner' : 'member';
}

/**
 * A store record for a household this device holds but has NOT hydrated.
 *
 * `listLocalBudgetHouseholds()` is synchronous and cold on purpose: it reads
 * only the fields a switcher needs, so listing every household costs no row
 * decryption. That matters — cold open is 34–37 µs/row, and a member with three
 * households must not pay it three times over just to see three names — but it
 * means the full `Household` of a background household is not reachable without
 * hydrating it.
 *
 * So the previously published record is reused where there is one. It survives
 * relaunches (the store persists `households`) and it was published from that
 * household's real ledger the last time it was active, which makes it the best
 * copy available; only the two fields the summary is authoritative about are
 * refreshed over it, so a rename lands without a hydration.
 */
function householdFromSummary(
  summary: BudgetHouseholdSummary,
  previous: Household | undefined,
): Household {
  const role = toStoreRole(summary.role);
  // The summary now carries the household's whole sealed record, which is a
  // better source than the store's last published copy for every field it holds
  // — it is what is on disk right now, including a photo and an address edited
  // while this household was in the background. `previous` remains underneath it
  // for the fields the record does not own (`member_count`, published from the
  // control plane roster), so a known household does not lose its member count
  // to a summary that has never asked the server anything.
  return {
    ...(previous ?? EMPTY_HOUSEHOLD_RECORD),
    ...summary.record,
    id: summary.householdId,
    name: summary.name,
    my_role: role,
  };
}

/**
 * The floor under a household nothing has published yet.
 *
 * `created_at` is left EMPTY rather than stamped with now: `BudgetHouseholdScreen`
 * sorts newest-first, and an invented timestamp would jump a years-old household
 * to the top of the list. Empty sorts it last, honestly. `member_count` is 1 for
 * the same reason a freshly minted household is: this device knows of exactly one
 * member — itself — until the control plane says otherwise.
 */
const EMPTY_HOUSEHOLD_RECORD: Household = {
  id: '',
  name: '',
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
  my_role: 'member',
};

/**
 * Publish the local engine's household set into `householdStore`.
 *
 * Two jobs, and the second one is BR-016's.
 *
 * 1. Point `currentHousehold` at the open ledger's household. Required after a
 *    backup restore that replaces `hh_local_*` with a migrated id (Sweet Home
 *    etc.) — otherwise savings/mortgage/loan APIs throw household mismatch and
 *    screens look empty.
 * 2. Publish the REAL list. This used to force `households` to
 *    `[ledger.household]`, which was true when a device held one ledger and is a
 *    lie now: it hid every other household from the switcher and from
 *    `BudgetHouseholdScreen`, and — because it ran on every screen focus — it
 *    deleted a just-created household from the list moments after it appeared.
 *    (That is the exact assertion `budget-households.yaml` and
 *    `budget-household-switch.yaml` fail on.)
 *
 * Synchronous, and it stays that way: it publishes what the engine already holds
 * in memory. Making it async to fetch the full `Household` of every cold
 * household would put N row-decryptions on a path that runs on every focus.
 */
export function syncHouseholdStoreFromLocalLedger(): void {
  if (!isBudgetLocalFirst() || !isLocalBudgetSessionOpen()) return;
  const ledger = getLocalLedger();
  // `getActiveBudgetHouseholdId()` cannot be null while a session is open, but
  // the ledger's own id is the same answer and costs nothing to fall back to.
  const activeHouseholdId = getActiveBudgetHouseholdId() ?? ledger.household.id;
  const previous = new Map(
    useHouseholdStore.getState().households.map((household) => [household.id, household]),
  );

  const summaries = listLocalBudgetHouseholds();
  // The ACTIVE household is taken from the live ledger — hydrated, authoritative,
  // and the only one whose full record is in memory. An engine that somehow lists
  // nothing still leaves the member the household they have open rather than an
  // empty switcher and a null `currentHousehold`, which every Budget screen reads
  // as "no household" and renders as an empty state.
  // COPY, never the live object. `useHouseholdStore` runs through
  // `zustand/middleware/immer`, which DEEP-FREEZES everything it stores — and
  // `ledger.household` is the engine's own mutable record, not a snapshot.
  // Publishing it by reference froze it in place, so the next local write
  // (`mutateLocalLedger` stamps `ledger.household.updated_at` on EVERY create /
  // update / delete) threw `TypeError: Cannot assign to read-only property
  // 'updated_at'`. That surfaced as "Save does nothing": the form's save threw,
  // `useUnsavedChanges` caught it, the screen never closed and nothing was
  // persisted — for spendings, planned items and receipt imports alike
  // (reproduced 2026-08-22 on Budget-C and on the Budget-A/B pair).
  //
  // One spread is enough: `Household` is flat, and immer only freezes what it
  // can reach from the stored value.
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
  // Swap the member list to whichever household is now active BEFORE the store
  // update, and re-set the same array inside it, so no subscriber can observe
  // household A's `currentHousehold` next to household B's members. The roster
  // cache lives in `householdRoster` — the module the control plane publishes
  // through — because two caches for one screen slot is how they drift; this
  // module only says WHEN to swap, which is the moment the active household
  // changes underneath it. Falls back to the self row rather than to an empty
  // list, so a switch lands on "just you" (true, and momentary) instead of on a
  // blank member list.
  const currentHouseholdMembers = republishActiveBudgetRoster();

  useHouseholdStore.setState({
    households,
    currentHousehold,
    currentHouseholdMembers,
    isLoading: false,
    error: null,
  });
  console.log('[BudgetLocal] householdStore synced', {
    householdId: currentHousehold.id,
    name: currentHousehold.name,
    households: households.length,
  });
}

/** Live only while a session is open, and only ever one — see below. */
let unwatchHouseholdSet: (() => void) | null = null;

/**
 * Keep `householdStore` in step with the engine's household set, whoever moved it.
 *
 * Every change to that set is an engine act that already emits a ledger change:
 * `activateLocalBudgetHousehold` switches, `createLocalBudgetHousehold` adds
 * (WITHOUT activating — creating and switching are separate acts),
 * `removeLocalBudgetHousehold` drops and falls back, `adoptJoinedHousehold` adds
 * and activates, `renameLocalHousehold` renames. Following that event beats
 * trusting five call sites to each remember `syncHouseholdStoreFromLocalLedger()`,
 * and the cost of one forgetting is not a stale label but an outage:
 * `currentHousehold.id` is what every domain API is called with, and the local
 * facades throw on a household mismatch — so a store still pointing at the
 * household the member just left renders Savings, Mortgage and Loans empty while
 * the data sits on disk, decrypted and one id away.
 *
 * Deliberately NOT filtered on `change.householdId`. That filter is right for
 * `ledgerRefresh`, which repaints the foreground household's screens; here a
 * background household's very first op is exactly the event that must be
 * noticed, because it is a household the switcher is not yet showing.
 *
 * Cheap by construction: the common case is three comparisons over state already
 * in memory, and only a genuine disagreement publishes.
 */
function startHouseholdSetWatch(): void {
  if (unwatchHouseholdSet) return;
  unwatchHouseholdSet = subscribeToLedgerChanges(() => {
    if (!isLocalBudgetSessionOpen()) return;
    const { currentHousehold, households } = useHouseholdStore.getState();
    const inStep =
      currentHousehold?.id === getActiveBudgetHouseholdId() &&
      currentHousehold.name === getLocalLedger().household.name &&
      households.length === listLocalBudgetHouseholds().length;
    if (inStep) return;
    syncHouseholdStoreFromLocalLedger();
  });
}

/**
 * Open (or reopen) the encrypted local ledger after Shared User sign-in / hydration.
 * Seeds householdStore so Budget screens have a currentHousehold offline.
 *
 * `openLocalBudgetSession` enumerates the on-disk household index and builds a
 * COLD session for every entry, then hydrates only the one `ACTIVE_META` names —
 * so this call restores the household the member was last in, not "the first one
 * found", and the others cost one meta read each until they are switched into.
 * There is deliberately no `activateLocalBudgetHousehold` call here: the engine
 * has already restored the persisted active household, and re-activating it
 * would rewrite both pointers and emit a whole-ledger change on every
 * foreground, repainting every screen for nothing.
 */
/**
 * Whether a device holding no ledger for this account may mint a household.
 *
 * The engine cannot answer it: the deciding fact — "does this account already
 * hold households?" — is a control-plane round trip away, and the engine must
 * work with no network at all.
 *
 * A fresh install on an account that already has households used to mint a NEW
 * empty one and register it, so the member opened the app to an empty budget
 * while their real data sat on their other device. Listing first turns that
 * into an adoption: the real households appear, awaiting enrolment, and the
 * first peer online wraps the key and backfills them.
 */
async function decideWhatAnEmptyDeviceMayDo(): Promise<BudgetEmptyDeviceDecision> {
  let remote;
  try {
    // A lazy `require`, not a static import and not `await import(...)`.
    // Static is impossible — `controlPlaneClient` imports
    // `syncHouseholdStoreFromLocalLedger` from this file, so the two are a
    // cycle. `await import(...)` throws under Jest without
    // --experimental-vm-modules, which here would be swallowed as "unreachable"
    // and quietly turn every test of this decision into the mint branch.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const controlPlane = require('./controlPlaneClient') as typeof import('./controlPlaneClient');
    remote = await controlPlane.listControlPlaneHouseholds();
  } catch (error) {
    // Offline, or auth expired. Budget still mints here (see `openEmptyDevice`)
    // — this keeps first-launch-with-no-network behaving exactly as before.
    console.warn('[BudgetLocal] control plane unreachable — minting as before', error);
    return { allowMint: true };
  }

  if (remote.length === 0) {
    console.log('[BudgetLocal] new account — minting the first household');
    return { allowMint: true };
  }

  console.log('[BudgetLocal] account already holds households — adopting rather than minting', {
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

export async function ensureBudgetLocalSession(): Promise<void> {
  if (!isBudgetLocalFirst()) return;

  const { user, isAuthenticated, hasHydrated } = useAuthStore.getState();
  if (!hasHydrated || !isAuthenticated || !user?.id) return;

  const ledger = await openLocalBudgetSession({
    userId: user.id,
    displayName: user.display_name ?? user.email ?? null,
    decideEmptyDevice: decideWhatAnEmptyDeviceMayDo,
  });
  console.log('[BudgetLocal] session open', {
    householdId: ledger.household.id,
    deviceId: ledger.deviceId,
    households: listLocalBudgetHouseholds().length,
  });

  // Repaint budget views whenever a peer's op merges in (TRD §8.6).
  startBudgetLedgerRefreshBridge();
  // And keep the active household free of same-name categories as peers' rows
  // land — see `categoryReconcile`.
  startBudgetCategoryReconcileBridge();
  // And make sync happen BY ITSELF: push what this device writes, react to a
  // peer's announcement, and keep a heartbeat under both. Without this the only
  // automatic trigger in the app is the `session-open` run twenty lines below,
  // which is why a spending used to sit on its author's phone until relaunch.
  startBudgetAutoSync();
  void import('@services/budgetBackgroundBootstrap')
    .then(m => m.registerBudgetBackgroundTasks())
    .catch(error => console.warn('[BudgetLocal] background registration deferred', error));
  // And keep the household list and the active selection following the engine.
  startHouseholdSetWatch();

  syncHouseholdStoreFromLocalLedger();

  // Reconcile the category list — `localBudgetApi.mergeDuplicateCategories`
  // then `.backfillDefaultCategories`, merge first so the backfill's by-name
  // view is of ONE row per name. Fired here because this is the one place a
  // hydrated active household is guaranteed, and floated because a category
  // that fails to appear must not cost the member their session. The ACTIVE
  // household only: reconciling a cold one would hydrate it, which is the cost
  // lazy hydration exists to avoid, and it picks its repairs up the next time
  // it is opened.
  void import('./localBudgetApi')
    .then(async (m) => {
      await m.localBudgetApi
        .mergeDuplicateCategories(ledger.household.id)
        .catch((error: unknown) => {
          console.warn('[BudgetLocal] duplicate-category merge skipped', error);
        });
      await m.localBudgetApi.backfillDefaultCategories(ledger.household.id);
    })
    .catch((error: unknown) => {
      console.warn('[BudgetLocal] default-category backfill skipped', error);
    });

  // Names and faces for the rest of the household, as soon as we are online.
  // Offline-safe and never blocks session open — the seeded self row above is
  // what the UI renders until this lands. Active household only: it is the one
  // whose member list is on screen, and a cold household's roster is fetched
  // when it is switched into.
  void refreshBudgetHouseholdRoster();

  void syncBudgetLocalReminders();

  // NOTE: the auto-backup scheduler is deliberately NOT started here.
  // `backup/autoBackup` → `backup/backupDestinations` → `backup/budgetBackup`
  // imports this module, so starting it from here would close an import cycle.
  // `DataContext` owns that call, one level up — see startBudgetAutoBackupScheduler.

  // Best-effort control-plane registration + Phase 3 sync. Offline-safe.
  void import('./controlPlaneClient')
    .then((m) => m.syncLocalHouseholdToControlPlane())
    .then(() => import('./pushWake'))
    .then((m) => m.registerBudgetLocalPushToken())
    .then(() => import('./sync/orchestrator'))
    .then((m) => m.runBudgetLocalSync('session-open'))
    .catch(() => undefined);
}

export async function teardownBudgetLocalSession(options?: { wipe?: boolean }): Promise<void> {
  // First, before anything is torn down underneath them: the write listener,
  // the heartbeat and the debounced pushes all reach for a session, and a timer
  // that fires after teardown would try to sync the account that just signed
  // out.
  stopBudgetAutoSync();
  // The category reconcile listener too: a pass that fires after teardown would
  // try to write into the account that just signed out.
  stopBudgetCategoryReconcileBridge();
  // And the socket they were listening on. Exported since the client was
  // written and never called by anything — survivable while a socket only
  // existed for the tail of a sync run, and not survivable now that `autoSync`
  // deliberately holds one open: a live socket carries the signed-out account's
  // token in its URL and keeps this device present in a household room it has
  // just left.
  disposeSignalingClient();
  // Every household's roster dies with the session. Teardown runs on sign-out and
  // on an account switch, and a cached roster that outlived one would name the
  // previous account's members in the next account's member lists — the same
  // cross-account leak the engine's `MEMBER_META` guard exists to prevent, just
  // in memory instead of on disk.
  resetBudgetRosters();
  // Same reasoning one level down: "which households does this account have on
  // the control plane" is an ACCOUNT answer, and the next sign-in must not
  // inherit this one's — it decides which households are allowed to sync.
  await import('./controlPlaneClient')
    .then((m) => m.resetBudgetControlPlaneCache())
    .catch(() => undefined);
  // And the membership watch built on that answer: its throttle window and its
  // "you were removed from X" notices are both about the account that is
  // leaving, and the next one must not be shown either.
  await import('./membershipWatch')
    .then((m) => m.resetBudgetMembershipWatch())
    .catch(() => undefined);
  unwatchHouseholdSet?.();
  unwatchHouseholdSet = null;
  if (options?.wipe) {
    await resetLocalBudgetSession();
    return;
  }
  if (isLocalBudgetSessionOpen()) {
    // Closes EVERY household, not just the active one: they share one SQLite
    // file and one DEK, so leaving a background session behind would leave a
    // handle on a store the next sign-in is about to reopen under a new key.
    await closeAllLocalBudgetSessions();
  }
}
