/**
 * Re-render when the local ledger changes.
 *
 * The engine is not a React store — it is a mutable projection with a listener
 * set — so anything read straight off it (`getLocalHouseConflicts()`,
 * `isAwaitingHouseEnrolment()`) is invisible to React until something else
 * happens to re-render. The sync card and the conflict list both read exactly
 * those, and both are the surfaces where a stale render is worst: a discarded
 * edit that never appears is the BR-044 bug with extra steps.
 *
 * `useSyncExternalStore` is the right primitive here — `getHouseLedgerRevision()`
 * is a monotonically increasing number, which is a valid snapshot, and it keeps
 * the subscription concurrent-safe without a `useState` + `useEffect` dance that
 * would miss a change fired between render and effect.
 */
import { useCallback, useSyncExternalStore } from 'react';

import {
  getHouseLedgerRevision,
  subscribeToHouseLedgerChanges,
} from '@features/house/local/engine';

/**
 * @param householdId Only re-render for this property's changes. Omit to react
 *   to every property — correct for a card that follows whatever is active.
 */
export function useHouseLedgerRevision(householdId?: string): number {
  const subscribe = useCallback(
    (onChange: () => void) =>
      subscribeToHouseLedgerChanges((change) => {
        // A multi-property device syncs each property independently; a card
        // bound to property A must not re-render on every op landing in B.
        if (householdId && change.householdId && change.householdId !== householdId) return;
        onChange();
      }),
    [householdId],
  );

  return useSyncExternalStore(subscribe, getHouseLedgerRevision, getHouseLedgerRevision);
}
