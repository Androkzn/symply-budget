import {
  MemoryLocalFirstStore,
  SqliteLocalFirstStore,
  type LocalFirstStore,
} from '@symply/local-first';

import {
  HEALTH_LOCAL_FIRST_DB_NAME,
  HEALTH_LOCAL_FIRST_DB_SIDECARS,
  createExpoSqliteDriver,
} from './expo-sqlite-driver';

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
}

let jestStore: MemoryLocalFirstStore | null = null;

/** Opens the durable local-first store for Health (SQLite on device, memory in Jest). */
export async function openHealthLocalFirstStore(dbKey: Uint8Array): Promise<LocalFirstStore> {
  if (isJestRuntime()) {
    if (!jestStore) {
      jestStore = new MemoryLocalFirstStore();
      await jestStore.open(dbKey);
    } else if (!jestStore.isOpen()) {
      await jestStore.open(dbKey);
    }
    return jestStore;
  }

  const driver = await createExpoSqliteDriver(HEALTH_LOCAL_FIRST_DB_NAME);
  const store = new SqliteLocalFirstStore(driver);
  await store.open(dbKey);
  return store;
}

/**
 * Deletes the on-device ops journal AND its WAL sidecars (no-op in Jest).
 *
 * Health deliberately goes further than the House equivalent, which deletes only
 * the main `.db`. `deleteDatabaseAsync` leaves `-wal` and `-shm` behind
 * (expo/expo#43441, still open, fix PR unmerged, absent from SDK 57 native
 * source on both platforms), and a stale `-wal` beside a later database of the
 * same name can replay the previous account's committed transactions.
 *
 * Every delete is independently guarded: a missing sidecar is the normal case
 * (WAL may already be checkpointed), and one failure must not skip the rest.
 * Plan §5 / DoD He2.
 */
export async function deleteHealthLocalFirstDbFile(): Promise<void> {
  if (isJestRuntime()) {
    if (jestStore) {
      await jestStore.close();
      jestStore = null;
    }
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');

  try {
    await SQLite.deleteDatabaseAsync(HEALTH_LOCAL_FIRST_DB_NAME);
  } catch {
    // ignore missing database
  }

  const dir = FileSystem.documentDirectory ?? '';
  const targets = [HEALTH_LOCAL_FIRST_DB_NAME, ...HEALTH_LOCAL_FIRST_DB_SIDECARS];
  for (const name of targets) {
    try {
      await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
    } catch {
      // ignore missing file — a checkpointed WAL leaves no sidecar behind
    }
  }
}

/**
 * Exported for the teardown test: asserts non-existence of all three files
 * rather than trusting the `deleteDatabaseAsync` return value (DoD He2).
 */
export const HEALTH_LOCAL_FIRST_DB_FILES = [
  HEALTH_LOCAL_FIRST_DB_NAME,
  ...HEALTH_LOCAL_FIRST_DB_SIDECARS,
] as const;
