/**
 * Symply Health — read-through repository (parity phase P1).
 *
 * Every Health store now funnels through `readThrough` / `writeThrough`, so the
 * offline contract is asserted ONCE here rather than re-derived in seven store
 * suites: the API is the record of truth, MMKV is a cache that must never blank
 * a screen, never resurrect a row the server deleted, and never surface a raw
 * error string (see the no-raw-error-leaks rule).
 *
 * The store suites then assert their own wire payloads and mappers on top.
 */

import * as e2eObservability from '@api/e2eTestObservability';
import { storageHelpers } from '@services/storage';

import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
  readThrough,
  writeThrough,
} from '../healthRepository';

const KEY = 'health.test.v1';
const OTHER_KEY = 'health.test-other.v1';

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

beforeEach(async () => {
  await storageHelpers.clearAll();
  // `lastSyncState` is module-level; an empty key list resets it without
  // touching storage, so one test's 'offline' verdict cannot leak into the next.
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

describe('healthRepository — readThrough (online)', () => {
  it('HEALTH-REPO-001: returns the fresh server value and mirrors it into the cache', async () => {
    const fetcher = jest.fn().mockResolvedValue(['fresh']);

    expect(await readThrough(KEY, fetcher, ['fallback'])).toEqual(['fresh']);
    // Cold start renders the cached snapshot, so the mirror is what makes the
    // NEXT launch instant — a read that does not write the cache is a bug.
    expect(await storageHelpers.getObject(KEY)).toEqual(['fresh']);
    expect(healthSyncStateFor(KEY)).toBe('synced');
  });

  it('HEALTH-REPO-002: a successful read replaces the cache wholesale', async () => {
    await storageHelpers.setObject(KEY, ['a', 'b', 'c']);
    const fetcher = jest.fn().mockResolvedValue(['a']);

    // 'b' and 'c' were deleted on another device. Merging (rather than
    // replacing) would resurrect them forever, so the server list wins outright.
    expect(await readThrough(KEY, fetcher, [])).toEqual(['a']);
    expect(await storageHelpers.getObject(KEY)).toEqual(['a']);
  });
});

describe('healthRepository — readThrough (offline)', () => {
  it('HEALTH-REPO-003: a failed fetch falls back to the cached snapshot', async () => {
    await storageHelpers.setObject(KEY, ['cached']);
    const fetcher = jest.fn().mockRejectedValue(new Error('Network request failed'));

    expect(await readThrough(KEY, fetcher, ['fallback'])).toEqual(['cached']);
    expect(healthSyncStateFor(KEY)).toBe('offline');
    // The stale cache survives the failure — it is all the user has.
    expect(await storageHelpers.getObject(KEY)).toEqual(['cached']);
  });

  it('HEALTH-REPO-004: a failed fetch with no cache yields the caller fallback', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('nope'));

    // First-ever launch in a basement: the screen shows its empty state, not a
    // crash and not an error string.
    expect(await readThrough(KEY, fetcher, ['fallback'])).toEqual(['fallback']);
    expect(healthSyncStateFor(KEY)).toBe('offline');
  });

  it('HEALTH-REPO-016: a cached value of the wrong PRIMITIVE type is refused', async () => {
    // The shape guard infers what to expect from `fallback`, so a scalar
    // fallback demands a scalar of the same type. A snapshot left behind by an
    // older schema (here a number under a key that now holds a string) must
    // reach the caller as the fallback rather than as itself — the caller is
    // about to call string methods on it.
    await storageHelpers.setObject(KEY, 42);
    const fetcher = jest.fn().mockRejectedValue(new Error('Network request failed'));

    expect(await readThrough(KEY, fetcher, 'kg')).toBe('kg');

    // The matching primitive type IS handed back, so the guard is a type check
    // and not a blanket refusal of every scalar cache.
    await storageHelpers.setObject(OTHER_KEY, 'lb');
    expect(await readThrough(OTHER_KEY, fetcher, 'kg')).toBe('lb');
  });

  it('HEALTH-REPO-005: the forced-offline flag skips the network entirely', async () => {
    await storageHelpers.setObject(KEY, ['cached']);
    const fetcher = jest.fn().mockResolvedValue(['fresh']);
    __setHealthOfflineForTests(true);

    expect(await readThrough(KEY, fetcher, [])).toEqual(['cached']);
    // Deterministic offline: the fetcher must not even be attempted, otherwise
    // a suite asserting "no call was made" would be timing-dependent.
    expect(fetcher).not.toHaveBeenCalled();
    expect(healthSyncStateFor(KEY)).toBe('offline');
  });
});

describe('healthRepository — writeThrough (online)', () => {
  it('HEALTH-REPO-006: writes, re-reads, caches the refreshed value and returns it', async () => {
    const write = jest.fn().mockResolvedValue({ ok: true });
    const after = jest.fn().mockResolvedValue(['server']);

    expect(await writeThrough(KEY, write, after, ['optimistic'])).toEqual(['server']);
    expect(write).toHaveBeenCalledTimes(1);
    // Server-derived fields (ids, computed streaks, rounded totals) only exist
    // after the refresh, so the REFRESHED value is what the screen must render.
    expect(after).toHaveBeenCalledTimes(1);
    expect(await storageHelpers.getObject(KEY)).toEqual(['server']);
    expect(healthSyncStateFor(KEY)).toBe('synced');
  });

  it('HEALTH-REPO-007: records one E2E persist entry per write, defaulting the detail', async () => {
    const persistSpy = jest.spyOn(e2eObservability, 'recordE2EPersistEntry');
    const write = jest.fn().mockResolvedValue(null);
    const after = jest.fn().mockResolvedValue('v');

    await writeThrough(KEY, write, after, 'v', 'insert weight=70kg');
    expect(persistSpy).toHaveBeenCalledWith({
      store: KEY,
      operation: 'update',
      detail: 'insert weight=70kg',
    });

    // Maestro greps [E2E-DB] for these lines, so a writer that forgets its
    // detail must still emit a record rather than nothing at all.
    persistSpy.mockClear();
    await writeThrough(KEY, write, after, 'v');
    expect(persistSpy).toHaveBeenCalledWith({ store: KEY, operation: 'update', detail: 'write' });

    persistSpy.mockRestore();
  });

  it('HEALTH-REPO-008: the persist record is emitted BEFORE the network attempt', async () => {
    const persistSpy = jest.spyOn(e2eObservability, 'recordE2EPersistEntry');
    const write = jest.fn().mockImplementation(() => {
      // The [E2E-DB] line is what proves the tap reached the store at all, so it
      // has to be there even when the request that follows never completes.
      expect(persistSpy).toHaveBeenCalledTimes(1);
      return Promise.reject(new Error('boom'));
    });

    await writeThrough(KEY, write, jest.fn(), 'optimistic', 'tap');
    expect(write).toHaveBeenCalledTimes(1);

    persistSpy.mockRestore();
  });
});

describe('healthRepository — writeThrough (offline)', () => {
  it('HEALTH-REPO-009: a failed write still returns and caches the optimistic value', async () => {
    const write = jest.fn().mockRejectedValue(new Error('Network request failed'));
    const after = jest.fn();

    // The user tapped "+1 cup" and it has to look like it worked; the next
    // successful read reconciles whatever the server actually holds.
    expect(await writeThrough(KEY, write, after, ['optimistic'])).toEqual(['optimistic']);
    expect(after).not.toHaveBeenCalled();
    expect(await storageHelpers.getObject(KEY)).toEqual(['optimistic']);
    expect(healthSyncStateFor(KEY)).toBe('offline');
  });

  it('HEALTH-REPO-010: a write that lands but fails to refresh also keeps the optimistic value', async () => {
    const write = jest.fn().mockResolvedValue(null);
    const after = jest.fn().mockRejectedValue(new Error('refresh failed'));

    // Half-success (POST 201, follow-up GET dropped) must not blank the screen
    // either — the same catch covers both legs.
    expect(await writeThrough(KEY, write, after, ['optimistic'])).toEqual(['optimistic']);
    expect(write).toHaveBeenCalledTimes(1);
    expect(await storageHelpers.getObject(KEY)).toEqual(['optimistic']);
    expect(healthSyncStateFor(KEY)).toBe('offline');
  });

  it('HEALTH-REPO-011: the forced-offline flag never touches the network', async () => {
    const write = jest.fn().mockResolvedValue(null);
    const after = jest.fn().mockResolvedValue(['server']);
    __setHealthOfflineForTests(true);

    expect(await writeThrough(KEY, write, after, ['optimistic'])).toEqual(['optimistic']);
    expect(write).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(healthSyncStateFor(KEY)).toBe('offline');
  });
});

describe('healthRepository — sync state + cache clearing', () => {
  it('HEALTH-REPO-012: an untouched key reports "unknown", not "offline"', () => {
    // A badge must be able to tell "never asked" apart from "asked and failed".
    expect(healthSyncStateFor('health.never-read.v1')).toBe('unknown');
  });

  it('HEALTH-REPO-013: sync state is tracked per key', async () => {
    await readThrough(KEY, jest.fn().mockResolvedValue('a'), 'x');
    await readThrough(OTHER_KEY, jest.fn().mockRejectedValue(new Error('down')), 'x');

    // One failing endpoint must not mark the whole app offline.
    expect(healthSyncStateFor(KEY)).toBe('synced');
    expect(healthSyncStateFor(OTHER_KEY)).toBe('offline');
  });

  it('HEALTH-REPO-014: clearHealthCache drops every snapshot and forgets the sync state', async () => {
    await readThrough(KEY, jest.fn().mockResolvedValue('a'), 'x');
    await readThrough(OTHER_KEY, jest.fn().mockResolvedValue('b'), 'x');

    await clearHealthCache([KEY, OTHER_KEY]);

    // Sign-out guard: the next account on this handset must not read the
    // previous user's health rows out of the cache. The sync map is part of
    // that — a stale 'synced' badge would claim the new session is up to date.
    expect(await storageHelpers.getObject(KEY)).toBeNull();
    expect(await storageHelpers.getObject(OTHER_KEY)).toBeNull();
    expect(healthSyncStateFor(KEY)).toBe('unknown');
    expect(healthSyncStateFor(OTHER_KEY)).toBe('unknown');
  });

  it('HEALTH-REPO-015: clearing an unknown or empty key list is a no-op, not a throw', async () => {
    await readThrough(KEY, jest.fn().mockRejectedValue(new Error('down')), 'x');
    expect(healthSyncStateFor(KEY)).toBe('offline');

    // Sign-out must never fail because a store was never opened this session.
    await expect(clearHealthCache(['health.never-written.v1'])).resolves.toBeUndefined();
    await expect(clearHealthCache([])).resolves.toBeUndefined();
    expect(healthSyncStateFor(KEY)).toBe('unknown');
  });
});
