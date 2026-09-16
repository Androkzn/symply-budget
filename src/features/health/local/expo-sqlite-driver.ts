import type { SQLiteBindParams } from 'expo-sqlite';

import type { SqliteDriver } from '@symply/local-first';

/**
 * On-device SQLite file for the Health local-first op journal.
 *
 * Deliberately distinct from `symply-budget-local-first.db` and
 * `symply-house-local-first.db`: a device with more than one Symply app
 * installed must not have the ledgers fight over one file (plan §3).
 */
export const HEALTH_LOCAL_FIRST_DB_NAME = 'symply-health-local-first.db';

/**
 * WAL sidecars. SQLite in WAL mode keeps committed pages in `-wal` until a
 * checkpoint folds them back, and `-shm` is the shared-memory index for it.
 *
 * These are NOT removed by `deleteDatabaseAsync` (expo/expo#43441, still open),
 * so teardown must delete them explicitly. An orphaned `-wal` left beside a
 * later database of the same name can replay committed transactions from the
 * previous account — the hazard is account-switch / re-login within one install,
 * not reinstall (iOS drops the whole container on uninstall). Plan §5.
 */
export const HEALTH_LOCAL_FIRST_DB_SIDECARS = [
  `${HEALTH_LOCAL_FIRST_DB_NAME}-wal`,
  `${HEALTH_LOCAL_FIRST_DB_NAME}-shm`,
] as const;

/**
 * expo-sqlite adapter for `@symply/local-first` SqliteLocalFirstStore.
 * Lazy-loaded so Jest and Node tests never touch native modules.
 */
export async function createExpoSqliteDriver(dbName: string): Promise<SqliteDriver> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(dbName);
  return {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params) => db.runAsync(sql, (params ?? []) as SQLiteBindParams),
    getFirstAsync: (sql, params) => db.getFirstAsync(sql, (params ?? []) as SQLiteBindParams),
    getAllAsync: (sql, params) => db.getAllAsync(sql, (params ?? []) as SQLiteBindParams),
    closeAsync: () => db.closeAsync(),
    withTransactionAsync: (work) => db.withTransactionAsync(work),
  };
}
