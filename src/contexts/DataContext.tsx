import React, { createContext, useContext, useCallback, useMemo, useState, useEffect, useRef } from 'react';

import { householdsApi } from '@api/households';
import { reportsApi, type Report } from '@api/reports';
import { tasksApi, type Task } from '@api/tasks';
import { hasBrandCapability, isJoinedPlatformBrand } from '@brand';
import { captureException } from '@services/monitoring';
import { settingsLoader } from '@services/settings-loader';
import { showToast } from '@services/toastManager';
import { useAuthStore } from '@stores/authStore';
import { useHouseholdStore } from '@stores/householdStore';
import { useReportStore } from '@stores/reportStore';
import { useTaskStore } from '@stores/taskStore';

interface DataContextType {
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  error: string | null;
  refreshAll: () => Promise<void>;
  refreshActivePropertyData: () => Promise<void>;
  clearError: () => void;
  // Multi-property mode helpers
  getActiveHouseholdIds: () => string[];
  isMultiPropertyMode: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

/**
 * Re-resolve which household Budget's local engine currently has ACTIVE and
 * publish it into `householdStore`.
 *
 * BR-016 turned "the active household" into something that moves: a switch, a
 * join, a create, or the fallback the engine takes after a removal all change
 * which ledger it serves. Every Budget screen reads `currentHousehold.id` and
 * hands it to a local facade that resolves the household by id — so a store
 * still pointing at the household the member just left does not merely show a
 * stale name, it renders Spending, Savings, Mortgage and Loans empty over data
 * that is on disk and one id away. A refresh that follows a switch therefore has
 * to re-ask the engine, not just re-fetch.
 *
 * Synchronous and cheap: it republishes what the engine already holds in memory
 * (no row decryption, no hydration of a background household). It is a no-op
 * unless Budget local-first is on with a session open, which is what keeps House
 * — whose multi-property switching is driven by its own engine and store — on
 * exactly the path it had before.
 *
 * Lazily required for the same reason the local-first branches in `refreshAll`
 * are: this context is mounted by every brand, and a static import would pull
 * the Budget engine and its crypto polyfill into all of their bundles.
 */
function resolveActiveLocalBudgetHousehold(): void {
  try {
    const { isBudgetLocalFirst } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design; see above
      require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
    if (!isBudgetLocalFirst()) return;
    const { syncHouseholdStoreFromLocalLedger } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design; see above
      require('@features/budget/local/ensureSession') as typeof import('@features/budget/local/ensureSession');
    syncHouseholdStoreFromLocalLedger();
  } catch (err) {
    // A refresh must not fail because the household set could not be
    // republished — the previously published one is still serviceable.
    if (__DEV__) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[DataContext] local household resolve skipped:', message);
    }
  }
}

/**
 * Whether House's on-device ledger is available to be read RIGHT NOW.
 *
 * - `off`     — local-first is not on in this build (or not wired at all), so
 *               tasks come from the server exactly as they always did.
 * - `open`    — the ledger is open and hydrated; local reads will answer.
 * - `closed`  — local-first is on and the session is not open yet.
 *
 * `closed` is not an error state, it is the first second of every launch:
 * `ensureHouseLocalSession()` derives a key and decrypts rows before any local
 * facade can answer, and it is called from `refreshAll` while the UI is already
 * mounting. Anything that reads the ledger in that window has to wait rather
 * than report a failure — see the gate in `fetchPropertyData`.
 *
 * Lazily required, like the local-first branches in `refreshAll`: this context
 * is mounted by every brand, and a static import would pull the House engine and
 * its crypto polyfill into all of their bundles. `engine` is only reached once
 * the flag says yes, so no other brand loads it.
 */
function houseLocalLedgerState(): 'off' | 'open' | 'closed' {
  try {
    const { isHouseLocalFirst } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design; see above
      require('@features/house/local/flag') as typeof import('@features/house/local/flag');
    if (!isHouseLocalFirst()) return 'off';
    const { isLocalHouseSessionOpen } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy by design; see above
      require('@features/house/local/engine') as typeof import('@features/house/local/engine');
    return isLocalHouseSessionOpen() ? 'open' : 'closed';
  } catch {
    // Not wired in this build (or this test) — the remote path is correct.
    return 'off';
  }
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const propertyMode = useHouseholdStore((state) => state.propertyMode);
  const setHouseholds = useHouseholdStore((state) => state.setHouseholds);
  const setCurrentHousehold = useHouseholdStore((state) => state.setCurrentHousehold);
  const getActiveHouseholdIds = useHouseholdStore((state) => state.getActiveHouseholdIds);
  const setReports = useReportStore((state) => state.setReports);
  const setMaintenanceTasks = useTaskStore((state) => state.setMaintenanceTasks);
  const setUpcomingTasks = useTaskStore((state) => state.setUpcomingTasks);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialLoadStarted = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMultiPropertyMode = propertyMode === 'all';

  const SYNC_TIMEOUT_MS = 15000;

  const fetchPropertyData = useCallback(async () => {
    // Budget / Kaizen / Health / Language: homeApi is off — reports/tasks 404
    // behind gateHomeApiPaths. Skip so we don't toast "Couldn't load …".
    if (!hasBrandCapability('homeApi')) {
      setReports([]);
      setMaintenanceTasks([]);
      setUpcomingTasks([]);
      return;
    }

    // House V2 local-first: tasks are read out of the on-device ledger, and that
    // ledger opens ASYNCHRONOUSLY at launch (key derivation, then row
    // decryption). `HomeScreen`'s focus effect calls this the moment the tab
    // renders — comfortably before `ensureHouseLocalSession()` resolves — and
    // `householdStore` has already rehydrated the property list from disk, so
    // the loop below used to run against a closed ledger: `localTasksApi` threw
    // `HouseLocalNotReadyError`, the household was counted as failed, and the
    // member was told `Couldn't load "<their home>". Pull to refresh.` about
    // data that was on the device and merely not decrypted yet.
    //
    // Waiting costs nothing: `refreshAll` fetches again the instant the session
    // is open (see below), so no task is lost by skipping here — and returning
    // early rather than falling through also leaves the stores holding what they
    // already had instead of clearing them behind the toast.
    if (houseLocalLedgerState() === 'closed') return;

    const store = useHouseholdStore.getState();
    const activeHousehold = store.currentHousehold;
    const mode = store.propertyMode;
    const householdsToFetch = mode === 'all'
      ? store.households
      : (activeHousehold ? [activeHousehold] : []);

    if (householdsToFetch.length === 0) {
      setReports([]);
      setMaintenanceTasks([]);
      setUpcomingTasks([]);
      return;
    }

    const allReports: Report[] = [];
    const allTasks: Task[] = [];
    const allUpcoming: Task[] = [];
    const failedHouseholdNames: string[] = [];
    const previousReports = useReportStore.getState().reports;

    await Promise.all(
      householdsToFetch.map(async (household) => {
        // Reports and tasks are fetched as two INDEPENDENT units, still
        // concurrently, because only one of them can speak for the household.
        //
        // Reports are Tier B: they stay on the server even for a local-first
        // household, because the Lambda has to read the PDF. So this is the one
        // call here that needs the network, and it is also the one that fails on
        // its own — offline, or 403 while the legacy-membership mirror is still
        // being registered at cold start. A member whose tasks came off the
        // ledger has a working home; telling them it could not be loaded because
        // a report list did not answer is simply untrue, and on a local-first
        // build it turns "you are offline" into "your home is broken".
        //
        // Tasks are what Home renders, so a task failure — and only a task
        // failure — marks the household as failed.
        await Promise.all([
          (async () => {
            try {
              const reportsResponse = await reportsApi.list(household.id);
              allReports.push(
                ...reportsResponse.reports.map((r: Report) => ({
                  ...r,
                  _householdName: household.name,
                  _householdId: household.id,
                }))
              );
            } catch (err) {
              // Carry the household's known reports forward rather than dropping
              // them: `setReports` below replaces the whole list, so an empty
              // push here would read on `ReportsScreen` as "your reports are
              // gone" for the length of one failed refresh.
              allReports.push(...previousReports.filter((r) => r.household_id === household.id));
              captureException(err, {
                source: 'DataContext',
                phase: 'reports',
                householdId: household.id,
                householdName: household.name,
              });
              if (__DEV__) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                console.warn(
                  `[DataContext] Reports fetch failed for household ${household.name}:`,
                  message
                );
              }
            }
          })(),
          (async () => {
            try {
              const [tasksResponse, upcomingResponse] = await Promise.all([
                tasksApi.list(household.id),
                tasksApi.getUpcoming(household.id, 30),
              ]);
              allTasks.push(
                ...tasksResponse.tasks.map((t: Task) => ({
                  ...t,
                  _householdName: household.name,
                  _householdId: household.id,
                }))
              );
              allUpcoming.push(
                ...upcomingResponse.tasks.map((t: Task) => ({
                  ...t,
                  _householdName: household.name,
                  _householdId: household.id,
                }))
              );
            } catch (err) {
              failedHouseholdNames.push(household.name);
              captureException(err, {
                source: 'DataContext',
                phase: 'tasks',
                householdId: household.id,
                householdName: household.name,
              });
              if (__DEV__) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                console.warn(
                  `[DataContext] Tasks fetch failed for household ${household.name}:`,
                  message
                );
              }
            }
          })(),
        ]);
      })
    );

    setReports(allReports);
    setMaintenanceTasks(allTasks);
    setUpcomingTasks(allUpcoming);

    if (failedHouseholdNames.length > 0) {
      const names = failedHouseholdNames.join(', ');
      setError(`Failed to load data for ${names}. Pull to refresh to retry.`);
      showToast('error', failedHouseholdNames.length === 1
        ? `Couldn't load "${failedHouseholdNames[0]}". Pull to refresh.`
        : `Couldn't load ${failedHouseholdNames.length} properties. Pull to refresh.`);
    }
  }, [setReports, setMaintenanceTasks, setUpcomingTasks]);

  const refreshActivePropertyData = useCallback(async () => {
    if (!isAuthenticated) return;
    if (!isJoinedPlatformBrand()) return;

    setIsSyncing(true);
    setError(null);

    try {
      // BEFORE the fetch, not after: `fetchPropertyData` reads `currentHousehold`
      // out of the store at call time, so resolving first is what makes a refresh
      // that follows a household switch fetch for the household the member has
      // just landed in rather than the one they left. Every Budget caller of this
      // function is exactly that — `BudgetHouseholdScreen`'s switch/leave/delete
      // handlers call it immediately after moving households.
      resolveActiveLocalBudgetHousehold();
      await fetchPropertyData();
      setLastSyncAt(new Date());
    } catch (err) {
      captureException(err, { source: 'DataContext', phase: 'refreshActivePropertyData' });
      setError(err instanceof Error ? err.message : 'Failed to sync data');
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, fetchPropertyData]);

  const refreshAll = useCallback(async () => {
    if (!isAuthenticated) return;
    // Symply Language reuses the donor backend (no households/reports/tasks);
    // skip the House data sync so it doesn't 404 against the donor Worker.
    if (!isJoinedPlatformBrand()) return;

    setIsSyncing(true);
    setError(null);

    try {
      // House V2 local-first: the property list comes from the on-device ledger,
      // so the `householdsApi.list()` + D1 enumeration below must not run — it
      // would replace the local property set with whatever the server mirror
      // happens to hold.
      let houseLocalFirst = false;
      try {
        const { isHouseLocalFirst } =
          require('@features/house/local/flag') as typeof import('@features/house/local/flag');
        houseLocalFirst = isHouseLocalFirst();
      } catch {
        houseLocalFirst = false;
      }

      if (houseLocalFirst) {
        const { ensureHouseLocalSession } =
          require('@features/house/local/ensureSession') as typeof import('@features/house/local/ensureSession');
        await ensureHouseLocalSession();
        // Scheduled backups run in the foreground (Argon2 cannot finish inside
        // an iOS background window), so an open ledger is the trigger. Started
        // from here rather than ensureSession itself: the backup modules import
        // ensureSession, so starting it there would close an import cycle.
        const { startHouseAutoBackupScheduler } =
          require('@features/house/local/backup/autoBackup') as typeof import('@features/house/local/backup/autoBackup');
        startHouseAutoBackupScheduler();
        // Load tasks HERE, now that the ledger is open — this is the only place
        // in the app where that is guaranteed.
        //
        // `fetchPropertyData` is the sole writer of `taskStore` outside
        // `TasksScreen`, and Home renders straight off it. This branch used to
        // return without calling it, which left exactly one route to Home's task
        // list: the focus effect in `HomeScreen`, racing the very session open
        // that was still in flight above. Calling it after the await removes the
        // race instead of papering over it.
        //
        // Cheap, and it does NOT reintroduce what the old comment here feared:
        // the local task facades read the ACTIVE ledger's rows through
        // `rowsOf()` (`localWrite.ts`) and hydrate nothing, so a device holding
        // several properties still pays cold-open for the one it is looking at.
        // Reports stay remote — Tier B, the Lambda has to read the PDF — and a
        // failure there no longer speaks for the household.
        await fetchPropertyData();
        setLastSyncAt(new Date());
        return;
      }

      // Budget V2 local-first: never replace the on-device household with D1 list.
      let localFirst = false;
      try {
        const { isBudgetLocalFirst } =
          require('@features/budget/local/flag') as typeof import('@features/budget/local/flag');
        localFirst = isBudgetLocalFirst();
      } catch {
        localFirst = false;
      }

      if (localFirst) {
        const { ensureBudgetLocalSession } =
          require('@features/budget/local/ensureSession') as typeof import('@features/budget/local/ensureSession');
        await ensureBudgetLocalSession();
        // Scheduled backups run in the foreground (Argon2 cannot finish inside
        // an iOS background window), so an open ledger is the trigger. Started
        // from here rather than ensureSession itself: the backup modules import
        // ensureSession, so starting it there would close an import cycle.
        const { startBudgetAutoBackupScheduler } =
          require('@features/budget/local/backup/autoBackup') as typeof import('@features/budget/local/backup/autoBackup');
        startBudgetAutoBackupScheduler();
        // Ledger/household already seeded into householdStore by ensureSession.
        setLastSyncAt(new Date());
        return;
      }

      const householdsResponse = await householdsApi.list();
      setHouseholds(householdsResponse.households);

      const store = useHouseholdStore.getState();
      let activeHousehold = store.currentHousehold;
      if (!activeHousehold && householdsResponse.households.length > 0) {
        activeHousehold = householdsResponse.households[0];
        setCurrentHousehold(activeHousehold);
      }

      const mode = store.propertyMode;
      const householdsToFetch = mode === 'all'
        ? householdsResponse.households
        : (activeHousehold ? [activeHousehold] : []);

      if (householdsToFetch.length > 0) {
        await fetchPropertyData();
      }

      setLastSyncAt(new Date());
    } catch (err) {
      captureException(err, { source: 'DataContext', phase: 'refreshAll' });
      setError(err instanceof Error ? err.message : 'Failed to sync data');
    } finally {
      setIsSyncing(false);
    }
  }, [isAuthenticated, setHouseholds, setCurrentHousehold, fetchPropertyData]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initial load when authenticated (run once to avoid Strict Mode double-run / freeze)
  useEffect(() => {
    // hasHydrated guards against the window where the persisted isAuthenticated
    // flag has rehydrated but the SecureStore-held token hasn't loaded yet — an
    // authenticated fetch fired in that window is guaranteed a pre-token 401.
    if (!hasHydrated || !isAuthenticated) {
      initialLoadStarted.current = false;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      return;
    }
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;

    // Read server-held settings back. NOTHING else calls this, and without it
    // currency / tax country / tax region / theme are write-only: `setCurrency`
    // queues `PUT /api/settings/bulk` (observed 200 `success=true` on a real
    // iPhone, 2026-09-03), but `useAppStore` carries no `persist` middleware, so
    // the next launch starts from `initialState` — `DEFAULT_CURRENCY` and null
    // region — and the member reads that as "it didn't save". `seedFirstRunTaxRegion`
    // hangs off this call too, so the locale-based first-run default never ran
    // either. Same story for `widgetLayoutStore`, which also holds nothing locally.
    //
    // Floated, not awaited: settings are independent of household data and must
    // not delay it. `loadAllSettings` never throws (it returns false), falls back
    // to its own cache when the fetch fails, and restores sync write-back on both
    // its success and error paths — so a failure here costs the defaults, nothing more.
    void settingsLoader.loadAllSettings();

    // Don't set isLoading so the app stays interactive; only isSyncing is set inside refreshAll

    // Safety: always clear loading/syncing after SYNC_TIMEOUT_MS if fetch hangs
    loadingTimeoutRef.current = setTimeout(() => {
      loadingTimeoutRef.current = null;
      setIsLoading(false);
      setIsSyncing(false);
    }, SYNC_TIMEOUT_MS);

    refreshAll().finally(() => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setIsLoading(false);
    });
  }, [hasHydrated, isAuthenticated, refreshAll]);

  const value = useMemo(
    () => ({
      isLoading,
      isSyncing,
      lastSyncAt,
      error,
      refreshAll,
      refreshActivePropertyData,
      clearError,
      getActiveHouseholdIds,
      isMultiPropertyMode,
    }),
    [isLoading, isSyncing, lastSyncAt, error, refreshAll, refreshActivePropertyData, clearError, getActiveHouseholdIds, isMultiPropertyMode]
  );

  return (
    <DataContext.Provider value={value}>{children}</DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
