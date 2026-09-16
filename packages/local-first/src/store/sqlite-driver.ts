/**
 * Minimal async SQLite surface injected by the host app (expo-sqlite, better-sqlite3 shim, etc.).
 * Keeps `@symply/local-first` free of React Native / Expo imports.
 */
export interface SqliteDriver {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  closeAsync?(): Promise<void>;
  /** Optional; SqliteLocalFirstStore falls back to running `work` unsafely. */
  withTransactionAsync?(work: () => Promise<void>): Promise<void>;
}
