import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { storage } from '@services/storage';

const PREFIX = 'rq-cache:';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedEntry<T> {
  data: T;
  updatedAt: number;
}

type PersistedQueryOptions<TData, TError> = UseQueryOptions<TData, TError> & {
  /** How long a cached entry stays usable as initialData. Default: 7 days. */
  ttlMs?: number;
};

/**
 * Like useQuery, but survives app restarts. Reads MMKV synchronously on mount
 * so the query renders cached data instantly with no spinner, then refetches
 * in the background if the cached entry is older than staleTime.
 *
 * Falls back to plain useQuery semantics when MMKV isn't available (Expo Go).
 */
export function usePersistedQuery<TData, TError = Error>(
  options: PersistedQueryOptions<TData, TError>
): UseQueryResult<TData, TError> {
  const { queryKey, ttlMs = DEFAULT_TTL_MS } = options;
  const storageKey = `${PREFIX}${stableKey(queryKey)}`;

  const cached = readCache<TData>(storageKey, ttlMs);

  const query = useQuery<TData, TError>({
    ...options,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.updatedAt,
  });

  useEffect(() => {
    if (query.isSuccess && !query.isFetching && query.data !== undefined) {
      writeCache(storageKey, query.data);
    }
  }, [query.isSuccess, query.isFetching, query.data, storageKey]);

  return query;
}

function stableKey(key: unknown): string {
  try {
    return JSON.stringify(key);
  } catch {
    return String(key);
  }
}

function readCache<T>(key: string, ttlMs: number): CachedEntry<T> | null {
  try {
    const raw = storage.getItem(key);
    // MMKV returns sync string | null. AsyncStorage fallback returns a Promise,
    // in which case we skip the cache and let the query load normally.
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as CachedEntry<T>;
    if (!parsed || typeof parsed.updatedAt !== 'number') return null;
    if (Date.now() - parsed.updatedAt > ttlMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    storage.setItem(key, JSON.stringify({ data, updatedAt: Date.now() }));
  } catch {
    // swallow — persistence is best-effort
  }
}
