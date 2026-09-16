/**
 * Symply Life (brand `symply-kaizen`) — feature-local MMKV storage facade.
 *
 * Ported 1:1 from the donor Kaizen app (`Simply Kaizen/kaizen/src/services/storage/index.ts`).
 * The donor's services call this synchronously and use `storageHelpers.remove()`, which the
 * ecosystem's shared `@services/storage` (async, `delete()`-based) does not provide — so the
 * donor facade is kept feature-local and behavior-identical. Isolated MMKV instance id keeps
 * Life keys separate from other brand data on shared installs.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';
import type { StateStorage } from 'zustand/middleware';

let usingMMKV = false;
let mmkvInstance: MMKV | null = null;
let storageReady = false;

const initializeMMKV = (): boolean => {
  try {
    mmkvInstance = createMMKV({
      id: 'symply-kaizen-storage',
    });
    usingMMKV = true;
    return true;
  } catch {
    usingMMKV = false;
    mmkvInstance = null;
    return false;
  }
};

initializeMMKV();
storageReady = true;

export const isStorageReady = (): boolean => storageReady;
export const isUsingMMKV = (): boolean => usingMMKV;

/** Zustand-compatible sync storage (MMKV) with AsyncStorage fallback. */
export const storage: StateStorage = {
  getItem: (name: string): string | null => {
    if (usingMMKV && mmkvInstance) {
      try {
        return mmkvInstance.getString(name) ?? null;
      } catch {
        return null;
      }
    }
    return null;
  },

  setItem: (name: string, value: string): void => {
    if (usingMMKV && mmkvInstance) {
      try {
        mmkvInstance.set(name, value);
      } catch {
        // ignore
      }
      return;
    }
    AsyncStorage.setItem(name, value).catch(() => {});
  },

  removeItem: (name: string): void => {
    if (usingMMKV && mmkvInstance) {
      try {
        mmkvInstance.remove(name);
      } catch {
        // ignore
      }
      return;
    }
    AsyncStorage.removeItem(name).catch(() => {});
  },
};

/** Async storage adapter for zustand persist when MMKV is unavailable. */
export const asyncStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (usingMMKV && mmkvInstance) {
      return mmkvInstance.getString(name) ?? null;
    }
    return AsyncStorage.getItem(name);
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(name, value);
      return;
    }
    await AsyncStorage.setItem(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.remove(name);
      return;
    }
    await AsyncStorage.removeItem(name);
  },
};

export const storageHelpers = {
  getString: (key: string): string | null => {
    if (usingMMKV && mmkvInstance) {
      return mmkvInstance.getString(key) ?? null;
    }
    return null;
  },
  setString: (key: string, value: string): void => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.set(key, value);
    } else {
      AsyncStorage.setItem(key, value).catch(() => {});
    }
  },
  remove: (key: string): void => {
    if (usingMMKV && mmkvInstance) {
      mmkvInstance.remove(key);
    } else {
      AsyncStorage.removeItem(key).catch(() => {});
    }
  },
  getObject: <T>(key: string): T | null => {
    const raw = storageHelpers.getString(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setObject: (key: string, value: unknown): void => {
    storageHelpers.setString(key, JSON.stringify(value));
  },
};
