/**
 * Budget's binding of the shared delta-state projection core.
 *
 * The 1,060 mechanical lines that used to live here — snapshot/diff, LWW merge,
 * absorbing tombstones, orphan-patch parking, conflict surfacing (BR-044),
 * cursor strategy — now live in `@symply/local-first/projection` so House V2
 * consumes the *same* engine instead of forking it (House plan §3.1). What
 * stays here is the only part that was ever Budget-specific: the table registry,
 * the windowed date fields and the `goals` bucket rule.
 *
 * Every export below keeps its previous name and signature, so the ~70 call
 * sites and the Stage-1..4 test suites are the oracle for the refactor.
 */
import {
  createLedgerProjection,
  defineLedgerSchema,
  type LedgerRow,
} from '@symply/local-first';
import type {
  ApplyDeltaResult as SharedApplyDeltaResultType,
  LedgerConflict as SharedLedgerConflict,
  LedgerDelta as SharedLedgerDelta,
  LedgerLww as SharedLedgerLww,
  LedgerOpPayload as SharedLedgerOpPayload,
  LedgerSnapshot as SharedLedgerSnapshot,
  RowWrite as SharedRowWrite,
} from '@symply/local-first';

import type { LocalBudgetLedger } from './engine';

/** Ledger tables that participate in sync, mapped to their row-key field. */
export const LEDGER_TABLE_KEYS = {
  categories: 'id',
  expenses: 'id',
  items: 'id',
  goals: 'id',
  subBudgets: 'id',
  transfers: 'id',
  mortgages: 'id',
  mortgageTerms: 'id',
  mortgageStatements: 'id',
  mortgageEvents: 'id',
  mortgageOffers: 'id',
  savingsIncome: 'id',
  savingsSpending: 'id',
  savingsRecurringPayments: 'id',
  savingsGoals: 'id',
  savingsCategories: 'id',
  savingsIncomeTemplates: 'id',
  savingsMonthlyTargets: 'id',
  budgetLoans: 'id',
  budgetRenewals: 'id',
  registeredAccounts: 'id',
  registeredTransactions: 'id',
  wishes: 'id',
  wishEntries: 'id',
  wishAttachments: 'id',
} as const;

export type LedgerTableName = keyof typeof LEDGER_TABLE_KEYS;

export const LEDGER_TABLE_NAMES = Object.keys(LEDGER_TABLE_KEYS) as LedgerTableName[];

const WINDOWED_DATE_FIELDS: Partial<Record<LedgerTableName, readonly string[]>> = {
  expenses: ['expense_date', 'date'],
  items: ['expense_date', 'date'],
  transfers: ['date', 'transfer_date'],
  mortgageStatements: ['statement_date'],
  mortgageEvents: ['event_date', 'effective_date'],
  savingsIncome: ['income_date'],
  savingsSpending: ['spending_date'],
  registeredTransactions: ['transaction_date', 'posted_at', 'date'],
  wishEntries: ['entry_date', 'date'],
};

/** `goals` has no date column — it buckets off its numeric (year, month) pair. */
function budgetBucketOverride(table: LedgerTableName, row: LedgerRow): string | null {
  if (table !== 'goals') return null;
  const year = row.year;
  const month = row.month;
  if (
    typeof year === 'number' &&
    Number.isFinite(year) &&
    typeof month === 'number' &&
    month >= 1 &&
    month <= 12
  ) {
    return `${String(Math.trunc(year)).padStart(4, '0')}-${String(Math.trunc(month)).padStart(2, '0')}`;
  }
  return null;
}

export const BUDGET_LEDGER_SCHEMA = defineLedgerSchema<LedgerTableName>({
  tableKeys: LEDGER_TABLE_KEYS,
  windowedDateFields: WINDOWED_DATE_FIELDS,
  bucketOverride: budgetBucketOverride,
  logPrefix: 'BudgetLocal',
  isDev: () => __DEV__,
});

const projection = createLedgerProjection<LedgerTableName, LocalBudgetLedger>(BUDGET_LEDGER_SCHEMA);

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

export type LedgerDelta = SharedLedgerDelta<LedgerTableName>;
export type LedgerOpPayload = SharedLedgerOpPayload<LedgerTableName>;
export type LedgerConflict = SharedLedgerConflict<LedgerTableName>;
export type LedgerLww = SharedLedgerLww<LedgerTableName>;
export type LedgerSnapshot = SharedLedgerSnapshot<LedgerTableName>;
export type ApplyDeltaResult = SharedApplyDeltaResultType<LedgerTableName>;
export type RowWrite = SharedRowWrite<LedgerTableName>;
