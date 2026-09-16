/**
 * Re-read when a PEER's write lands — for screens that do not use React Query.
 *
 * ## The gap this closes
 *
 * `ledgerRefresh.ts` is the bridge between an incoming sync delta and the UI,
 * and it works by invalidating React Query keys. That covers most of House. It
 * does not cover the garden surface, and the bridge says so itself: grepping
 * every `queryKey` in `src/` finds no garden key at all, because every garden
 * screen fetches imperatively with `useState`/`useEffect`. The
 * `['garden-plans']` entries in `HOUSE_TABLE_QUERY_KEYS` therefore invalidate a
 * key nothing subscribes to, which React Query treats as a no-op.
 *
 * The consequence is invisible on one device and obvious on two. A member drags
 * a lot boundary on their phone; the iPad has the same plan open; the row syncs
 * within seconds and the iPad goes on drawing the old outline until the member
 * navigates away and back. The DATA is correct on both devices the whole time —
 * only the screen is stale, which is the worst version of this bug because
 * nothing looks wrong.
 *
 * `useFocusEffect` is what those screens have today and it is not the same
 * thing: it fires when you arrive, not when the data moves under you.
 *
 * ## Why a hook rather than adding React Query to the garden screens
 *
 * Converting four screens and an editor to React Query would be the tidier
 * long-term answer and a much larger change, and it would have to re-decide
 * cache keys for a family the refresh map deliberately gave a namespace nobody
 * subscribes to. This subscribes to the same signal the bridge does, one level
 * down, and leaves each screen's existing load function in charge of what a
 * reload means.
 *
 * ## Three things it is careful about
 *
 *  - **Not local-first → nothing happens.** A household on the remote API has no
 *    ledger to listen to, and `subscribeToHouseLedgerChanges` would simply never
 *    fire. The flag check keeps the engine out of the module graph for those.
 *  - **Another property's sync must not repaint this screen.** A change carries
 *    the `householdId` that moved; H5 puts several properties on one device and
 *    a background one syncing is not a reason to reload the one being looked at.
 *  - **Bursts coalesce.** A sync run merges ops ONE AT A TIME, so a peer adding
 *    twelve objects emits twelve changes. Without coalescing that is twelve
 *    reloads of the same screen.
 */
import { useEffect, useRef } from 'react';

import { subscribeToHouseLedgerChanges, type HouseLedgerChange } from './engine';
import { isHouseLocalFirst } from './flag';
import type { HouseLedgerTableName } from './schema';

/**
 * Slightly longer than the refresh bridge's 120ms.
 *
 * The bridge invalidates a cache key; this re-runs a screen's whole imperative
 * load, which is more expensive, so it is worth waiting a little longer for the
 * rest of a burst to arrive.
 */
const COALESCE_MS = 150;

export interface UseHouseLedgerTablesOptions {
  /**
   * Only react to changes for this property. Omit and every property's sync
   * reloads the screen — correct only for a screen that is not property-scoped.
   */
  householdId?: string | null;
  /**
   * Set false to suspend reloads. The garden viewer uses this while the member
   * is EDITING: reloading under an open editor would replace their unsaved
   * draft with the stored rows, turning a peer's unrelated write into silent
   * loss of the work in front of them.
   */
  enabled?: boolean;
}

export function useHouseLedgerTables(
  tables: readonly HouseLedgerTableName[],
  onChange: () => void,
  options: UseHouseLedgerTablesOptions = {},
): void {
  const { householdId = null, enabled = true } = options;

  // Refs so a caller does not have to memoise its callback, and so `enabled`
  // flipping does not tear down and rebuild the subscription mid-burst.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const householdRef = useRef(householdId);
  householdRef.current = householdId;

  // A stable identity for the table set, so passing an inline array literal —
  // which every caller will — does not resubscribe on every render.
  const watchKey = [...tables].sort().join('|');

  useEffect(() => {
    if (!isHouseLocalFirst()) return;
    const watched = new Set(watchKey.split('|').filter(Boolean));
    if (watched.size === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = subscribeToHouseLedgerChanges((change: HouseLedgerChange) => {
      if (!enabledRef.current) return;
      // `householdId: null` on the change means "not property-scoped" and is
      // allowed through; a DIFFERENT property is not.
      const scoped = householdRef.current;
      if (scoped && change.householdId && change.householdId !== scoped) return;
      if (!change.tables.some((table) => watched.has(table))) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Re-checked at FIRE time, not at schedule time: the member may have
        // opened the editor during the coalescing window, and the whole point
        // of `enabled` is not to reload under them.
        if (!enabledRef.current) return;
        onChangeRef.current();
      }, COALESCE_MS);
    });

    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [watchKey]);
}
