/**
 * Dev-only deep links for Maestro / manual QA observability.
 *
 *   {scheme}://e2e-clear-log
 *   {scheme}://e2e-dump-log
 *   {scheme}://e2e-logout
 *   {scheme}://e2e-tag-matrix?row=HOUSE-TASK-002
 *   {scheme}://e2e-verify-network?method=POST&path=/tasks&status=201
 *   {scheme}://e2e-verify-no-network?method=GET&path=/ai-access&status=401
 *   {scheme}://e2e-verify-no-network?method=GET&path=/households&status=401&exact=true
 *   {scheme}://e2e-verify-persist?store=kaizen_weekly_rotations&operation=upsert
 *   {scheme}://e2e-pick?key=kaizen-book
 *   {scheme}://e2e-force-import-fail
 *   {scheme}://e2e-block-network
 *   {scheme}://e2e-unblock-network
 *   {scheme}://e2e-prime-chat-mention
 *   {scheme}://e2e-wish-draft?title=E2E+Wish
 *   {scheme}://e2e-health-enable-all-features
 *   {scheme}://e2e-health-reset-features
 *   {scheme}://e2e-budget-sync     — force one Budget local-first sync
 *   {scheme}://e2e-savings-reset-month — snap Savings year/month back to today
 *   {scheme}://e2e-budget-purge-test-payments — delete every "* Test Item" row
 *   {scheme}://e2e-house-reset-local — put House back on a household it OWNS
 *                                      (use this INSTEAD of erasing the device,
 *                                      which destroys enrolment — see the
 *                                      handler and purge-house-test-data.mjs)
 *   {scheme}://e2e-arm               — mount dev-only chrome on this install
 *   {scheme}://e2e-disarm            — hand a test device back to manual use
 *
 * Works with any brand scheme (symply-house, simplebudget, kaizen, etc.).
 */
import * as Linking from 'expo-linking';

import {
  clearAllE2ETestLogs,
  dumpE2ETestObservabilityToConsole,
  findE2ENetworkEntryBySpec,
  findE2EPersistEntryBySpec,
  setE2EActiveMatrixTag,
  setE2ELastVerifyResult,
} from '@api/e2eTestObservability';

import { clearE2EDrivenInstall, markE2EDrivenInstall } from './e2e-mode';

/** t=<epoch ms> lets tooling correlate this line against Maestro's commands.json timestamps. */
function logE2EVerify(message: string): void {
   
  console.log(`[E2E-VERIFY] [t=${Date.now()}] ${message}`);
}

function parseQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

function e2eHost(parsed: Linking.ParsedURL): string | null {
  const host = parsed.hostname ?? parsed.path?.replace(/^\//, '') ?? '';
  if (!host) return null;
  return host.split('/')[0] ?? null;
}

/** Dev-only: handle observability deep links. Returns true when consumed. */
export function tryHandleE2ETestDeepLink(url: string | null | undefined): boolean {
  if (!__DEV__ || !url) return false;

  const parsed = Linking.parse(url);
  const host = e2eHost(parsed);
  if (!host) return false;

  // Any e2e-* link means Maestro (or a QA session) is driving this install, so
  // arm the chrome that only exists for the flows to grab — see e2e-mode.ts.
  if (host.startsWith('e2e-')) markE2EDrivenInstall();

  // Explicit arm/disarm. Arming is normally incidental (the rule above), so
  // `e2e-arm` exists for the case with no other e2e-* link to lean on: a device
  // erased by the size guard that a single flow is being re-run against.
  if (host === 'e2e-arm') {
    logE2EVerify('e2e-driven marker set — dev-only chrome mounted');
    return true;
  }

  if (host === 'e2e-disarm') {
    clearE2EDrivenInstall();
    logE2EVerify('e2e-driven marker cleared — dev-only chrome hidden again');
    return true;
  }

  if (host === 'e2e-clear-log') {
    clearAllE2ETestLogs();
    return true;
  }

  if (host === 'e2e-logout') {
    const { clearPendingE2ELogin } =
      require('./e2e-autologin') as typeof import('./e2e-autologin');
    const { useAuthStore } = require('@stores/authStore') as typeof import('@stores/authStore');
    clearPendingE2ELogin();
    void useAuthStore.getState().logout();
    return true;
  }

  if (host === 'e2e-budget-sync') {
    // Replaces the tap target the multi-member flows used to have: SyncStatusBanner
    // was mounted on the dashboard ONLY so Maestro had something to tap, and it
    // talked engine vocabulary ("Synced 3m ago via mailbox") at everyone running a
    // dev build. A deep link is the better shape anyway — it forces a sync without
    // navigating anywhere, so the list a convergence loop is watching stays on
    // screen between pulses. Members' own path is Settings → Device sync.
    //
    // Lazy require: the local-first engine must not be pulled into the bundle of
    // brands that never sync a budget. Fire-and-forget, matching the old tap —
    // callers wait via `waitForAnimationToEnd`, and the orchestrator publishes its
    // own [E2E-VERIFY] line (applied/deposited/conflicts) when it settles.
    const { runBudgetLocalSync } =
      require('@features/budget/local/sync/orchestrator') as typeof import('@features/budget/local/sync/orchestrator');
    void runBudgetLocalSync('e2e-deeplink');
    logE2EVerify('budget local-first sync requested');
    return true;
  }

  if (host === 'e2e-dump-log') {
    dumpE2ETestObservabilityToConsole();
    return true;
  }

  if (host === 'e2e-tag-matrix') {
    const row =
      parseQueryParam(parsed.queryParams?.row) ??
      parseQueryParam(parsed.queryParams?.matrix) ??
      parseQueryParam(parsed.queryParams?.id);
    setE2EActiveMatrixTag(row);
    return true;
  }

  if (host === 'e2e-verify-network') {
    const method = parseQueryParam(parsed.queryParams?.method);
    const path = parseQueryParam(parsed.queryParams?.path);
    const statusRaw = parseQueryParam(parsed.queryParams?.status);
    const exact = parseQueryParam(parsed.queryParams?.exact) === 'true';
    if (!path) {
      logE2EVerify('missing path query param');
      setE2ELastVerifyResult({ ok: false, detail: 'missing path query param', at: Date.now() });
      return true;
    }
    const status = statusRaw != null ? Number(statusRaw) : undefined;
    const hit = findE2ENetworkEntryBySpec({
      method,
      urlIncludes: path,
      status: Number.isFinite(status) ? status : undefined,
      exact,
    });
    if (hit) {
      logE2EVerify(
        `PASS ${hit.method} ${hit.url} status=${hit.status ?? 'null'} ok=${hit.ok}`,
      );
      setE2ELastVerifyResult({
        ok: hit.ok,
        detail: `${hit.method} ${hit.url} status=${hit.status ?? 'null'}`,
        at: Date.now(),
      });
    } else {
      const detail = `no match method=${method ?? '*'} path=*${path}* status=${statusRaw ?? '*'}`;
      logE2EVerify(`FAIL ${detail}`);
      setE2ELastVerifyResult({ ok: false, detail, at: Date.now() });
    }
    dumpE2ETestObservabilityToConsole();
    return true;
  }

  if (host === 'e2e-verify-no-network') {
    // Inverse of e2e-verify-network: asserts an action that should be a
    // no-op (e.g. tapping Cancel on a destructive-action confirm) actually
    // fired zero matching calls — not just that the confirm dialog closed.
    // Optional `status` narrows the negative assertion to a specific outcome
    // (e.g. `status=401`) so a flow can assert "this endpoint never errored"
    // without also forbidding the legitimate call — useful for catching a
    // silently-retried auth race that a plain `e2e-verify-network` check
    // (which matches the most recent entry, i.e. the successful retry) would
    // never see. Optional `exact=true` requires an exact URL match instead of
    // substring — required for a bare collection route like `/households`,
    // which would otherwise also match every nested sub-resource
    // (`/households/:id/join-requests`, `/households/:id/budget/monthly-overview`,
    // …) and flag unrelated endpoints as a false positive.
    const method = parseQueryParam(parsed.queryParams?.method);
    const path = parseQueryParam(parsed.queryParams?.path);
    const statusRaw = parseQueryParam(parsed.queryParams?.status);
    const exact = parseQueryParam(parsed.queryParams?.exact) === 'true';
    if (!path) {
      logE2EVerify('missing path query param');
      setE2ELastVerifyResult({ ok: false, detail: 'missing path query param', at: Date.now() });
      return true;
    }
    const status = statusRaw != null ? Number(statusRaw) : undefined;
    const hit = findE2ENetworkEntryBySpec({
      method,
      urlIncludes: path,
      status: Number.isFinite(status) ? status : undefined,
      exact,
    });
    if (hit) {
      const detail = `unexpected call fired: ${hit.method} ${hit.url} status=${hit.status ?? 'null'}`;
      logE2EVerify(`FAIL ${detail}`);
      setE2ELastVerifyResult({ ok: false, detail, at: Date.now() });
    } else {
      logE2EVerify(`PASS no call matched method=${method ?? '*'} path=*${path}*`);
      setE2ELastVerifyResult({
        ok: true,
        detail: `no call matched method=${method ?? '*'} path=*${path}*`,
        at: Date.now(),
      });
    }
    dumpE2ETestObservabilityToConsole();
    return true;
  }

  if (host === 'e2e-verify-persist') {
    // Local-first brands (Kaizen, Health) mostly write to on-device SQLite/
    // MMKV, not the network — this is the persist-buffer equivalent of
    // e2e-verify-network, for asserting those writes from Maestro instead of
    // leaving every local mutation row "Console verify: n/a (local)".
    const store = parseQueryParam(parsed.queryParams?.store);
    const operation = parseQueryParam(parsed.queryParams?.operation);
    const detailIncludes = parseQueryParam(parsed.queryParams?.detailIncludes);
    if (!store) {
      logE2EVerify('missing store query param');
      setE2ELastVerifyResult({ ok: false, detail: 'missing store query param', at: Date.now() });
      return true;
    }
    const hit = findE2EPersistEntryBySpec({
      store,
      operation: operation || undefined,
      detailIncludes: detailIncludes || undefined,
    });
    if (hit) {
      logE2EVerify(`PASS ${hit.operation} ${hit.store} ${hit.detail}`);
      setE2ELastVerifyResult({
        ok: true,
        detail: `${hit.operation} ${hit.store} ${hit.detail}`,
        at: Date.now(),
      });
    } else {
      const detail = `no match store=*${store}* operation=${operation ?? '*'} detailIncludes=${detailIncludes ?? '*'}`;
      logE2EVerify(`FAIL ${detail}`);
      setE2ELastVerifyResult({ ok: false, detail, at: Date.now() });
    }
    dumpE2ETestObservabilityToConsole();
    return true;
  }

  if (host === 'e2e-pick') {
    const { tryQueueE2EDocumentPickFromUrl } =
      require('./e2e-document-pick') as typeof import('./e2e-document-pick');
    return tryQueueE2EDocumentPickFromUrl(url);
  }

  if (host === 'e2e-force-import-fail') {
    const { queueE2EForceImportFail } =
      require('./e2e-import-fail') as typeof import('./e2e-import-fail');
    queueE2EForceImportFail();
    return true;
  }

  if (host === 'e2e-block-network') {
    const { setE2ENetworkBlocked } =
      require('./e2e-network-block') as typeof import('./e2e-network-block');
    setE2ENetworkBlocked(true);
    return true;
  }

  if (host === 'e2e-unblock-network') {
    const { setE2ENetworkBlocked } =
      require('./e2e-network-block') as typeof import('./e2e-network-block');
    setE2ENetworkBlocked(false);
    return true;
  }

  if (host === 'e2e-prime-chat-mention') {
    const { queueE2EPrimeChatMention } =
      require('./e2e-chat-mention') as typeof import('./e2e-chat-mention');
    queueE2EPrimeChatMention();
    return true;
  }

  if (host === 'e2e-wish-draft') {
    const title = parseQueryParam(parsed.queryParams?.title) ?? '';
    const { queueE2EWishDraftTitle } =
      require('./e2e-wish-draft') as typeof import('./e2e-wish-draft');
    queueE2EWishDraftTitle(title);
    return true;
  }

  if (host === 'e2e-import-question') {
    const text = parseQueryParam(parsed.queryParams?.text) ?? '';
    if (text.trim()) {
      const { queueE2EQuestionImport } =
        require('./e2e-question-import') as typeof import('./e2e-question-import');
      queueE2EQuestionImport(text);
      const { router } = require('expo-router') as typeof import('expo-router');
      router.push({
        pathname: '/kaizen/question-import',
        params: { e2eText: text.trim() },
      });
    }
    return true;
  }

  if (host === 'e2e-health-set-note') {
    const text = parseQueryParam(parsed.queryParams?.text) ?? '';
    const { saveNoteForDate } =
      require('../features/health/healthLocalStorage') as typeof import('../features/health/healthLocalStorage');
    void saveNoteForDate(text);
    return true;
  }

  if (host === 'e2e-health-enable-all-features') {
    // Opt-in Health features (Trends, Body, Habits, Cycle, Vitality, ...)
    // default OFF and only turn on via an admin override in
    // `useHealthFeatureStore` (see its own header comment) — an override
    // that lives in AsyncStorage, so it's gone after any fresh
    // install/reinstall. Every flow that exercises an opt-in feature just
    // assumed that override was already there from a prior manual session;
    // a genuinely fresh install left them all failing with no code or test
    // defect anywhere (root-caused 2026-07-31 investigating
    // home-dashboard-rings-and-glance.yaml's Trends failure). This does NOT
    // grant admin — `resolveHealthFeature` still gates every read on
    // `isAdmin` from the authed user, so it's a no-op on a non-admin account.
    //
    // Deferred past hydration: `useHealthFeatureStore`'s `persist` middleware
    // reads AsyncStorage asynchronously in the background from module init —
    // writing `overrides` before that finishes risks the late rehydration's
    // own `set()` call landing AFTER ours and silently reverting it to
    // whatever (or nothing) was previously persisted. `authStore` avoids this
    // by explicitly awaiting `persist.rehydrate()` during boot (see its own
    // comment); this store has no such gate, so check `hasHydrated()`
    // ourselves rather than assume boot order already covers it.
    const { HEALTH_FEATURE_KEYS } =
      require('@config/healthFeatures') as typeof import('@config/healthFeatures');
    const { useHealthFeatureStore } =
      require('@stores/healthFeatureStore') as typeof import('@stores/healthFeatureStore');
    const { useAuthStore } = require('@stores/authStore') as typeof import('@stores/authStore');
    const applyOverrides = () => {
      const { setFeature } = useHealthFeatureStore.getState();
      for (const key of HEALTH_FEATURE_KEYS) setFeature(key, true);
      const authUser = useAuthStore.getState().user;
      logE2EVerify(
        `e2e-health-enable-all-features applied — role=${authUser?.role} userId=${authUser?.id} overrides now: ${JSON.stringify(
          useHealthFeatureStore.getState().overrides
        )}`
      );
    };
    if (useHealthFeatureStore.persist.hasHydrated()) {
      applyOverrides();
    } else {
      logE2EVerify('e2e-health-enable-all-features waiting on store hydration');
      useHealthFeatureStore.persist.onFinishHydration(applyOverrides);
    }
    return true;
  }

  if (host === 'e2e-health-reset-features') {
    // Companion teardown for e2e-health-enable-all-features. The override map
    // lives in AsyncStorage, which survives a soft launch (launchApp without
    // clearState) across every later flow in the same suite run — the two
    // flows that opt in must also opt back out, or every flow after them in
    // sequence inherits the expanded More/Home layout. Reproduced 2026-07-31:
    // home-rapid-water's water count read back as "0" instead of "5" because
    // the extra Food Challenges / Habits / Body / Sleep cards ahead of WATER
    // (left on from home-empty-and-privacy, which ran first) shifted layout
    // mid-burst. Calling this at the end of both flows keeps the opt-in
    // scoped to the flow that asked for it, not "every flow that runs after".
    const { useHealthFeatureStore } =
      require('@stores/healthFeatureStore') as typeof import('@stores/healthFeatureStore');
    useHealthFeatureStore.getState().resetAll();
    logE2EVerify('e2e-health-reset-features applied — overrides cleared');
    return true;
  }

  if (host === 'e2e-house-reset-local') {
    // Put this device back on a household it OWNS, without erasing anything.
    //
    // ## Why this exists
    //
    // Budget has `e2e-budget-purge-test-payments` and Health has
    // `e2e-health-reset-features`; House had NOTHING, and the absence is what
    // made every operator — human and agent — reach for `simctl erase` or
    // deleting the ledger file. `purge-house-test-data.mjs` documents where
    // that leads, measured 2026-08-26: wiping the container destroys the
    // device's ENROLMENT along with the ledger, the device rejoins unapproved,
    // and **every write is refused** with "Waiting for the household owner to
    // approve this device". Recovering then needs an owner action on another
    // device, which may not exist any more. That is a far worse state than the
    // residue anyone was trying to clear.
    //
    // ## Why a plain reset is not enough
    //
    // `resetLocalHouseSession()` clears local persistence, but
    // `ensureHouseLocalSession()` then re-adopts the households the CONTROL
    // PLANE lists for this account — and this device has no HDK for any of
    // them, because it did not create them. It lands straight back in
    // `awaitingKeys`. Observed here with 18 accumulated test households, every
    // one reporting "awaiting enrolment" on a device that had just been erased
    // and reinstalled.
    //
    // So the reset has to MINT: `createLocalHouseProperty` generates a fresh
    // HDK locally, which makes this device the owner rather than a joiner, and
    // sets `awaitingKeys: false`. Activating it is a separate call because
    // creating a property deliberately does not steal focus from the active one
    // in normal use.
    //
    // The orphaned households are left alone on purpose: they are unreachable
    // ciphertext either way, and deleting them is a server-side decision this
    // deeplink has no business making from inside a test.
    void (async () => {
      try {
        const engine = require('@features/house/local/engine') as typeof import('@features/house/local/engine');
        const { ensureHouseLocalSession } =
          require('@features/house/local/ensureSession') as typeof import('@features/house/local/ensureSession');

        await engine.resetLocalHouseSession();
        await ensureHouseLocalSession();

        const ledger = await engine.createLocalHouseProperty({ displayName: 'E2E Home' });
        await engine.activateLocalHouseProperty(ledger.household.id);

        // Drop every property this device can never use.
        //
        // Minting an owned household unblocks WRITES, but it does not make the
        // unusable ones disappear — and they are not merely untidy. Measured
        // here with 20 properties: `HousePropertyPicker` renders one row per
        // property with no cap, so the "WHICH HOME" list on the Backup screen
        // filled the entire viewport and pushed `house-backup-status-card`
        // off-screen entirely. `lf-021-auto-backup` and
        // `lf-012-restore-screen-unselected-state` both failed on
        // `assertVisible` for elements that were rendered but unreachable —
        // which reads as a layout bug and is actually a data one.
        //
        // They also cost real network: every sync pulse fans out across all of
        // them (H5 syncs per property), and `invites/pending` polling is per
        // property against a PER-USER rate limiter — measured at 82% of the
        // limiter budget, starving mailbox deposits of actual ops.
        //
        // `awaitingEnrolment` is exactly the right predicate: it means "this
        // device holds no HDK for this property", which for a device that did
        // not create it and cannot be approved is permanent. The freshly minted
        // one is never in this set (`awaitingKeys: false`), so the guard against
        // removing the last property cannot fire.
        const orphans = engine
          .listLocalHouseProperties()
          .filter((p) => p.awaitingEnrolment && p.householdId !== ledger.household.id);

        for (const orphan of orphans) {
          try {
            await engine.removeLocalHouseProperty(orphan.householdId);
          } catch (error) {
            // One stubborn property must not abort the rest of the sweep.
            logE2EVerify(`WARN e2e-house-reset-local — kept ${orphan.householdId}: ${String(error)}`);
          }
        }

        logE2EVerify(
          `PASS e2e-house-reset-local — owned household ${ledger.household.id}, dropped ${orphans.length} unusable`,
        );
      } catch (error) {
        // Loud, and with the reason: a silent failure here reads downstream as
        // "the flow is broken", which is the misdiagnosis this whole deeplink
        // exists to prevent.
        logE2EVerify(`FAIL e2e-house-reset-local — ${String(error)}`);
      }
    })();
    return true;
  }

  if (host === 'e2e-budget-purge-test-payments') {
    // Delete every "* Test Item" recurring payment through the API, from inside
    // the already-authenticated app.
    //
    // The UI purge flow this replaces could not finish the job. Maestro's
    // visibility is VIEWPORT based, so a drain that taps rows by name can only
    // reach what it can bring on screen at >=60% — across 120 iterations it
    // deleted 18 of the backlog and then reported "nothing visible" while rows
    // still existed (2026-08-25). Deleting by ID sidesteps scrolling entirely.
    //
    // Why this matters: every mutating savings flow creates "<X> Test Item"
    // rows and only cleans up when it PASSES, so failures leave rows behind.
    // Flows then tap rows BY NAME, and with duplicates Maestro takes the FIRST
    // match — a row from an older run rather than the one just created.
    const { savingsApi } = require('@api/savings') as typeof import('@api/savings');
    const { useHouseholdStore } = require('@stores/householdStore') as typeof import('@stores/householdStore');
    const householdId = useHouseholdStore.getState().currentHousehold?.id;
    if (!householdId) {
      logE2EVerify('FAIL e2e-budget-purge-test-payments — no current household');
      return true;
    }
    void (async () => {
      try {
        const view = await savingsApi.listRecurringPayments(householdId);
        // Two naming conventions are in use across the savings flows —
        // "<X> Test Item" (recurring/renewal/toggle) and "ZZ E2E <X>"
        // (monthly-crud, goal-crud). Matching only the first left
        // "ZZ E2E Monthly Renamed" behind, which is exactly the kind of
        // leftover that breaks the next run (2026-08-25). Both prefixes are
        // unambiguous; no genuine payment on this shared account looks like
        // either.
        const rows = (view?.items ?? []).filter((p) => /Test Item|ZZ E2E/i.test(p.label ?? ''));
        let removed = 0;
        for (const row of rows) {
          try {
            await savingsApi.deleteRecurringPayment(householdId, row.id);
            removed += 1;
          } catch {
            // Keep going — one stubborn row must not strand the rest.
          }
        }
        logE2EVerify(
          `${removed === rows.length ? 'PASS' : 'FAIL'} e2e-budget-purge-test-payments — removed ${removed} of ${rows.length} test rows`
        );
      } catch (err) {
        logE2EVerify(`FAIL e2e-budget-purge-test-payments — ${String(err)}`);
      }
    })();
    return true;
  }

  if (host === 'e2e-savings-set-tab') {
    // Drive the Savings sub-tab directly instead of tapping the segmented
    // control. Same reasoning PensionView already documents for its own
    // sub-tabs: "the in-screen segmented sub-tab tap can be dropped on iOS-26
    // New-Arch". Confirmed on Savings 2026-08-25 — three consecutive
    // `budget-savings-income-copy` runs tapped `filter-tab-income` (twice
    // unconditionally) and stayed on OVERVIEW, so the Income screen never
    // mounted and the run failed later on `savings-entry-form`.
    const tab = parseQueryParam(parsed.queryParams?.tab) ?? '';
    const allowed = ['overview', 'income', 'monthly', 'projection', 'goals'];
    if (!allowed.includes(tab)) {
      logE2EVerify(`FAIL e2e-savings-set-tab — tab must be one of ${allowed.join('|')} (got "${tab}")`);
      return true;
    }
    const { useSavingsStore } = require('@stores/savingsStore') as typeof import('@stores/savingsStore');
    useSavingsStore.getState().setActiveSubTab(tab as import('@stores/savingsStore').SavingsSubTab);
    logE2EVerify(`e2e-savings-set-tab applied — sub-tab set to ${tab}`);
    return true;
  }

  if (host === 'e2e-savings-reset-month') {
    // Snap the Savings year/month back to today. `savingsStore` persists
    // NOTHING (`partialize: () => ({})`), so this is not about storage — the
    // carry-over is in MEMORY. `budget-launch-logged-in` is a deliberate soft
    // launch (no stopApp, no clearState) to keep the Expo Dev Client ↔ Metro
    // session alive, so the Zustand store is never torn down between flows in
    // a run: whatever month the previous flow left selected is inherited by
    // the next one. Any flow that assumes "the current month" (month-stepper,
    // monthly-crud, projection) must call this first rather than trust the
    // default, since flow ORDER then decides whether it passes.
    const { useSavingsStore } = require('@stores/savingsStore') as typeof import('@stores/savingsStore');
    useSavingsStore.getState().resetToCurrentMonth();
    logE2EVerify('e2e-savings-reset-month applied — year/month snapped to today');
    return true;
  }

  return false;
}
