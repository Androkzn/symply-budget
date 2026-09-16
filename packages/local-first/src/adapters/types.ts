/**
 * Platform adapters — implemented by the RN (or desktop) shell.
 * The local-first core must not import expo-secure-store or RN modules.
 */

export interface SecureKeyStore {
  getBytes(key: string): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface FileStore {
  /** Absolute or app-scoped path for the household DB file. */
  databasePath(householdId: string): string;
  /** Optional attachment directory (device-local, not synced). */
  attachmentDir(householdId: string): string;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  deleteFile(path: string): Promise<void>;
}

export interface Clock {
  /** Milliseconds since Unix epoch (wall). */
  nowMs(): number;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
};
