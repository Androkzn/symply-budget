/**
 * Symply Health — a pinned tab survives a relaunch.
 *
 * `tabCustomizationStore` is what makes the Health bar a per-member choice
 * rather than a per-session one. It had NO test anywhere: the editor's Save
 * (covered by platform.tabCustomization.test.tsx) stops at `setOverrides`, and
 * `resolveEffectiveTabs` (healthTabShell.test.ts) starts from an override array
 * someone hands it. The join between them — what is written, what is persisted,
 * what a cold launch reads back — was the gap.
 *
 * Two durable homes, both exercised here:
 *   1. Zustand `persist` → `asyncStorage` (NOT MMKV: MMKV v2 is dead under the
 *      New Architecture, so a persisted store on MMKV silently loses its state
 *      on device while passing in Jest).
 *   2. `settingsSync` → `navigation.customTabs` in the settings KV, which is
 *      also the offline bootstrap when the persisted blob is empty.
 *
 * The store itself is shared platform code and is NOT modified.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */

import { buildTabConfig } from '@navigation/tabRegistry';
import { resolveEffectiveTabs } from '@navigation/useEffectiveTabs';
import { useTabCustomizationStore, type TabOverride } from '@stores/tabCustomizationStore';

const healthBrand = require('../../../../../brands/symply-health/brand.cjs');

jest.mock('@brand', () => {
  const pack = require('../../../../../brands/symply-health/brand.cjs');
  const actual = jest.requireActual('@brand');
  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'brand') return pack;
      if (prop === 'brandId') return pack.id;
      return Reflect.get(target, prop);
    },
  });
});

const mockQueueSync = jest.fn();
jest.mock('@services/settings-sync', () => ({
  settingsSync: {
    queueSync: (...args: unknown[]) => mockQueueSync(...args),
    flushNow: jest.fn(),
  },
}));

// In-memory stand-in for the AsyncStorage-backed adapter, so the persisted blob
// is observable — that blob IS the relaunch contract.
const mockDisk = new Map<string, string>();
let mockSettingsCache: Record<string, unknown> | null = null;
jest.mock('@services/storage', () => ({
  asyncStorage: {
    getItem: jest.fn(async (k: string) => mockDisk.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockDisk.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockDisk.delete(k);
    }),
  },
  storageHelpers: {
    getObject: jest.fn(async () => mockSettingsCache),
  },
}));

const PERSIST_KEY = 'tab-customization-storage';

/** The Health bar a member gets after swapping Activity for Habits. */
const HABITS_OVERRIDE: TabOverride[] = [
  { route: 'index', order: 0, visible: true },
  { route: 'health-weight', order: 1, visible: true },
  { route: 'health-nutrition', order: 2, visible: true },
  { route: 'health-habits', order: 3, visible: true },
  { route: 'settings', order: 4, visible: true },
  { route: 'health-activity', order: 5, visible: false },
] as TabOverride[];

/** Wait for zustand's persist middleware to flush its async setItem. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function persistedState(): { overrides: TabOverride[] | null; lastModified: number | null } {
  const raw = mockDisk.get(PERSIST_KEY);
  expect(raw).toBeDefined();
  return JSON.parse(raw as string).state;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDisk.clear();
  mockSettingsCache = null;
  useTabCustomizationStore.setState({
    overrides: null,
    lastModified: null,
    isHydrated: true,
  });
});

describe('Health tab customization — what Save writes (HEALTH-STORE-059..061)', () => {
  it('HEALTH-STORE-059: renumbers `order` from the array position, never the caller', async () => {
    // The editor already hands over contiguous orders, but the store is the
    // authority: a caller passing sparse / duplicate / descending orders must
    // not be able to write a layout the resolver would read differently from
    // the list it was given.
    useTabCustomizationStore.getState().setOverrides([
      { route: 'index', order: 90, visible: true },
      { route: 'health-habits', order: 7, visible: true },
      { route: 'settings', order: 7, visible: true },
      { route: 'health-trends', order: 0, visible: false },
    ] as TabOverride[]);

    const written = useTabCustomizationStore.getState().overrides as TabOverride[];
    expect(written.map((o) => o.order)).toEqual([0, 1, 2, 3]);
    expect(written.map((o) => o.route)).toEqual([
      'index',
      'health-habits',
      'settings',
      'health-trends',
    ]);
    // `visible` is passed through untouched — only the ordering is normalized.
    expect(written.map((o) => o.visible)).toEqual([true, true, true, false]);
  });

  it('HEALTH-STORE-060: mirrors the layout into the settings KV with a timestamp', () => {
    const before = Date.now();
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    const state = useTabCustomizationStore.getState();

    expect(mockQueueSync).toHaveBeenCalledWith('navigation.customTabs', state.overrides);
    expect(mockQueueSync).toHaveBeenCalledWith(
      'navigation.customTabsLastModified',
      state.lastModified,
    );
    expect(state.lastModified).toBeGreaterThanOrEqual(before);
    // Both keys, every time — a layout synced without its timestamp cannot be
    // conflict-resolved against another device.
    expect(mockQueueSync).toHaveBeenCalledTimes(2);
  });

  it('HEALTH-STORE-061: resetting clears the override and tells the KV it is gone', () => {
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    mockQueueSync.mockClear();

    useTabCustomizationStore.getState().resetToDefaults();

    expect(useTabCustomizationStore.getState().overrides).toBeNull();
    // NULL, not an empty array: "no customization" must be distinguishable from
    // "the member pinned nothing", or the next device would read an empty bar.
    expect(mockQueueSync).toHaveBeenCalledWith('navigation.customTabs', null);
    expect(mockQueueSync).toHaveBeenCalledWith(
      'navigation.customTabsLastModified',
      expect.any(Number),
    );
  });
});

describe('Health tab customization — surviving a relaunch (HEALTH-STORE-062..066, HEALTH-STORE-068)', () => {
  it('HEALTH-STORE-062: persists only the layout + timestamp, and reproduces the same bar', async () => {
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    await flush();

    const state = persistedState();
    // `partialize` — the transient hydration flag must never reach the disk, or
    // a relaunch would restore `isHydrated: true` before rehydration finished.
    expect(Object.keys(state).sort()).toEqual(['lastModified', 'overrides']);
    expect(state.overrides?.map((o) => o.route)).toEqual(HABITS_OVERRIDE.map((o) => o.route));

    // The relaunch: feed exactly what was written back through the resolver.
    const { pinned, overflow } = resolveEffectiveTabs(
      buildTabConfig({ showTasks: false }),
      state.overrides,
      healthBrand.maxVisibleTabs,
    );
    expect(pinned.map((t) => t.route)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-habits',
      'settings',
    ]);
    expect(overflow.map((t) => t.route)).toContain('health-trends');
  });

  it('HEALTH-STORE-063: a reset is persisted too, so defaults come back after a relaunch', async () => {
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    await flush();
    useTabCustomizationStore.getState().resetToDefaults();
    await flush();

    expect(persistedState().overrides).toBeNull();
    const { pinned } = resolveEffectiveTabs(
      buildTabConfig({ showTasks: false }),
      persistedState().overrides,
      healthBrand.maxVisibleTabs,
    );
    // Back to the donor default bar — Habits is no longer pinned.
    expect(pinned.map((t) => t.route)).toEqual([
      'index',
      'health-weight',
      'health-nutrition',
      'health-activity',
      'settings',
    ]);
  });

  it('HEALTH-STORE-064: a reinstall with a synced layout restores it from the settings cache', async () => {
    // Fresh install: no saved layout on this device (the persisted blob holds a
    // null `overrides`), but the account's settings cache carries
    // `navigation.customTabs` from the previous device. Without this bootstrap
    // the member's bar silently reverts on every reinstall.
    mockSettingsCache = {
      'navigation.customTabs': HABITS_OVERRIDE,
      'navigation.customTabsLastModified': 1_700_000_000_000,
    };
    useTabCustomizationStore.setState({ overrides: null, lastModified: null, isHydrated: false });

    await useTabCustomizationStore.persist.rehydrate();
    await flush();

    const state = useTabCustomizationStore.getState();
    expect(state.overrides?.map((o) => o.route)).toEqual(HABITS_OVERRIDE.map((o) => o.route));
    expect(state.lastModified).toBe(1_700_000_000_000);
    expect(state.isHydrated).toBe(true);
    // Bootstrapping is a READ — it must not echo back into the sync queue and
    // start a write loop between two devices.
    expect(mockQueueSync).not.toHaveBeenCalled();
  });

  it('HEALTH-STORE-065: a persisted layout wins over the settings cache', async () => {
    // Both homes hold something: the local blob is the newer, device-local
    // truth, so the cache must not overwrite it. The blob is produced by the
    // store itself rather than hand-written — a hand-rolled envelope drifts
    // from whatever shape `persist` actually writes.
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    await flush();
    const blob = mockDisk.get(PERSIST_KEY) as string;
    expect(blob).toContain('health-habits');
    mockQueueSync.mockClear();

    // Wipe the in-memory store the way a cold launch does, THEN put the blob
    // back: `persist` writes on every `set`, so seeding the disk before the
    // reset would just be overwritten by the reset itself.
    useTabCustomizationStore.setState({ overrides: null, lastModified: null, isHydrated: false });
    await flush();
    mockDisk.set(PERSIST_KEY, blob);
    mockSettingsCache = {
      'navigation.customTabs': [{ route: 'health-cycle', order: 0, visible: true }],
      'navigation.customTabsLastModified': 999,
    };

    await useTabCustomizationStore.persist.rehydrate();
    await flush();

    const state = useTabCustomizationStore.getState();
    expect(state.overrides?.map((o) => o.route)).toEqual(HABITS_OVERRIDE.map((o) => o.route));
    expect(state.isHydrated).toBe(true);
  });

  it('HEALTH-STORE-066: an empty settings cache leaves the defaults alone and still marks hydrated', async () => {
    mockSettingsCache = null;
    useTabCustomizationStore.setState({ overrides: null, lastModified: null, isHydrated: false });

    await useTabCustomizationStore.persist.rehydrate();
    await flush();

    const state = useTabCustomizationStore.getState();
    expect(state.overrides).toBeNull();
    // `isHydrated` MUST flip even on the nothing-to-restore path: the bar waits
    // on it, so a store stuck un-hydrated is a bar stuck on the brand defaults.
    expect(state.isHydrated).toBe(true);
  });

  it('HEALTH-STORE-068: a broken settings-cache read still finishes hydration with the brand default', async () => {
    // storageHelpers.getObject touches the KV cache file; a corrupt blob or a
    // cold cache miss can reject. The bootstrap swallows it (`catch { return
    // null }`) — asserted here because a rethrow would leave `isHydrated` false
    // forever, stranding a Health member on a blank tab bar.
    (jest.requireMock('@services/storage').storageHelpers.getObject as jest.Mock).mockRejectedValueOnce(
      new Error('cache file corrupt'),
    );
    useTabCustomizationStore.setState({ overrides: null, lastModified: null, isHydrated: false });

    await useTabCustomizationStore.persist.rehydrate();
    await flush();

    const state = useTabCustomizationStore.getState();
    expect(state.overrides).toBeNull();
    expect(state.isHydrated).toBe(true);
  });
});

describe('Health tab customization — hydrate() semantics (HEALTH-STORE-067)', () => {
  it('HEALTH-STORE-067: distinguishes "not in the payload" from "explicitly cleared"', () => {
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    const saved = useTabCustomizationStore.getState().overrides;

    // Key absent → keep what we have. A settings payload that simply does not
    // mention tabs must not wipe the member's bar.
    useTabCustomizationStore.getState().hydrate({});
    expect(useTabCustomizationStore.getState().overrides).toEqual(saved);

    // Key present but null → the member reset it on another device.
    useTabCustomizationStore.getState().hydrate({ tabs: null, lastModified: 42 });
    expect(useTabCustomizationStore.getState().overrides).toBeNull();
    expect(useTabCustomizationStore.getState().lastModified).toBe(42);

    // …and a timestamp-only payload leaves the layout untouched.
    useTabCustomizationStore.getState().setOverrides(HABITS_OVERRIDE);
    useTabCustomizationStore.getState().hydrate({ lastModified: 7 });
    expect(useTabCustomizationStore.getState().overrides).not.toBeNull();
    expect(useTabCustomizationStore.getState().lastModified).toBe(7);
  });
});
