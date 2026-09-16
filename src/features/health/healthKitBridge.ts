/**
 * Symply Health — the real `HealthKitBridge`, over the `SymplyHealthKit` native
 * module (`modules/symply-healthkit/`).
 *
 * ## What this is
 *
 * The adapter the service in `healthKit.ts` was written against, and nothing more.
 * `healthKit.ts` already owns availability, the permission state machine, the
 * window, sample→payload mapping, de-duplication against the server and every
 * string the user reads. This file only:
 *
 *   1. decides whether a real bridge may exist at all (brand + platform + module),
 *   2. turns our type names into Apple identifiers and back,
 *   3. converts epoch-milliseconds into ISO instants,
 *   4. refuses anything outside the five scoped types.
 *
 * It adds no state, no caching and no retries. If it grows any, it has become a
 * second service and belongs in `healthKit.ts` instead.
 *
 * ## Why the brand gate is here and not only in native
 *
 * House, Budget, Kaizen and Language build from this same `src/` tree. None of them
 * may ask for health data, so `resolveHealthKitBridge()` answers `null` for them
 * before a single native call is made — `createHealthKitService` then falls back to
 * `nullHealthKitBridge` and reports `no-bridge`, exactly as it did before any native
 * module existed. The native module gates itself again on the entitlement and the
 * purpose string (see `SymplyHealthKitModule.swift`); this is the first of three
 * independent locks, not the only one.
 *
 * ## Honesty
 *
 * `null` and `unavailable` are the DEFAULT answers here, not failure modes. A
 * simulator, an Android handset, a build without the HealthKit entitlement and an
 * Expo Go session all land in the same place: the card says Apple Health is not
 * available, and every Health tab keeps working on typed entries alone.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { brandId } from '@brand';

import type { HealthKitBridge, HealthKitQuery, HealthKitRawAuthorization } from './healthKit';
import {
  HEALTHKIT_TYPES,
  isScopedIdentifier,
  type HealthKitDataType,
  type HealthKitSample,
  type HealthKitWorkoutSample,
} from './healthKitTypes';

/* ============================== Native shape ============================= */

/** One sample as the Swift module hands it over. Epoch MILLISECONDS, never dates. */
export interface HealthKitNativeSample {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly value: number;
  readonly unit: string;
  /** e.g. "Apple Watch". Display only — never forwarded to the server. */
  readonly sourceName?: string;
}

/** One workout as the Swift module hands it over. Epoch MILLISECONDS, never dates. */
export interface HealthKitNativeWorkoutSample {
  readonly uuid: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly workoutType: string;
  readonly minutes: number;
  readonly calories: number;
  readonly distanceMeters?: number;
  readonly sourceName?: string;
}

/** The payload `onHealthDataChanged` carries — which scoped identifier changed. */
export interface HealthKitChangeEvent {
  readonly type: string;
}

/**
 * The methods (and the one event) `SymplyHealthKitModule` exposes.
 *
 * Deliberately NOT the same shape as `HealthKitBridge`: the native side speaks
 * Apple's vocabulary (identifiers, epoch millis) and this file translates. That way
 * neither side has to know the other's naming, and swapping the native module for a
 * community package later is a change to this file alone.
 *
 * `addListener` / `consumePendingSync` are deliberately NOT part of
 * `HealthKitBridge` — that interface is "how to read data" and stays testable
 * against a plain fake; background-wake-up concerns are native-module-specific and
 * are consumed directly by `healthKitBackgroundSync.ts` via `nativeHealthKitModule()`.
 */
export interface HealthKitNativeModule {
  isAvailable(): Promise<boolean>;
  getAuthorizationStatus(identifiers: string[]): Promise<Record<string, string>>;
  requestAuthorization(identifiers: string[]): Promise<Record<string, string>>;
  querySamples(
    identifier: string,
    startMs: number,
    endMs: number,
  ): Promise<readonly HealthKitNativeSample[]>;
  queryWorkouts(startMs: number, endMs: number): Promise<readonly HealthKitNativeWorkoutSample[]>;
  /** Reads and clears "a background observer saw a real change since last asked". */
  consumePendingSync(): Promise<boolean>;
  /** Expo Modules' `EventEmitter` surface — every `Module` with an `Events(...)` block gets this for free. */
  addListener(
    eventName: 'onHealthDataChanged',
    listener: (event: HealthKitChangeEvent) => void,
  ): { remove: () => void };
}

/** The Expo module name declared in `modules/symply-healthkit/expo-module.config.json`. */
export const HEALTHKIT_NATIVE_MODULE_NAME = 'SymplyHealthKit';

/**
 * The only brand allowed to ask iOS for health data.
 *
 * Mirrors `isHealthBrand()` in `src/features/health/index.ts`, restated as a literal
 * because that module re-exports the whole Health screen graph — importing it here
 * would pull the screens into the service's dependency graph and close an import
 * cycle. `HEALTH-HK-303` pins the two against each other.
 */
export const HEALTHKIT_BRAND_ID = 'symply-health';

/* ============================== Conversion ============================== */

const RAW_AUTHORIZATIONS: readonly HealthKitRawAuthorization[] = [
  'notDetermined',
  'sharingDenied',
  'sharingAuthorized',
];

function asRawAuthorization(value: unknown): HealthKitRawAuthorization | null {
  return typeof value === 'string' &&
    (RAW_AUTHORIZATIONS as readonly string[]).includes(value)
    ? (value as HealthKitRawAuthorization)
    : null;
}

/**
 * Native status map → the bridge's status map.
 *
 * Two filters, both intentional: an identifier outside our five is dropped even if
 * the module volunteers it, and a status string we do not recognise is dropped
 * rather than guessed. Both come back as "absent", which
 * `mapRawAuthorization(undefined, …)` reads as not-requested/undisclosed — never as
 * a grant.
 */
export function toAuthorizationMap(
  raw: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, HealthKitRawAuthorization> {
  const out: Record<string, HealthKitRawAuthorization> = {};
  if (!raw || typeof raw !== 'object') return out;

  for (const [identifier, value] of Object.entries(raw)) {
    if (!isScopedIdentifier(identifier)) continue;
    const status = asRawAuthorization(value);
    if (status) out[identifier] = status;
  }
  return out;
}

function toIso(epochMs: unknown): string | null {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null;
  const at = new Date(epochMs);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Native samples → `HealthKitSample`s of ONE known type.
 *
 * Anything malformed is dropped, never repaired: a unit that does not match the
 * descriptor means the native side failed to normalise, and guessing would turn
 * 70 kg into 70 lb in somebody's weight log. `healthKit.ts` re-checks all of this —
 * belt and braces is the point.
 */
export function toSamples(
  type: HealthKitDataType,
  native: readonly HealthKitNativeSample[] | null | undefined,
): HealthKitSample[] {
  const descriptor = HEALTHKIT_TYPES[type];
  if (!descriptor || !Array.isArray(native)) return [];

  const samples: HealthKitSample[] = [];
  for (const row of native) {
    if (!row || typeof row !== 'object') continue;
    if (row.unit !== descriptor.unit) continue;
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) continue;

    const startedAt = toIso(row.startedAt);
    if (!startedAt) continue;
    const endedAt = toIso(row.endedAt) ?? startedAt;

    samples.push({
      type,
      startedAt,
      endedAt,
      value: row.value,
      unit: descriptor.unit,
      ...(typeof row.sourceName === 'string' && row.sourceName
        ? { sourceName: row.sourceName }
        : {}),
    });
  }
  return samples;
}

/**
 * Native workout rows → `HealthKitWorkoutSample`s.
 *
 * Same "never repair, only drop" rule as `toSamples`: a session with no positive
 * duration, or a start instant that will not parse, is dropped rather than guessed.
 */
export function toWorkoutSamples(
  native: readonly HealthKitNativeWorkoutSample[] | null | undefined,
): HealthKitWorkoutSample[] {
  if (!Array.isArray(native)) return [];

  const out: HealthKitWorkoutSample[] = [];
  for (const row of native) {
    if (!row || typeof row !== 'object') continue;
    if (typeof row.uuid !== 'string' || !row.uuid) continue;
    if (typeof row.minutes !== 'number' || !Number.isFinite(row.minutes) || row.minutes <= 0) continue;
    if (typeof row.workoutType !== 'string' || !row.workoutType) continue;

    const startedAt = toIso(row.startedAt);
    if (!startedAt) continue;
    const endedAt = toIso(row.endedAt) ?? startedAt;

    const calories =
      typeof row.calories === 'number' && Number.isFinite(row.calories) && row.calories >= 0
        ? row.calories
        : 0;

    out.push({
      uuid: row.uuid,
      startedAt,
      endedAt,
      workoutType: row.workoutType,
      minutes: row.minutes,
      calories,
      ...(typeof row.distanceMeters === 'number' && row.distanceMeters > 0
        ? { distanceMeters: row.distanceMeters }
        : {}),
      ...(typeof row.sourceName === 'string' && row.sourceName ? { sourceName: row.sourceName } : {}),
    });
  }
  return out;
}

/* ================================ Bridge ================================ */

/**
 * Wrap a native module in the bridge contract.
 *
 * Exported separately from `resolveHealthKitBridge` so the whole translation layer
 * is testable against a fake native module — no simulator, no entitlement, no
 * device (HEALTH-HK-31x…34x).
 */
export function createNativeHealthKitBridge(native: HealthKitNativeModule): HealthKitBridge {
  return {
    isAvailable: async () => (await native.isAvailable()) === true,

    getAuthorizationStatus: async (identifiers) =>
      toAuthorizationMap(await native.getAuthorizationStatus(scopeOnly(identifiers))),

    requestAuthorization: async (identifiers) =>
      toAuthorizationMap(await native.requestAuthorization(scopeOnly(identifiers))),

    querySamples: async (query: HealthKitQuery) => {
      const descriptor = HEALTHKIT_TYPES[query.type];
      if (!descriptor) return [];

      const start = Date.parse(query.start);
      const end = Date.parse(query.end);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];

      const raw = await native.querySamples(descriptor.identifier, start, end);
      return toSamples(query.type, raw);
    },

    queryWorkouts: async (query) => {
      const start = Date.parse(query.start);
      const end = Date.parse(query.end);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];

      return toWorkoutSamples(await native.queryWorkouts(start, end));
    },
  };
}

/**
 * Never hand the OS an identifier we have not published in `healthKitTypes.ts`,
 * whatever the caller passed.
 */
function scopeOnly(identifiers: readonly string[]): string[] {
  return identifiers.filter(isScopedIdentifier);
}

/* =============================== Resolution ============================= */

export interface HealthKitBridgeEnvironment {
  /** Defaults to the autolinked `SymplyHealthKit` module. */
  native?: HealthKitNativeModule | null;
  /** Defaults to `Platform.OS`. */
  platform?: string;
  /** Defaults to the running brand. */
  brand?: string;
}

/**
 * The bridge for this build, or `null` when there cannot be one.
 *
 * `null` — not a throwing bridge, not a stub that pretends — is returned when:
 *
 *   * the brand is not Symply Health (House / Budget / Kaizen / Language),
 *   * the platform is not iOS,
 *   * the native module is not linked (Expo Go, a stale build, Jest).
 *
 * `createHealthKitService` maps `null` to `nullHealthKitBridge`, whose availability
 * reason is `'no-bridge'`. Everything downstream — card copy, import, tests —
 * behaves exactly as it did before this module existed.
 */
export function resolveHealthKitBridge(
  environment: HealthKitBridgeEnvironment = {},
): HealthKitBridge | null {
  const brand = environment.brand ?? brandId;
  if (brand !== HEALTHKIT_BRAND_ID) return null;

  const platform = environment.platform ?? Platform.OS;
  if (platform !== 'ios') return null;

  const native =
    environment.native !== undefined ? environment.native : nativeHealthKitModule();
  if (!native) return null;

  return createNativeHealthKitBridge(native);
}

/**
 * The autolinked module, or `null`.
 *
 * `requireOptionalNativeModule` is the New-Architecture-safe lookup used by
 * `src/services/roomplan.ts` and `src/services/widget-sync.ts`: under bridgeless,
 * `NativeModules.X` can resolve `null` for a module that is in fact present, while
 * this cannot. Resolved lazily rather than at module scope so importing this file
 * (which Jest does, on every Health suite) never touches the native registry.
 */
export function nativeHealthKitModule(): HealthKitNativeModule | null {
  try {
    return (
      requireOptionalNativeModule<HealthKitNativeModule>(HEALTHKIT_NATIVE_MODULE_NAME) ?? null
    );
  } catch {
    return null;
  }
}
