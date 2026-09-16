/**
 * Bridge between committed ledger changes and the screens that read them.
 *
 * Budget screens read the local ledger through `budgetApi` inside `useEffect`s
 * keyed on each feature store's `dataRevision` (see `BudgetHomeScreen`,
 * `BudgetSpendingsView`, savings/pension/mortgage views). Merging a remote op
 * mutates the ledger arrays in place, so without a revision bump the UI keeps
 * rendering the pre-sync state until the user happens to switch month or
 * remount the tab — which is exactly the "member B's change never shows up"
 * symptom this layer exists to prevent.
 *
 * React Query caches are invalidated too: a handful of budget surfaces
 * (category detail, timeline) go through `queryClient` rather than the stores.
 *
 * ONLY THE ACTIVE HOUSEHOLD (BR-016)
 * ----------------------------------
 * With several households open on one device, the ledger moves for reasons the
 * member cannot see: a background household's mailbox sync merges a peer's ops,
 * an enrolment completes, a checkpoint installs. Every one of those used to
 * reach this bridge and fire a bare `queryClient.invalidateQueries()` plus four
 * `markDirty()` calls — repainting the FOREGROUND household's screens, and
 * refetching its queries, off data that belongs to a household it is not
 * showing. At best that is a flicker and a burst of work per background sync; at
 * worst it re-reads the ledger mid-merge for no reason at all.
 *
 * So the change payload carries the household that moved, and this bridge
 * refuses everything that is not the active one. The stores and the query cache
 * only ever hold the active household's data (the engine's `getLocal*`
 * accessors read the active session), so a background change genuinely has
 * nothing on screen to invalidate.
 *
 * `change.tables` is deliberately NOT used to narrow further — that is House's
 * pattern (see `house/local/sync/ledgerRefresh.ts`) and it earns its keep there
 * because House holds ~15 query keys, several of them server-backed. Budget's
 * screens are Zustand + `dataRevision` effects over a small key set, and an
 * empty `tables` array here is an enrolment completing or a conflict list
 * clearing on the ACTIVE household — precisely a moment the screen must repaint,
 * not skip.
 */
import { queryClient } from '@/lib/queryClient';
import { useBudgetStore } from '@stores/budgetStore';
import { useMortgageStore } from '@stores/mortgageStore';
import { usePensionStore } from '@stores/pensionStore';
import { useSavingsStore } from '@stores/savingsStore';

import {
  getActiveBudgetHouseholdId,
  subscribeToLedgerChanges,
  type BudgetLedgerChange,
} from '../engine';

let unsubscribe: (() => void) | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long events are gathered before the screen is repainted once.
 *
 * The sync run already coalesces its own merges (`withLedgerBatch` in the
 * engine), so this is not the primary defence — it is the one that covers every
 * OTHER burst: a WebRTC round, a restore, a household switch that lands beside
 * an arriving op, a future caller that forgets the batch. Trailing-only, because
 * a leading edge would repaint off the first op of a burst and reintroduce
 * exactly the half-merged frame this exists to remove.
 *
 * Both committed local writes and remote merges use this bridge. Local echo
 * projection stays silent; mutateLocalLedger publishes after persistence.
 * Existing caller markDirty calls may still provide an immediate refresh.
 */
const REFRESH_COALESCE_MS = 120;

function flushRefresh(): void {
  coalesceTimer = null;
  try {
    useBudgetStore.getState().markDirty();
    useSavingsStore.getState().markDirty();
    usePensionStore.getState().markDirty();
    useMortgageStore.getState().markDirty();
    void queryClient.invalidateQueries();
  } catch (error) {
    console.warn('[budget.local] ledger refresh bridge failed', error);
  }
}

/** Publish an installed snapshot to mounted screens before dismissing first-sync UI. */
export async function refreshBudgetLedgerNow(householdId: string): Promise<void> {
  if (householdId !== getActiveBudgetHouseholdId()) return;
  if (coalesceTimer) clearTimeout(coalesceTimer);
  coalesceTimer = null;
  useBudgetStore.getState().markDirty();
  useSavingsStore.getState().markDirty();
  usePensionStore.getState().markDirty();
  useMortgageStore.getState().markDirty();
  await queryClient.invalidateQueries();
  // Let the store-driven screen effects publish their local reads before the
  // completion banner is removed. No network publishing is part of this step.
  await new Promise<void>(resolve => setTimeout(resolve, REFRESH_COALESCE_MS));
}

/** Idempotent — safe to call on every session open. */
export function startBudgetLedgerRefreshBridge(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeToLedgerChanges((_revision: number, change: BudgetLedgerChange) => {
    // Strict equality against the live pointer, read per event rather than
    // captured: the active household changes under this listener, and an
    // activation notifies with the NEW id, so the switch itself passes the
    // filter and repaints — which is exactly what a switch should do.
    if (change.householdId !== getActiveBudgetHouseholdId()) return;
    if (coalesceTimer) clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(flushRefresh, REFRESH_COALESCE_MS);
  });
}

export function stopBudgetLedgerRefreshBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
}
