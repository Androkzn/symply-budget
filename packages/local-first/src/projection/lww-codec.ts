/**
 * Compact wire form for the LWW half of a persisted row envelope.
 *
 * WHY THIS EXISTS
 * ---------------
 * `RowEnvelope` is `{ row, lww }`, and both halves are JSON-stringified,
 * AEAD-sealed and stored per row. On the Health 10-year corpus the LWW half is
 * **70% of the plaintext** (53.5 M chars against 21.6 M for the data it
 * describes — `coldopen.lww.charsPerRowChar` = 2.47), and cold open decrypts
 * every byte of it. AES-GCM is byte-proportional, so those bytes ARE the cold
 * open (He10 §4 measured AEAD at 86% of first paint).
 *
 * The map is redundant in two exact ways, both of which JSON is powerless to
 * exploit because it has no back-references:
 *
 *   1. `encodeStamp` is `${hlc}|${authorMemberId}`, and the author half repeats
 *      on EVERY field of EVERY row. A Health household has exactly one member
 *      (plan §1.2), so one 19-char id was measured at 16.07 M chars — 30% of the
 *      LWW half — of pure repetition.
 *   2. `applyLedgerDelta` stamps every field a single op wrote with the SAME
 *      string (`projection.ts`: `for (const field of Object.keys(rowDelta.f))
 *      meta.f[field] = encoded`). A row created by one op therefore carries N
 *      copies of one stamp, one per column.
 *
 * So: intern the authors, intern the HLCs, and collapse "every field of this row
 * shares one stamp" to a single index.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT a change to LWW, tombstone or op-log semantics. `decode(encode(x))`
 * reproduces `x` field for field, stamp for stamp; the merge core never sees the
 * compact form. It is a serialization detail of the at-rest row body, and
 * nothing on the wire between peers changes (op payloads carry deltas, not this
 * map).
 *
 * OPT-IN PER BRAND. `defineLedgerSchema({ compactLww: true })`. Budget and House
 * ship uncompacted and are byte-identical unless they opt in. The decoder is
 * shape-driven (`z === 1`), so a device that wrote legacy envelopes before the
 * flag still reads them, and one that wrote compact envelopes still reads them
 * if the flag is later removed.
 *
 * ORDERING CAVEAT, stated rather than hidden: the `g` group rebuilds `f` in the
 * key order of `row`. `Object.keys(meta.f)` order is already replica-dependent
 * (it follows op arrival), and the only thing that reads it is the order
 * conflicts are pushed in the delete branch — a bounded UI list, never a
 * converged value.
 */
import type { LedgerRow, ParkedField, RowLww } from './types';

/** Author index meaning "this stamp had no `|` separator" — carried verbatim. */
const NO_AUTHOR = -1;

/** `[hlcIndex, authorIndex]`. A bare number is shorthand for `[n, 0]`. */
type StampRef = number | readonly [number, number];

export type EncodedRowLww = {
  /** Format marker. Absent on a legacy envelope, which decodes unchanged. */
  z: 1;
  /** Distinct author ids. Index 0 is the default for a bare-number `StampRef`. */
  m: string[];
  /** Distinct HLC halves. */
  h: string[];
  /** Stamp shared by every key of `row` — the create-op case. */
  g?: StampRef;
  /** Per-field stamps: everything `g` does not already cover, plus overrides. */
  f?: Record<string, StampRef>;
  /** Absorbing tombstone stamp. */
  d?: StampRef;
  /** Parked orphan patches. Bounded by MAX_PARKED_ROWS; carried verbatim. */
  p?: Record<string, ParkedField>;
};

/** True for the compact form. Used by the install path to stay legacy-tolerant. */
export function isEncodedRowLww(value: unknown): value is EncodedRowLww {
  return typeof value === 'object' && value !== null && (value as { z?: unknown }).z === 1;
}

type Interner = {
  hlcs: string[];
  authors: string[];
  ref(stamp: string): StampRef;
};

function createInterner(): Interner {
  const hlcs: string[] = [];
  const authors: string[] = [];
  const hlcIndex = new Map<string, number>();
  const authorIndex = new Map<string, number>();

  const intern = (table: string[], index: Map<string, number>, value: string): number => {
    const at = index.get(value);
    if (at !== undefined) return at;
    const next = table.length;
    table.push(value);
    index.set(value, next);
    return next;
  };

  return {
    hlcs,
    authors,
    ref(stamp) {
      const bar = stamp.lastIndexOf('|');
      if (bar < 0) return [intern(hlcs, hlcIndex, stamp), NO_AUTHOR] as const;
      const h = intern(hlcs, hlcIndex, stamp.slice(0, bar));
      const a = intern(authors, authorIndex, stamp.slice(bar + 1));
      return a === 0 ? h : ([h, a] as const);
    },
  };
}

function resolve(ref: StampRef, hlcs: readonly string[], authors: readonly string[]): string {
  if (typeof ref === 'number') return `${hlcs[ref] ?? ''}|${authors[0] ?? ''}`;
  const [h, a] = ref;
  const hlc = hlcs[h] ?? '';
  return a === NO_AUTHOR ? hlc : `${hlc}|${authors[a] ?? ''}`;
}

/**
 * Compact one row's watermarks. `row` is the envelope's data half — the `g`
 * group is only claimed when every one of its keys carries a stamp, so decoding
 * can never invent a watermark for a field that had none.
 */
export function encodeRowLww(lww: RowLww, row: LedgerRow | null): EncodedRowLww {
  const interner = createInterner();
  const fields = lww.f ?? {};

  // The group stamp: the most common stamp among the row's own columns, claimed
  // only when EVERY column has one. A row whose create op wrote all of its
  // columns — which is every row that has never been edited field-wise — turns
  // the whole map into one index.
  let groupStamp: string | null = null;
  if (row) {
    const rowKeys = Object.keys(row);
    if (rowKeys.length > 0) {
      const counts = new Map<string, number>();
      let covered = true;
      for (const key of rowKeys) {
        const stamp = fields[key];
        if (stamp === undefined) {
          covered = false;
          break;
        }
        counts.set(stamp, (counts.get(stamp) ?? 0) + 1);
      }
      if (covered) {
        let best = 0;
        for (const [stamp, count] of counts) {
          if (count > best) {
            best = count;
            groupStamp = stamp;
          }
        }
      }
    }
  }

  const groupedKeys = groupStamp === null ? null : new Set(Object.keys(row ?? {}));
  const explicit: Record<string, StampRef> = {};
  let explicitCount = 0;
  // `g` is interned FIRST so the common case is index 0 in both tables and every
  // remaining reference stays a single digit.
  const groupRef = groupStamp === null ? undefined : interner.ref(groupStamp);
  for (const [field, stamp] of Object.entries(fields)) {
    if (groupedKeys?.has(field) && stamp === groupStamp) continue;
    explicit[field] = interner.ref(stamp);
    explicitCount += 1;
  }

  const out: EncodedRowLww = { z: 1, m: interner.authors, h: interner.hlcs };
  if (groupRef !== undefined) out.g = groupRef;
  if (explicitCount > 0) out.f = explicit;
  if (lww.del !== undefined) out.d = interner.ref(lww.del);
  if (lww.p) out.p = lww.p;
  return out;
}

/** Inverse of `encodeRowLww`. A legacy (uncompacted) value is returned as-is. */
export function decodeRowLww(value: unknown, row: LedgerRow | null): RowLww {
  if (!isEncodedRowLww(value)) return (value ?? { f: {} }) as RowLww;
  const hlcs = value.h ?? [];
  const authors = value.m ?? [];
  const f: Record<string, string> = {};
  if (value.g !== undefined && row) {
    const stamp = resolve(value.g, hlcs, authors);
    for (const key of Object.keys(row)) f[key] = stamp;
  }
  if (value.f) {
    for (const [field, ref] of Object.entries(value.f)) f[field] = resolve(ref, hlcs, authors);
  }
  const out: RowLww = { f };
  if (value.d !== undefined) out.del = resolve(value.d, hlcs, authors);
  if (value.p) out.p = value.p;
  return out;
}
