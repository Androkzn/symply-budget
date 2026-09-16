/**
 * House's binding of the shared delta-state projection core (plan §3.1).
 *
 * The merge engine itself — snapshot/diff, per-field LWW, absorbing tombstones,
 * orphan-patch parking, conflict surfacing (BR-044), cursor strategy — lives in
 * `@symply/local-first/projection` and is the *same* code Budget V2 has been
 * running on two devices since 2026-08-12. House pays only for the registry in
 * `./schema.ts`.
 *
 * House has no bucket override: unlike Budget's `goals` (keyed on numeric
 * year/month columns) every windowed House table carries a real date string, so
 * `HOUSE_WINDOWED_DATE_FIELDS` covers the whole surface. **29 of the 63 live
 * tables** have no windowed field at all and are always-resident by design.
 *
 * Sub-wave B1 added two of each: `contractorVisits` and `contractorDocuments`
 * window on their event date, while `contractors` and
 * `contractorRepresentatives` are the address book and stay resident. B2 added
 * four windowed and none resident — quoting is entirely event-shaped — and B3
 * and B4 did the same, so the always-resident count held at fifteen across the
 * whole of Wave B while the live total moved by nineteen. Everything Wave B
 * added is an event; the address book was the single exception and it arrived
 * first.
 *
 * Wave C reversed that ratio. C1 added two windowed and three resident (an
 * address book plus two tables whose only period column is an `integer` year and
 * therefore CANNOT be bucketed), C2 added three resident and none windowed, and
 * C3 added three resident and one windowed. The reason is the same in all three:
 * a task outside the read window is absent and obviously so, whereas a MARKER or
 * a garden object outside it renders a drawing that looks complete and is wrong.
 * Only the transient rows — a boundary draft with an `expires_at` — are worth
 * windowing in that family.
 *
 * C4 reversed it back, and it is the clearest split in the registry because both
 * halves come from one feature. Six of its ten are windowed and four are not,
 * and the line is "is this row part of the project, or is it an event that
 * happened to the project". Budget lines, selections, phases and plan links ARE
 * the project — `getHub` reads every one of them on the first render, so a row
 * in a colder bucket is an estimate that is silently short — while the project
 * itself, its milestones and its four append-only tables are events strung along
 * a job that spans months.
 *
 * B3 is also the first family whose parent and children window on DIFFERENT
 * fields, which is safe only because `localProjectsApi` reads a project's
 * children THROUGH the project: a milestone that buckets colder than its
 * project is still hydrated with it, never surfaced alone. C4 repeats that shape
 * exactly — `homeProjects` buckets on `target_start_at` and its milestones on
 * `due_on` — and `localHomeProjectsApi.getHub` is what makes it safe.
 *
 * The 2026-08-15 `applianceDocuments` correction added the 29th resident table
 * and no window, which is the C2/C4 line applied outside any wave: a manual, a
 * receipt and a warranty scan ARE the appliance rather than events against it,
 * and the DTO carries no date D1 has a column for anyway. `schema.ts` argues
 * both halves beside the map.
 *
 * Only the LIVE map is read here. `HOUSE_STAGED_WINDOWED_DATE_FIELDS` is
 * declared for tables the projection does not yet merge; it is `{}` since C4,
 * and the split is kept for the next table that stages rather than deleted (see
 * `schema.ts`). Activating a sub-wave has to MOVE the entry rather than
 * duplicate it, or a table would be windowed by whichever map the reader
 * happened to consult.
 */
import { createLedgerProjection, defineLedgerSchema } from '@symply/local-first';
import type {
  ApplyDeltaResult as SharedApplyDeltaResult,
  LedgerConflict as SharedLedgerConflict,
  LedgerDelta as SharedLedgerDelta,
  LedgerLww as SharedLedgerLww,
  LedgerOpPayload as SharedLedgerOpPayload,
  LedgerSnapshot as SharedLedgerSnapshot,
  RowWrite as SharedRowWrite,
} from '@symply/local-first';

import type { HouseLedger } from './engine';
import {
  HOUSE_LEDGER_TABLE_KEYS,
  HOUSE_WINDOWED_DATE_FIELDS,
  type HouseLedgerTableName,
} from './schema';

export const HOUSE_LEDGER_SCHEMA = defineLedgerSchema<HouseLedgerTableName>({
  tableKeys: HOUSE_LEDGER_TABLE_KEYS,
  windowedDateFields: HOUSE_WINDOWED_DATE_FIELDS,
  logPrefix: 'HouseLocal',
  isDev: () => __DEV__,
});

const projection = createLedgerProjection<HouseLedgerTableName, HouseLedger>(HOUSE_LEDGER_SCHEMA);

export const {
  rowBucket,
  collectRowWrites,
  installRowEnvelopes,
  captureLedgerSnapshot,
  diffLedger,
  restoreDeltaFromBackup,
  chunkLedgerDelta,
  applyLedgerDelta,
  drainParkedRows,
  planTableStrategy,
} = projection;

export {
  ALWAYS_RESIDENT_BUCKET,
  LEDGER_INDEX_THRESHOLD,
  MAX_OP_DELTA_BYTES,
  MAX_OP_DELTA_ROWS,
  MAX_PARKED_ROWS,
  MAX_TRACKED_CONFLICTS,
  RESTORE_AUTHOR,
  RESTORE_HLC,
  chunkRowsForOp,
  compareStamps,
  decodeLedgerOpPayload,
  encodeLedgerOpPayload,
  restoreStamp,
} from '@symply/local-first';

export type {
  LedgerConflictKind,
  OpStamp,
  ParkedField,
  RowDelta,
  RowEnvelope,
  RowLww,
} from '@symply/local-first';

export type LedgerTableName = HouseLedgerTableName;
export type LedgerDelta = SharedLedgerDelta<HouseLedgerTableName>;
export type LedgerOpPayload = SharedLedgerOpPayload<HouseLedgerTableName>;
export type LedgerConflict = SharedLedgerConflict<HouseLedgerTableName>;
export type LedgerLww = SharedLedgerLww<HouseLedgerTableName>;
export type LedgerSnapshot = SharedLedgerSnapshot<HouseLedgerTableName>;
export type ApplyDeltaResult = SharedApplyDeltaResult<HouseLedgerTableName>;
export type RowWrite = SharedRowWrite<HouseLedgerTableName>;

export { HOUSE_LEDGER_TABLE_KEYS, HOUSE_LEDGER_TABLE_NAMES } from './schema';
