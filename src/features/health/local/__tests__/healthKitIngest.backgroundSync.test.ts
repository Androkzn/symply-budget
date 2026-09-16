/**
 * **He11a — a background HealthKit sync does NOT POST `/health`** (plan §1.6,
 * the Wave B line).
 *
 * ## Why this is its own file, and its own assertion
 *
 * `healthKitIngest.drain.test.ts` drives `importNow()` directly. This one drives
 * the path a real device takes when nobody is looking: `HKObserverQuery` fires
 * in Swift → `onHealthDataChanged` reaches JS → `healthKitBackgroundSync`
 * debounces → the **app-wide `healthKit` singleton** imports. That singleton is
 * built at module load with `resolveHealthKitBridge()` and, crucially, with NO
 * `sink` in its config — so it is the one object in the app that exercises
 * `resolveHealthKitImportSink()` for real.
 *
 * On a flag-1 device that path must reach the ledger. If it reaches D1 instead,
 * the failure is not a silent one — `/health/entries`, `/health/weight` and
 * `/health/nutrition` are on the He0 410 reject-list and the
 * `X-Health-Local-First` header is armed on `/health/*` as soon as a session
 * opens — so a background sync would 410 on every write and import nothing at
 * all, several times an hour, for a member who is told "Apple Health synced".
 *
 * The assertion is therefore negative and absolute: **not one call leaves the
 * device**, and the rows are in the ledger afterwards. A positive-only test
 * ("rows appeared") would pass against a sink that wrote both.
 *
 * ## What is mocked and why
 *
 * Only `healthKitBridge` — the native boundary. `resolveHealthKitBridge()`
 * answers `null` off Symply Health, which would make `importNow()` return
 * `unavailable` and turn every assertion below vacuous; `nativeHealthKitModule()`
 * is what the observer subscription needs. Everything after that — the service,
 * the sink resolver, the facades, the engine — is the shipped code.
 *
 * Static imports only: `await import()` throws under this Jest config without
 * `--experimental-vm-modules`.
 */
const mockNetworkCalls: string[] = [];

jest.mock('@api/client', () => {
  const fail = (verb: string) => (url?: unknown) => {
    mockNetworkCalls.push(`${verb} ${String(url)}`);
    const error = new Error('airplane mode: this device has no network') as Error & {
      code: string;
    };
    error.code = 'ERR_NETWORK';
    return Promise.reject(error);
  };
  const client = {
    get: fail('GET'),
    post: fail('POST'),
    put: fail('PUT'),
    patch: fail('PATCH'),
    delete: fail('DELETE'),
    request: fail('REQUEST'),
  };
  return { __esModule: true, apiClient: client, api: client, default: client };
});

const mockSamples: Record<string, unknown[]> = {};

jest.mock('../../healthKitBridge', () => {
  const actual = jest.requireActual('../../healthKitBridge');
  const authorized = {
    HKQuantityTypeIdentifierStepCount: 'sharingAuthorized',
    HKQuantityTypeIdentifierBodyMass: 'sharingAuthorized',
  };
  return {
    ...actual,
    // The bridge the app-wide `healthKit` singleton is constructed with.
    resolveHealthKitBridge: () => ({
      isAvailable: () => true,
      getAuthorizationStatus: async () => authorized,
      requestAuthorization: async () => authorized,
      querySamples: async ({ type }: { type: string }) => mockSamples[type] ?? [],
      queryWorkouts: async () => [],
    }),
    nativeHealthKitModule: () => mockNative,
  };
});

/** The observer half: `addListener` + the pending-flag probe. */
const mockNative = (() => {
  const listeners: Array<(event: { type: string }) => void> = [];
  return {
    addListener: (_event: string, cb: (event: { type: string }) => void) => {
      listeners.push(cb);
      return { remove: () => undefined };
    },
    consumePendingSync: async () => false,
    fire: (type = 'HKQuantityTypeIdentifierStepCount') => {
      for (const cb of listeners) cb({ type });
    },
  };
})();

import { healthKit } from '../../healthKit';
import { startHealthKitBackgroundSync } from '../../healthKitBackgroundSync';
import { closeLocalHealthSession, openLocalHealthSessionForTests } from '../engine';
import { rowsOf } from '../localWrite';
import type { LocalHealthEntry, LocalWeightEntry } from '../types';

const USER = 'user_healthkit_background';

/**
 * An instant safely inside the window a background sync reads.
 *
 * `importNow({})` — no `days` override, which is what `healthKitBackgroundSync`
 * passes — reads `healthKitHistoricalWindows(now())`: the previous calendar
 * month plus this month **up to now**. So the sample cannot sit at a fixed hour
 * of "today": on a run that starts at 02:30 a 10:00 sample is in the FUTURE and
 * is dropped, silently, by the service's own window re-check. Anchoring 26 hours
 * back keeps it inside whichever of the two chunks the calendar puts it in.
 */
function recentInstant(): string {
  return new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
}

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = ((input?: unknown) => {
    mockNetworkCalls.push(`FETCH ${String(input)}`);
    return Promise.reject(new Error('airplane mode: this device has no network'));
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(async () => {
  jest.useFakeTimers();
  mockNetworkCalls.length = 0;
  for (const key of Object.keys(mockSamples)) delete mockSamples[key];
  await openLocalHealthSessionForTests({ userId: USER });
});

afterEach(async () => {
  jest.useRealTimers();
  await closeLocalHealthSession();
});

/**
 * Run `work` with the client gate explicitly on, then restore whatever the
 * ambient run had — `isHealthLocalFirst()` reads `process.env` per call, and the
 * variable is process-wide across a Jest worker.
 */
async function withLocalFirstFlag<T>(work: () => Promise<T>): Promise<T> {
  const previous = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
  process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '1';
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
    else process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = previous;
  }
}

describe('background sync on a flag-1 device', () => {
  it('imports into the ledger and never POSTs /health', async () => {
    const instant = recentInstant();
    mockSamples.steps = [
      { type: 'steps', startedAt: instant, endedAt: instant, value: 4200, unit: 'count' },
    ];
    mockSamples.bodyMass = [
      { type: 'bodyMass', startedAt: instant, endedAt: instant, value: 80.5, unit: 'kg' },
    ];

    await withLocalFirstFlag(async () => {
      // The permission sheet is answered once, exactly as onboarding does it,
      // so the singleton's stored state reads `connected`.
      await healthKit.requestPermission();

      const handle = startHealthKitBackgroundSync();
      mockNative.fire();
      // The module's own 3s debounce — one import for a burst of events.
      await jest.advanceTimersByTimeAsync(3000);
      // Then the import's OWN timers: `importNow` yields with `setTimeout(…, 0)`
      // between types so a foreground drag can finish its Pressable →
      // ScrollView handoff while the native reads run. Under fake timers those
      // yields are scheduled as the run proceeds, so the clock has to keep
      // moving for the drain to reach its writes.
      for (let tick = 0; tick < 40; tick += 1) {
        await jest.advanceTimersByTimeAsync(10);
      }
      handle.stop();
    });

    // THE assertion. Wave B's line in plan §1.6: HealthKit samples become Wave A
    // ledger rows, and nothing about that reaches the Worker.
    expect(mockNetworkCalls).toEqual([]);

    const entries = rowsOf<LocalHealthEntry>('healthEntries');
    const weights = rowsOf<LocalWeightEntry>('weightEntries');
    // Guards a vacuous pass: an import that silently did nothing would satisfy
    // the "no network" assertion perfectly.
    expect(entries.map((row) => row.entry_type)).toEqual(['steps']);
    expect(entries[0].source).toBe('healthkit');
    expect(weights).toHaveLength(1);
    expect(weights[0].source).toBe('healthkit');
  });
});
