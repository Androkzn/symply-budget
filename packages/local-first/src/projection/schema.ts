/**
 * Ledger schema descriptor — the *only* brand-specific input the merge core
 * takes. Budget passes 25 tables, House passes 21 (Wave A); everything else in
 * `createLedgerProjection` is identical for both.
 */
import { ALWAYS_RESIDENT_BUCKET } from '../store/types';

import type { LedgerRow } from './types';

export type LedgerSchemaInput<TName extends string> = {
  /** Tables that participate in sync, mapped to their row-key field. */
  tableKeys: Readonly<Record<TName, string>>;
  /**
   * Ordered candidate date fields per table. First one yielding `YYYY-MM` wins;
   * anything else degrades to `ALWAYS_RESIDENT_BUCKET`.
   */
  windowedDateFields?: Partial<Record<TName, readonly string[]>>;
  /**
   * Last-chance bucket derivation when no windowed date field matched — Budget's
   * `goals` table buckets off numeric `(year, month)` columns rather than a date
   * string. Return null to fall through to always-resident.
   */
  bucketOverride?: (table: TName, row: LedgerRow) => string | null;
  /** Diagnostic prefix, e.g. `BudgetLocal` / `HouseLocal`. */
  logPrefix: string;
  /**
   * Dev predicate. React Native passes `() => __DEV__` so a write site that
   * forgot a row key throws in development instead of silently never syncing.
   * Defaults to "not dev" — a library must never assume a bundler global.
   */
  isDev?: () => boolean;
  /**
   * Persist the LWW half of each row envelope in the compact form
   * (`projection/lww-codec.ts`) instead of the raw stamp map.
   *
   * Off by default, and deliberately per brand rather than global: the shared
   * store is read by three shipped apps and a serialization change with no
   * measured benefit for a brand is pure risk for that brand. Health turns it
   * on because its LWW half is 70% of its plaintext at 10 years, and cold open
   * decrypts every byte.
   *
   * READING is never gated by this flag — the decoder is shape-driven — so a
   * device that wrote one form still reads the other after the flag moves.
   */
  compactLww?: boolean;
  /**
   * How many days of history a cold open decrypts into memory, as a count of
   * whole `'YYYY-MM'` buckets. Omitted (the default) means **no window**: the
   * cold open loads every row, which is what Budget and House do and what they
   * keep doing.
   *
   * Health turns it on because 86% of its first paint is per-row AEAD and the
   * count of decrypts — not the bytes — is the cost. Opting in per brand rather
   * than globally is the same judgement `compactLww` makes: three shipped apps
   * read this store, and residency is a behavioural change, not a serialization
   * one. A brand that sets this is committing to hydrate on demand for
   * everything outside the window; a brand that does not set it is unaffected,
   * byte for byte.
   *
   * ⚠️ The flag alone is NOT a mitigation. `residentBuckets()` decides what a
   * cold open reads; it says nothing about what happens when a read or a merge
   * addresses a row outside that set. `mergeRowEnvelopes` and
   * `RowLoadQuery.keys` exist for that half, and a brand that windows without
   * using them has not made its cold open faster — it has made its older data
   * invisible.
   */
  residentWindowDays?: number;
};

export type LedgerSchema<TName extends string> = {
  tableKeys: Readonly<Record<TName, string>>;
  tableNames: readonly TName[];
  windowedDateFields: Partial<Record<TName, readonly string[]>>;
  bucketOverride?: (table: TName, row: LedgerRow) => string | null;
  logPrefix: string;
  isDev: () => boolean;
  compactLww: boolean;
  /** Null when the brand did not opt in — see `LedgerSchemaInput`. */
  residentWindowDays: number | null;
};

export function defineLedgerSchema<TName extends string>(
  input: LedgerSchemaInput<TName>,
): LedgerSchema<TName> {
  const tableNames = Object.keys(input.tableKeys) as TName[];
  if (tableNames.length === 0) {
    throw new Error('defineLedgerSchema: at least one table is required');
  }
  for (const table of tableNames) {
    const keyField = input.tableKeys[table];
    if (typeof keyField !== 'string' || keyField.length === 0) {
      throw new Error(`defineLedgerSchema: table '${table}' has no row-key field`);
    }
  }
  const residentWindowDays = input.residentWindowDays ?? null;
  if (residentWindowDays !== null && (!Number.isInteger(residentWindowDays) || residentWindowDays < 1)) {
    // A zero or fractional window would resolve to an empty (or nonsense)
    // bucket list and a cold open that installs nothing — an app that looks
    // wiped rather than one that looks slow. Refuse at definition time, where
    // the mistake is one line away, not at first launch on a user's device.
    throw new Error(
      `defineLedgerSchema: residentWindowDays must be a positive integer (got ${String(input.residentWindowDays)})`,
    );
  }
  return {
    tableKeys: input.tableKeys,
    tableNames,
    windowedDateFields: input.windowedDateFields ?? {},
    ...(input.bucketOverride ? { bucketOverride: input.bucketOverride } : {}),
    logPrefix: input.logPrefix,
    isDev: input.isDev ?? (() => false),
    compactLww: input.compactLww ?? false,
    residentWindowDays,
  };
}

export { ALWAYS_RESIDENT_BUCKET };
