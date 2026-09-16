import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

// Storage type flag
let usingMMKV = false;
let mmkvInstance: MMKV | null = null;
let storageReady = false;

// Try to initialize MMKV. Under the New Architecture (bridgeless) runtime this
// requires react-native-mmkv v3+ (Nitro); v2's old-bridge JSI installer was
// unavailable there and silently fell everything back to AsyncStorage.
// AES-256 lets the (>16-byte) key be accepted — AES-128 caps keys at 16 bytes.
/**
 * Why MMKV init failed, if it did. Read by monitoring once Sentry is up —
 * initialisation runs at module load, before the monitoring service exists, so
 * it cannot report directly from here.
 */
let mmkvInitError: Error | null = null;

export function getMmkvInitError(): Error | null {
  return mmkvInitError;
}

const initializeMMKV = (): boolean => {
  try {
    mmkvInstance = createMMKV({
      id: 'simple-house-storage',
      // KNOWN WEAKNESS — deliberately not changed here.
      //
      // This literal ships in every build of all five apps, so it is public and
      // identical for every install: at-rest encryption is decorative today.
      // Budget's ledger DEK now lives in SecureStore (Stage 2), not in this
      // store. The decorative MMKV key remains a fleet-wide issue for zustand
      // persist blobs and is intentionally not swapped in place (recrypt would
      // orphan House/Kaizen/Health data).
      //
      // It is NOT swapped in place because MMKV cannot open an existing store
      // with a different key: a bare change orphans every current user's data
      // across all five apps. Fixing it needs recrypt()-on-first-launch plus a
      // per-install key in SecureStore, and it is entangled with the at-rest
      // encryption posture decision (per-row AEAD vs per-table page encryption
      // vs OS file protection) that has to be settled before row-granular
      // storage lands. Tracked as decision 1 in the local-first build plan.
      encryptionKey: 'your-encryption-key',
      encryptionType: 'AES-256',
    });
    usingMMKV = true;
    console.log('[Storage] MMKV initialized successfully ✓');
    return true;
  } catch (error) {
    // Not a benign downgrade: the fallback is AsyncStorage, whose Android
    // database has a hard size ceiling that Budget's single-value local-first
    // ledger reaches. This used to be a console.log, so a fleet-wide MMKV
    // failure was invisible in production.
    console.warn('[Storage] MMKV not available, using AsyncStorage fallback', error);
    mmkvInitError = error instanceof Error ? error : new Error(String(error));
    usingMMKV = false;
    mmkvInstance = null;
    return false;
  }
};

// Initialize on module load
initializeMMKV();
storageReady = true;

const MMKV_MIGRATION_FLAG = '__mmkv_migrated_from_async__';

/**
 * One-time copy of existing AsyncStorage data into MMKV.
 *
 * While the app shipped react-native-mmkv v2 under bridgeless New Arch, MMKV was
 * dead at runtime and ALL persisted data (auth flags, settings, budget/savings/
 * pension caches, feature-flag cache, every zustand persist store) lived in
 * AsyncStorage. Now that MMKV works (v4 / Nitro), the storage layer prefers MMKV
 * — which would read empty and strand that data. Copy it across once, guarded by
 * a flag stored in MMKV itself. No-op when MMKV is unavailable (we stay on
 * AsyncStorage) or the copy already ran. Never overwrites a key MMKV already has.
 *
 * MUST run before any persist store rehydrates (see app/_layout).
 */
export const migrateAsyncStorageToMMKV = async (): Promise<void> => {
  if (!usingMMKV || !mmkvInstance) return;
  try {
    if (mmkvInstance.getBoolean(MMKV_MIGRATION_FLAG)) return;
    const keys = await AsyncStorage.getAllKeys();
    if (keys.length > 0) {
      const entries = await AsyncStorage.multiGet(keys);
      let copied = 0;
      for (const [key, value] of entries) {
        if (value != null && !mmkvInstance.contains(key)) {
          mmkvInstance.set(key, value);
          copied += 1;
        }
      }
      console.log(`[Storage] Migrated ${copied} keys from AsyncStorage to MMKV`);
    }
    mmkvInstance.set(MMKV_MIGRATION_FLAG, true);
  } catch (error) {
    console.warn('[Storage] AsyncStorage→MMKV migration failed:', error);
  }
};

/**
 * Check if storage is ready
 */
export const isStorageReady = (): boolean => storageReady;

/**
 * Check if using MMKV (vs AsyncStorage fallback)
 */
export const isUsingMMKV = (): boolean => usingMMKV;

/**
 * Wait for storage to be ready (always resolves quickly now)
 */
export const waitForMMKV = async (_timeoutMs: number = 10000): Promise<MMKV | null> => {
  // Storage is always ready now (either MMKV or AsyncStorage)
  return mmkvInstance;
};

// Zustand-compatible storage adapter with AsyncStorage fallback
export const storage: StateStorage = {
  getItem: (name: string): string | null => {
    if (usingMMKV && mmkvInstance) {
      try {
        const value = mmkvInstance.getString(name);
        return value ?? null;
      } catch (error) {
        console.warn('[Storage] MMKV getItem failed:', error);
        return null;
      }
    }
    
    // AsyncStorage is async, but zustand persist expects sync
    // Return null synchronously, data will be hydrated async
    return null;
  },
  
  setItem: (name: string, value: string): void => {
    if (usingMMKV && mmkvInstance) {
      try {
        mmkvInstance.set(name, value);
      } catch (error) {
        console.warn('[Storage] MMKV setItem failed:', error);
      }
      return;
    }
    
    // AsyncStorage fallback (fire and forget for sync interface)
    AsyncStorage.setItem(name, value).catch(error => {
      console.warn('[Storage] AsyncStorage setItem failed:', error);
    });
  },
  
  removeItem: (name: string): void => {
    if (usingMMKV && mmkvInstance) {
      try {
        mmkvInstance.remove(name);
      } catch (error) {
        console.warn('[Storage] MMKV removeItem failed:', error);
      }
      return;
    }

    // AsyncStorage fallback
    AsyncStorage.removeItem(name).catch(error => {
      console.warn('[Storage] AsyncStorage removeItem failed:', error);
    });
  },
};

// Async storage adapter for zustand (better for AsyncStorage fallback)
async function setItemStrict(name: string, value: string): Promise<void> {
  if (usingMMKV && mmkvInstance) {
    mmkvInstance.set(name, value);
    return;
  }
  await AsyncStorage.setItem(name, value);
}

/**
 * Zustand's StateStorage plus the strict write. The extra member has to be on
 * the type or callers cannot reach it — StateStorage does not know about it.
 */
export type AppStorage = StateStorage & {
  setItemStrict: (name: string, value: string) => Promise<void>;
};

export const asyncStorage: AppStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (usingMMKV && mmkvInstance) {
      try {
        const value = mmkvInstance.getString(name);
        return value ?? null;
      } catch (error) {
        console.warn('[Storage] MMKV getItem failed:', error);
        return null;
      }
    }
    
    try {
      return await AsyncStorage.getItem(name);
    } catch (error) {
      console.warn('[Storage] AsyncStorage getItem failed:', error);
      return null;
    }
  },
  
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await setItemStrict(name, value);
    } catch (error) {
      // Preserved for the many zustand `persist` stores across the fleet, which
      // treat storage as best-effort. Callers that cannot tolerate a lost write
      // must use setItemStrict.
      console.warn('[Storage] setItem failed:', error);
    }
  },

  /**
   * setItem that FAILS instead of pretending to succeed.
   *
   * The tolerant version above swallows the error and returns void, so a caller
   * cannot distinguish "written" from "silently dropped". That is acceptable for
   * a re-derivable UI preference and unacceptable for anything that is the only
   * copy of user data — notably Budget's local-first ledger, which is the system
   * of record and is stored as a single value (so on Android it also meets
   * AsyncStorage's database ceiling as one write).
   */
  setItemStrict,
  
  removeItem: async (name: string): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      try {
        mmkvInstance.remove(name);
        return;
      } catch (error) {
        console.warn('[Storage] MMKV removeItem failed:', error);
      }
      return;
    }
    
    try {
      await AsyncStorage.removeItem(name);
    } catch (error) {
      console.warn('[Storage] AsyncStorage removeItem failed:', error);
    }
  },
};

// Export a proxy that works like MMKV but with AsyncStorage fallback
export const mmkv = new Proxy({} as MMKV, {
  get(_target, prop) {
    if (usingMMKV && mmkvInstance) {
      const value = mmkvInstance[prop as keyof MMKV];
      // BIND, do not hand the bare method back.
      //
      // `mmkvInstance[prop]` detaches the method from its object, so calling
      // `mmkv.getBoolean(k)` invokes it with `this` set to THIS PROXY. Under
      // react-native-mmkv v2 that was harmless — the instance was a plain JS
      // object and the methods never read `this`. Under v3 the instance is a
      // Nitro `HybridObject` whose methods require `this` to carry NativeState,
      // and the call dies with:
      //
      //   Cannot call hybrid function `HybridMMKVSpec.getBoolean(...)` —
      //   `this` does not have a NativeState!
      //   … Did you accidentally destructure the `HybridObject`?
      //
      // Which is exactly what this proxy was doing, on every property read. It
      // takes down the whole app: `mmkv` is read during onboarding
      // (`houseOnboardingAiStepsIncluded`) and by every zustand persist store,
      // so the first render throws and nothing mounts.
      //
      // Non-function properties are passed through untouched — binding them
      // would be wrong and `bind` is not defined on them.
      return typeof value === 'function' ? value.bind(mmkvInstance) : value;
    }
    // Return no-op functions when MMKV not available
    return () => undefined;
  },
});

// Type-safe storage helpers with async support
export const storageHelpers = {
  // String operations
  getString: async (key: string): Promise<string | undefined> => {
    if (usingMMKV && mmkvInstance) {
      return mmkvInstance.getString(key);
    }
    const value = await AsyncStorage.getItem(key);
    return value ?? undefined;
  },
  
  setString: async (key: string, value: string): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },

  // Number operations
  getNumber: async (key: string): Promise<number | undefined> => {
    if (usingMMKV && mmkvInstance) {
      const native = mmkvInstance.getNumber(key);
      if (native !== undefined) return native;
      // Values copied from the AsyncStorage fallback are stored as strings.
      const raw = mmkvInstance.getString(key);
      return raw != null ? parseFloat(raw) : undefined;
    }
    const value = await AsyncStorage.getItem(key);
    return value ? parseFloat(value) : undefined;
  },
  
  setNumber: async (key: string, value: number): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value.toString());
  },

  // Boolean operations
  getBoolean: async (key: string): Promise<boolean | undefined> => {
    if (usingMMKV && mmkvInstance) {
      const native = mmkvInstance.getBoolean(key);
      if (native !== undefined) return native;
      // Values copied from the AsyncStorage fallback are stored as strings.
      const raw = mmkvInstance.getString(key);
      return raw != null ? raw === 'true' : undefined;
    }
    const value = await AsyncStorage.getItem(key);
    return value ? value === 'true' : undefined;
  },
  
  setBoolean: async (key: string, value: boolean): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value.toString());
  },

  // JSON operations
  getObject: async <T>(key: string): Promise<T | null> => {
    if (usingMMKV && mmkvInstance) {
      const value = mmkvInstance.getString(key);
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    
    const value = await AsyncStorage.getItem(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  
  setObject: async <T>(key: string, value: T): Promise<void> => {
    const jsonValue = JSON.stringify(value);
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(key, jsonValue);
      return;
    }
    await AsyncStorage.setItem(key, jsonValue);
  },

  // Delete and check
  delete: async (key: string): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.remove(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
  
  contains: async (key: string): Promise<boolean> => {
    if (usingMMKV && mmkvInstance) {
      return mmkvInstance.contains(key);
    }
    const value = await AsyncStorage.getItem(key);
    return value !== null;
  },
  
  getAllKeys: async (): Promise<string[]> => {
    if (usingMMKV && mmkvInstance) {
      return mmkvInstance.getAllKeys();
    }
    const keys = await AsyncStorage.getAllKeys();
    return [...keys];
  },

  // Clear all storage
  clearAll: async (): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.clearAll();
      return;
    }
    await AsyncStorage.clear();
  },

  /**
   * Clean up stale persistence keys from removed stores
   * These stores previously used persist middleware but no longer do (commit 428b719)
   */
  cleanupStaleKeys: async (): Promise<{ removed: string[]; errors: string[] }> => {
    const STALE_KEYS = [
      'report-storage',       // reportStore - removed persistence for multi-device sync
      'task-storage',         // taskStore - removed persistence for multi-device sync
      'task-draft-storage',   // taskDraftStore - never persisted
      'household-storage',    // householdStore - never persisted
      'project-storage',      // projectStore - never persisted
      'quote-storage',        // quoteStore - never persisted
      'appointment-storage',  // appointmentStore - never persisted
      'image-storage',        // imagesStore - never persisted
      'message-storage',      // messageStore - never persisted
    ];

    const removed: string[] = [];
    const errors: string[] = [];

    try {
      const allKeys = await storageHelpers.getAllKeys();
      console.log('[Storage] All keys found:', allKeys.length);

      // Check for stale keys
      for (const staleKey of STALE_KEYS) {
        if (allKeys.includes(staleKey)) {
          try {
            await storageHelpers.delete(staleKey);
            removed.push(staleKey);
            console.log(`[Storage] Removed stale key: ${staleKey}`);
          } catch (error) {
            console.error(`[Storage] Failed to remove key ${staleKey}:`, error);
            errors.push(staleKey);
          }
        }
      }

      if (removed.length > 0) {
        console.log(`[Storage] Cleanup complete: ${removed.length} keys removed`);
      } else {
        console.log('[Storage] No stale keys found');
      }

      return { removed, errors };
    } catch (error) {
      console.error('[Storage] Cleanup failed:', error);
      return { removed, errors: ['getAllKeys failed'] };
    }
  },
};
