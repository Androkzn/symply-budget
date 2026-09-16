/**
 * Health ledger → screen refresh bridge — Stage He3, plan §7 "Refresh contract
 * (normative)".
 *
 * WHY THIS IS NOT THE HOUSE / BUDGET BRIDGE
 * -----------------------------------------
 * House's `local/sync/ledgerRefresh.ts` maps changed tables to React Query key
 * prefixes and calls `queryClient.invalidateQueries`. Health cannot: its screens
 * are a 17-way `Promise.all` of `load*()` into component-local `useState`
 * driven by `useFocusEffect` (`screens/HealthHomeScreen.tsx:198-219`). There is
 * no React Query key to invalidate, no Zustand store holding Health domain data,
 * and no emitter in any `health*Storage.ts` — so an inbound delta from the
 * member's other device changes nothing on screen until they navigate away and
 * back.
 *
 * So the fan-out target here is a revision counter (`healthLedgerStore`) plus
 * one hook per screen. The hook copies BOTH guards from the one Health
 * mechanism that already solves this, `useHealthKitSyncHydration`:
 *
 *  1. `useIsFocused` — only the visible tab re-hydrates. Visited-but-hidden
 *     tabs stay mounted under Expo Router; waking all of them at once stampedes
 *     MMKV + `setState` and starves the JS thread.
 *  2. `InteractionManager.runAfterInteractions` — wait out the current gesture
 *     or animation frame so a refresh does not collide with a drag.
 *
 * No screen state management is rewritten: a screen adds one hook call beside
 * its existing `useFocusEffect`.
 *
 * THE ORIGIN RULES (all four normative, §7)
 * -----------------------------------------
 *  - `'local'` is a NO-OP. The mutating screen already rendered its own write;
 *    fanning out here refetches on every save. Mirrors House's `!isLocalEcho`
 *    guard (`src/features/house/local/engine.ts:352`).
 *  - `'ingest'` DOES fan out. A HealthKit drain writes through
 *    `mutateLocalHealthLedger` on this device, so it is technically a local
 *    echo — but NO screen rendered it, which is the entire premise of the
 *    `'local'` no-op. Getting this wrong silently regresses the HealthKit
 *    refresh that ships today and is pinned by
 *    `src/features/health/__tests__/useHealthKitSyncHydration.test.tsx`.
 *  - `'inbound'` (a peer device's op) and `'restore'` (session open, account
 *    switch, backup restore) fan out.
 *  - Table filter: a screen re-hydrates only if the changed tables intersect
 *    the tables it renders. `HEALTH_TABLE_SCREEN_KEYS` is a TOTAL
 *    `Record<HealthLedgerTableName, …>`, so a 9th ledger table cannot compile
 *    without a mapping.
 *
 * Payload is table names only, never row data (§15 leak surface).
 */
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

import {
  getHealthLedgerRevision,
  subscribeToHealthLedgerChanges,
  type HealthLedgerChange,
} from './engine';
import { useHealthLedgerStore } from './healthLedgerStore';
import { HEALTH_LEDGER_TABLE_NAMES, type HealthLedgerTableName } from './schema';

const LOG_PREFIX = '[health.local]';

/** Where a ledger change came from. Only `'local'` is silent. */
export type HealthLedgerChangeOrigin = 'local' | 'ingest' | 'inbound' | 'restore';

/**
 * A screen (or headless projection) that renders ledger data.
 *
 * `'widget'` is not a screen the member navigates to — it is the widget/watch
 * projection at He3d, which subscribes through the same map so the App Group
 * payload is rebuilt when a peer's delta lands.
 */
export type HealthScreenKey =
  | 'home'
  | 'trends'
  | 'weight'
  | 'nutrition'
  | 'water'
  | 'activity'
  | 'habits'
  | 'body'
  | 'goals'
  | 'widget';

export const HEALTH_SCREEN_KEYS: readonly HealthScreenKey[] = [
  'home',
  'trends',
  'weight',
  'nutrition',
  'water',
  'activity',
  'habits',
  'body',
  'goals',
  'widget',
];

/**
 * Ledger table → every surface that renders it.
 *
 * TOTAL by type, so adding a 9th ledger table to `schema.ts` fails to compile
 * until it is mapped — the same "cannot forget" property `registryGuard` gives
 * the registry.
 *
 * Each row is derived from what the screen's own hydrate actually loads, not
 * from what it plausibly shows. Over-broad entries reinstate the stampede this
 * module exists to avoid; missing entries leave a screen stale.
 */
export const HEALTH_TABLE_SCREEN_KEYS: Record<
  HealthLedgerTableName,
  readonly HealthScreenKey[]
> = {
  /** Home log card + trends chart + the Weight screen; Body derives BMI / lean mass; widget weight tile. */
  weightEntries: ['home', 'trends', 'weight', 'body', 'widget'],
  /** Nutrition loads `loadWaterToday` beside the meal list; widget carries a water ring. */
  waterEntries: ['home', 'trends', 'water', 'nutrition', 'widget'],
  /** Weight screen loads `loadMeals` for the calories-vs-weight overlay. */
  nutritionEntries: ['home', 'trends', 'nutrition', 'weight', 'widget'],
  /** Workouts / steps / sleep — one table, discriminated by `entry_type`. */
  healthEntries: ['home', 'trends', 'activity', 'widget'],
  /** Body screen owns it; the Weight screen charts girths beside weight. */
  bodyMeasurements: ['home', 'weight', 'body'],
  /** Habit definitions. Trends charts completion rate, which needs the definitions. */
  userHabits: ['home', 'trends', 'habits'],
  habitLogs: ['home', 'trends', 'habits'],
  /**
   * Targets for every tracker (calories, macros, water, steps, workout minutes,
   * sleep) plus the profile fields the calculators read — so nearly every
   * surface renders it. This is broad because the table IS broad, not because
   * the mapping is lazy.
   */
  healthGoals: [
    'home',
    'trends',
    'weight',
    'nutrition',
    'water',
    'activity',
    'body',
    'goals',
    'widget',
  ],
};

function buildScreenTables(): Record<HealthScreenKey, readonly HealthLedgerTableName[]> {
  const out = {} as Record<HealthScreenKey, HealthLedgerTableName[]>;
  for (const screen of HEALTH_SCREEN_KEYS) out[screen] = [];
  for (const table of HEALTH_LEDGER_TABLE_NAMES) {
    for (const screen of HEALTH_TABLE_SCREEN_KEYS[table]) out[screen].push(table);
  }
  return out;
}

const SCREEN_TABLES = buildScreenTables();

/**
 * The tables a screen renders, as ONE stable array per screen key.
 *
 * Stability matters: `useHealthLedgerHydration` keys its effect on the table
 * set, and an inline `['weightEntries', …]` literal at the call site is a new
 * identity on every render. Prefer `healthTablesForScreen('weight')` in screens.
 */
export function healthTablesForScreen(
  screen: HealthScreenKey,
): readonly HealthLedgerTableName[] {
  return SCREEN_TABLES[screen];
}

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

/**
 * Re-entrancy budget.
 *
 * A subscriber may legitimately write while handling a change (the widget
 * projection recomputes and stores a derived row; a repo backfills a missing
 * goal). That write can come back as another notification. The nested call
 * never recurses — it is coalesced into the in-flight pass — but the passes
 * themselves must terminate, so they are capped. Four is far above any real
 * cascade and still cheap; exceeding it means a feedback loop, which is logged
 * rather than allowed to spin.
 */
const MAX_COALESCED_PASSES = 4;

let notifyDepth = 0;
let coalesced: Set<HealthLedgerTableName> | null = null;

function isChangeOrigin(value: unknown): value is HealthLedgerChangeOrigin {
  return (
    value === 'local' || value === 'ingest' || value === 'inbound' || value === 'restore'
  );
}

/**
 * An origin the engine emits that this module does not know is treated as
 * `'inbound'` — the safe direction (refresh once) rather than showing stale
 * data forever. `'local'` is the only value that suppresses a fan-out, and it
 * is spelled explicitly, so an unknown value can never be mistaken for it.
 */
function normalizeOrigin(value: unknown): HealthLedgerChangeOrigin {
  if (isChangeOrigin(value)) return value;
  if (__DEV__) console.warn(`${LOG_PREFIX} unknown ledger change origin`, value);
  return 'inbound';
}

/**
 * Fan a ledger change out to every mounted Health screen.
 *
 * Fire-and-forget by contract: it returns void and must NEVER be awaited inside
 * the projection apply loop. Callers are the engine's delta path (via the
 * bridge below) and the session-lifecycle sites in §7 — end of
 * `ensureHealthLocalSession`, account switch, and the HealthKit drain.
 */
export function notifyHealthLedgerChanged(
  tables: readonly HealthLedgerTableName[],
  origin: HealthLedgerChangeOrigin,
): void {
  // Rule 1 — the local echo. The screen that wrote it already rendered it.
  if (normalizeOrigin(origin) === 'local') return;

  // Re-entrancy — a subscriber wrote while we were fanning out. Merge into the
  // in-flight pass instead of recursing; the loop below picks it up.
  if (notifyDepth > 0) {
    coalesced ??= new Set<HealthLedgerTableName>();
    for (const table of tables) coalesced.add(table);
    return;
  }

  notifyDepth += 1;
  try {
    let batch: readonly HealthLedgerTableName[] = tables;
    for (let pass = 0; ; pass += 1) {
      coalesced = null;
      useHealthLedgerStore.getState().markChanged(batch);
      const nested = coalesced as Set<HealthLedgerTableName> | null;
      coalesced = null;
      if (!nested || nested.size === 0) return;
      if (pass >= MAX_COALESCED_PASSES) {
        console.warn(
          `${LOG_PREFIX} ledger refresh feedback loop — dropping re-entrant change`,
          [...nested],
        );
        return;
      }
      batch = [...nested];
    }
  } finally {
    notifyDepth -= 1;
    coalesced = null;
  }
}

// ---------------------------------------------------------------------------
// Bridge (engine → store)
// ---------------------------------------------------------------------------

let unsubscribe: (() => void) | null = null;

/**
 * Last engine revision this bridge observed. Module-level, not per-start, so a
 * stop/start pair inside one app session can tell "nothing happened while we
 * were detached" from "the engine moved without us".
 */
let lastEngineRevision: number | null = null;

/**
 * Subscribe the store to the engine. Idempotent — safe to call on every session
 * open (§5.1 wires it into `ensureHealthLocalSession`). Returns the stopper.
 *
 * COLD START. The engine hydrates the ledger — and therefore advances its
 * revision — before the session is considered open, while screens that mounted
 * first are already sitting there with their `useFocusEffect` hydrate long
 * finished. If the bridge only forwarded FUTURE changes, those screens would
 * stay empty until the member navigated away and back. So on start we compare
 * the engine's revision with the last one we forwarded and, if they differ,
 * fire a full `'restore'` fan-out. This is the same job House does by notifying
 * at its six session-activate / restore call sites rather than only at the
 * delta path (`engine.ts:352`).
 */
export function startHealthLedgerRefreshBridge(): () => void {
  if (unsubscribe) return stopHealthLedgerRefreshBridge;

  unsubscribe = subscribeToHealthLedgerChanges((change: HealthLedgerChange) => {
    try {
      lastEngineRevision = change.revision;
      notifyHealthLedgerChanged(change.tables, normalizeOrigin(change.origin));
    } catch (error) {
      console.warn(`${LOG_PREFIX} ledger refresh bridge failed`, error);
    }
  });

  try {
    const current = getHealthLedgerRevision();
    if (current !== lastEngineRevision) {
      lastEngineRevision = current;
      notifyHealthLedgerChanged(HEALTH_LEDGER_TABLE_NAMES, 'restore');
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} ledger refresh catch-up failed`, error);
  }

  return stopHealthLedgerRefreshBridge;
}

/** Detach from the engine. Leaves the store's revision alone (it is monotonic). */
export function stopHealthLedgerRefreshBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}

// ---------------------------------------------------------------------------
// Consumer
// ---------------------------------------------------------------------------

/**
 * Re-hydrate a Health screen when a ledger change touches the tables it renders.
 *
 * Add it beside the screen's existing `useFocusEffect` — it does not replace it.
 * `useFocusEffect` covers navigate-in; this covers "data landed while I was
 * already here", which is every inbound sync from the member's other device.
 *
 * @param hydrate the screen's existing loader (kept in a ref, so an inline
 *   arrow at the call site does not cancel an in-flight refresh)
 * @param tables the ledger tables the screen renders — prefer
 *   `healthTablesForScreen('home')` over an inline literal
 */
export function useHealthLedgerHydration(
  hydrate: () => void | Promise<void>,
  tables: readonly HealthLedgerTableName[],
): void {
  const isFocused = useIsFocused();
  const revision = useHealthLedgerStore((state) => state.revision);
  const touched = useHealthLedgerStore((state) => state.touched);

  const hydrateRef = useRef(hydrate);
  const tablesRef = useRef(tables);

  // Declared FIRST so both refs are current before the hydration effect below
  // runs for the same commit (React runs effects in declaration order).
  useEffect(() => {
    hydrateRef.current = hydrate;
    tablesRef.current = tables;
  });

  /** Highest revision folded into `pending`. Baselined at mount: a screen that
   *  mounts after a change has just hydrated itself and is already current. */
  const seenRevisionRef = useRef(revision);
  /** Tables changed since this screen last hydrated. Survives a hidden tab, so
   *  a change that lands while the tab is off-screen is not lost. */
  const pendingRef = useRef<Set<HealthLedgerTableName>>(new Set());

  // Content-addressed so an unstable `tables` identity at the call site does not
  // re-run (and therefore cancel) an in-flight refresh every render.
  const tablesKey = [...tables].sort().join('|');

  useEffect(() => {
    const pending = pendingRef.current;

    if (revision > seenRevisionRef.current) {
      for (const table of touched) pending.add(table);
      seenRevisionRef.current = revision;
    }

    if (pending.size === 0) return undefined;
    // Guard 1 — only the visible tab refetches.
    if (!isFocused) return undefined;

    const watched = tablesRef.current;
    if (!watched.some((table) => pending.has(table))) {
      // Nothing this screen renders moved; drop it so a later, relevant change
      // is not evaluated against stale table names.
      pending.clear();
      return undefined;
    }

    // Guard 2 — let the current gesture / animation frame finish first.
    // `pending` is cleared inside the task, not here: if this effect re-runs
    // before the task fires, the cleanup cancels it and the re-run reschedules,
    // so exactly one hydrate happens and none is lost.
    const task = InteractionManager.runAfterInteractions(() => {
      pending.clear();
      void hydrateRef.current();
    });
    return () => task.cancel();
  }, [revision, touched, isFocused, tablesKey]);
}
