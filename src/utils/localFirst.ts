import { isBudgetLocalFirst } from '@features/budget/local/flag';
import { isHealthLocalFirst } from '@features/health/local/flag';
import { isHouseLocalFirst } from '@features/house/local/flag';

/**
 * True when this build reads and writes its own on-device ledger rather than a
 * Worker — House V2, Budget V2 and Health V2 all do.
 *
 * On such a build the network is a *sync transport*, not a dependency: every
 * screen, every read and every write works with the radio off, and the ops
 * queue drains whenever a peer or the mailbox relay is reachable again. So
 * "offline" is a routine state to be reported quietly by the sync surfaces
 * (see `houseSyncCopy.ts`), never an error and never something that blocks the
 * UI — that is what {@link NetworkBlockOverlay} keys off.
 *
 * Each app's own flag keeps its own env override + brand default (and its own
 * Jest opt-in), so this stays a pure OR over them rather than a fourth source
 * of truth that could disagree.
 */
export function isLocalFirstBuild(): boolean {
  return isHouseLocalFirst() || isBudgetLocalFirst() || isHealthLocalFirst();
}
