/**
 * Keeps the ACTIVE household free of same-name categories as data moves.
 *
 * `mergeDuplicateCategories` runs at session open, which repairs what is on
 * disk. Duplicates also ARRIVE mid-session — a peer's seed lands, a checkpoint
 * installs, a spending shows up filed under an id this device already merged
 * away — and waiting for the next launch means the picker shows "Pets" twice
 * until then. So this listens to the same change feed the screens repaint on,
 * and runs the (cheap, idempotent) merge once the burst settles.
 *
 * Active household only, like `ledgerRefresh`: the merge goes through
 * `runOnHousehold`, which ACTIVATES the household it is asked about, and a
 * background household's sync must not switch what is on screen. A cold
 * household picks its repair up when it is switched into — activation notifies
 * with every table, which passes the filter below.
 *
 * The merge's own write notifies too; the pass it schedules finds nothing and
 * authors nothing, so the loop closes after one extra scan.
 */
import { getActiveBudgetHouseholdId, subscribeToLedgerChanges, type BudgetLedgerChange } from './engine';
import type { LedgerTableName } from './projection';

/** Tables whose rows either ARE categories or point at one. */
const TRIGGER_TABLES: ReadonlySet<LedgerTableName> = new Set<LedgerTableName>([
  'categories',
  'expenses',
  'items',
  'subBudgets',
]);

/** Long enough for a sync run's per-op notifications to coalesce into one pass. */
const RECONCILE_COALESCE_MS = 250;

let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let rerun = false;

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, RECONCILE_COALESCE_MS);
}

function run(): void {
  timer = null;
  if (inFlight) {
    // Changes landed while a pass was running — go again once it settles.
    rerun = true;
    return;
  }
  const householdId = getActiveBudgetHouseholdId();
  if (!householdId) return;
  inFlight = import('./localBudgetApi')
    .then((m) => m.localBudgetApi.mergeDuplicateCategories(householdId))
    .then(() => undefined)
    .catch((error: unknown) => {
      console.warn('[BudgetLocal] category reconcile skipped', error);
    })
    .finally(() => {
      inFlight = null;
      if (rerun && unsubscribe) {
        rerun = false;
        schedule();
      }
    });
}

/** Idempotent — safe to call on every session open. */
export function startBudgetCategoryReconcileBridge(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeToLedgerChanges((_revision: number, change: BudgetLedgerChange) => {
    // Read per event, not captured: the active household changes under this
    // listener, and an activation notifies with the NEW id.
    if (change.householdId !== getActiveBudgetHouseholdId()) return;
    // An empty table list is an enrolment completing or a conflict list
    // clearing — the moment a deferred merge (bootstrap pending) becomes due.
    if (change.tables.length > 0 && !change.tables.some((table) => TRIGGER_TABLES.has(table))) {
      return;
    }
    schedule();
  });
}

export function stopBudgetCategoryReconcileBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
  rerun = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
