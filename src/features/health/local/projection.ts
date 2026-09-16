/**
 * Health's binding of the shared delta-state projection core — Stage He1.
 *
 * The merge engine itself — snapshot/diff, per-field LWW, absorbing tombstones,
 * orphan-patch parking, conflict surfacing, cursor strategy — lives in
 * `@symply/local-first/projection` and is the *same* code Budget V2 has been
 * running two-device since 2026-08-12 and House Wave A reuses. Health pays only
 * for the registry in `./schema.ts`.
 *
 * `projection.ts` is NOT forked (plan §18 / handoff Non-Goals). If Health needs
 * different merge behaviour, that is a change to the shared core with Budget and
 * House re-certified — not a copy.
 *
 * Health has no bucket override: every windowed Health table carries a real
 * `date` string, so `HEALTH_WINDOWED_DATE_FIELDS` covers the whole surface. Two
 * of the eight (`userHabits`, `healthGoals`) are always-resident by design.
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

import type { HealthLedger } from './engine';
import {
  HEALTH_LEDGER_TABLE_KEYS,
  HEALTH_RESIDENT_WINDOW_DAYS,
  HEALTH_WINDOWED_DATE_FIELDS,
  type HealthLedgerTableName,
} from './schema';

export const HEALTH_LEDGER_SCHEMA = defineLedgerSchema<HealthLedgerTableName>({
  tableKeys: HEALTH_LEDGER_TABLE_KEYS,
  windowedDateFields: HEALTH_WINDOWED_DATE_FIELDS,
  logPrefix: 'HealthLocal',
  isDev: () => __DEV__,
  // He10 §4 mitigation: intern the stamps in the persisted watermark half.
  // Health-only. On the 10-year corpus the LWW half is 70% of the plaintext a
  // cold open decrypts, and a Health household has exactly one member (plan
  // §1.2) so its author id repeats on every stamp of every row. Budget and
  // House are untouched — see `packages/local-first/src/projection/lww-codec.ts`.
  compactLww: true,
  // The other He10 §4 mitigation, and the one that actually moves cold open:
  // decrypt a window rather than the whole table. Health-only for the same
  // reason `compactLww` is — Budget and House pass no `residentWindowDays` and
  // so keep loading every row, byte for byte as before.
  //
  // ⚠️ Turning this on is only half the change. The engine owes the other half:
  // `ensureHealthRowsResident` widens the window when a read reaches past it,
  // and `hydrateRowsForDelta` widens it before a merge touches a row it did not
  // load. Without those two, this flag does not make the ledger faster — it
  // makes the user's older data invisible, which is exactly the failure §1.3
  // exists to forbid.
  residentWindowDays: HEALTH_RESIDENT_WINDOW_DAYS,
});

const projection = createLedgerProjection<HealthLedgerTableName, HealthLedger>(
  HEALTH_LEDGER_SCHEMA,
);

export const {
  rowBucket,
  residentBuckets,
  collectRowWrites,
  installRowEnvelopes,
  mergeRowEnvelopes,
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
  bucketsForRange,
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

export type LedgerTableName = HealthLedgerTableName;
export type LedgerDelta = SharedLedgerDelta<HealthLedgerTableName>;
export type LedgerOpPayload = SharedLedgerOpPayload<HealthLedgerTableName>;
export type LedgerConflict = SharedLedgerConflict<HealthLedgerTableName>;
export type LedgerLww = SharedLedgerLww<HealthLedgerTableName>;
export type LedgerSnapshot = SharedLedgerSnapshot<HealthLedgerTableName>;
export type ApplyDeltaResult = SharedApplyDeltaResult<HealthLedgerTableName>;
export type RowWrite = SharedRowWrite<HealthLedgerTableName>;

export { HEALTH_LEDGER_TABLE_KEYS, HEALTH_LEDGER_TABLE_NAMES } from './schema';
