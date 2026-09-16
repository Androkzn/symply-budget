import {
  MemoryLocalFirstStore,
  SqliteLocalFirstStore,
  type LocalFirstStore,
} from '@symply/local-first';

import { BUDGET_LOCAL_FIRST_DB_NAME, createExpoSqliteDriver } from './expo-sqlite-driver';

function isJestRuntime(): boolean {
  return process.env.JEST_WORKER_ID !== undefined;
}

let jestStore: MemoryLocalFirstStore | null = null;

/** Opens the durable local-first store for Budget (SQLite on device, memory in Jest). */
export async function openBudgetLocalFirstStore(dbKey: Uint8Array): Promise<LocalFirstStore> {
  if (isJestRuntime()) {
    if (!jestStore) {
      jestStore = new MemoryLocalFirstStore();
      await jestStore.open(dbKey);
    } else if (!jestStore.isOpen()) {
      await jestStore.open(dbKey);
    }
    return jestStore;
  }

  const driver = await createExpoSqliteDriver(BUDGET_LOCAL_FIRST_DB_NAME);
  const store = new SqliteLocalFirstStore(driver);
  await store.open(dbKey);
  return store;
}

/**
 * Lazy `expo-file-system` handle.
 *
 * Required at call time, not import time: this module is loaded in Jest (where
 * the store is in-memory) and the native module is absent there. One site
 * rather than one per function.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireFileSystem = () => require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');

/** expo-sqlite's own directory — where the live file and every archive sit. */
function sqliteDirectory(): string {
  const FileSystem = requireFileSystem();
  return `${FileSystem.documentDirectory ?? ''}SQLite/`;
}

/** `archived-<label>-<db>` and its `-wal` / `-shm` siblings. */
const ARCHIVED_DB_PATTERN = new RegExp(
  `^archived-(.+)-${BUDGET_LOCAL_FIRST_DB_NAME.replace(/\./g, '\\.')}(-wal|-shm)?$`,
);

/** One retired ledger on disk, its write-ahead siblings folded in. */
export type ArchivedBudgetDbFile = {
  /** The sanitized member id the ledger was retired under. */
  label: string;
  /** Absolute path of the main `.db` file. */
  path: string;
  /** db + `-wal` + `-shm` — what deleting this archive actually frees. */
  sizeBytes: number;
  /** ISO mtime of the main file, or null when the platform withholds it. */
  archivedAt: string | null;
};

/**
 * Moves the on-device ops journal aside instead of deleting it, returning the
 * archived path (null when there was nothing to move / in Jest).
 *
 * expo-sqlite keeps the file under `Documents/SQLite/`, and writes `-wal` and
 * `-shm` siblings — moving only the `.db` would leave a torn database.
 */
export async function archiveBudgetLocalFirstDbFile(label: string): Promise<string | null> {
  if (isJestRuntime()) return null;

  const FileSystem = requireFileSystem();
  const dir = sqliteDirectory();
  const from = `${dir}${BUDGET_LOCAL_FIRST_DB_NAME}`;
  const to = `${dir}archived-${label}-${BUDGET_LOCAL_FIRST_DB_NAME}`;

  const info = await FileSystem.getInfoAsync(from).catch(() => null);
  if (!info?.exists) return null;

  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await FileSystem.moveAsync({ from: `${from}${suffix}`, to: `${to}${suffix}` });
    } catch {
      // -wal/-shm may not exist; the main file is the one that matters.
    }
  }
  return to;
}

/**
 * Every ledger this device retired on an account switch, newest first.
 *
 * These are the copies `archiveBudgetLocalFirstDbFile` moved aside: real user
 * data, unreadable without their SecureStore key, and invisible to the app
 * until something lists them. Empty in Jest (no filesystem) and whenever the
 * SQLite directory does not exist yet.
 */
export async function listArchivedBudgetLocalFirstDbFiles(): Promise<ArchivedBudgetDbFile[]> {
  if (isJestRuntime()) return [];

  const FileSystem = requireFileSystem();
  const dir = sqliteDirectory();
  const dirInfo = await FileSystem.getInfoAsync(dir).catch(() => null);
  if (!dirInfo?.exists) return [];

  const names = await FileSystem.readDirectoryAsync(dir).catch(() => [] as string[]);

  // db + `-wal` + `-shm` are ONE retired ledger, not three — fold the siblings
  // into their label's row so the size reported is what deleting it frees.
  const byLabel = new Map<string, ArchivedBudgetDbFile>();
  for (const name of names) {
    const match = ARCHIVED_DB_PATTERN.exec(name);
    if (!match) continue;

    const [, label, sibling] = match;
    const path = `${dir}${name}`;
    const info = await FileSystem.getInfoAsync(path).catch(() => null);
    const size = info?.exists && typeof info.size === 'number' ? info.size : 0;
    const mtime =
      info?.exists && typeof info.modificationTime === 'number'
        ? new Date(info.modificationTime * 1000).toISOString()
        : null;

    const existing = byLabel.get(label);
    if (!existing) {
      byLabel.set(label, {
        label,
        path,
        sizeBytes: size,
        // Only the main file dates the archive; a `-wal` seen first contributes
        // its bytes and nothing else.
        archivedAt: sibling ? null : mtime,
      });
      continue;
    }
    existing.sizeBytes += size;
    if (!sibling) {
      existing.path = path;
      existing.archivedAt = mtime;
    }
  }

  return [...byLabel.values()].sort((a, b) =>
    (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''),
  );
}

/** Deletes one retired ledger and its write-ahead siblings (no-op in Jest). */
export async function deleteArchivedBudgetLocalFirstDbFile(label: string): Promise<void> {
  if (isJestRuntime()) return;

  const FileSystem = requireFileSystem();
  const base = `${sqliteDirectory()}archived-${label}-${BUDGET_LOCAL_FIRST_DB_NAME}`;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await FileSystem.deleteAsync(`${base}${suffix}`, { idempotent: true });
    } catch {
      // -wal/-shm may not exist; a missing sibling is not a failed delete.
    }
  }
}

/** Deletes the on-device ops journal (no-op in Jest). */
export async function deleteBudgetLocalFirstDbFile(): Promise<void> {
  if (isJestRuntime()) {
    if (jestStore) {
      await jestStore.close();
      jestStore = null;
    }
    return;
  }

  const FileSystem = requireFileSystem();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const dbPath = `${FileSystem.documentDirectory ?? ''}${BUDGET_LOCAL_FIRST_DB_NAME}`;
  try {
    await SQLite.deleteDatabaseAsync(BUDGET_LOCAL_FIRST_DB_NAME);
  } catch {
    // ignore missing database
  }
  try {
    await FileSystem.deleteAsync(dbPath, { idempotent: true });
  } catch {
    // ignore missing file
  }
}
