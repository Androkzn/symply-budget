import {
  MemoryLocalFirstStore,
  SqliteLocalFirstStore,
  type LocalFirstStore,
} from '@symply/local-first';

import { HOUSE_LOCAL_FIRST_DB_NAME, createExpoSqliteDriver } from './expo-sqlite-driver';

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
}

let jestStore: MemoryLocalFirstStore | null = null;

/** Opens the durable local-first store for House (SQLite on device, memory in Jest). */
export async function openHouseLocalFirstStore(dbKey: Uint8Array): Promise<LocalFirstStore> {
  if (isJestRuntime()) {
    if (!jestStore) {
      jestStore = new MemoryLocalFirstStore();
      await jestStore.open(dbKey);
    } else if (!jestStore.isOpen()) {
      await jestStore.open(dbKey);
    }
    return jestStore;
  }

  const driver = await createExpoSqliteDriver(HOUSE_LOCAL_FIRST_DB_NAME);
  const store = new SqliteLocalFirstStore(driver);
  await store.open(dbKey);
  return store;
}

/** Deletes the on-device ops journal (no-op in Jest). */
export async function deleteHouseLocalFirstDbFile(): Promise<void> {
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
  const dbPath = `${FileSystem.documentDirectory ?? ''}${HOUSE_LOCAL_FIRST_DB_NAME}`;
  try {
    await SQLite.deleteDatabaseAsync(HOUSE_LOCAL_FIRST_DB_NAME);
  } catch {
    // ignore missing database
  }
  try {
    await FileSystem.deleteAsync(dbPath, { idempotent: true });
  } catch {
    // ignore missing file
  }
}
