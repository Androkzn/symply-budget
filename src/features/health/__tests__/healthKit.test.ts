/**
 * Symply Health — HealthKit service suite (parity phase P3).
 *
 * Four things are worth failing a build over, and this suite exists for them:
 *
 * 1. **Scope.** The donor asked iOS for ~30 read types plus writes. We ask for
 *    five and write nothing. That is asserted against the literal identifier
 *    list handed to the bridge, and against the ABSENCE of the donor's extras —
 *    a permission footprint that widens by accident is an App Review rejection
 *    and a privacy failure, so it is pinned, not reviewed.
 * 2. **The OFF path.** Unavailable and denied are ordinary states. Nothing here
 *    may throw, and no code path may make manual entry conditional on a grant.
 * 3. **Manual data survives.** A day the user typed is never replaced.
 * 4. **Re-import does not stack.** `POST /health/entries` inserts blindly, so
 *    the de-duplication is ours to get right — twice, in the mapper (one row per
 *    day per type) and in the planner (against what the server already holds).
 *
 * Everything runs against an injected fake bridge; no native module is involved.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  HEALTHKIT_DEFAULT_WINDOW_DAYS,
  HEALTHKIT_MAX_WINDOW_DAYS,
  HEALTHKIT_STATE_KEY,
  EMPTY_HEALTHKIT_STATE,
  KILOGRAMS_PER_POUND,
  convertKilograms,
  createApiImportSink,
  createHealthKitService,
  createInMemoryHealthKitStore,
  createStoredHealthKitStore,
  deriveConnectionState,
  healthKit,
  healthKitHistoricalWindows,
  healthKitWindow,
  isSampleInWindow,
  localDayKey,
  mapRawAuthorization,
  mapSamplesToNutritionPayloads,
  mapSamplesToPayloads,
  mapSamplesToWeightPayloads,
  mapWorkoutSamplesToPayloads,
  nullHealthKitBridge,
  planImport,
  planNutritionImport,
  planWeightImport,
  planWorkoutImport,
  uniformAuthorization,
  type HealthKitAuthorizationMap,
  type HealthKitBridge,
  type HealthKitExistingEntry,
  type HealthKitExistingNutrition,
  type HealthKitExistingWeight,
  type HealthKitImportSink,
  type HealthKitPersistedState,
  type HealthKitRawAuthorization,
  type HealthKitSyncProgress,
} from '../healthKit';
import {
  HEALTHKIT_DATA_TYPES,
  HEALTHKIT_DESCRIPTORS,
  HEALTHKIT_ENTRY_TYPES,
  HEALTHKIT_IMPORTABLE_TYPES,
  HEALTHKIT_NUTRITION_TYPES,
  HEALTHKIT_READ_IDENTIFIERS,
  HEALTHKIT_TYPES,
  HEALTHKIT_WEIGHT_TYPES,
  HEALTHKIT_WORKOUT_IDENTIFIER,
  HEALTHKIT_WRITE_IDENTIFIERS,
  descriptorForIdentifier,
  isHealthKitDataType,
  isScopedIdentifier,
  type HealthKitDataType,
  type HealthKitEntryPayload,
  type HealthKitSample,
  type HealthKitWorkoutPayload,
  type HealthKitWorkoutSample,
} from '../healthKitTypes';
import {
  healthEntryRow,
  ok,
  weightRow as wireWeightRow,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

// The sink at the bottom of this file is the ONE place the Health feature talks
// to `/health/entries` and `/health/weight/entries` directly; everything above it
// runs against an injected fake and never reaches the API at all.
jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

/* =============================== Fixtures =============================== */

/** Local noon, so day bucketing is never ambiguous across the runner's TZ. */
const NOW = new Date(2026, 6, 25, 12, 0, 0);
const now = () => NOW;

function statuses(value: HealthKitRawAuthorization): Record<string, HealthKitRawAuthorization> {
  return Object.fromEntries(HEALTHKIT_READ_IDENTIFIERS.map((id) => [id, value]));
}

const GRANTED = statuses('sharingAuthorized');
const DENIED = statuses('sharingDenied');
const NOT_DETERMINED = statuses('notDetermined');

function fakeBridge(overrides: Partial<HealthKitBridge> = {}): HealthKitBridge {
  return {
    isAvailable: () => true,
    getAuthorizationStatus: jest.fn(async () => GRANTED),
    requestAuthorization: jest.fn(async () => GRANTED),
    querySamples: jest.fn(async () => []),
    queryWorkouts: jest.fn(async () => []),
    ...overrides,
  };
}

function workoutSample(
  over: Partial<HealthKitWorkoutSample> = {},
): HealthKitWorkoutSample {
  const startedAt = over.startedAt ?? new Date(2026, 6, 25, 9, 0, 0).toISOString();
  return {
    uuid: over.uuid ?? 'WORKOUT-UUID-1',
    startedAt,
    endedAt: over.endedAt ?? new Date(2026, 6, 25, 9, 30, 0).toISOString(),
    workoutType: over.workoutType ?? 'Running',
    minutes: over.minutes ?? 30,
    calories: over.calories ?? 250,
    ...(over.distanceMeters !== undefined ? { distanceMeters: over.distanceMeters } : {}),
    ...(over.sourceName !== undefined ? { sourceName: over.sourceName } : {}),
  };
}

function sample(over: Partial<HealthKitSample> & Pick<HealthKitSample, 'type'>): HealthKitSample {
  const descriptor = HEALTHKIT_TYPES[over.type];
  const startedAt = over.startedAt ?? new Date(2026, 6, 25, 9, 0, 0).toISOString();
  return {
    type: over.type,
    startedAt,
    endedAt: over.endedAt ?? startedAt,
    value: over.value ?? 1,
    unit: over.unit ?? descriptor.unit,
    sourceName: over.sourceName,
  };
}

function existing(over: Partial<HealthKitExistingEntry>): HealthKitExistingEntry {
  return {
    id: over.id ?? 'he_1',
    date: over.date ?? '2026-07-25',
    entry_type: over.entry_type ?? 'steps',
    source: over.source ?? 'healthkit',
    // `in` rather than `??` so an explicitly-null blob survives to the assertion.
    data: 'data' in over ? (over.data as HealthKitExistingEntry['data']) : JSON.stringify({ steps: 100 }),
    deleted_at: over.deleted_at ?? null,
  };
}

function fakeSink(overrides: Partial<HealthKitImportSink> = {}): HealthKitImportSink {
  return {
    listExisting: jest.fn(async () => []),
    create: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** A service that is genuinely connected, for the import paths. */
function connectedService(config: {
  samples?: readonly HealthKitSample[];
  sink?: HealthKitImportSink;
  bridge?: Partial<HealthKitBridge>;
} = {}) {
  const bridge = fakeBridge({
    querySamples: jest.fn(async ({ type }) =>
      (config.samples ?? []).filter((s) => s.type === type),
    ),
    ...config.bridge,
  });
  const store = createInMemoryHealthKitStore({
    requestedAt: '2026-07-20T00:00:00.000Z',
    lastSyncedAt: null,
  });
  const sink = config.sink ?? fakeSink();
  return { bridge, store, sink, service: createHealthKitService({ bridge, store, sink, now }) };
}

/* ========================== Scope of the request ======================== */

describe('healthKitTypes — the scoped contract', () => {
  it('HEALTH-HK-001: scopes the integration to exactly nine scalar data types', () => {
    expect(HEALTHKIT_DATA_TYPES).toEqual([
      'steps',
      'activeEnergy',
      'sleep',
      'heartRate',
      'bodyMass',
      'dietaryEnergy',
      'dietaryProtein',
      'dietaryCarbs',
      'dietaryFat',
    ]);
    expect(HEALTHKIT_DATA_TYPES).toHaveLength(9);
  });

  it('HEALTH-HK-002: hands iOS the nine scalar identifiers plus the workout sentinel', () => {
    expect(HEALTHKIT_READ_IDENTIFIERS).toEqual([
      'HKQuantityTypeIdentifierStepCount',
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      'HKCategoryTypeIdentifierSleepAnalysis',
      'HKQuantityTypeIdentifierHeartRate',
      'HKQuantityTypeIdentifierBodyMass',
      'HKQuantityTypeIdentifierDietaryEnergyConsumed',
      'HKQuantityTypeIdentifierDietaryProtein',
      'HKQuantityTypeIdentifierDietaryCarbohydrates',
      'HKQuantityTypeIdentifierDietaryFatTotal',
      HEALTHKIT_WORKOUT_IDENTIFIER,
    ]);
  });

  it('HEALTH-HK-003: does not carry over the donor’s broad read set', () => {
    // A representative slice of what HealthKitManager.swift asked for and we do
    // not: distance, flights, stand hours, mindfulness, body composition,
    // resting HR, HRV, SpO2, respiratory rate, VO2 max and dietary water — the
    // scoped set now DOES include the four dietary macros and workouts, so
    // those two moved out of this "still refused" list.
    const donorExtras = [
      'HKQuantityTypeIdentifierDistanceWalkingRunning',
      'HKQuantityTypeIdentifierFlightsClimbed',
      'HKCategoryTypeIdentifierAppleStandHour',
      'HKCategoryTypeIdentifierMindfulSession',
      'HKQuantityTypeIdentifierBasalEnergyBurned',
      'HKQuantityTypeIdentifierAppleExerciseTime',
      'HKQuantityTypeIdentifierBodyFatPercentage',
      'HKQuantityTypeIdentifierLeanBodyMass',
      'HKQuantityTypeIdentifierBodyMassIndex',
      'HKQuantityTypeIdentifierHeight',
      'HKQuantityTypeIdentifierWaistCircumference',
      'HKQuantityTypeIdentifierRestingHeartRate',
      'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
      'HKQuantityTypeIdentifierOxygenSaturation',
      'HKQuantityTypeIdentifierRespiratoryRate',
      'HKQuantityTypeIdentifierVO2Max',
      'HKQuantityTypeIdentifierDietaryWater',
    ];
    for (const identifier of donorExtras) {
      expect(HEALTHKIT_READ_IDENTIFIERS).not.toContain(identifier);
      expect(isScopedIdentifier(identifier)).toBe(false);
    }
  });

  it('HEALTH-HK-004: requests no write access at all — read-only', () => {
    expect(HEALTHKIT_WRITE_IDENTIFIERS).toEqual([]);
    // The bridge contract has no write method, so there is nothing to call.
    expect('saveSample' in nullHealthKitBridge).toBe(false);
    expect(Object.keys(nullHealthKitBridge).sort()).toEqual([
      'getAuthorizationStatus',
      'isAvailable',
      'querySamples',
      'queryWorkouts',
      'requestAuthorization',
    ]);
  });

  it('HEALTH-HK-005: every descriptor carries a user-facing purpose and an icon', () => {
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.purpose.length).toBeGreaterThan(0);
      expect(descriptor.icon.length).toBeGreaterThan(0);
    }
  });

  it('HEALTH-HK-006: routes four types to /health/entries, weight to the weight log, macros to nutrition', () => {
    // Three destinations, not one table with extra entry_types: `HealthEntryType`
    // has no weight member (body mass → /health/weight/entries) and a nutrition
    // diary row is several macros at once (the four dietary types → ONE
    // /health/nutrition/entries row, never four /health/entries rows).
    expect(HEALTHKIT_ENTRY_TYPES).toEqual(['steps', 'activeEnergy', 'sleep', 'heartRate']);
    expect(HEALTHKIT_WEIGHT_TYPES).toEqual(['bodyMass']);
    expect(HEALTHKIT_NUTRITION_TYPES).toEqual([
      'dietaryEnergy',
      'dietaryProtein',
      'dietaryCarbs',
      'dietaryFat',
    ]);
    expect(HEALTHKIT_IMPORTABLE_TYPES).toEqual([...HEALTHKIT_DATA_TYPES]);

    // Body mass is imported, but NOT as an entry — those two fields stay null so
    // `mapSamplesToPayloads` can never emit a weight row into the wrong table.
    expect(HEALTHKIT_TYPES.bodyMass.importsTo).toBe('weight');
    expect(HEALTHKIT_TYPES.bodyMass.entryType).toBeNull();
    expect(HEALTHKIT_TYPES.bodyMass.dataKey).toBeNull();
    // Nothing is read-for-display-only any more, so nothing states a reason.
    expect(
      HEALTHKIT_DESCRIPTORS.filter((descriptor) => descriptor.notImportedReason !== null),
    ).toEqual([]);
  });

  it('HEALTH-HK-009: a descriptor that is not imported must say why, and vice versa', () => {
    // The card renders `notImportedReason ?? purpose`, so the two fields have to
    // stay in lock-step: a type we silently drop with no reason is exactly the
    // kind of unexplained gap the connect card exists to prevent.
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      if (descriptor.importsTo === null) {
        expect(descriptor.notImportedReason).toBeTruthy();
      } else {
        expect(descriptor.notImportedReason).toBeNull();
      }
    }
  });

  it('HEALTH-HK-007: resolves descriptors by identifier and rejects anything unscoped', () => {
    expect(descriptorForIdentifier('HKQuantityTypeIdentifierStepCount')?.type).toBe('steps');
    expect(descriptorForIdentifier('HKQuantityTypeIdentifierVO2Max')).toBeNull();
    expect(isScopedIdentifier('HKQuantityTypeIdentifierHeartRate')).toBe(true);
  });

  it('HEALTH-HK-008: guards a data type without throwing on junk', () => {
    expect(isHealthKitDataType('steps')).toBe(true);
    expect(isHealthKitDataType('vo2Max')).toBe(false);
    expect(isHealthKitDataType(null)).toBe(false);
    expect(isHealthKitDataType(undefined)).toBe(false);
    expect(isHealthKitDataType(7)).toBe(false);
  });
});

/* ============================== Availability ============================ */

describe('availability', () => {
  it('HEALTH-HK-010: reports unavailable with no bridge wired — the state this repo ships in', async () => {
    const service = createHealthKitService();
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'no-bridge',
    });
  });

  it('HEALTH-HK-011: reports unavailable when the device has no Health data', async () => {
    const service = createHealthKitService({ bridge: fakeBridge({ isAvailable: () => false }) });
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'unsupported-device',
    });
  });

  it('HEALTH-HK-012: a throwing bridge degrades to unavailable instead of propagating', async () => {
    const service = createHealthKitService({
      bridge: fakeBridge({
        isAvailable: () => {
          throw new Error('NativeModule HealthKit is null');
        },
      }),
    });
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'bridge-error',
    });
  });

  it('HEALTH-HK-013: a rejecting async bridge is also just unavailable', async () => {
    const service = createHealthKitService({
      bridge: fakeBridge({ isAvailable: async () => Promise.reject(new Error('boom')) }),
    });
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'bridge-error',
    });
  });

  it('HEALTH-HK-014: reports available on a real device', async () => {
    const service = createHealthKitService({ bridge: fakeBridge() });
    await expect(service.checkAvailability()).resolves.toEqual({ available: true, reason: null });
  });

  it('HEALTH-HK-015: an explicit null bridge is the null object, not a crash', async () => {
    const service = createHealthKitService({ bridge: null });
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'no-bridge',
    });
  });
});

/* =========================== Authorisation model ======================== */

describe('authorisation mapping', () => {
  it('HEALTH-HK-020: sharingAuthorized is granted', () => {
    expect(mapRawAuthorization('sharingAuthorized', null)).toBe('granted');
    expect(mapRawAuthorization('sharingAuthorized', '2026-07-20T00:00:00.000Z')).toBe('granted');
  });

  it('HEALTH-HK-021: sharingDenied carries no read signal for a read-only scope — treated like notDetermined', () => {
    // `authorizationStatus(for:)` reports WRITE authorization, which this
    // integration never requests, so iOS answers `sharingDenied` for every one
    // of our five read-only types once the sheet has been shown — regardless
    // of what the member actually chose for READING. Confirmed on-device
    // 2026-07-27 with all five read toggles ON in Settings.
    expect(mapRawAuthorization('sharingDenied', null)).toBe('not-requested');
    expect(mapRawAuthorization('sharingDenied', '2026-07-20T00:00:00.000Z')).toBe('undisclosed');
  });

  it('HEALTH-HK-022: notDetermined before asking is not-requested', () => {
    expect(mapRawAuthorization('notDetermined', null)).toBe('not-requested');
  });

  it('HEALTH-HK-023: notDetermined AFTER asking is undisclosed, never a claimed grant', () => {
    // iOS deliberately hides read grants. Calling this "granted" would be a lie;
    // calling it "denied" would be a different lie.
    expect(mapRawAuthorization('notDetermined', '2026-07-20T00:00:00.000Z')).toBe('undisclosed');
  });

  it('HEALTH-HK-024: a type the bridge omitted is treated like notDetermined', () => {
    expect(mapRawAuthorization(undefined, null)).toBe('not-requested');
    expect(mapRawAuthorization(undefined, '2026-07-20T00:00:00.000Z')).toBe('undisclosed');
  });

  it('HEALTH-HK-025: uniformAuthorization covers every scoped type', () => {
    const map = uniformAuthorization('denied');
    expect(Object.keys(map).sort()).toEqual([...HEALTHKIT_DATA_TYPES].sort());
    expect(Object.values(map).every((v) => v === 'denied')).toBe(true);
  });
});

describe('deriveConnectionState', () => {
  const available = { available: true, reason: null } as const;
  const off = { available: false, reason: 'no-bridge' } as const;

  function map(value: Parameters<typeof uniformAuthorization>[0]): HealthKitAuthorizationMap {
    return uniformAuthorization(value);
  }

  it('HEALTH-HK-030: unavailable beats everything — an un-askable permission is not denied', () => {
    expect(
      deriveConnectionState({
        availability: off,
        perType: map('granted'),
        requestedAt: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe('unavailable');
  });

  it('HEALTH-HK-031: never asked and nothing determined is not-requested', () => {
    expect(
      deriveConnectionState({ availability: available, perType: map('not-requested'), requestedAt: null }),
    ).toBe('not-requested');
  });

  it('HEALTH-HK-032: asked, every type denied, is denied', () => {
    expect(
      deriveConnectionState({
        availability: available,
        perType: map('denied'),
        requestedAt: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe('denied');
  });

  it('HEALTH-HK-033: denied in Settings counts even with no local record of asking', () => {
    expect(
      deriveConnectionState({ availability: available, perType: map('denied'), requestedAt: null }),
    ).toBe('denied');
  });

  it('HEALTH-HK-034: asked, statuses undisclosed, is connected', () => {
    expect(
      deriveConnectionState({
        availability: available,
        perType: map('undisclosed'),
        requestedAt: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe('connected');
  });

  it('HEALTH-HK-035: an explicit grant survives losing the local timestamp (reinstall)', () => {
    expect(
      deriveConnectionState({ availability: available, perType: map('granted'), requestedAt: null }),
    ).toBe('connected');
  });

  it('HEALTH-HK-036: a partial denial is still connected — some types is not none', () => {
    const perType = { ...uniformAuthorization('denied'), steps: 'granted' } as HealthKitAuthorizationMap;
    expect(
      deriveConnectionState({
        availability: available,
        perType,
        requestedAt: '2026-07-20T00:00:00.000Z',
      }),
    ).toBe('connected');
  });
});

/* ================================ getStatus ============================= */

describe('getStatus', () => {
  it('HEALTH-HK-040: unavailable reports every type unavailable and never queries the OS', async () => {
    const bridge = fakeBridge({ isAvailable: () => false });
    const status = await createHealthKitService({ bridge, now }).getStatus();

    expect(status.state).toBe('unavailable');
    expect(Object.values(status.perType).every((v) => v === 'unavailable')).toBe(true);
    expect(bridge.getAuthorizationStatus).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-041: a fresh install is not-requested', async () => {
    const bridge = fakeBridge({ getAuthorizationStatus: jest.fn(async () => NOT_DETERMINED) });
    const status = await createHealthKitService({ bridge, now }).getStatus();

    expect(status.state).toBe('not-requested');
    expect(status.requestedAt).toBeNull();
    expect(status.lastSyncedAt).toBeNull();
  });

  it('HEALTH-HK-042: asks the OS for exactly the scoped identifiers', async () => {
    const bridge = fakeBridge();
    await createHealthKitService({ bridge, now }).getStatus();
    expect(bridge.getAuthorizationStatus).toHaveBeenCalledWith(HEALTHKIT_READ_IDENTIFIERS);
  });

  it('HEALTH-HK-043: a bridge reporting sharingDenied for everything, with no local record of asking, reads as not-requested', async () => {
    // `sharingDenied` is the write-status default iOS reports whether or not
    // this device has ever been asked (see HEALTH-HK-021). Reading it as
    // `denied` here would show a member who has genuinely never been asked a
    // permanent "Apple Health access is off" card with no way back except
    // Settings, for a permission they never touched.
    const bridge = fakeBridge({ getAuthorizationStatus: jest.fn(async () => DENIED) });
    const status = await createHealthKitService({ bridge, now }).getStatus();

    expect(status.state).toBe('not-requested');
    expect(Object.values(status.perType).every((v) => v === 'not-requested')).toBe(true);
  });

  it('HEALTH-HK-044: statuses for types outside our scope are ignored', async () => {
    const bridge = fakeBridge({
      getAuthorizationStatus: jest.fn(async () => ({
        ...NOT_DETERMINED,
        HKQuantityTypeIdentifierVO2Max: 'sharingAuthorized' as const,
        HKQuantityTypeIdentifierDietaryWater: 'sharingAuthorized' as const,
      })),
    });
    const status = await createHealthKitService({ bridge, now }).getStatus();

    // A helpful native module cannot promote us to "connected" on data we never
    // asked for.
    expect(status.state).toBe('not-requested');
    expect(Object.keys(status.perType).sort()).toEqual([...HEALTHKIT_DATA_TYPES].sort());
  });

  it('HEALTH-HK-045: surfaces the persisted last-sync time', async () => {
    const store = createInMemoryHealthKitStore({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: '2026-07-25T08:00:00.000Z',
    });
    const status = await createHealthKitService({ bridge: fakeBridge(), store, now }).getStatus();

    expect(status.state).toBe('connected');
    expect(status.lastSyncedAt).toBe('2026-07-25T08:00:00.000Z');
  });

  it('HEALTH-HK-046: a status probe that throws falls back to what the user last agreed to', async () => {
    const bridge = fakeBridge({
      getAuthorizationStatus: jest.fn(async () => Promise.reject(new Error('xpc error'))),
    });
    const store = createInMemoryHealthKitStore({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: null,
    });
    const status = await createHealthKitService({ bridge, store, now }).getStatus();

    expect(status.state).toBe('connected');
    expect(Object.values(status.perType).every((v) => v === 'undisclosed')).toBe(true);
  });

  it('HEALTH-HK-047: a broken store degrades to empty state rather than throwing', async () => {
    const store = {
      read: jest.fn(async () => Promise.reject(new Error('mmkv gone'))),
      write: jest.fn(async () => undefined),
    };
    const status = await createHealthKitService({
      bridge: fakeBridge({ getAuthorizationStatus: jest.fn(async () => NOT_DETERMINED) }),
      store,
      now,
    }).getStatus();

    expect(status.state).toBe('not-requested');
    expect(status.requestedAt).toBeNull();
  });
});

/* ============================ requestPermission ========================= */

describe('requestPermission', () => {
  it('HEALTH-HK-050: prompts for exactly the scoped identifiers, once', async () => {
    const bridge = fakeBridge();
    await createHealthKitService({ bridge, now }).requestPermission();

    expect(bridge.requestAuthorization).toHaveBeenCalledTimes(1);
    expect(bridge.requestAuthorization).toHaveBeenCalledWith(HEALTHKIT_READ_IDENTIFIERS);
    const [asked] = (bridge.requestAuthorization as jest.Mock).mock.calls[0] as [string[]];
    expect(asked).toHaveLength(HEALTHKIT_READ_IDENTIFIERS.length);
  });

  it('HEALTH-HK-051: records when the sheet was answered', async () => {
    const store = createInMemoryHealthKitStore();
    const status = await createHealthKitService({ bridge: fakeBridge(), store, now }).requestPermission();

    expect(status.requestedAt).toBe(NOW.toISOString());
    await expect(store.read()).resolves.toEqual({
      requestedAt: NOW.toISOString(),
      lastSyncedAt: null,
    });
  });

  it('HEALTH-HK-052: iOS answering sharingDenied after the sheet is NOT a decline — it never discloses read access', async () => {
    // The exact bug this pins: `HKHealthStore.requestAuthorization` returns
    // `sharingDenied` for a read-only request whether the member tapped Allow
    // or Don't Allow (see HEALTH-HK-021), because the API reports WRITE
    // authorization, which this integration never requests. Reading it as a
    // decline showed "Apple Health access is off" to a member who had just
    // said yes to all five toggles. Once the sheet has been answered, the only
    // honest outcome is `connected` — iOS gives us nothing more specific.
    const service = createHealthKitService({
      bridge: fakeBridge({ requestAuthorization: jest.fn(async () => DENIED) }),
      now,
    });
    const status = await service.requestPermission();

    expect(status.state).toBe('connected');
    expect(status.availability.available).toBe(true);
  });

  it('HEALTH-HK-053: never prompts when HealthKit is unavailable, and records nothing', async () => {
    const bridge = fakeBridge({ isAvailable: () => false });
    const store = createInMemoryHealthKitStore();
    const status = await createHealthKitService({ bridge, store, now }).requestPermission();

    expect(status.state).toBe('unavailable');
    expect(bridge.requestAuthorization).not.toHaveBeenCalled();
    await expect(store.read()).resolves.toEqual(EMPTY_HEALTHKIT_STATE);
  });

  it('HEALTH-HK-054: a prompt that fails leaves the user able to try again', async () => {
    const store = createInMemoryHealthKitStore();
    const status = await createHealthKitService({
      bridge: fakeBridge({
        requestAuthorization: jest.fn(async () => Promise.reject(new Error('sheet failed'))),
      }),
      store,
      now,
    }).requestPermission();

    expect(status.state).toBe('not-requested');
    // Nothing recorded, so the Connect action stays available.
    await expect(store.read()).resolves.toEqual(EMPTY_HEALTHKIT_STATE);
  });

  it('HEALTH-HK-055: an answered sheet with undisclosed reads is connected', async () => {
    const status = await createHealthKitService({
      bridge: fakeBridge({ requestAuthorization: jest.fn(async () => NOT_DETERMINED) }),
      now,
    }).requestPermission();

    expect(status.state).toBe('connected');
    expect(Object.values(status.perType).every((v) => v === 'undisclosed')).toBe(true);
  });

  it('HEALTH-HK-056: the default service prompts for nothing and stays unavailable', async () => {
    const status = await createHealthKitService().requestPermission();
    expect(status.state).toBe('unavailable');
  });

  it('HEALTH-HK-057: a store that cannot persist still returns a usable status', async () => {
    const store = {
      read: jest.fn(async () => EMPTY_HEALTHKIT_STATE),
      write: jest.fn(async () => Promise.reject(new Error('disk full'))),
    };
    const status = await createHealthKitService({ bridge: fakeBridge(), store, now }).requestPermission();
    expect(status.state).toBe('connected');
  });
});

/* =============================== Windowing ============================== */

describe('windowing', () => {
  it('HEALTH-HK-060: defaults to seven whole days ending now (donor parity)', () => {
    const window = healthKitWindow(undefined, NOW);
    expect(HEALTHKIT_DEFAULT_WINDOW_DAYS).toBe(7);
    expect(window.end).toBe(NOW.toISOString());
    // 7 days INCLUDING today → starts at local midnight six days back.
    expect(new Date(window.start)).toEqual(new Date(2026, 6, 19, 0, 0, 0, 0));
  });

  it('HEALTH-HK-061: starts at local midnight so a whole day is never half-read', () => {
    const start = new Date(healthKitWindow(3, NOW).start);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('HEALTH-HK-062: clamps to a 30-day ceiling — a first connect never vacuums history', () => {
    expect(HEALTHKIT_MAX_WINDOW_DAYS).toBe(30);
    const huge = healthKitWindow(3650, NOW);
    const capped = healthKitWindow(30, NOW);
    expect(huge.start).toBe(capped.start);
  });

  it('HEALTH-HK-063: clamps zero and negatives up to a single day', () => {
    const oneDay = healthKitWindow(1, NOW).start;
    expect(healthKitWindow(0, NOW).start).toBe(oneDay);
    expect(healthKitWindow(-5, NOW).start).toBe(oneDay);
  });

  it('HEALTH-HK-064: a non-finite window falls back to the default', () => {
    const fallback = healthKitWindow(HEALTHKIT_DEFAULT_WINDOW_DAYS, NOW).start;
    expect(healthKitWindow(Number.NaN, NOW).start).toBe(fallback);
    expect(healthKitWindow(Number.POSITIVE_INFINITY, NOW).start).toBe(fallback);
  });

  it('HEALTH-HK-065: fractional days floor rather than producing a partial day', () => {
    expect(healthKitWindow(3.9, NOW).start).toBe(healthKitWindow(3, NOW).start);
  });

  it('HEALTH-HK-066: window membership is start-inclusive and end-exclusive', () => {
    const window = healthKitWindow(2, NOW);
    const atStart = sample({ type: 'steps', startedAt: window.start, value: 1 });
    const atEnd = sample({ type: 'steps', startedAt: window.end, value: 1 });
    const before = sample({ type: 'steps', startedAt: new Date(2026, 6, 1).toISOString(), value: 1 });

    expect(isSampleInWindow(atStart, window)).toBe(true);
    expect(isSampleInWindow(atEnd, window)).toBe(false);
    expect(isSampleInWindow(before, window)).toBe(false);
  });

  it('HEALTH-HK-067: an unparseable timestamp is out of every window', () => {
    const window = healthKitWindow(7, NOW);
    expect(isSampleInWindow(sample({ type: 'steps', startedAt: 'not-a-date' }), window)).toBe(false);
  });

  it('HEALTH-HK-068: day keys are local — a 23:30 sample belongs to that evening', () => {
    expect(localDayKey(new Date(2026, 6, 25, 23, 30, 0))).toBe('2026-07-25');
    expect(localDayKey(new Date(2026, 0, 5, 0, 1, 0))).toBe('2026-01-05');
    expect(localDayKey('not-a-date')).toBeNull();
  });
});

/* ============================ readWindow (reads) ======================== */

describe('readWindow', () => {
  it('HEALTH-HK-070: returns nothing and throws nothing with no bridge', async () => {
    await expect(createHealthKitService().readWindow('steps')).resolves.toEqual([]);
  });

  it('HEALTH-HK-071: does not query the OS when genuinely unavailable', async () => {
    const bridge = fakeBridge({ isAvailable: () => false });
    const service = createHealthKitService({ bridge, now });

    await expect(service.readWindow('steps')).resolves.toEqual([]);
    expect(bridge.querySamples).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-072: a bridge reporting sharingDenied for a type does not block reading it — that string carries no read signal (see HEALTH-HK-021)', async () => {
    const bridge = fakeBridge({
      getAuthorizationStatus: jest.fn(async () => ({
        ...GRANTED,
        HKQuantityTypeIdentifierHeartRate: 'sharingDenied' as const,
      })),
      querySamples: jest.fn(async ({ type }) => [sample({ type, value: 5 })]),
    });
    const service = createHealthKitService({ bridge, now });

    await expect(service.readWindow('heartRate')).resolves.toHaveLength(1);
    await expect(service.readWindow('steps')).resolves.toHaveLength(1);
  });

  it('HEALTH-HK-073: passes the requested window straight through to the bridge', async () => {
    const bridge = fakeBridge();
    const service = createHealthKitService({ bridge, now });
    const window = healthKitWindow(3, NOW);

    await service.readWindow('steps', window);
    expect(bridge.querySamples).toHaveBeenCalledWith({
      type: 'steps',
      start: window.start,
      end: window.end,
    });
  });

  it('HEALTH-HK-074: drops samples the bridge returned outside the window', async () => {
    const window = healthKitWindow(2, NOW);
    const bridge = fakeBridge({
      querySamples: jest.fn(async () => [
        sample({ type: 'steps', startedAt: new Date(2026, 0, 1).toISOString(), value: 900 }),
        sample({ type: 'steps', startedAt: new Date(2026, 6, 25, 11, 0, 0).toISOString(), value: 100 }),
      ]),
    });

    const read = await createHealthKitService({ bridge, now }).readWindow('steps', window);
    expect(read).toHaveLength(1);
    expect(read[0].value).toBe(100);
  });

  it('HEALTH-HK-075: drops samples of a type we did not ask for', async () => {
    const bridge = fakeBridge({
      querySamples: jest.fn(async () => [
        sample({ type: 'steps', value: 10 }),
        sample({ type: 'heartRate', value: 60 }),
      ]),
    });
    const read = await createHealthKitService({ bridge, now }).readWindow('steps');
    expect(read.map((s) => s.type)).toEqual(['steps']);
  });

  it('HEALTH-HK-076: drops a sample whose unit was not normalised', async () => {
    // 70 lb read as 70 kg would silently corrupt a weight log; refusing is the
    // only safe answer.
    const bridge = fakeBridge({
      querySamples: jest.fn(async () => [{ ...sample({ type: 'bodyMass', value: 70 }), unit: 'count' as const }]),
    });
    await expect(createHealthKitService({ bridge, now }).readWindow('bodyMass')).resolves.toEqual([]);
  });

  it('HEALTH-HK-077: a query that throws yields an empty read, not an exception', async () => {
    const bridge = fakeBridge({
      querySamples: jest.fn(async () => Promise.reject(new Error('HKErrorDomain 6'))),
    });
    await expect(createHealthKitService({ bridge, now }).readWindow('steps')).resolves.toEqual([]);
  });
});

/* ========================= Sample → payload mapping ===================== */

describe('mapSamplesToPayloads', () => {
  const morning = new Date(2026, 6, 25, 8, 0, 0).toISOString();
  const evening = new Date(2026, 6, 25, 22, 0, 0).toISOString();
  const yesterday = new Date(2026, 6, 24, 10, 0, 0).toISOString();

  it('HEALTH-HK-080: sums steps into one row per day', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'steps', startedAt: morning, value: 1200 }),
      sample({ type: 'steps', startedAt: evening, value: 3400 }),
    ]);

    expect(payloads).toEqual([
      { date: '2026-07-25', entry_type: 'steps', data: { steps: 4600 }, source: 'healthkit' },
    ]);
  });

  it('HEALTH-HK-081: tags every payload as healthkit so the server keeps it apart', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'steps', value: 1 }),
      sample({ type: 'heartRate', value: 60 }),
    ]);
    expect(payloads.every((p) => p.source === 'healthkit')).toBe(true);
  });

  it('HEALTH-HK-082: sums active energy into the calories key', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'activeEnergy', startedAt: morning, value: 120.4 }),
      sample({ type: 'activeEnergy', startedAt: evening, value: 300.2 }),
    ]);
    expect(payloads[0]).toEqual({
      date: '2026-07-25',
      entry_type: 'active_energy',
      data: { calories: 421 },
      source: 'healthkit',
    });
  });

  it('HEALTH-HK-083: sums sleep segments into total minutes for the night', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'sleep', startedAt: evening, value: 210 }),
      sample({ type: 'sleep', startedAt: evening, value: 165 }),
    ]);
    expect(payloads[0].data).toEqual({ minutes: 375 });
  });

  it('HEALTH-HK-084: AVERAGES heart rate rather than summing it', () => {
    // Summing 800 heart-rate samples would produce a number that looks like a
    // medical emergency. The descriptor's aggregation is what prevents it.
    const payloads = mapSamplesToPayloads([
      sample({ type: 'heartRate', startedAt: morning, value: 58 }),
      sample({ type: 'heartRate', startedAt: morning, value: 62 }),
      sample({ type: 'heartRate', startedAt: evening, value: 75 }),
    ]);
    expect(payloads[0].data).toEqual({ bpm: 65 });
  });

  it('HEALTH-HK-085: weight produces no payload — read for display, never posted', () => {
    expect(mapSamplesToPayloads([sample({ type: 'bodyMass', value: 82.4 })])).toEqual([]);
  });

  it('HEALTH-HK-086: collapses hundreds of samples into exactly one row per day and type', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      sample({ type: 'steps', startedAt: new Date(2026, 6, 25, i % 24, 0, 0).toISOString(), value: 10 }),
    );
    const payloads = mapSamplesToPayloads(many);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].data).toEqual({ steps: 4000 });
  });

  it('HEALTH-HK-087: keeps days apart', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'steps', startedAt: yesterday, value: 500 }),
      sample({ type: 'steps', startedAt: morning, value: 900 }),
    ]);
    expect(payloads.map((p) => [p.date, p.data])).toEqual([
      ['2026-07-24', { steps: 500 }],
      ['2026-07-25', { steps: 900 }],
    ]);
  });

  it('HEALTH-HK-088: buckets by LOCAL day, so a late-night sample stays on its own evening', () => {
    const lateNight = new Date(2026, 6, 25, 23, 45, 0).toISOString();
    expect(mapSamplesToPayloads([sample({ type: 'steps', startedAt: lateNight, value: 12 })])[0].date).toBe(
      '2026-07-25',
    );
  });

  it('HEALTH-HK-089: drops malformed samples without taking the import down', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'steps', startedAt: 'nonsense', value: 10 }),
      { ...sample({ type: 'steps', value: 10 }), value: Number.NaN },
      { ...sample({ type: 'steps', value: 10 }), value: Number.POSITIVE_INFINITY },
      sample({ type: 'steps', value: -50 }),
      { ...sample({ type: 'steps', value: 10 }), unit: 'kg' as const },
      sample({ type: 'steps', value: 777 }),
    ]);
    expect(payloads).toEqual([
      { date: '2026-07-25', entry_type: 'steps', data: { steps: 777 }, source: 'healthkit' },
    ]);
  });

  it('HEALTH-HK-090: an empty read produces an empty import', () => {
    expect(mapSamplesToPayloads([])).toEqual([]);
  });

  it('HEALTH-HK-091: output is stable — oldest day first, then card order', () => {
    const payloads = mapSamplesToPayloads([
      sample({ type: 'heartRate', startedAt: morning, value: 60 }),
      sample({ type: 'steps', startedAt: morning, value: 10 }),
      sample({ type: 'sleep', startedAt: yesterday, value: 400 }),
      sample({ type: 'activeEnergy', startedAt: morning, value: 200 }),
    ]);
    expect(payloads.map((p) => `${p.date}/${p.entry_type}`)).toEqual([
      '2026-07-24/sleep',
      '2026-07-25/steps',
      '2026-07-25/active_energy',
      '2026-07-25/heart_rate',
    ]);
  });
});

/* ============================== Import plan ============================= */

describe('planImport', () => {
  const steps = (date: string, value: number): HealthKitEntryPayload => ({
    date,
    entry_type: 'steps',
    data: { steps: value },
    source: 'healthkit',
  });

  it('HEALTH-HK-100: creates every day when the server holds nothing', () => {
    const plan = planImport([steps('2026-07-24', 100), steps('2026-07-25', 200)], []);
    expect(plan.create).toHaveLength(2);
    expect(plan.supersede).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('HEALTH-HK-101: NEVER overwrites a day the user typed', () => {
    const plan = planImport(
      [steps('2026-07-25', 9000)],
      [existing({ id: 'he_manual', source: 'manual', data: JSON.stringify({ steps: 42 }) })],
    );

    expect(plan.create).toEqual([]);
    expect(plan.supersede).toEqual([]);
    expect(plan.skipped).toEqual([
      { date: '2026-07-25', entry_type: 'steps', reason: 'manual-entry-exists' },
    ]);
  });

  it('HEALTH-HK-102: a manual row wins even when a HealthKit row sits beside it', () => {
    const plan = planImport(
      [steps('2026-07-25', 9000)],
      [
        existing({ id: 'he_hk', source: 'healthkit', data: JSON.stringify({ steps: 1 }) }),
        existing({ id: 'he_manual', source: 'manual', data: JSON.stringify({ steps: 42 }) }),
      ],
    );
    expect(plan.create).toEqual([]);
    expect(plan.supersede).toEqual([]);
    expect(plan.skipped[0].reason).toBe('manual-entry-exists');
  });

  it('HEALTH-HK-103: skips a day already imported with the same figure — re-import cannot stack', () => {
    const plan = planImport(
      [steps('2026-07-25', 100)],
      [existing({ data: JSON.stringify({ steps: 100 }) })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ date: '2026-07-25', entry_type: 'steps', reason: 'unchanged' }]);
  });

  it('HEALTH-HK-104: replaces a stale HealthKit figure instead of adding a second row', () => {
    const plan = planImport(
      [steps('2026-07-25', 500)],
      [existing({ id: 'he_old', data: JSON.stringify({ steps: 100 }) })],
    );
    expect(plan.create).toEqual([steps('2026-07-25', 500)]);
    expect(plan.supersede).toEqual(['he_old']);
    expect(plan.skipped).toEqual([]);
  });

  it('HEALTH-HK-105: ignores soft-deleted rows so a deleted day can be re-imported', () => {
    const plan = planImport(
      [steps('2026-07-25', 100)],
      [existing({ data: JSON.stringify({ steps: 100 }), deleted_at: '2026-07-25T10:00:00.000Z' })],
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.supersede).toEqual([]);
  });

  it('HEALTH-HK-106: a deleted MANUAL row no longer blocks the day', () => {
    const plan = planImport(
      [steps('2026-07-25', 100)],
      [existing({ source: 'manual', deleted_at: '2026-07-25T10:00:00.000Z' })],
    );
    expect(plan.create).toHaveLength(1);
  });

  it('HEALTH-HK-107: reads an already-parsed data object as well as a JSON string', () => {
    const plan = planImport([steps('2026-07-25', 100)], [existing({ data: { steps: 100 } })]);
    expect(plan.skipped[0].reason).toBe('unchanged');
  });

  it('HEALTH-HK-108: an unreadable data blob is replaced rather than blocking the day forever', () => {
    const plan = planImport([steps('2026-07-25', 100)], [existing({ id: 'he_bad', data: '{oops' })]);
    expect(plan.create).toHaveLength(1);
    expect(plan.supersede).toEqual(['he_bad']);
  });

  it('HEALTH-HK-109: a null data blob is treated as different, not as a match', () => {
    const plan = planImport([steps('2026-07-25', 100)], [existing({ id: 'he_null', data: null })]);
    expect(plan.create).toHaveLength(1);
    expect(plan.supersede).toEqual(['he_null']);
  });

  it('HEALTH-HK-110: entries of another type on the same day do not block the import', () => {
    const plan = planImport(
      [steps('2026-07-25', 100)],
      [existing({ entry_type: 'sleep', source: 'manual', data: JSON.stringify({ minutes: 400 }) })],
    );
    expect(plan.create).toHaveLength(1);
  });

  it('HEALTH-HK-111: entries on another day do not block the import', () => {
    const plan = planImport(
      [steps('2026-07-25', 100)],
      [existing({ date: '2026-07-24', source: 'manual' })],
    );
    expect(plan.create).toHaveLength(1);
  });

  it('HEALTH-HK-112: duplicate payloads for one day collapse to a single create', () => {
    const plan = planImport([steps('2026-07-25', 100), steps('2026-07-25', 999)], []);
    expect(plan.create).toEqual([steps('2026-07-25', 100)]);
  });

  it('HEALTH-HK-113: planning is idempotent — planning the result of an import creates nothing', () => {
    const payloads = [steps('2026-07-25', 100)];
    const first = planImport(payloads, []);
    const afterImport = first.create.map((payload, index) =>
      existing({ id: `he_${index}`, date: payload.date, data: payload.data }),
    );
    expect(planImport(payloads, afterImport).create).toEqual([]);
  });
});

/* =============================== importNow ============================== */

describe('importNow', () => {
  it('HEALTH-HK-120: does nothing at all when HealthKit is unavailable', async () => {
    const sink = fakeSink();
    const result = await createHealthKitService({ sink, now }).importNow();

    expect(result).toEqual({
      state: 'unavailable',
      imported: 0,
      superseded: 0,
      skipped: [],
      failed: 0,
      weightImported: 0,
      weightSuperseded: 0,
      weightSkipped: [],
      weightFailed: 0,
      workoutImported: 0,
      workoutSkipped: 0,
      workoutFailed: 0,
      nutritionImported: 0,
      nutritionSuperseded: 0,
      nutritionSkipped: 0,
      nutritionFailed: 0,
      samplesRead: 0,
      syncedAt: null,
    });
    expect(sink.listExisting).not.toHaveBeenCalled();
    expect(sink.create).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-121: does nothing when the bridge has no local record of asking, and reports not-requested', async () => {
    const sink = fakeSink();
    const result = await createHealthKitService({
      bridge: fakeBridge({ getAuthorizationStatus: jest.fn(async () => DENIED) }),
      sink,
      now,
    }).importNow();

    expect(result.state).toBe('not-requested');
    expect(result.imported).toBe(0);
    expect(sink.create).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-122: imports a day as a source-tagged /health/entries row', async () => {
    const { service, sink } = connectedService({
      samples: [sample({ type: 'steps', value: 8240 })],
    });
    const result = await service.importNow();

    expect(sink.create).toHaveBeenCalledTimes(1);
    expect(sink.create).toHaveBeenCalledWith({
      date: '2026-07-25',
      entry_type: 'steps',
      data: { steps: 8240 },
      source: 'healthkit',
    });
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });

  it('HEALTH-HK-123: reads all five scoped types and imports the four that map', async () => {
    const { service, sink, bridge } = connectedService({
      samples: [
        sample({ type: 'steps', value: 100 }),
        sample({ type: 'activeEnergy', value: 200 }),
        sample({ type: 'sleep', value: 400 }),
        sample({ type: 'heartRate', value: 60 }),
        sample({ type: 'bodyMass', value: 80 }),
      ],
    });
    const result = await service.importNow();

    // Each type is read twice — once per historical chunk (last month, this
    // month) — before the next type starts.
    expect((bridge.querySamples as jest.Mock).mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(
      HEALTHKIT_DATA_TYPES.flatMap((type) => [type, type]),
    );
    expect(result.samplesRead).toBe(5);
    expect(result.imported).toBe(4);
    expect((sink.create as jest.Mock).mock.calls.map((c) => (c[0] as HealthKitEntryPayload).entry_type)).toEqual([
      'steps',
      'active_energy',
      'sleep',
      'heart_rate',
    ]);
  });

  it('HEALTH-HK-124: a second import right after the first writes nothing', async () => {
    const rows: HealthKitExistingEntry[] = [];
    const sink = fakeSink({
      listExisting: jest.fn(async () => rows),
      create: jest.fn(async (payload: HealthKitEntryPayload) => {
        rows.push(existing({ id: `he_${rows.length}`, date: payload.date, entry_type: payload.entry_type, data: payload.data }));
      }),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });

    const first = await service.importNow();
    const second = await service.importNow();

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toEqual([
      { date: '2026-07-25', entry_type: 'steps', reason: 'unchanged' },
    ]);
    expect(rows).toHaveLength(1);
  });

  it('HEALTH-HK-125: leaves a manually logged day exactly as the user left it', async () => {
    const sink = fakeSink({
      listExisting: jest.fn(async () => [
        existing({ id: 'he_manual', source: 'manual', data: JSON.stringify({ steps: 42 }) }),
      ]),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });
    const result = await service.importNow();

    expect(sink.create).not.toHaveBeenCalled();
    expect(sink.remove).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([
      { date: '2026-07-25', entry_type: 'steps', reason: 'manual-entry-exists' },
    ]);
  });

  it('HEALTH-HK-126: retires the superseded row before writing the corrected one', async () => {
    const order: string[] = [];
    const sink = fakeSink({
      listExisting: jest.fn(async () => [existing({ id: 'he_old', data: JSON.stringify({ steps: 10 }) })]),
      remove: jest.fn(async (id: string) => {
        order.push(`remove:${id}`);
      }),
      create: jest.fn(async () => {
        order.push('create');
      }),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });
    const result = await service.importNow();

    expect(order).toEqual(['remove:he_old', 'create']);
    expect(result.superseded).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('HEALTH-HK-127: imports nothing when the server baseline cannot be read', async () => {
    // Without knowing what is already there we cannot tell a duplicate from a
    // new day, and importing blind is exactly how rows stack.
    const sink = fakeSink({
      listExisting: jest.fn(async () => Promise.reject(new Error('offline'))),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });
    const result = await service.importNow();

    expect(sink.create).not.toHaveBeenCalled();
    expect(result.imported).toBe(0);
    expect(result.samplesRead).toBe(1);
    expect(result.syncedAt).toBeNull();
  });

  it('HEALTH-HK-128: a rejected write is counted, never thrown, and never a raw error', async () => {
    const sink = fakeSink({
      create: jest.fn(async () => Promise.reject(new Error('500 upstream'))),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });
    const result = await service.importNow();

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    expect(JSON.stringify(result)).not.toContain('500 upstream');
  });

  it('HEALTH-HK-129: one bad write does not abandon the rest of the import', async () => {
    let call = 0;
    const sink = fakeSink({
      create: jest.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('nope');
      }),
    });
    const { service } = connectedService({
      samples: [sample({ type: 'steps', value: 100 }), sample({ type: 'sleep', value: 400 })],
      sink,
    });
    const result = await service.importNow();

    expect(result.failed).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('HEALTH-HK-130: an empty read still records a successful sync', async () => {
    const { service, store } = connectedService({ samples: [] });
    const result = await service.importNow();

    expect(result.imported).toBe(0);
    expect(result.samplesRead).toBe(0);
    expect(result.syncedAt).toBe(NOW.toISOString());
    await expect(store.read()).resolves.toMatchObject({ lastSyncedAt: NOW.toISOString() });
  });

  it('HEALTH-HK-131: records the last sync time so the card can show it', async () => {
    const { service, store } = connectedService({ samples: [sample({ type: 'steps', value: 10 })] });
    await service.importNow();
    await expect(store.read()).resolves.toEqual({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: NOW.toISOString(),
    });
  });

  it('HEALTH-HK-132: clamps the requested window before it reaches the OS', async () => {
    const { service, bridge } = connectedService({ samples: [] });
    await service.importNow({ days: 3650 });

    const capped = healthKitWindow(HEALTHKIT_MAX_WINDOW_DAYS, NOW);
    const [query] = (bridge.querySamples as jest.Mock).mock.calls[0] as [{ start: string }];
    expect(query.start).toBe(capped.start);
  });

  it('HEALTH-HK-133: reads last calendar month then this month to date when no window is asked for', async () => {
    const { service, bridge } = connectedService({ samples: [] });
    await service.importNow();

    const [previousMonth, thisMonth] = healthKitHistoricalWindows(NOW);
    const calls = (bridge.querySamples as jest.Mock).mock.calls as [
      { type: HealthKitDataType; start: string; end: string },
    ][];
    // Per type: last month's chunk, then this month's — in that order.
    expect(calls).toEqual(
      HEALTHKIT_DATA_TYPES.flatMap((type) => [
        [{ type, start: previousMonth.window.start, end: previousMonth.window.end }],
        [{ type, start: thisMonth.window.start, end: thisMonth.window.end }],
      ]),
    );
  });
});

describe('healthKitHistoricalWindows — the two-month backfill', () => {
  it('HEALTH-HK-200: covers the whole of last calendar month, then this month to date', () => {
    const [previousMonth, thisMonth] = healthKitHistoricalWindows(NOW);

    expect(new Date(previousMonth.window.start)).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0));
    expect(new Date(previousMonth.window.end)).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(new Date(thisMonth.window.start)).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(thisMonth.window.end).toBe(NOW.toISOString());
  });

  it('HEALTH-HK-201: never spans more than roughly two calendar months', () => {
    const [previousMonth, thisMonth] = healthKitHistoricalWindows(NOW);
    const totalDays =
      (new Date(thisMonth.window.end).getTime() - new Date(previousMonth.window.start).getTime()) / 86_400_000;
    expect(totalDays).toBeLessThanOrEqual(62);
  });

  it('HEALTH-HK-202: labels each chunk with its calendar month name', () => {
    const [previousMonth, thisMonth] = healthKitHistoricalWindows(NOW);
    expect(previousMonth.label).toBe('June');
    expect(thisMonth.label).toBe('July');
  });
});

describe('importNow — progress reporting', () => {
  it('HEALTH-HK-210: reports each area moving pending → reading → done, then a final done stage', async () => {
    const { service } = connectedService({
      samples: [sample({ type: 'steps', value: 100 }), sample({ type: 'bodyMass', value: 80 })],
      sink: fullSink(),
    });
    const events: HealthKitSyncProgress[] = [];
    await service.importNow({ onProgress: (progress) => events.push(progress) });

    expect(events[0].stage).toBe('reading');
    expect(events[0].areas.every((area) => area.status === 'pending')).toBe(true);
    expect(events[0].totalAreas).toBe(HEALTHKIT_DATA_TYPES.length);

    const savingEvent = events.find((event) => event.stage === 'saving');
    expect(savingEvent).toBeDefined();
    expect(savingEvent!.areas.every((area) => area.status === 'done')).toBe(true);
    expect(savingEvent!.completedAreas).toBe(HEALTHKIT_DATA_TYPES.length);
    expect(savingEvent!.result).toBeNull();

    const doneEvent = events[events.length - 1];
    expect(doneEvent.stage).toBe('done');
    expect(doneEvent.result).toMatchObject({ imported: 1, weightImported: 1, samplesRead: 2 });
  });

  it('HEALTH-HK-211: sums an area’s samples across both historical chunks', async () => {
    const { service } = connectedService({
      samples: [
        sample({ type: 'steps', value: 100 }),
        sample({ type: 'steps', value: 200, startedAt: new Date(2026, 6, 24, 8, 0, 0).toISOString() }),
      ],
    });
    const events: HealthKitSyncProgress[] = [];
    await service.importNow({ onProgress: (progress) => events.push(progress) });

    const stepsDone = events.find(
      (event) => event.areas.find((area) => area.type === 'steps')?.status === 'done',
    );
    expect(stepsDone!.areas.find((area) => area.type === 'steps')?.samplesRead).toBe(2);
  });

  it('HEALTH-HK-212: an explicit `days` override still reports progress over one chunk', async () => {
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 100 })] });
    const events: HealthKitSyncProgress[] = [];
    await service.importNow({ days: 3, onProgress: (progress) => events.push(progress) });

    const doneEvent = events[events.length - 1];
    expect(doneEvent.result?.samplesRead).toBe(1);
  });
});

/* ============================= Weight import ============================ */

/** A sink that implements every track — entries, weight, workout, nutrition. */
function fullSink(overrides: Partial<HealthKitImportSink> = {}): HealthKitImportSink {
  return {
    listExisting: jest.fn(async () => []),
    create: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    listExistingWeight: jest.fn(async () => []),
    createWeight: jest.fn(async () => undefined),
    removeWeight: jest.fn(async () => undefined),
    createWorkout: jest.fn(async () => undefined),
    listExistingNutrition: jest.fn(async () => []),
    createNutrition: jest.fn(async () => undefined),
    removeNutrition: jest.fn(async () => undefined),
    ...overrides,
  };
}

function nutritionRow(over: Partial<HealthKitExistingNutrition> = {}): HealthKitExistingNutrition {
  return {
    id: over.id ?? 'n_1',
    date: over.date ?? '2026-07-25',
    food_name: over.food_name ?? 'Apple Health',
    calories: over.calories ?? 1800,
    proteins: over.proteins ?? 90,
    carbohydrates: over.carbohydrates ?? 200,
    fats: over.fats ?? 60,
    source: 'source' in over ? over.source : 'healthkit',
    deleted_at: over.deleted_at ?? null,
  };
}

function weightRow(over: Partial<HealthKitExistingWeight> = {}): HealthKitExistingWeight {
  return {
    id: over.id ?? 'w_1',
    date: over.date ?? '2026-07-25',
    weight: over.weight ?? 82.4,
    unit: over.unit ?? 'kg',
    // `in` rather than `??` so an explicitly-absent origin survives to the assertion.
    source: 'source' in over ? over.source : 'healthkit',
    deleted_at: over.deleted_at ?? null,
  };
}

describe('body mass → the weight log', () => {
  it('HEALTH-HK-150: converts kilograms into the unit the log is kept in', () => {
    expect(convertKilograms(82.4, 'kg')).toBe(82.4);
    expect(convertKilograms(82.4, 'lb')).toBe(181.7);
    // Exact by definition, so this is a real check and not a tolerance.
    expect(convertKilograms(KILOGRAMS_PER_POUND, 'lb')).toBe(1);
  });

  it('HEALTH-HK-151: rounds to one decimal, the precision a scale actually reports', () => {
    expect(convertKilograms(82.44444, 'kg')).toBe(82.4);
    expect(convertKilograms(82.45, 'kg')).toBe(82.5);
  });

  it('HEALTH-HK-152: collapses a day to ONE reading, the latest of them', () => {
    const morning = new Date(2026, 6, 25, 7, 0, 0).toISOString();
    const evening = new Date(2026, 6, 25, 21, 0, 0).toISOString();

    expect(
      mapSamplesToWeightPayloads([
        sample({ type: 'bodyMass', value: 82.9, startedAt: morning }),
        sample({ type: 'bodyMass', value: 82.4, startedAt: evening }),
      ]),
    ).toEqual([{ date: '2026-07-25', weight: 82.4, unit: 'kg', source: 'healthkit' }]);
  });

  it('HEALTH-HK-153: tags every row as an Apple Health reading, never as a typed one', () => {
    for (const payload of mapSamplesToWeightPayloads([sample({ type: 'bodyMass', value: 80 })])) {
      expect(payload.source).toBe('healthkit');
    }
  });

  it('HEALTH-HK-154: imports weight in pounds when that is what the member uses', () => {
    expect(mapSamplesToWeightPayloads([sample({ type: 'bodyMass', value: 82.4 })], 'lb')).toEqual([
      { date: '2026-07-25', weight: 181.7, unit: 'lb', source: 'healthkit' },
    ]);
  });

  it('HEALTH-HK-155: ignores everything that is not body mass', () => {
    expect(
      mapSamplesToWeightPayloads([
        sample({ type: 'steps', value: 8000 }),
        sample({ type: 'heartRate', value: 62 }),
      ]),
    ).toEqual([]);
  });

  it('HEALTH-HK-156: drops a reading the bridge failed to normalise', () => {
    expect(
      mapSamplesToWeightPayloads([
        { ...sample({ type: 'bodyMass', value: 180 }), unit: 'count' as never },
      ]),
    ).toEqual([]);
    expect(mapSamplesToWeightPayloads([sample({ type: 'bodyMass', value: 0 })])).toEqual([]);
  });

  it('HEALTH-HK-157: orders oldest-first, so an import is byte-identical run to run', () => {
    const dates = mapSamplesToWeightPayloads([
      sample({ type: 'bodyMass', value: 80, startedAt: new Date(2026, 6, 25, 8).toISOString() }),
      sample({ type: 'bodyMass', value: 81, startedAt: new Date(2026, 6, 23, 8).toISOString() }),
      sample({ type: 'bodyMass', value: 82, startedAt: new Date(2026, 6, 24, 8).toISOString() }),
    ]).map((payload) => payload.date);

    expect(dates).toEqual(['2026-07-23', '2026-07-24', '2026-07-25']);
  });
});

describe('planWeightImport — the weight log’s de-duplication', () => {
  const payload = { date: '2026-07-25', weight: 82.4, unit: 'kg', source: 'healthkit' } as const;

  it('HEALTH-HK-160: never touches a day the member weighed themselves in by hand', () => {
    const plan = planWeightImport([payload], [weightRow({ source: 'manual', weight: 79 })]);

    expect(plan.create).toEqual([]);
    expect(plan.supersede).toEqual([]);
    expect(plan.skipped).toEqual([{ date: '2026-07-25', reason: 'manual-entry-exists' }]);
  });

  it('HEALTH-HK-161: treats a row with no recorded origin as typed — every pre-0122 row is', () => {
    // `weight_entries.source` arrived in 0122. Before it, no import path existed, so
    // an origin-less row was necessarily typed; reading it as ours would let a sync
    // overwrite a number the member entered.
    expect(planWeightImport([payload], [weightRow({ source: undefined })]).skipped).toEqual([
      { date: '2026-07-25', reason: 'manual-entry-exists' },
    ]);
    expect(planWeightImport([payload], [weightRow({ source: null })]).skipped).toEqual([
      { date: '2026-07-25', reason: 'manual-entry-exists' },
    ]);
  });

  it('HEALTH-HK-162: skips a HealthKit row that already reads the same', () => {
    const plan = planWeightImport([payload], [weightRow({ weight: 82.4, unit: 'kg' })]);

    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ date: '2026-07-25', reason: 'unchanged' }]);
  });

  it('HEALTH-HK-163: replaces a HealthKit row whose figure has changed', () => {
    const plan = planWeightImport([payload], [weightRow({ id: 'w_old', weight: 83.1 })]);

    expect(plan.supersede).toEqual(['w_old']);
    expect(plan.create).toEqual([payload]);
    expect(plan.skipped).toEqual([]);
  });

  it('HEALTH-HK-164: replaces a row stored in a different unit rather than comparing across', () => {
    // 181.7 lb IS 82.4 kg, but the log renders the stored unit and `weightDelta()`
    // refuses to compare across units — so the row has to be restated, not matched.
    const plan = planWeightImport([payload], [weightRow({ id: 'w_lb', weight: 181.7, unit: 'lb' })]);

    expect(plan.supersede).toEqual(['w_lb']);
    expect(plan.create).toEqual([payload]);
  });

  it('HEALTH-HK-165: accepts the donor’s “lbs” spelling as the same unit as “lb”', () => {
    const inPounds = { date: '2026-07-25', weight: 181.7, unit: 'lb', source: 'healthkit' } as const;
    const plan = planWeightImport([inPounds], [weightRow({ weight: 181.7, unit: 'lbs' })]);

    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ date: '2026-07-25', reason: 'unchanged' }]);
  });

  it('HEALTH-HK-166: re-imports a day the member deleted, rather than blocking it forever', () => {
    const plan = planWeightImport(
      [payload],
      [weightRow({ id: 'w_gone', source: 'manual', deleted_at: '2026-07-25T10:00:00.000Z' })],
    );

    expect(plan.create).toEqual([payload]);
    expect(plan.supersede).toEqual([]);
  });

  it('HEALTH-HK-167: is idempotent — planning the result of an import creates nothing', () => {
    const first = planWeightImport([payload], []);
    const afterImport = first.create.map((row, index) =>
      weightRow({ id: `w_${index}`, date: row.date, weight: row.weight, unit: row.unit }),
    );

    expect(planWeightImport([payload], afterImport).create).toEqual([]);
  });

  it('HEALTH-HK-168: plans a day only once, however many payloads name it', () => {
    const plan = planWeightImport([payload, { ...payload, weight: 99 }], []);
    expect(plan.create).toEqual([payload]);
  });
});

describe('importNow — the weight track', () => {
  it('HEALTH-HK-170: posts a body-mass reading to the weight log, tagged healthkit', async () => {
    const sink = fullSink();
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    const result = await service.importNow();

    expect(sink.createWeight).toHaveBeenCalledTimes(1);
    expect(sink.createWeight).toHaveBeenCalledWith({
      date: '2026-07-25',
      weight: 82.4,
      unit: 'kg',
      source: 'healthkit',
    });
    expect(result.weightImported).toBe(1);
    expect(result.weightFailed).toBe(0);
    // Weight never lands in `/health/entries`, whatever else is in the window.
    expect(sink.create).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-171: counts the two tracks separately, because they are two tables', async () => {
    const sink = fullSink();
    const { service } = connectedService({
      samples: [
        sample({ type: 'steps', value: 8000 }),
        sample({ type: 'activeEnergy', value: 420 }),
        sample({ type: 'bodyMass', value: 82.4 }),
      ],
      sink,
    });
    const result = await service.importNow();

    expect(result.imported).toBe(2);
    expect(result.weightImported).toBe(1);
    expect(result.samplesRead).toBe(3);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });

  it('HEALTH-HK-172: honours the member’s unit preference', async () => {
    const sink = fullSink();
    const bridge = fakeBridge({
      querySamples: jest.fn(async ({ type }) =>
        type === 'bodyMass' ? [sample({ type: 'bodyMass', value: 82.4 })] : [],
      ),
    });
    const service = createHealthKitService({
      bridge,
      sink,
      now,
      store: createInMemoryHealthKitStore({ requestedAt: '2026-07-20T00:00:00.000Z', lastSyncedAt: null }),
      weightUnit: () => 'lb',
    });
    await service.importNow();

    expect(sink.createWeight).toHaveBeenCalledWith({
      date: '2026-07-25',
      weight: 181.7,
      unit: 'lb',
      source: 'healthkit',
    });
  });

  it('HEALTH-HK-173: falls back to kilograms when the preference cannot be read', async () => {
    const sink = fullSink();
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    // `connectedService` leaves `weightUnit` at its default, which reads prefs from
    // storage; a failure there must not stop the import or invent a unit.
    await service.importNow();

    expect(sink.createWeight).toHaveBeenCalledWith(
      expect.objectContaining({ unit: expect.stringMatching(/^(kg|lb)$/) }),
    );
  });

  it('HEALTH-HK-174: retires a superseded weight row before writing its replacement', async () => {
    const sink = fullSink({
      listExistingWeight: jest.fn(async () => [weightRow({ id: 'w_old', weight: 83.9 })]),
    });
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    const result = await service.importNow();

    expect(sink.removeWeight).toHaveBeenCalledWith('w_old');
    expect(result.weightSuperseded).toBe(1);
    expect(result.weightImported).toBe(1);
  });

  it('HEALTH-HK-175: reports a skipped manual day rather than silently doing nothing', async () => {
    const sink = fullSink({
      listExistingWeight: jest.fn(async () => [weightRow({ source: 'manual', weight: 79 })]),
    });
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    const result = await service.importNow();

    expect(sink.createWeight).not.toHaveBeenCalled();
    expect(result.weightSkipped).toEqual([{ date: '2026-07-25', reason: 'manual-entry-exists' }]);
  });

  it('HEALTH-HK-176: counts a refused weight write without surfacing the reason', async () => {
    const sink = fullSink({
      createWeight: jest.fn(async () => {
        throw new Error('500 upstream');
      }),
    });
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    const result = await service.importNow();

    expect(result.weightFailed).toBe(1);
    expect(result.weightImported).toBe(0);
  });

  it('HEALTH-HK-177: imports nothing at all when the weight baseline cannot be read', async () => {
    const sink = fullSink({
      listExistingWeight: jest.fn(async () => Promise.reject(new Error('offline'))),
    });
    const { service, store } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });
    const result = await service.importNow();

    expect(sink.createWeight).not.toHaveBeenCalled();
    expect(result.weightImported).toBe(0);
    // No baseline means we cannot tell a duplicate from a new day — and a partial
    // sync must not be stamped as a completed one.
    expect(result.syncedAt).toBeNull();
    await expect(store.read()).resolves.toMatchObject({ lastSyncedAt: null });
  });

  it('HEALTH-HK-178: a sink with no weight verbs imports entries only, and says nothing about weight', async () => {
    const sink = fakeSink();
    const { service } = connectedService({
      samples: [
        sample({ type: 'steps', value: 8000 }),
        sample({ type: 'bodyMass', value: 82.4 }),
      ],
      sink,
    });
    const result = await service.importNow();

    expect(result.imported).toBe(1);
    expect(result.weightImported).toBe(0);
    expect(result.weightSkipped).toEqual([]);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });

  it('HEALTH-HK-179: a re-import writes nothing the second time', async () => {
    const stored: HealthKitExistingWeight[] = [];
    const sink = fullSink({
      listExistingWeight: jest.fn(async () => stored),
      createWeight: jest.fn(async (payload) => {
        stored.push(weightRow({ id: `w_${stored.length}`, ...payload }));
      }),
    });
    const { service } = connectedService({
      samples: [sample({ type: 'bodyMass', value: 82.4 })],
      sink,
    });

    await service.importNow();
    const second = await service.importNow();

    expect(sink.createWeight).toHaveBeenCalledTimes(1);
    expect(second.weightImported).toBe(0);
    expect(second.weightSkipped).toEqual([{ date: '2026-07-25', reason: 'unchanged' }]);
  });
});

/* ============================ Nutrition import ============================ */

describe('the four dietary macros → one nutrition row per day', () => {
  it('HEALTH-HK-190: combines calories/protein/carbs/fat into ONE row, not four', () => {
    const payloads = mapSamplesToNutritionPayloads([
      sample({ type: 'dietaryEnergy', value: 1800 }),
      sample({ type: 'dietaryProtein', value: 90 }),
      sample({ type: 'dietaryCarbs', value: 200 }),
      sample({ type: 'dietaryFat', value: 60 }),
    ]);

    expect(payloads).toEqual([
      {
        date: '2026-07-25',
        food_name: 'Apple Health',
        meal_type: 'snack',
        calories: 1800,
        proteins: 90,
        carbohydrates: 200,
        fats: 60,
        source: 'healthkit',
      },
    ]);
  });

  it('HEALTH-HK-191: sums same-day samples of the same macro before combining', () => {
    const [payload] = mapSamplesToNutritionPayloads([
      sample({ type: 'dietaryEnergy', value: 500 }),
      sample({ type: 'dietaryEnergy', value: 700 }),
    ]);
    expect(payload.calories).toBe(1200);
  });

  it('HEALTH-HK-192: drops a day with no calorie total — a macro alone is not a usable row', () => {
    expect(mapSamplesToNutritionPayloads([sample({ type: 'dietaryProtein', value: 40 })])).toEqual([]);
  });

  it('HEALTH-HK-193: rounds every figure, the same precision every other track keeps', () => {
    const [payload] = mapSamplesToNutritionPayloads([
      sample({ type: 'dietaryEnergy', value: 1799.6 }),
      sample({ type: 'dietaryProtein', value: 89.4 }),
    ]);
    expect(payload.calories).toBe(1800);
    expect(payload.proteins).toBe(89);
  });

  it('HEALTH-HK-194: ignores a type outside the nutrition group', () => {
    expect(
      mapSamplesToNutritionPayloads([sample({ type: 'steps', value: 8000 })]),
    ).toEqual([]);
  });
});

describe('planNutritionImport — de-duplication against the diary', () => {
  // Matches `nutritionRow()`'s defaults exactly, so the "unchanged" tests below
  // compare like with like.
  const payload = mapSamplesToNutritionPayloads([
    sample({ type: 'dietaryEnergy', value: 1800 }),
    sample({ type: 'dietaryProtein', value: 90 }),
    sample({ type: 'dietaryCarbs', value: 200 }),
    sample({ type: 'dietaryFat', value: 60 }),
  ])[0];

  it('HEALTH-HK-195: creates when nothing imported exists for the day yet', () => {
    const plan = planNutritionImport([payload], []);
    expect(plan.create).toEqual([payload]);
    expect(plan.supersede).toEqual([]);
  });

  it('HEALTH-HK-196: a MANUAL meal that day does not block the import — they coexist', () => {
    const plan = planNutritionImport(
      [payload],
      [nutritionRow({ id: 'n_manual', source: 'manual', food_name: 'Oatmeal' })],
    );
    expect(plan.create).toEqual([payload]);
    expect(plan.supersede).toEqual([]);
  });

  it('HEALTH-HK-197: skips when the same Apple Health row is already there, unchanged', () => {
    const plan = planNutritionImport(
      [payload],
      [nutritionRow({ calories: payload.calories, proteins: payload.proteins })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ date: '2026-07-25', reason: 'unchanged' }]);
  });

  it('HEALTH-HK-198: supersedes a stale Apple Health row whose totals changed', () => {
    const plan = planNutritionImport([payload], [nutritionRow({ id: 'n_old', calories: 1500 })]);
    expect(plan.supersede).toEqual(['n_old']);
    expect(plan.create).toEqual([payload]);
  });

  it('HEALTH-HK-199: never touches a row that is not its own sentinel — different food_name', () => {
    const plan = planNutritionImport(
      [payload],
      [nutritionRow({ id: 'n_other', food_name: 'Lunch', source: 'healthkit' })],
    );
    // Not recognised as "the" imported row (wrong food_name), so it is left alone
    // and a fresh Apple Health row is created alongside it.
    expect(plan.supersede).toEqual([]);
    expect(plan.create).toEqual([payload]);
  });
});

describe('importNow — the nutrition track', () => {
  it('HEALTH-HK-200: posts one Apple Health nutrition row, tagged healthkit', async () => {
    const sink = fullSink();
    const { service } = connectedService({
      samples: [
        sample({ type: 'dietaryEnergy', value: 1800 }),
        sample({ type: 'dietaryProtein', value: 90 }),
        sample({ type: 'dietaryCarbs', value: 200 }),
        sample({ type: 'dietaryFat', value: 60 }),
      ],
      sink,
    });
    const result = await service.importNow();

    expect(sink.createNutrition).toHaveBeenCalledWith({
      date: '2026-07-25',
      food_name: 'Apple Health',
      meal_type: 'snack',
      calories: 1800,
      proteins: 90,
      carbohydrates: 200,
      fats: 60,
      source: 'healthkit',
    });
    expect(result.nutritionImported).toBe(1);
    expect(result.nutritionFailed).toBe(0);
  });

  it('HEALTH-HK-201: a sink with no nutrition verbs imports the rest only', async () => {
    const sink = fakeSink();
    const { service } = connectedService({
      samples: [sample({ type: 'dietaryEnergy', value: 1800 }), sample({ type: 'steps', value: 8000 })],
      sink,
    });
    const result = await service.importNow();

    expect(result.imported).toBe(1);
    expect(result.nutritionImported).toBe(0);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });
});

/* ============================= Workout import ============================ */

describe('mapWorkoutSamplesToPayloads — one row per session, never aggregated', () => {
  it('HEALTH-HK-210: maps a session, carrying Apple’s uuid for later de-duplication', () => {
    const [payload] = mapWorkoutSamplesToPayloads([workoutSample()]);
    expect(payload).toEqual({
      date: '2026-07-25',
      entry_type: 'workout',
      data: {
        workout_type: 'Running',
        minutes: 30,
        calories: 250,
        note: '',
        started_at: workoutSample().startedAt,
        healthkit_uuid: 'WORKOUT-UUID-1',
      },
      source: 'healthkit',
    });
  });

  it('HEALTH-HK-211: two sessions the same day produce two rows, not one aggregate', () => {
    const payloads = mapWorkoutSamplesToPayloads([
      workoutSample({ uuid: 'a' }),
      workoutSample({ uuid: 'b', startedAt: new Date(2026, 6, 25, 18, 0, 0).toISOString() }),
    ]);
    expect(payloads).toHaveLength(2);
  });

  it('HEALTH-HK-212: includes distance only when the session measured one', () => {
    const [withDistance] = mapWorkoutSamplesToPayloads([workoutSample({ distanceMeters: 5000 })]);
    expect(withDistance.data.distance_m).toBe(5000);
    const [without] = mapWorkoutSamplesToPayloads([workoutSample()]);
    expect(without.data).not.toHaveProperty('distance_m');
  });

  it('HEALTH-HK-213: drops a session with no positive duration', () => {
    expect(mapWorkoutSamplesToPayloads([workoutSample({ minutes: 0 })])).toEqual([]);
  });
});

describe('planWorkoutImport — de-duplication by Apple’s own uuid', () => {
  const payload = mapWorkoutSamplesToPayloads([workoutSample({ uuid: 'WORKOUT-UUID-1' })])[0];

  it('HEALTH-HK-214: creates a session never seen before', () => {
    const plan = planWorkoutImport([payload], []);
    expect(plan.create).toEqual([payload]);
  });

  it('HEALTH-HK-215: skips a session whose uuid is already on an imported entry', () => {
    const already = existing({
      entry_type: 'workout',
      source: 'healthkit',
      data: JSON.stringify({ healthkit_uuid: 'WORKOUT-UUID-1' }),
    });
    const plan = planWorkoutImport([payload], [already]);
    expect(plan.create).toEqual([]);
    expect(plan.skipped).toEqual([{ uuid: 'WORKOUT-UUID-1', reason: 'unchanged' }]);
  });

  it('HEALTH-HK-216: a MANUAL workout entry never blocks an imported one — different uuid, or none', () => {
    const manual = existing({ entry_type: 'workout', source: 'manual', data: JSON.stringify({}) });
    const plan = planWorkoutImport([payload], [manual]);
    expect(plan.create).toEqual([payload]);
  });
});

describe('importNow — the workout track', () => {
  it('HEALTH-HK-217: posts a workout session to /health/entries, tagged healthkit', async () => {
    const sink = fullSink();
    const { service } = connectedService({
      sink,
      bridge: { queryWorkouts: jest.fn(async () => [workoutSample()]) },
    });
    const result = await service.importNow();

    expect(sink.createWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ entry_type: 'workout', source: 'healthkit' }),
    );
    expect(result.workoutImported).toBe(1);
    expect(result.workoutFailed).toBe(0);
    // Workouts never go through the scalar entries path.
    expect(sink.create).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-218: a re-import writes nothing the second time — same uuid', async () => {
    const stored: HealthKitExistingEntry[] = [];
    const sink = fullSink({
      listExisting: jest.fn(async () => stored),
      createWorkout: jest.fn(async (payload: HealthKitWorkoutPayload) => {
        stored.push(existing({ id: `he_${stored.length}`, entry_type: 'workout', source: 'healthkit', data: JSON.stringify(payload.data) }));
      }),
    });
    const { service } = connectedService({
      sink,
      bridge: { queryWorkouts: jest.fn(async () => [workoutSample()]) },
    });

    await service.importNow();
    const second = await service.importNow();

    expect(sink.createWorkout).toHaveBeenCalledTimes(1);
    expect(second.workoutImported).toBe(0);
    expect(second.workoutSkipped).toBe(1);
  });

  it('HEALTH-HK-219: a sink with no createWorkout imports the rest only', async () => {
    const sink = fakeSink();
    const { service } = connectedService({
      sink,
      samples: [sample({ type: 'steps', value: 8000 })],
      bridge: { queryWorkouts: jest.fn(async () => [workoutSample()]) },
    });
    const result = await service.importNow();

    expect(result.imported).toBe(1);
    expect(result.workoutImported).toBe(0);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });
});

/* ====================== The HealthKit-OFF guarantees ==================== */

describe('HealthKit-OFF path', () => {
  it('HEALTH-HK-140: the shipped singleton reports unavailable, because it is', async () => {
    await expect(healthKit.checkAvailability()).resolves.toEqual({
      available: false,
      reason: 'no-bridge',
    });
    await expect(healthKit.getStatus()).resolves.toMatchObject({ state: 'unavailable' });
  });

  it('HEALTH-HK-141: every method on the shipped singleton resolves rather than throwing', async () => {
    await expect(healthKit.requestPermission()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(healthKit.readWindow('steps')).resolves.toEqual([]);
    await expect(healthKit.importNow()).resolves.toMatchObject({ state: 'unavailable', imported: 0 });
    await expect(healthKit.forget()).resolves.toBeUndefined();
  });

  it('HEALTH-HK-142: the null bridge answers every call without throwing', async () => {
    await expect(nullHealthKitBridge.isAvailable()).toBe(false);
    await expect(nullHealthKitBridge.getAuthorizationStatus(HEALTHKIT_READ_IDENTIFIERS)).resolves.toEqual({});
    await expect(nullHealthKitBridge.requestAuthorization(HEALTHKIT_READ_IDENTIFIERS)).resolves.toEqual({});
    await expect(
      nullHealthKitBridge.querySamples({ type: 'steps', start: '', end: '' }),
    ).resolves.toEqual([]);
  });

  it('HEALTH-HK-143: reading every scoped type with no bridge is silent and empty', async () => {
    const service = createHealthKitService();
    for (const type of HEALTHKIT_DATA_TYPES) {
      await expect(service.readWindow(type)).resolves.toEqual([]);
    }
  });

  it('HEALTH-HK-144: forget clears local state without touching the OS grant', async () => {
    const store = createInMemoryHealthKitStore({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: '2026-07-25T00:00:00.000Z',
    });
    const bridge = fakeBridge();
    await createHealthKitService({ bridge, store, now }).forget();

    await expect(store.read()).resolves.toEqual(EMPTY_HEALTHKIT_STATE);
    // We cannot revoke an OS grant, and must not pretend we did.
    expect(bridge.requestAuthorization).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-145: an entirely broken bridge behaves exactly like no bridge', async () => {
    const broken: HealthKitBridge = {
      isAvailable: () => {
        throw new Error('undefined is not an object');
      },
      getAuthorizationStatus: () => {
        throw new Error('nope');
      },
      requestAuthorization: () => {
        throw new Error('nope');
      },
      querySamples: () => {
        throw new Error('nope');
      },
      queryWorkouts: () => {
        throw new Error('nope');
      },
    };
    const service = createHealthKitService({ bridge: broken, now });

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(service.requestPermission()).resolves.toMatchObject({ state: 'unavailable' });
    await expect(service.readWindow('steps')).resolves.toEqual([]);
    await expect(service.importNow()).resolves.toMatchObject({ state: 'unavailable' });
  });
});

/* ============================== Persisted state ========================= */

describe('createStoredHealthKitStore', () => {
  beforeEach(async () => {
    await storageHelpers.clearAll();
  });

  it('HEALTH-HK-180: "last synced" survives a relaunch, under the documented key', async () => {
    const persisted: HealthKitPersistedState = {
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: '2026-07-25T08:00:00.000Z',
    };
    await createStoredHealthKitStore().write(persisted);

    // A SECOND instance is what a cold start gets — the in-memory store would
    // pass this by accident, which is exactly why the shipped singleton uses
    // this one instead.
    await expect(createStoredHealthKitStore().read()).resolves.toEqual(persisted);
    // The key is pinned because `HEALTH_CACHE_KEYS` has to name it for sign-out
    // to wipe it: leaving one user's "connected to Apple Health" behind is the
    // cross-user leak `privacy-cross-user-leak.yaml` guards against.
    expect(HEALTHKIT_STATE_KEY).toBe('health.healthKit.v1');
    expect(await storageHelpers.getObject(HEALTHKIT_STATE_KEY)).toEqual(persisted);
  });

  it('HEALTH-HK-181: a corrupt or absent blob reads as "never", never as a date', async () => {
    await expect(createStoredHealthKitStore().read()).resolves.toEqual(EMPTY_HEALTHKIT_STATE);

    // A half-written blob (epoch numbers from an older build, an object where a
    // string belongs). The card renders these two fields as dates, so anything
    // that is not a string has to read as "never" rather than reach the UI.
    await storageHelpers.setObject(HEALTHKIT_STATE_KEY, {
      requestedAt: 1_753_000_000_000,
      lastSyncedAt: {},
    });
    await expect(createStoredHealthKitStore().read()).resolves.toEqual(EMPTY_HEALTHKIT_STATE);
  });

  it('HEALTH-HK-182: an import through the stored store leaves the card a real last-sync', async () => {
    const store = createStoredHealthKitStore();
    await store.write({ requestedAt: '2026-07-20T00:00:00.000Z', lastSyncedAt: null });
    const service = createHealthKitService({ bridge: fakeBridge(), store, sink: fakeSink(), now });

    await service.importNow();

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'connected',
      lastSyncedAt: NOW.toISOString(),
    });
  });
});

/* ======================= Windowing without a clock ====================== */

describe('healthKitWindow — the default clock', () => {
  it('HEALTH-HK-183: a window asked for with no clock ends at the real "now"', () => {
    const before = Date.now();
    const window = healthKitWindow(1);
    const after = Date.now();

    // Every other window case injects `now`. This is the shape the app actually
    // calls (`importNow` passes its own clock, but `readWindow`'s default does
    // not), so a broken default would only ever show up on a device.
    const end = Date.parse(window.end);
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(after);
    expect(new Date(window.start).getHours()).toBe(0);
  });
});

/* ================== Samples the table has never heard of ================ */

describe('mapSamplesToPayloads — a type outside the table', () => {
  it('HEALTH-HK-184: drops a sample of a type we never published', () => {
    // `HEALTHKIT_TYPES[sample.type]` is undefined for anything not in the five,
    // so this is the guard that stops a bridge (or a hand-assembled call) from
    // widening what we import by inventing a type name.
    const rogue = {
      type: 'vo2Max' as unknown as HealthKitDataType,
      startedAt: new Date(2026, 6, 25, 9, 0, 0).toISOString(),
      endedAt: new Date(2026, 6, 25, 9, 0, 0).toISOString(),
      value: 42,
      unit: 'count' as const,
    };

    expect(mapSamplesToPayloads([rogue])).toEqual([]);
    expect(mapSamplesToPayloads([rogue, sample({ type: 'steps', value: 100 })])).toEqual([
      { date: '2026-07-25', entry_type: 'steps', data: { steps: 100 }, source: 'healthkit' },
    ]);
  });
});

/* ================== "latest" means the latest READING =================== */

describe('mapSamplesToWeightPayloads — ordering', () => {
  it('HEALTH-HK-185: takes the evening weigh-in however the bridge ordered the day', () => {
    const morning = new Date(2026, 6, 25, 7, 0, 0).toISOString();
    const evening = new Date(2026, 6, 25, 21, 0, 0).toISOString();

    // Fixed 2026-07-25: `'latest'` used to mean "the last element of the array",
    // so a bridge that answered newest-first imported the MORNING weight and
    // called it the day's reading. The native module sorts oldest-first today,
    // but this file re-checks every other thing a bridge could get wrong (type,
    // window, unit, sign, date) and sort order was the one it took on trust.
    expect(
      mapSamplesToWeightPayloads([
        sample({ type: 'bodyMass', value: 82.4, startedAt: evening }),
        sample({ type: 'bodyMass', value: 82.9, startedAt: morning }),
      ]),
    ).toEqual([{ date: '2026-07-25', weight: 82.4, unit: 'kg', source: 'healthkit' }]);
  });
});

/* ===================== A data blob that is not a record ================= */

describe('planImport — unreadable figures', () => {
  it('HEALTH-HK-186: a data blob that parses to a non-object is replaced, not matched', () => {
    const payload: HealthKitEntryPayload = {
      date: '2026-07-25',
      entry_type: 'steps',
      data: { steps: 100 },
      source: 'healthkit',
    };

    // Valid JSON, but not a row we can compare against — `100` and `null` both
    // parse cleanly and neither carries a `steps` key. Reading either as
    // "unchanged" would freeze that day at a figure nobody can see.
    for (const blob of ['100', 'null', '"steps"']) {
      const plan = planImport([payload], [existing({ id: 'he_odd', data: blob })]);
      expect(plan.create).toEqual([payload]);
      expect(plan.supersede).toEqual(['he_odd']);
    }
  });
});

/* ================ Probe / prompt failures on both histories ============= */

describe('getStatus + requestPermission — failures on a fresh install vs an old one', () => {
  it('HEALTH-HK-187: a status probe that fails before anyone asked stays not-requested', async () => {
    const bridge = fakeBridge({
      getAuthorizationStatus: jest.fn(async () => Promise.reject(new Error('xpc error'))),
    });
    const status = await createHealthKitService({ bridge, now }).getStatus();

    // The mirror of HEALTH-HK-046: with no record of a request, a failed probe
    // must NOT read as connected — the card has to keep offering Connect rather
    // than claiming a permission that was never granted.
    expect(status.state).toBe('not-requested');
    expect(Object.values(status.perType).every((v) => v === 'not-requested')).toBe(true);
  });

  it('HEALTH-HK-188: a prompt that fails does not disconnect someone already connected', async () => {
    const store = createInMemoryHealthKitStore({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: '2026-07-24T00:00:00.000Z',
    });
    const status = await createHealthKitService({
      bridge: fakeBridge({
        requestAuthorization: jest.fn(async () => Promise.reject(new Error('sheet failed'))),
      }),
      store,
      now,
    }).requestPermission();

    // Re-tapping Connect on a build where the sheet is broken must not downgrade
    // a working connection to "not requested" — nor move the timestamps.
    expect(status.state).toBe('connected');
    expect(Object.values(status.perType).every((v) => v === 'undisclosed')).toBe(true);
    expect(status.requestedAt).toBe('2026-07-20T00:00:00.000Z');
    expect(status.lastSyncedAt).toBe('2026-07-24T00:00:00.000Z');
    await expect(store.read()).resolves.toEqual({
      requestedAt: '2026-07-20T00:00:00.000Z',
      lastSyncedAt: '2026-07-24T00:00:00.000Z',
    });
  });
});

/* ==================== Supersede failures on both tracks ================= */

describe('importNow — a supersede that does not land', () => {
  it('HEALTH-HK-189: a failed DELETE is not counted, and the corrected figure still lands', async () => {
    const sink = fakeSink({
      listExisting: jest.fn(async () => [existing({ id: 'he_old', data: JSON.stringify({ steps: 10 }) })]),
      remove: jest.fn(async () => Promise.reject(new Error('409 conflict'))),
    });
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8240 })], sink });
    const result = await service.importNow();

    // Counting a delete that never happened would tell the member their old
    // figure was retired when the day now holds two HealthKit rows. The next
    // import plans against both and replaces them, which is why writing the
    // corrected figure anyway is still the right call.
    expect(result.superseded).toBe(0);
    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(JSON.stringify(result)).not.toContain('409 conflict');
  });

  it('HEALTH-HK-190: the weight track counts a failed retirement the same way', async () => {
    const sink = fullSink({
      listExistingWeight: jest.fn(async () => [weightRow({ id: 'w_old', weight: 83.9 })]),
      removeWeight: jest.fn(async () => Promise.reject(new Error('409 conflict'))),
    });
    const { service } = connectedService({ samples: [sample({ type: 'bodyMass', value: 82.4 })], sink });
    const result = await service.importNow();

    expect(result.weightSuperseded).toBe(0);
    expect(result.weightImported).toBe(1);
    expect(result.weightFailed).toBe(0);
  });

  it('HEALTH-HK-191: a member who never weighs in gets no weight write, and still a sync stamp', async () => {
    const sink = fullSink();
    const { service } = connectedService({ samples: [sample({ type: 'steps', value: 8000 })], sink });
    const result = await service.importNow();

    // A sink that CAN write weight but has nothing to write must not reach the
    // weight table at all — an empty POST would 400, and asking for a baseline
    // for zero days is a round trip for nothing.
    expect(sink.listExistingWeight).not.toHaveBeenCalled();
    expect(sink.createWeight).not.toHaveBeenCalled();
    expect(result.weightImported).toBe(0);
    expect(result.weightSkipped).toEqual([]);
    expect(result.imported).toBe(1);
    expect(result.syncedAt).toBe(NOW.toISOString());
  });
});

/* ========================== The real API sink =========================== */

/**
 * The one place the HealthKit feature touches the network.
 *
 * Everything above runs against an injected sink. This block runs against
 * `healthApi` itself, because the Health Worker answers `c.json({ entries })`
 * BARE — no `{ data }` wrapper — and this sink is the file that has to read it
 * that way. It got that wrong once already (see the note on `createApiImportSink`).
 */
describe('createApiImportSink — the real /health wire', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('HEALTH-HK-192: reads the entries baseline for the planned range, straight off the body', async () => {
    const rows = [healthEntryRow({ id: 'he_1', entry_type: 'steps', data: '{"steps":100}' })];
    api.listEntries.mockResolvedValue(ok({ entries: rows }));

    await expect(
      createApiImportSink().listExisting({ from: '2026-07-19', to: '2026-07-25' }),
    ).resolves.toEqual(rows);
    expect(api.listEntries).toHaveBeenCalledWith({ from: '2026-07-19', to: '2026-07-25' });
  });

  it('HEALTH-HK-193: a body with no `entries` key is an empty baseline, not a crash', async () => {
    // The Worker answers bare, so a renamed key or a 204-shaped body arrives as
    // `{}`. Reading `.entries` off that and handing `undefined` to the planner
    // would throw inside the import rather than plan an empty day.
    api.listEntries.mockResolvedValue(ok({} as never));
    api.listWeight.mockResolvedValue(ok({} as never));

    const sink = createApiImportSink();
    await expect(sink.listExisting({ from: '2026-07-19', to: '2026-07-25' })).resolves.toEqual([]);
    await expect(
      sink.listExistingWeight?.({ from: '2026-07-19', to: '2026-07-25' }),
    ).resolves.toEqual([]);
  });

  it('HEALTH-HK-194: writes and retires entries rows through the entries routes', async () => {
    api.createEntry.mockResolvedValue(ok({ entry: healthEntryRow() }));
    api.deleteEntry.mockResolvedValue(ok({ deleted: true }));
    const sink = createApiImportSink();
    const payload: HealthKitEntryPayload = {
      date: '2026-07-25',
      entry_type: 'steps',
      data: { steps: 8240 },
      source: 'healthkit',
    };

    await sink.create(payload);
    await sink.remove('he_old');

    // `source: 'healthkit'` is what lets the server — and `planImport` — keep an
    // imported day apart from one the member typed.
    expect(api.createEntry).toHaveBeenCalledWith(payload);
    expect(api.deleteEntry).toHaveBeenCalledWith('he_old');
  });

  it('HEALTH-HK-195: reads, writes and retires weight rows through the WEIGHT routes', async () => {
    const rows = [wireWeightRow({ id: 'w_1', weight: 82.4, source: 'healthkit' })];
    api.listWeight.mockResolvedValue(ok({ entries: rows }));
    api.createWeight.mockResolvedValue(ok({ entry: wireWeightRow() }));
    api.deleteWeight.mockResolvedValue(ok({ deleted: true }));
    const sink = createApiImportSink();

    await expect(
      sink.listExistingWeight?.({ from: '2026-07-19', to: '2026-07-25' }),
    ).resolves.toEqual(rows);
    await sink.createWeight?.({ date: '2026-07-25', weight: 82.4, unit: 'kg', source: 'healthkit' });
    await sink.removeWeight?.('w_old');

    // A body-mass reading is a row in a DIFFERENT table with a different shape —
    // it must never reach `/health/entries`.
    expect(api.listWeight).toHaveBeenCalledWith({ from: '2026-07-19', to: '2026-07-25' });
    expect(api.createWeight).toHaveBeenCalledWith({
      date: '2026-07-25',
      weight: 82.4,
      unit: 'kg',
      source: 'healthkit',
    });
    expect(api.deleteWeight).toHaveBeenCalledWith('w_old');
    expect(api.createEntry).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-196: a service given no sink imports through exactly these routes', async () => {
    api.listEntries.mockResolvedValue(ok({ entries: [] }));
    api.createEntry.mockResolvedValue(ok({ entry: healthEntryRow() }));
    api.listWeight.mockResolvedValue(ok({ entries: [] }));
    api.createWeight.mockResolvedValue(ok({ entry: wireWeightRow() }));

    const bridge = fakeBridge({
      querySamples: jest.fn(async ({ type }) =>
        type === 'steps' ? [sample({ type: 'steps', value: 8240 })] : [],
      ),
    });
    // The client gate is pinned OFF for this one import — see the block comment
    // above `resolveHealthKitImportSink` in `healthKit.ts`. Left ambient, this
    // test asserts the API sink under `npx jest src/features/health` and the
    // LEDGER sink under `EXPO_PUBLIC_HEALTH_LOCAL_FIRST=1 npx jest …`, which is
    // the same test claiming two different things depending on how it was run.
    const previousFlag = process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
    process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = '0';
    let result;
    try {
      result = await createHealthKitService({
        bridge,
        store: createInMemoryHealthKitStore({
          requestedAt: '2026-07-20T00:00:00.000Z',
          lastSyncedAt: null,
        }),
        now,
        weightUnit: () => 'kg',
      }).importNow();
    } finally {
      if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST;
      else process.env.EXPO_PUBLIC_HEALTH_LOCAL_FIRST = previousFlag;
    }

    // On a flag-0 build the default sink is the API one, so an app that only
    // injects a bridge gets a real import rather than a silent no-op. The flag-1
    // half of the same rule — the default sink is the LEDGER one, and nothing
    // reaches the wire — is `local/__tests__/healthKitIngest.drain.test.ts`.
    expect(result.imported).toBe(1);
    expect(api.createEntry).toHaveBeenCalledWith({
      date: '2026-07-25',
      entry_type: 'steps',
      data: { steps: 8240 },
      source: 'healthkit',
    });
    // No body mass in the window, so the weight table is never touched.
    expect(api.createWeight).not.toHaveBeenCalled();
  });
});
