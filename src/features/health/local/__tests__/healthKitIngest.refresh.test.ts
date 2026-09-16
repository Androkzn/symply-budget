/**
 * **He11a — a drain write repaints Home** (plan §7 refresh contract, rule 2).
 *
 * ## The bug this file exists to prevent, stated plainly
 *
 * `origin: 'local'` is a NO-OP for refresh subscribers. That rule is right, and
 * it rests on one premise: the screen that wrote the row already rendered it.
 * The HealthKit drain breaks the premise — it writes through
 * `mutateLocalHealthLedger` on THIS device, so the engine sees a local echo, but
 * **no screen rendered it**. A drain write tagged `'local'` therefore lands in
 * the ledger, fires nothing, and leaves Home, Trends and the Weight screen
 * painting yesterday's figures until the member navigates away and back — while
 * a toast says "Apple Health synced".
 *
 * It is a silent regression by construction: every row is correct, every count
 * is correct, and the only symptom is a screen that does not move.
 * `ledgerRefresh.test.ts` pins the CONTRACT (an `'ingest'` change fans out);
 * this file pins the PRODUCER (the drain actually emits `'ingest'`), which is
 * the half that was missing on the weight track until He11a.
 *
 * ## Read through the real engine, not a mock
 *
 * The origin is asserted where the engine emits it —
 * `subscribeToHealthLedgerChanges` — and then again at the far end of the wire,
 * as the store revision `useHealthLedgerHydration` compares against. A test that
 * mocked the engine would certify a tag nobody emits.
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

import { createHealthKitService, type HealthKitBridge } from '../../healthKit';
import type { HealthKitSample } from '../../healthKitTypes';
import {
  closeLocalHealthSession,
  openLocalHealthSessionForTests,
  subscribeToHealthLedgerChanges,
  type HealthLedgerChange,
} from '../engine';
import { createLedgerHealthKitImportSink } from '../healthKitIngest';
import { useHealthLedgerStore } from '../healthLedgerStore';
import {
  healthTablesForScreen,
  startHealthLedgerRefreshBridge,
  stopHealthLedgerRefreshBridge,
} from '../ledgerRefresh';
import { localWeightApi } from '../localWeightApi';
import type { HealthLedgerTableName } from '../schema';

const USER = 'user_healthkit_refresh';
const NOW = new Date('2026-08-14T12:00:00.000Z');
const DAY = '2026-08-12';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const originalFetch = globalThis.fetch;
let changes: HealthLedgerChange[] = [];
let unsubscribe: (() => void) | null = null;

beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(new Error('airplane mode: this device has no network'))) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(async () => {
  mockNetworkCalls.length = 0;
  changes = [];
  await openLocalHealthSessionForTests({ userId: USER });
  unsubscribe = subscribeToHealthLedgerChanges((change) => changes.push(change));
});

afterEach(async () => {
  unsubscribe?.();
  unsubscribe = null;
  stopHealthLedgerRefreshBridge();
  expect(mockNetworkCalls).toEqual([]);
  await closeLocalHealthSession();
});

function at(date: string, hour = 10): string {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`).toISOString();
}

function bridgeWith(samples: readonly HealthKitSample[]): HealthKitBridge {
  const authorized = Object.fromEntries(
    [
      'HKQuantityTypeIdentifierStepCount',
      'HKQuantityTypeIdentifierBodyMass',
      'HKQuantityTypeIdentifierDietaryEnergyConsumed',
    ].map((identifier) => [identifier, 'sharingAuthorized' as const]),
  );
  return {
    isAvailable: () => true,
    getAuthorizationStatus: async () => authorized,
    requestAuthorization: async () => authorized,
    querySamples: async ({ type }) => samples.filter((s) => s.type === type),
    queryWorkouts: async () => [],
  };
}

/** One import over the three tables Wave B writes. */
async function importAllThreeTracks(): Promise<void> {
  const service = createHealthKitService({
    bridge: bridgeWith([
      { type: 'steps', startedAt: at(DAY), endedAt: at(DAY, 11), value: 4200, unit: 'count' },
      { type: 'bodyMass', startedAt: at(DAY, 7), endedAt: at(DAY, 7), value: 80.5, unit: 'kg' },
      {
        type: 'dietaryEnergy',
        startedAt: at(DAY, 13),
        endedAt: at(DAY, 13),
        value: 1900,
        unit: 'kcal',
      },
    ]),
    sink: createLedgerHealthKitImportSink(),
    now: () => NOW,
    weightUnit: () => 'kg',
  });
  await service.requestPermission();
  await service.importNow({ days: 7 });
}

/* ================================================================== */

describe('a HealthKit drain write is an INGEST, never a local echo', () => {
  it('tags every write on all three Wave B tables as "ingest"', async () => {
    await importAllThreeTracks();

    expect(changes.length).toBeGreaterThan(0);
    // Not "at least one is ingest": ALL of them. One track left on `'local'` is
    // exactly the weight-shaped gap He11a closes, and it would still pass a
    // `some()` assertion because the other two are correct.
    expect(changes.map((change) => change.origin)).toEqual(changes.map(() => 'ingest'));

    const touched = new Set<HealthLedgerTableName>(changes.flatMap((change) => change.tables));
    expect(touched).toEqual(new Set(['healthEntries', 'weightEntries', 'nutritionEntries']));
  });

  it('moves the store revision Home compares against', async () => {
    // The far end of the wire: `useHealthLedgerHydration` re-hydrates a focused
    // screen when this revision passes the one it last saw.
    startHealthLedgerRefreshBridge();
    const before = useHealthLedgerStore.getState().revision;

    await importAllThreeTracks();

    const after = useHealthLedgerStore.getState();
    expect(after.revision).toBeGreaterThan(before);
    // And the tables it published are ones Home actually renders, or the
    // revision would move without Home reacting.
    const home = new Set(healthTablesForScreen('home'));
    expect(after.touched.some((table) => home.has(table))).toBe(true);
  });

  it('keeps a HAND-TYPED weigh-in silent — the asymmetry is the point', async () => {
    startHealthLedgerRefreshBridge();
    const before = useHealthLedgerStore.getState().revision;

    // Same table, same facade, same write path — only `source` differs. The
    // screen that saved this one has already rendered it, so fanning out here
    // would refetch on every keystroke-close of the weight sheet.
    await localWeightApi.createWeight({ date: DAY, weight: 79.4, unit: 'kg' });

    expect(changes.map((change) => change.origin)).toEqual(['local']);
    expect(useHealthLedgerStore.getState().revision).toBe(before);
  });

  it('tags a weigh-in written with source "healthkit" as ingest', async () => {
    // The signal is the payload's own `source`, because exactly one thing writes
    // it. Asserted directly on the facade as well as through the drain, since
    // `localWeightApi` is the file that was missing `originFor` before He11a.
    await localWeightApi.createWeight({
      date: DAY,
      weight: 80.5,
      unit: 'kg',
      source: 'healthkit',
    });

    expect(changes.map((change) => change.origin)).toEqual(['ingest']);
    expect(changes[0].tables).toEqual(['weightEntries']);
  });
});
