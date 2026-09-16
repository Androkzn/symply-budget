/**
 * The Health ledger's change signal — Stage He3 (§7 refresh contract, consumer side).
 *
 * Deliberately modelled on `src/stores/healthSyncStore.ts`, which is the one
 * mechanism in Health that already solves "data landed while the member is
 * sitting on a tab": an in-memory Zustand counter that screens subscribe to.
 * This store generalises it from "a HealthKit import happened" to "these ledger
 * tables moved".
 *
 * WHAT IT HOLDS
 * -------------
 *  - `revision` — monotonic, in-memory, reset each app session. It is this
 *    store's own counter, NOT the engine's: `notifyHealthLedgerChanged` is
 *    called both from the engine's delta path and from session-lifecycle sites
 *    that have no engine revision at all (§7: `ensureHealthLocalSession`,
 *    account switch, the HealthKit drain). Mixing two counters would make it
 *    non-monotonic, and every consumer here compares with `>`.
 *  - `touched` — the ledger TABLE NAMES the change moved. Never row data: the
 *    payload of a Health change is a log/analytics leak surface (plan §15), so
 *    the contract is table names only, all the way from the engine to the hook.
 *
 * There is deliberately no `reset()`. An account switch fires
 * `notifyHealthLedgerChanged(ALL, 'restore')`, which bumps the revision
 * forward; rewinding it to 0 would make every mounted screen's
 * "have I seen this revision" comparison go backwards and silently stop
 * hydrating until the counter climbed back past its old value.
 */
import { create } from 'zustand';

import type { HealthLedgerTableName } from './schema';

/** Shared empty tuple so "nothing table-shaped changed" keeps a stable identity. */
const NO_TABLES: readonly HealthLedgerTableName[] = Object.freeze([]);

export interface HealthLedgerStoreState {
  /** Bumped once per fanned-out change. Monotonic for the life of the session. */
  revision: number;
  /** Tables the change at `revision` touched. Frozen — consumers must not mutate. */
  touched: readonly HealthLedgerTableName[];
  /**
   * Publish a change. Called only by `ledgerRefresh.ts`, which owns the origin
   * rules and the re-entrancy guard — do not call this from screens or repos.
   */
  markChanged: (tables: readonly HealthLedgerTableName[]) => void;
}

export const useHealthLedgerStore = create<HealthLedgerStoreState>((set) => ({
  revision: 0,
  touched: NO_TABLES,
  markChanged: (tables) =>
    set((state) => ({
      revision: state.revision + 1,
      touched: tables.length === 0 ? NO_TABLES : Object.freeze([...tables]),
    })),
}));
