/**
 * Verbatim mirrors of the five product functions this harness cannot import.
 *
 * WHY MIRROR AT ALL
 * -----------------
 * `src/features/budget/local/engine.ts` imports `@api/*` and
 * `src/features/budget/local/persistence.ts` imports `@services/storage`;
 * neither alias resolves outside the mobile tsconfig, so neither module can be
 * loaded from this package at all. `projection.ts` is reachable only because
 * its single import of engine.ts is `import type` (projection.ts:39), erased at
 * runtime. Mirroring is the only way to measure the real end-to-end write path.
 *
 * WHY THE DIGEST GUARD IS NOT OPTIONAL
 * ------------------------------------
 * A mirror without a guard is how a harness starts lying. Stage 2 rewrites
 * `persist()` and cold open by design; without `mirror-guard.test.ts` this file
 * would keep reporting the OLD write path's cost as if it were the new one — a
 * harness that reports an improvement which did not happen is worse than no
 * harness. The guard failing on Stage 2's first commit is the intended
 * handshake, not an accident.
 *
 * The permanent fix is Stage 2 exporting a real serializer from a module free
 * of React Native imports; then this file imports it and the guard is deleted.
 */
import { aeadDecrypt, aeadEncrypt } from '../../../src/crypto/aead';
import { bytesToHex, hexToBytes, utf8Decode, utf8Encode } from '../../../src/crypto/bytes';
import type { StoredOperation } from '../../../src/store/types';

import type { ScaleLedger } from './ledger-factory';

export type SerializedOp = Omit<StoredOperation, 'payload' | 'signature'> & {
  payload: string;
  signature: string;
};

/** AAD constant, persistence.ts:37 and :45. */
const LEDGER_AAD = 'budget-ledger-v1';

/**
 * MIRROR of `persist()` engine.ts:417-424 — the serialization body only. The
 * `state.ledger.crypto = cryptoBundle(...)` line above it is a caller concern
 * (the generator pre-populates `crypto`), and the `await saveEncryptedSnapshot`
 * below it is mirrored separately as `sealSnapshot`.
 */
export function serializeLedgerForPersist(ledger: ScaleLedger): string {
  const serializable = {
    ...ledger,
    ops: ledger.ops.map((op) => ({
      ...op,
      payload: bytesToHex(op.payload),
      signature: bytesToHex(op.signature),
    })),
  };
  return JSON.stringify(serializable);
}

/**
 * MIRROR of `saveEncryptedSnapshot` persistence.ts:44-51, minus the
 * AsyncStorage write. `bytesToHex(sealed)` is what actually reaches storage,
 * which is why "bytes written" is exactly 2x the sealed byte count — the
 * audit's 46.72 MB stringified -> 93.44 MB written.
 */
export function sealSnapshot(
  dbKey: Uint8Array,
  json: string,
): { sealed: Uint8Array; storedHex: string } {
  const sealed = aeadEncrypt(dbKey, utf8Encode(json), utf8Encode(LEDGER_AAD));
  return { sealed, storedHex: bytesToHex(sealed) };
}

/** MIRROR of `loadEncryptedSnapshot` persistence.ts:33-42, minus the read. */
export function openSnapshot(dbKey: Uint8Array, storedHex: string): string {
  return utf8Decode(aeadDecrypt(dbKey, hexToBytes(storedHex), utf8Encode(LEDGER_AAD)));
}

/** MIRROR of `reviveOps` engine.ts:428-436. */
export function reviveOps(raw: SerializedOp[]): StoredOperation[] {
  return raw.map((op) => ({
    ...op,
    payload: hexToBytes(op.payload),
    signature: hexToBytes(op.signature),
  }));
}

/**
 * MIRROR of `normalizeLedger` engine.ts:215-241. Every `?? []` is a fresh
 * array allocation and the whole thing is a full object spread, run once per
 * cold open over a ledger that may be tens of megabytes.
 */
export function normalizeLedger(ledger: ScaleLedger): ScaleLedger {
  return {
    ...ledger,
    mortgages: ledger.mortgages ?? [],
    mortgageTerms: ledger.mortgageTerms ?? [],
    mortgageStatements: ledger.mortgageStatements ?? [],
    mortgageEvents: ledger.mortgageEvents ?? [],
    mortgageOffers: ledger.mortgageOffers ?? [],
    savingsIncome: ledger.savingsIncome ?? [],
    savingsSpending: ledger.savingsSpending ?? [],
    savingsRecurringPayments: ledger.savingsRecurringPayments ?? [],
    savingsGoals: ledger.savingsGoals ?? [],
    savingsCategories: ledger.savingsCategories ?? [],
    savingsIncomeTemplates: ledger.savingsIncomeTemplates ?? [],
    savingsMonthlyTargets: ledger.savingsMonthlyTargets ?? [],
    budgetLoans: ledger.budgetLoans ?? [],
    budgetRenewals: ledger.budgetRenewals ?? [],
    registeredAccounts: ledger.registeredAccounts ?? [],
    registeredTransactions: ledger.registeredTransactions ?? [],
    wishes: ledger.wishes ?? [],
    wishEntries: ledger.wishEntries ?? [],
    wishAttachments: ledger.wishAttachments ?? [],
    lww: ledger.lww ?? {},
    conflicts: ledger.conflicts ?? [],
    pendingEnrolment: ledger.pendingEnrolment ?? false,
  };
}
