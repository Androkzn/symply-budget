/**
 * Wire + merge types for delta-state projection, generic over a brand's ledger
 * table-name union.
 *
 * Promoted verbatim from `src/features/budget/local/projection.ts` (Budget V2)
 * so House and Budget share one CRDT core instead of forking a 1,100-line merge
 * engine per brand — see `documents/requirements/House v2/…` §3.1.
 */

/** A projected ledger row: a plain JSON object, exactly the DTO the API returns. */
export type LedgerRow = Record<string, unknown>;

/** Changed fields for one row. `n` marks a row that did not exist before. */
export type RowDelta = {
  k: string;
  f: LedgerRow;
  n?: 1;
};

/** Wire shape carried inside an op payload. Kept terse — ops are sealed+relayed. */
export type LedgerDelta<TName extends string = string> = {
  v: 1;
  u?: Partial<Record<TName, RowDelta[]>>;
  d?: Partial<Record<TName, string[]>>;
};

/** `{ intent }` is the original op descriptor payload, kept for debuggability. */
export type LedgerOpPayload<TName extends string = string> = {
  intent?: unknown;
  delta?: LedgerDelta<TName>;
};

export type LedgerConflictKind = 'field_lww' | 'edit_vs_delete';

export type LedgerConflict<TName extends string = string> = {
  id: string;
  table: TName;
  rowKey: string;
  field: string | null;
  kind: LedgerConflictKind;
  /** Stamp that won the merge. */
  winner: string;
  /** Stamp whose value was discarded. */
  loser: string;
  /** Author member of the discarded change (null when unknown). */
  loserMemberId: string | null;
  at: number;
};

/**
 * One field of a patch that arrived before the row's create. Held verbatim so
 * the replay is indistinguishable from in-order delivery.
 */
export type ParkedField = {
  /** Value the absent create will receive. */
  v: unknown;
  /** `encodeStamp()` of the op that parked it — the LWW ordering key. */
  s: string;
  /** Op id, so the replay can mint the same conflict id the in-order path does. */
  o: string;
};

/** Per-row merge watermarks: field stamps plus an absorbing delete stamp. */
export type RowLww = {
  f: Record<string, string>;
  del?: string;
  /**
   * Field patches for a row whose create has not arrived yet. Lives in the LWW
   * map (not on the wire) so it persists with the snapshot and stays invisible
   * to peers — the relay remains zero-knowledge.
   */
  p?: Record<string, ParkedField>;
};

export type LedgerLww<TName extends string = string> = Partial<
  Record<TName, Record<string, RowLww>>
>;

/**
 * The LWW half as it sits AT REST. Either the raw stamp map or the compact form
 * from `lww-codec.ts` (brands opt in via `defineLedgerSchema({ compactLww })`).
 * `installRowEnvelopes` normalizes both to `RowLww` before the merge core sees
 * it, so nothing downstream of the store ever handles the union.
 */
export type PersistedRowLww = RowLww | { z: 1 };

export type RowEnvelope = {
  row: LedgerRow | null;
  lww: PersistedRowLww;
};

export type RowWrite<TName extends string = string> = {
  table: TName;
  rowKey: string;
  bucket: string;
  deleted: boolean;
  envelope: RowEnvelope;
};

export type RowEnvelopeWrite<TName extends string = string> = {
  table: TName;
  rowKey: string;
  deleted: boolean;
  envelope: RowEnvelope;
};

export type OpStamp = {
  /** Hybrid logical clock of the op — the ordering key. */
  hlc: string;
  /** Author member, used as the final tie-break and for conflict attribution. */
  authorMemberId: string;
  opId: string;
};

export type ApplyDeltaResult<TName extends string = string> = {
  /** Rows inserted or patched. */
  applied: number;
  /** Rows removed by a tombstone. */
  deleted: number;
  conflicts: LedgerConflict<TName>[];
};

/**
 * Serialized per-row state captured before a mutator runs. Mutators edit rows
 * in place, so reference comparison cannot detect changes and the pre-image has
 * to be materialized eagerly.
 */
export type LedgerSnapshot<TName extends string = string> = Map<TName, Map<string, string>>;

/**
 * Minimum shape the merge core needs from a brand ledger. Brands add their own
 * table arrays (`expenses`, `tasks`, …) plus whatever session metadata they
 * carry; the core only ever reaches for `lww`, `conflicts` and `ledger[table]`.
 */
export type ProjectableLedger<TName extends string = string> = {
  lww?: LedgerLww<TName>;
  conflicts?: LedgerConflict<TName>[];
};
