/**
 * Sign-out must wipe every Symply Health offline cache key.
 *
 * The Health snapshots hold weight, nutrition, activity, body measurements,
 * cycle and vitality records. If a new cached key is added to a storage module
 * but not registered in `HEALTH_CACHE_KEYS`, it survives `logout()` and the next
 * person to sign in on the same handset sees the previous user's health data.
 *
 * That is exactly the leak `e2e/maestro/health/privacy-cross-user-leak.yaml`
 * guards on device; this pins it at unit speed, and — unlike the device flow —
 * it fails the moment the key is ADDED rather than the next time the suite runs
 * against two accounts.
 */

 
import fs from 'fs';
import path from 'path';

import { HEALTH_CACHE_KEYS } from '../healthCacheKeys';

const HEALTH_DIR = path.join(__dirname, '..');

/** Every `export const HEALTH_*_KEY = 'health.…'` across the storage modules. */
function declaredCacheKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of fs.readdirSync(HEALTH_DIR)) {
    // Storage modules, healthKit.ts (owns HEALTHKIT_STATE_KEY) and
    // healthRepository.ts (owns HEALTH_OUTBOX_KEY — the offline write queue,
    // which must be cleared on logout exactly like every cache: a queued
    // write for the PREVIOUS user must not survive to be replayed against the
    // next one's account). Scanning only `*Storage.ts` let this one hide from
    // HEALTH-CACHE-002 for real, which is the exact failure this test exists
    // to prevent — widen this list rather than the regex, so a genuinely
    // unrelated file cannot silently opt itself in.
    if (
      !/^health.*Storage\.ts$/.test(file) &&
      file !== 'healthKit.ts' &&
      file !== 'healthRepository.ts'
    ) {
      continue;
    }
    const source = fs.readFileSync(path.join(HEALTH_DIR, file), 'utf8');
    const pattern = /export const ([A-Z][A-Z_]*_KEY) = '(health\.[^']+)'/g;
    let match = pattern.exec(source);
    while (match !== null) {
      found.set(match[2], `${file} → ${match[1]}`);
      match = pattern.exec(source);
    }
  }
  return found;
}

describe('Symply Health — sign-out cache clearing', () => {
  it('HEALTH-CACHE-001: every storage-module cache key is registered for clearing', () => {
    const declared = declaredCacheKeys();
    expect(declared.size).toBeGreaterThan(0); // the scan itself must not silently find nothing

    const registered = new Set<string>(HEALTH_CACHE_KEYS);
    const missing = [...declared.entries()]
      .filter(([key]) => !registered.has(key))
      .map(([key, where]) => `${key} (${where})`);

    expect(missing).toEqual([]);
  });

  it('HEALTH-CACHE-002: the list has no stale entries pointing at removed keys', () => {
    const declared = declaredCacheKeys();
    const stale = HEALTH_CACHE_KEYS.filter((key) => !declared.has(key));
    // A stale key is harmless at runtime but means the list has drifted from the
    // modules, which is how a REAL key goes missing unnoticed.
    expect(stale).toEqual([]);
  });

  it('HEALTH-CACHE-003: authStore actually clears them on logout', () => {
    // The list is only useful if it is wired in. Assert the import + spread are
    // present in authStore rather than trusting that they stay.
    const authStore = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'stores', 'authStore.ts'),
      'utf8'
    );
    expect(authStore).toContain('HEALTH_CACHE_KEYS');
    expect(authStore).toContain('...HEALTH_CACHE_KEYS');
  });

  it('HEALTH-CACHE-004: every key is namespaced under `health.`', () => {
    // Namespacing is what makes these safe to clear in bulk without touching
    // another feature's persisted state.
    for (const key of HEALTH_CACHE_KEYS) {
      expect(key.startsWith('health.')).toBe(true);
    }
    expect(new Set(HEALTH_CACHE_KEYS).size).toBe(HEALTH_CACHE_KEYS.length); // no dupes
  });
});
