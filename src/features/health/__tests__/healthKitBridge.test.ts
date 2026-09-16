/**
 * Symply Health — the native HealthKit bridge adapter (parity phase P3).
 *
 * `healthKit.test.ts` proves the SERVICE is right against an injected fake bridge.
 * This suite proves the ADAPTER is right against a fake native module, so the two
 * halves are pinned without a device, a simulator or an entitlement between them.
 *
 * Four things are worth failing a build over here, and they are the four this file
 * exists for:
 *
 * 1. **Only Health asks.** Four sibling apps build from this `src/` tree. A bridge
 *    that resolves on any of them is a privacy incident, not a bug.
 * 2. **Scope, in both languages.** The Swift allow-list and
 *    `HEALTHKIT_READ_IDENTIFIERS` are two hand-written copies of the same five
 *    strings. They are compared here, because a sixth type appearing on one side
 *    only is exactly the drift that widens a permission footprint silently.
 * 3. **Nothing is repaired.** A unit mismatch, an unparseable date, a status string
 *    we do not recognise — all dropped. Guessing turns 70 kg into 70 lb in a weight
 *    log, or claims a grant iOS never gave.
 * 4. **Read-only, provably.** No write identifier, no `save`, and the native
 *    `NSHealthUpdateUsageDescription` purpose string (present only because App
 *    Store Connect requires it, see HEALTH-HK-353) says plainly that there is none.
 *
 * The last group reads the native + Xcode files as text, in the style of
 * `src/api/__tests__/healthEnvelope.test.ts`: these are facts a unit test can check
 * and a code review reliably misses.
 */

import fs from 'fs';
import path from 'path';

import { Platform } from 'react-native';

import { brandId } from '@brand';

import {
  HEALTHKIT_BRAND_ID,
  HEALTHKIT_NATIVE_MODULE_NAME,
  createNativeHealthKitBridge,
  nativeHealthKitModule,
  resolveHealthKitBridge,
  toAuthorizationMap,
  toSamples,
  toWorkoutSamples,
  type HealthKitNativeModule,
  type HealthKitNativeSample,
  type HealthKitNativeWorkoutSample,
} from '../healthKitBridge';
import {
  HEALTHKIT_READ_IDENTIFIERS,
  HEALTHKIT_TYPES,
  type HealthKitDataType,
} from '../healthKitTypes';

/* =============================== Fixtures =============================== */

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const MODULE_DIR = path.join(REPO_ROOT, 'modules', 'symply-healthkit');
const IOS_DIR = path.join(REPO_ROOT, 'ios');

function readRepoFile(...segments: string[]): string {
  return fs.readFileSync(path.join(...segments), 'utf8');
}

/**
 * Swift source with its comments removed.
 *
 * The negative assertions below ("no write path", "no observer query") must fail on
 * CODE, not on the doc comments that explain why those things are absent — the
 * alternative is deleting the explanations to keep a test green, which is precisely
 * backwards.
 */
function swiftCode(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Local morning, so an ISO round-trip cannot be confused with a UTC one. */
const STARTED_AT = new Date(2026, 6, 25, 9, 0, 0);
const ENDED_AT = new Date(2026, 6, 25, 9, 30, 0);

function nativeSample(over: Partial<HealthKitNativeSample> = {}): HealthKitNativeSample {
  return {
    startedAt: over.startedAt ?? STARTED_AT.getTime(),
    endedAt: over.endedAt ?? ENDED_AT.getTime(),
    value: over.value ?? 8240,
    unit: over.unit ?? 'count',
    ...(over.sourceName !== undefined ? { sourceName: over.sourceName } : {}),
  };
}

function fakeNative(overrides: Partial<HealthKitNativeModule> = {}): HealthKitNativeModule {
  return {
    isAvailable: jest.fn(async () => true),
    getAuthorizationStatus: jest.fn(async () => ({})),
    requestAuthorization: jest.fn(async () => ({})),
    querySamples: jest.fn(async () => []),
    queryWorkouts: jest.fn(async () => []),
    consumePendingSync: jest.fn(async () => false),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    ...overrides,
  };
}

const IOS_HEALTH = { brand: HEALTHKIT_BRAND_ID, platform: 'ios' } as const;

/**
 * The autolinked-module lookup, reached through the MODULE REGISTRY.
 *
 * A namespace import would not do: jest-expo mocks `expo-modules-core` with a
 * plain object, so Babel's interop hands each importer its own COPY — spying on
 * that copy leaves `healthKitBridge`'s own reference untouched and the test
 * passes without ever intercepting anything.
 */
function nativeLookupRegistry(): { requireOptionalNativeModule: (name: string) => unknown } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-modules-core') as {
    requireOptionalNativeModule: (name: string) => unknown;
  };
}

/* ============================== Resolution ============================== */

describe('resolveHealthKitBridge — who is allowed a bridge at all', () => {
  it('HEALTH-HK-300: refuses every brand except Symply Health', () => {
    for (const brand of ['symply-house', 'symply-budget', 'symply-kaizen', 'symply-language']) {
      expect(
        resolveHealthKitBridge({ brand, platform: 'ios', native: fakeNative() }),
      ).toBeNull();
    }
  });

  it('HEALTH-HK-301: builds a bridge for Symply Health on iOS with the module linked', () => {
    const bridge = resolveHealthKitBridge({ ...IOS_HEALTH, native: fakeNative() });
    expect(bridge).not.toBeNull();
    expect(Object.keys(bridge!).sort()).toEqual([
      'getAuthorizationStatus',
      'isAvailable',
      'querySamples',
      'queryWorkouts',
      'requestAuthorization',
    ]);
  });

  it('HEALTH-HK-302: refuses Android — HealthKit is not a cross-platform promise', () => {
    expect(
      resolveHealthKitBridge({ brand: HEALTHKIT_BRAND_ID, platform: 'android', native: fakeNative() }),
    ).toBeNull();
  });

  it('HEALTH-HK-303: the brand literal is the Health brand pack’s own id', () => {
    // Restated as a literal in healthKitBridge.ts to avoid an import cycle through
    // src/features/health/index.ts (which re-exports every Health screen). This
    // check is what keeps that copy honest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const brand = require(path.join(REPO_ROOT, 'brands', 'symply-health', 'brand.cjs')) as {
      id: string;
    };
    expect(HEALTHKIT_BRAND_ID).toBe(brand.id);
  });

  it('HEALTH-HK-304: refuses when the native module is not linked', () => {
    expect(resolveHealthKitBridge({ ...IOS_HEALTH, native: null })).toBeNull();
  });

  it('HEALTH-HK-305: looks the module up for real when none is injected, and finds none here', () => {
    // Jest has no native registry, which is the same answer Expo Go and a stale
    // build give. `null` here is what keeps the shipped singleton on the null
    // bridge in every test in this repo.
    expect(resolveHealthKitBridge({ ...IOS_HEALTH })).toBeNull();
  });

  it('HEALTH-HK-306: on a real Health build it adopts the autolinked module by itself', async () => {
    const native = fakeNative();
    const lookup = jest
      .spyOn(nativeLookupRegistry(), 'requireOptionalNativeModule')
      .mockReturnValue(native);

    // Neither `platform` nor `native` supplied — the two defaults the app relies
    // on, and the only combination a device ever takes. Every other case in this
    // block injects both, so the defaults were never exercised.
    expect(Platform.OS).toBe('ios'); // the suite's own platform, pinned
    const bridge = resolveHealthKitBridge({ brand: HEALTHKIT_BRAND_ID });

    expect(lookup).toHaveBeenCalledWith(HEALTHKIT_NATIVE_MODULE_NAME);
    expect(bridge).not.toBeNull();
    await expect(bridge!.isAvailable()).resolves.toBe(true);
    expect(native.isAvailable).toHaveBeenCalled();

    lookup.mockRestore();
  });

  it('HEALTH-HK-308: called with nothing at all, it reads the RUNNING brand', () => {
    // This is the shipped call site: `healthKit.ts` builds its singleton with
    // `resolveHealthKitBridge()` and no environment. The Jest baseline builds as
    // House, so the answer is `null` — which is precisely why importing the
    // Health feature into any suite in this repo is inert.
    expect(brandId).not.toBe(HEALTHKIT_BRAND_ID);
    expect(resolveHealthKitBridge()).toBeNull();
  });

  it('HEALTH-HK-307: a native registry that throws is answered with no bridge at all', () => {
    const lookup = jest
      .spyOn(nativeLookupRegistry(), 'requireOptionalNativeModule')
      .mockImplementation(() => {
        throw new Error('TurboModuleRegistry: SymplyHealthKit could not be found');
      });

    // A half-installed pod, a stale binary, a bridgeless quirk: all of them must
    // land on "Apple Health isn't available here", never on an exception out of
    // a module-scope call the app makes at import time.
    expect(nativeHealthKitModule()).toBeNull();
    expect(resolveHealthKitBridge({ ...IOS_HEALTH, native: undefined })).toBeNull();

    lookup.mockRestore();
  });
});

/* ============================== Availability ============================ */

describe('createNativeHealthKitBridge — availability', () => {
  it('HEALTH-HK-310: passes a true from the module straight through', async () => {
    const bridge = createNativeHealthKitBridge(fakeNative({ isAvailable: async () => true }));
    await expect(bridge.isAvailable()).resolves.toBe(true);
  });

  it('HEALTH-HK-311: reports false when the module says the device cannot help', async () => {
    const bridge = createNativeHealthKitBridge(fakeNative({ isAvailable: async () => false }));
    await expect(bridge.isAvailable()).resolves.toBe(false);
  });

  it('HEALTH-HK-312: treats a non-boolean answer as unavailable rather than truthy', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({ isAvailable: async () => 'yes' as unknown as boolean }),
    );
    await expect(bridge.isAvailable()).resolves.toBe(false);
  });
});

/* ============================= Authorisation ============================ */

describe('createNativeHealthKitBridge — authorisation', () => {
  it('HEALTH-HK-320: hands the OS only identifiers we have published', async () => {
    const native = fakeNative();
    const bridge = createNativeHealthKitBridge(native);

    await bridge.getAuthorizationStatus([
      'HKQuantityTypeIdentifierStepCount',
      'HKQuantityTypeIdentifierVO2Max',
      'HKCategoryTypeIdentifierMindfulSession',
    ]);

    expect(native.getAuthorizationStatus).toHaveBeenCalledWith([
      'HKQuantityTypeIdentifierStepCount',
    ]);
  });

  it('HEALTH-HK-321: keeps exactly the three statuses iOS reports', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({
        getAuthorizationStatus: async () => ({
          HKQuantityTypeIdentifierStepCount: 'sharingAuthorized',
          HKQuantityTypeIdentifierHeartRate: 'sharingDenied',
          HKQuantityTypeIdentifierBodyMass: 'notDetermined',
        }),
      }),
    );

    await expect(bridge.getAuthorizationStatus(HEALTHKIT_READ_IDENTIFIERS)).resolves.toEqual({
      HKQuantityTypeIdentifierStepCount: 'sharingAuthorized',
      HKQuantityTypeIdentifierHeartRate: 'sharingDenied',
      HKQuantityTypeIdentifierBodyMass: 'notDetermined',
    });
  });

  it('HEALTH-HK-322: drops a status string it does not recognise instead of guessing', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({
        getAuthorizationStatus: async () => ({
          HKQuantityTypeIdentifierStepCount: 'granted',
          HKQuantityTypeIdentifierHeartRate: 'sharingAuthorized',
        }),
      }),
    );

    // "granted" is not an iOS status. Absent reads as not-requested/undisclosed
    // downstream — never as a grant we cannot see.
    await expect(bridge.getAuthorizationStatus(HEALTHKIT_READ_IDENTIFIERS)).resolves.toEqual({
      HKQuantityTypeIdentifierHeartRate: 'sharingAuthorized',
    });
  });

  it('HEALTH-HK-323: ignores an out-of-scope type the module volunteers', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({
        getAuthorizationStatus: async () => ({
          HKQuantityTypeIdentifierStepCount: 'sharingAuthorized',
          HKQuantityTypeIdentifierVO2Max: 'sharingAuthorized',
        }),
      }),
    );

    await expect(bridge.getAuthorizationStatus(HEALTHKIT_READ_IDENTIFIERS)).resolves.toEqual({
      HKQuantityTypeIdentifierStepCount: 'sharingAuthorized',
    });
  });

  it('HEALTH-HK-324: applies the same scoping to the permission sheet', async () => {
    const native = fakeNative({
      requestAuthorization: jest.fn(async () => ({
        HKQuantityTypeIdentifierStepCount: 'notDetermined',
        HKQuantityTypeIdentifierVO2Max: 'sharingAuthorized',
      })),
    });
    const bridge = createNativeHealthKitBridge(native);

    const result = await bridge.requestAuthorization([
      ...HEALTHKIT_READ_IDENTIFIERS,
      'HKQuantityTypeIdentifierVO2Max',
    ]);

    expect(native.requestAuthorization).toHaveBeenCalledWith([...HEALTHKIT_READ_IDENTIFIERS]);
    expect(result).toEqual({ HKQuantityTypeIdentifierStepCount: 'notDetermined' });
  });

  it('HEALTH-HK-325: lets a rejected sheet reject, so the service can leave state alone', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({
        requestAuthorization: async () => {
          throw new Error('authorization_unavailable');
        },
      }),
    );

    // The service reads a rejection as "we never got to ask" and does NOT record a
    // request — swallowing it here would strand the user with no way to retry.
    await expect(bridge.requestAuthorization(HEALTHKIT_READ_IDENTIFIERS)).rejects.toThrow();
  });

  it('HEALTH-HK-326: survives a module that answers with nothing at all', () => {
    expect(toAuthorizationMap(null)).toEqual({});
    expect(toAuthorizationMap(undefined)).toEqual({});
    expect(toAuthorizationMap({})).toEqual({});
  });
});

/* ================================ Samples =============================== */

describe('createNativeHealthKitBridge — samples', () => {
  it('HEALTH-HK-330: converts epoch millis to ISO and stamps the type we asked for', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({ querySamples: async () => [nativeSample()] }),
    );

    await expect(
      bridge.querySamples({
        type: 'steps',
        start: new Date(2026, 6, 19).toISOString(),
        end: new Date(2026, 6, 25, 12).toISOString(),
      }),
    ).resolves.toEqual([
      {
        type: 'steps',
        startedAt: STARTED_AT.toISOString(),
        endedAt: ENDED_AT.toISOString(),
        value: 8240,
        unit: 'count',
      },
    ]);
  });

  it('HEALTH-HK-331: asks the OS by Apple identifier, with a numeric window', async () => {
    const native = fakeNative();
    const bridge = createNativeHealthKitBridge(native);
    const start = new Date(2026, 6, 19).toISOString();
    const end = new Date(2026, 6, 25, 12).toISOString();

    await bridge.querySamples({ type: 'bodyMass', start, end });

    expect(native.querySamples).toHaveBeenCalledWith(
      HEALTHKIT_TYPES.bodyMass.identifier,
      Date.parse(start),
      Date.parse(end),
    );
  });

  it('HEALTH-HK-332: drops a sample whose unit does not match the descriptor', async () => {
    const bridge = createNativeHealthKitBridge(
      fakeNative({ querySamples: async () => [nativeSample({ unit: 'lb' })] }),
    );

    // A unit mismatch means native did not normalise. Converting on a guess is how
    // 70 kg becomes 70 lb in somebody's weight log.
    await expect(
      bridge.querySamples({
        type: 'bodyMass',
        start: new Date(2026, 6, 19).toISOString(),
        end: new Date(2026, 6, 25, 12).toISOString(),
      }),
    ).resolves.toEqual([]);
  });

  it('HEALTH-HK-333: drops values that are not finite, positive numbers', () => {
    expect(toSamples('steps', [nativeSample({ value: Number.NaN })])).toEqual([]);
    expect(toSamples('steps', [nativeSample({ value: Number.POSITIVE_INFINITY })])).toEqual([]);
    expect(toSamples('steps', [nativeSample({ value: -1 })])).toEqual([]);
    expect(toSamples('steps', [nativeSample({ value: '900' as unknown as number })])).toEqual([]);
  });

  it('HEALTH-HK-334: drops a sample whose start instant cannot be read', () => {
    expect(toSamples('steps', [nativeSample({ startedAt: Number.NaN })])).toEqual([]);
    expect(
      toSamples('steps', [nativeSample({ startedAt: 'today' as unknown as number })]),
    ).toEqual([]);
  });

  it('HEALTH-HK-335: keeps the recording device’s name only when there is one', () => {
    const [withSource] = toSamples('steps', [nativeSample({ sourceName: 'Apple Watch' })]);
    expect(withSource.sourceName).toBe('Apple Watch');

    // Absent rather than an empty string: `sourceName` is display-only and an empty
    // label on a card is worse than no label.
    const [without] = toSamples('steps', [nativeSample({ sourceName: '' })]);
    expect(without).not.toHaveProperty('sourceName');
    expect('sourceName' in toSamples('steps', [nativeSample()])[0]).toBe(false);
  });

  it('HEALTH-HK-336: falls back to the start instant when the end is unreadable', () => {
    const [sample] = toSamples('steps', [nativeSample({ endedAt: Number.NaN })]);
    expect(sample.endedAt).toBe(sample.startedAt);
  });

  it('HEALTH-HK-337: never calls the OS for an empty or inverted window', async () => {
    const native = fakeNative();
    const bridge = createNativeHealthKitBridge(native);
    const now = new Date(2026, 6, 25, 12).toISOString();

    await expect(bridge.querySamples({ type: 'steps', start: now, end: now })).resolves.toEqual([]);
    await expect(
      bridge.querySamples({ type: 'steps', start: now, end: new Date(2026, 6, 19).toISOString() }),
    ).resolves.toEqual([]);
    await expect(
      bridge.querySamples({ type: 'steps', start: 'not-a-date', end: now }),
    ).resolves.toEqual([]);

    expect(native.querySamples).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-339: refuses a type that is not in the table, without touching the OS', async () => {
    const native = fakeNative();
    const bridge = createNativeHealthKitBridge(native);

    // There is no identifier to hand iOS for a type we never published, so the
    // adapter answers empty rather than calling the module with `undefined` and
    // letting the OS decide what that means.
    await expect(
      bridge.querySamples({
        type: 'vo2Max' as unknown as HealthKitDataType,
        start: new Date(2026, 6, 19).toISOString(),
        end: new Date(2026, 6, 25, 12).toISOString(),
      }),
    ).resolves.toEqual([]);
    expect(native.querySamples).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-355: drops an instant outside the range a Date can hold', () => {
    // A finite number that is still not a date: JS caps at ±8.64e15 ms, and past
    // that `new Date(n)` is Invalid — whose `toISOString()` THROWS. Dropping the
    // sample is the only answer that neither crashes the read nor invents a day.
    const beyond = 8.64e15 + 1;
    expect(toSamples('steps', [nativeSample({ startedAt: beyond })])).toEqual([]);

    // An unreadable END is not fatal, though: it falls back to the start.
    const [sample] = toSamples('steps', [nativeSample({ endedAt: beyond })]);
    expect(sample.endedAt).toBe(sample.startedAt);
  });

  it('HEALTH-HK-338: tolerates a module that answers with junk instead of an array', () => {
    expect(toSamples('steps', null)).toEqual([]);
    expect(toSamples('steps', undefined)).toEqual([]);
    expect(toSamples('steps', {} as unknown as HealthKitNativeSample[])).toEqual([]);
    expect(toSamples('steps', [null as unknown as HealthKitNativeSample])).toEqual([]);
  });
});

/* =============================== Workouts ================================ */

function nativeWorkout(over: Partial<HealthKitNativeWorkoutSample> = {}): HealthKitNativeWorkoutSample {
  return {
    uuid: over.uuid ?? 'WORKOUT-UUID-1',
    startedAt: over.startedAt ?? STARTED_AT.getTime(),
    endedAt: over.endedAt ?? ENDED_AT.getTime(),
    workoutType: over.workoutType ?? 'Running',
    minutes: over.minutes ?? 30,
    calories: over.calories ?? 250,
    ...(over.distanceMeters !== undefined ? { distanceMeters: over.distanceMeters } : {}),
    ...(over.sourceName !== undefined ? { sourceName: over.sourceName } : {}),
  };
}

describe('createNativeHealthKitBridge — workouts', () => {
  it('HEALTH-HK-360: converts epoch millis to ISO and carries the uuid through', async () => {
    const bridge = createNativeHealthKitBridge(fakeNative({ queryWorkouts: async () => [nativeWorkout()] }));

    await expect(
      bridge.queryWorkouts({
        start: new Date(2026, 6, 19).toISOString(),
        end: new Date(2026, 6, 25, 12).toISOString(),
      }),
    ).resolves.toEqual([
      {
        uuid: 'WORKOUT-UUID-1',
        startedAt: STARTED_AT.toISOString(),
        endedAt: ENDED_AT.toISOString(),
        workoutType: 'Running',
        minutes: 30,
        calories: 250,
      },
    ]);
  });

  it('HEALTH-HK-361: never calls the OS for an empty or inverted window', async () => {
    const native = fakeNative();
    const bridge = createNativeHealthKitBridge(native);
    const now = new Date(2026, 6, 25, 12).toISOString();

    await expect(bridge.queryWorkouts({ start: now, end: now })).resolves.toEqual([]);
    expect(native.queryWorkouts).not.toHaveBeenCalled();
  });

  it('HEALTH-HK-362: drops a session with no uuid, no type, or no positive duration', () => {
    expect(toWorkoutSamples([nativeWorkout({ uuid: '' })])).toEqual([]);
    expect(toWorkoutSamples([nativeWorkout({ workoutType: '' })])).toEqual([]);
    expect(toWorkoutSamples([nativeWorkout({ minutes: 0 })])).toEqual([]);
  });

  it('HEALTH-HK-363: keeps distance only when it is a positive measurement', () => {
    const [withDistance] = toWorkoutSamples([nativeWorkout({ distanceMeters: 5000 })]);
    expect(withDistance.distanceMeters).toBe(5000);
    const [without] = toWorkoutSamples([nativeWorkout()]);
    expect(without).not.toHaveProperty('distanceMeters');
  });

  it('HEALTH-HK-364: tolerates a module that answers with junk instead of an array', () => {
    expect(toWorkoutSamples(null)).toEqual([]);
    expect(toWorkoutSamples(undefined)).toEqual([]);
    expect(toWorkoutSamples([null as unknown as HealthKitNativeWorkoutSample])).toEqual([]);
  });
});

/* ========================= The native side, as text ===================== */

describe('the native module keeps the same promises as the TypeScript', () => {
  const swift = readRepoFile(MODULE_DIR, 'ios', 'SymplyHealthKitModule.swift');
  const code = swiftCode(swift);

  it('HEALTH-HK-340: the Swift allow-list is exactly HEALTHKIT_READ_IDENTIFIERS', () => {
    // `\w*` (not `\w+`) so this also matches the bare `HKWorkoutTypeIdentifier`
    // sentinel, which has no suffix the way `...StepCount`/`...BodyMass` do.
    const declared = (
      code.match(/"HK(?:Quantity|Category|Workout)TypeIdentifier\w*"/g) ?? []
    ).map((raw) => raw.slice(1, -1));
    // Two hand-written copies of the same identifiers; one extra on either side
    // is a widened permission footprint nobody reviewed.
    expect([...new Set(declared)].sort()).toEqual([...HEALTHKIT_READ_IDENTIFIERS].sort());
  });

  it('HEALTH-HK-341: the Swift has no write path at all', () => {
    expect(code).toContain('requestAuthorization(toShare: [], read: types)');
    // The three ways a HealthKit write can happen. None may appear in the code.
    // (`HKWorkout` itself is fine — it's read via `HKSampleQuery`, never built.)
    expect(code).not.toMatch(/\bhealthStore\.save\(|\bstore\.save\(/);
    expect(code).not.toMatch(/HKWorkoutBuilder|HKLiveWorkoutBuilder|HKWorkoutSession/);
    expect(code).not.toMatch(/HKQuantitySample\(type:|HKCategorySample\(type:/);
  });

  it('HEALTH-HK-342: the Swift DOES subscribe — HKObserverQuery + background delivery', () => {
    // The donor ran 25 observer queries with background delivery; this port asks
    // for fewer types but DOES now use the same mechanism, so a change in Apple
    // Health (including one written by a third-party app) can be reacted to
    // without a Sync tap. See `SymplyHealthKitModule.swift`'s header comment for
    // the full "what background delivery does and does not do" note.
    expect(code).toContain('HKObserverQuery');
    expect(code).toContain('enableBackgroundDelivery');
    expect(code).toContain('HKAnchoredObjectQuery');
    // The completion handler HealthKit is waiting on must always be called, or
    // future background deliveries silently stop.
    expect(code).toContain('completionHandler()');
  });

  it('HEALTH-HK-345: a background-observed change posts a local notification only when the app is not active', () => {
    expect(code).toContain('UNUserNotificationCenter');
    expect(code).toContain('applicationState != .active');
    // Generic, value-free copy — never a sample value, a food, or a weight figure.
    expect(code).not.toMatch(/content\.body = ".*(kg|lb|calorie|bpm)/i);
  });

  it('HEALTH-HK-346: consumePendingSync reads and clears the same flag the observer sets', () => {
    expect(code).toContain('AsyncFunction("consumePendingSync")');
    expect(code).toContain('pendingSyncKey');
  });

  it('HEALTH-HK-343: the module name the JS looks up is the name Swift registers', () => {
    expect(code).toContain(`Name("${HEALTHKIT_NATIVE_MODULE_NAME}")`);

    const config = JSON.parse(readRepoFile(MODULE_DIR, 'expo-module.config.json')) as {
      apple: { modules: string[] };
    };
    expect(config.apple.modules).toEqual(['SymplyHealthKitModule']);
    expect(readRepoFile(MODULE_DIR, 'ios', 'SymplyHealthKit.podspec')).toContain(
      `s.name           = '${HEALTHKIT_NATIVE_MODULE_NAME}'`,
    );
  });

  it('HEALTH-HK-344: sleep counts only time actually asleep', () => {
    // The donor's iOS path measured last.endDate - first.startDate over everything
    // that was not `.inBed`, so awake stretches counted as sleep. Its own Watch app
    // did it properly; we follow the Watch.
    expect(code).toContain('HKCategoryValueSleepAnalysis.allAsleepValues');
    expect(code).not.toContain('.inBed');
  });
});

describe('the iOS build only asks Symply Health for health data', () => {
  const infoPlist = readRepoFile(IOS_DIR, 'SymplyEcosystem', 'Info.plist');
  const brandXcconfig = readRepoFile(IOS_DIR, 'Brand.xcconfig');
  const sharedDebug = readRepoFile(IOS_DIR, 'SymplyEcosystem', 'SymplyEcosystem.entitlements');
  const sharedRelease = readRepoFile(
    IOS_DIR,
    'SymplyEcosystem',
    'SymplyEcosystem-Release.entitlements',
  );
  const healthDebug = readRepoFile(
    IOS_DIR,
    'SymplyEcosystem',
    'SymplyEcosystem-Health.entitlements',
  );
  const healthRelease = readRepoFile(
    IOS_DIR,
    'SymplyEcosystem',
    'SymplyEcosystem-Health-Release.entitlements',
  );

  it('HEALTH-HK-350: only the Health entitlements carry com.apple.developer.healthkit', () => {
    for (const entitlements of [healthDebug, healthRelease]) {
      expect(entitlements).toContain('<key>com.apple.developer.healthkit</key>');
      // Empty access array = no clinical records.
      expect(entitlements).toContain('<key>com.apple.developer.healthkit.access</key>');
    }
    // House / Budget / Kaizen / Language share these two. If HealthKit appears here
    // their App IDs stop signing AND four unrelated apps start asking for health data.
    for (const entitlements of [sharedDebug, sharedRelease]) {
      expect(entitlements).not.toContain('com.apple.developer.healthkit');
    }
  });

  it('HEALTH-HK-351: only the Health entitlements ask for background delivery', () => {
    // `SymplyHealthKitModule` runs `HKObserverQuery` + `enableBackgroundDelivery`
    // (HEALTH-HK-342), so the entitlement that turns it on IS present now — but
    // only on the two Health build configurations, never the four sibling apps
    // that share this native tree and have no observer running at all.
    for (const entitlements of [healthDebug, healthRelease]) {
      expect(entitlements).toContain('<key>com.apple.developer.healthkit.background-delivery</key>');
    }
    for (const entitlements of [sharedDebug, sharedRelease]) {
      expect(entitlements).not.toContain('com.apple.developer.healthkit.background-delivery');
    }
  });

  it('HEALTH-HK-352: the purpose string is non-empty everywhere, not a brand gate', () => {
    expect(infoPlist).toContain('<key>NSHealthShareUsageDescription</key>');
    expect(infoPlist).toContain('<string>$(SYMPLY_HEALTHKIT_SHARE_USAGE)</string>');
    // App Store Connect's binary validator (90683) requires this key non-empty on
    // every brand that links SymplyHealthKitModule — which is all five — so the
    // shared default is real text, not blank. It is the entitlement
    // (HEALTH-HK-350), not this string, that keeps House / Budget / Kaizen /
    // Language out of HealthKit; see SymplyHealthKitModule.isUsable().
    expect(brandXcconfig).toMatch(/^SYMPLY_HEALTHKIT_SHARE_USAGE\s*=\s*\S.+$/m);
  });

  it('HEALTH-HK-353: the write purpose says there is nothing to write, because nothing writes', () => {
    // Present (not absent) for the same 90683 reason as HK-352 — App Store Connect
    // requires it whenever the share key is required — but the shared default is
    // honest about doing nothing, and HEALTHKIT_WRITE_IDENTIFIERS (HK-342) stays
    // empty regardless of what this string says.
    expect(infoPlist).toContain('<key>NSHealthUpdateUsageDescription</key>');
    expect(brandXcconfig).toMatch(/^SYMPLY_HEALTHKIT_UPDATE_USAGE\s*=\s*\S.+$/m);
  });

  it('HEALTH-HK-354: the Health configurations are the ones wired to the Health entitlements', () => {
    const pbxproj = readRepoFile(
      IOS_DIR,
      'SymplyEcosystem.xcodeproj',
      'project.pbxproj',
    );
    // Matched with the quotes OPTIONAL. `pod install` rewrites this file and
    // re-quotes any value containing a hyphen, so pinning one spelling makes the
    // test fail on the next pod install for a purely cosmetic reason. What must
    // hold is which entitlements file each Health configuration points at.
    expect(pbxproj).toMatch(
      /CODE_SIGN_ENTITLEMENTS = "?SymplyEcosystem\/SymplyEcosystem-Health\.entitlements"?;/,
    );
    expect(pbxproj).toMatch(
      /CODE_SIGN_ENTITLEMENTS = "?SymplyEcosystem\/SymplyEcosystem-Health-Release\.entitlements"?;/,
    );
    // And exactly one configuration each — a second would mean a sibling brand
    // had been wired to the Health entitlements too.
    expect(
      pbxproj.match(/SymplyEcosystem-Health\.entitlements/g) ?? [],
    ).toHaveLength(1);
    expect(
      pbxproj.match(/SymplyEcosystem-Health-Release\.entitlements/g) ?? [],
    ).toHaveLength(1);
    // …and the purpose string is pinned to the same two brand configurations.
    expect(pbxproj.match(/SYMPLY_HEALTHKIT_SHARE_USAGE = "/g) ?? []).toHaveLength(2);
  });
});
