/**
 * The shared write helper every House local api module goes through.
 *
 * One place enforces the rules the plan calls non-negotiable, so 10 modules and
 * ~117 methods cannot each get them subtly wrong:
 *
 *  - **Bulk writes emit ONE op per chunk, never one op per row.**
 *    `mutateLocalHouseLedger` captures and diffs the WHOLE ledger per call, so a
 *    loop of single writes is quadratic. House's bulk paths (space seeding,
 *    report→draft conversion, `createDefaults`, seasonal generation) all run at
 *    onboarding while the member is watching, which is the worst possible place
 *    to be quadratic.
 *  - **Reads never copy the ledger.** A read returns the live array filtered;
 *    the ledger is the source of truth and screens re-render off the refresh
 *    bridge, not off a snapshot.
 *  - **Every row carries its `household_id`.** H5 keeps one ledger per property,
 *    but the facades filter defensively so a mis-scoped read cannot leak.
 */
import { chunkRowsForOp } from '@symply/local-first';

import { getLocalHouseLedger, mutateLocalHouseLedger, type HouseLedger } from './engine';
import { HouseLocalUnknownPropertyError } from './errors';
import type { HouseLedgerTableName } from './schema';

export type LocalOpDescriptor = {
  opType: string;
  entityType: string;
  entityId: string;
  payload?: unknown;
};

/** Read the active property's ledger. Never mutate what this returns. */
export function ledger(): HouseLedger {
  return getLocalHouseLedger();
}

/** The active property's id — every local row is scoped to it. */
export function activeHouseholdId(): string {
  return getLocalHouseLedger().household.id;
}

/** One write, one op. The ordinary path. */
export async function writeLocal(
  mutator: (draft: HouseLedger) => void,
  op: LocalOpDescriptor,
): Promise<void> {
  await mutateLocalHouseLedger(mutator, {
    opType: op.opType,
    entityType: op.entityType,
    entityId: op.entityId,
    payload: op.payload ?? {},
  });
}

/**
 * A bulk write, chunked so each op stays under the relay's plaintext budget.
 *
 * `chunkRowsForOp` packs by bytes AND row count, and never drops a row that is
 * bigger than the budget on its own. Each chunk is one op, so a 600-row seed is
 * ~3 ops rather than 600.
 */
export async function writeLocalBulk<TRow>(
  rows: TRow[],
  apply: (draft: HouseLedger, chunk: TRow[]) => void,
  op: (chunk: TRow[], index: number) => LocalOpDescriptor,
): Promise<void> {
  if (rows.length === 0) return;
  const chunks = chunkRowsForOp(rows);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
     
    await writeLocal((draft) => apply(draft, chunk), op(chunk, index));
  }
}

/** Rows of one table belonging to the active property. */
export function rowsOf<T extends { household_id?: string }>(
  table: HouseLedgerTableName,
): T[] {
  const current = ledger();
  const householdId = current.household.id;
  const rows = (current as unknown as Record<string, unknown>)[table] as T[] | undefined;
  if (!rows) return [];
  // A row with no `household_id` belongs to the ledger it is in — the column is
  // defensive, not authoritative, because the ledger is already per property.
  return rows.filter((row) => row.household_id === undefined || row.household_id === householdId);
}

/** One row by id, or null. */
export function rowById<T extends { id: string; household_id?: string }>(
  table: HouseLedgerTableName,
  id: string,
): T | null {
  return rowsOf<T>(table).find((row) => row.id === id) ?? null;
}

/** ISO timestamp for `created_at` / `updated_at`. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Assert that the property a caller addressed is the ACTIVE one.
 *
 * Every remote api method takes a `householdId`, because the server can serve
 * any household the caller is a member of. On device that is not true:
 * `mutateLocalHouseLedger` always writes the active session (H5), so a facade
 * handed a background property's id would silently write the member's edit into
 * the wrong home — and it would sync there.
 *
 * Callers that genuinely need another property must activate it first
 * (`activateLocalHouseProperty`) or read through `getLocalHouseLedgerFor`.
 * Throwing is the only safe default; the alternative is a cross-property write
 * that nobody notices until two homes disagree.
 */
export function requireActiveProperty(householdId: string): string {
  const active = activeHouseholdId();
  if (householdId && householdId !== active) {
    throw new HouseLocalUnknownPropertyError(householdId);
  }
  return active;
}
