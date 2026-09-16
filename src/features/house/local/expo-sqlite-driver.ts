import type { SQLiteBindParams } from 'expo-sqlite';

import type { SqliteDriver } from '@symply/local-first';

/**
 * On-device SQLite file for the House local-first op journal.
 *
 * Deliberately distinct from Budget's `symply-budget-local-first.db`: a device
 * with both apps installed must not have the two ledgers fight over one file
 * (plan §3.3).
 */
export const HOUSE_LOCAL_FIRST_DB_NAME = 'symply-house-local-first.db';

/**
 * expo-sqlite adapter for `@symply/local-first` SqliteLocalFirstStore.
 * Lazy-loaded so Jest and Node tests never touch native modules.
 */
/**
 * Bridge the two type systems at their one meeting point.
 *
 * `SqliteDriver` declares `params?: unknown[]` on purpose — the store stays
 * driver-agnostic — while expo-sqlite narrows to `SQLiteBindParams`. The values
 * really are bindable scalars; asserting it here keeps expo-sqlite's types from
 * leaking up into `@symply/local-first`.
 */
function toBindParams(params: unknown[] | undefined): SQLiteBindParams {
  return (params ?? []) as SQLiteBindParams;
}

export async function createExpoSqliteDriver(dbName: string): Promise<SqliteDriver> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(dbName);
  return {
    execAsync: (sql) => db.execAsync(sql),
    // `SqliteDriver` declares `params?: unknown[]` — deliberately, so the store
    // stays driver-agnostic — while expo-sqlite narrows to `SQLiteBindParams`.
    // The values really are bindable scalars; the cast states that at the one
    // boundary where the two type systems meet, rather than leaking
    // expo-sqlite's types up into the package.
    runAsync: (sql, params) => db.runAsync(sql, toBindParams(params)),
    getFirstAsync: (sql, params) => db.getFirstAsync(sql, toBindParams(params)),
    getAllAsync: (sql, params) => db.getAllAsync(sql, toBindParams(params)),
    closeAsync: () => db.closeAsync(),
    withTransactionAsync: (work) => db.withTransactionAsync(work),
  };
}
