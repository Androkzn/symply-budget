/**
 * Symply Health — the More tab's ONE preference, and everywhere it lands.
 *
 * `HealthMoreScreen` writes exactly one thing: the global unit system, through
 * `setPreferredUnit(u)` (a thin compatibility wrapper over `setUnitSystem`).
 * `HealthMoreScreen.test.tsx` proves the row calls it and re-renders from what
 * storage returned. What it cannot prove — because the screen mocks
 * `healthLocalStorage` to a seam — is the half that actually matters to a
 * member: that the choice REACHES the screens and the importer that read it
 * back.
 *
 * Three consumers read `preferredUnit`, and none of them shares a module with
 * the writer:
 *
 *   1. `healthGoalsStorage.loadHealthGoals()` → `snapshot.unit`, which is the
 *      unit every figure on the Goals screen is labelled with.
 *   2. `healthWeightAnalytics.dominantUnit(entries, preferred)` → the Weight
 *      tab's axis and input unit, with the preference as the FALLBACK only.
 *   3. `healthKit.createHealthKitService()` → the unit imported Apple Health
 *      body-mass readings are written in. The weight log stores a unit per row
 *      and `weightDelta()` refuses to compare across units, so importing
 *      kilograms into a log kept in pounds silently flattens a trend line.
 *
 * A unit change is SERVER-SYNCED (0141, `health_goals.unit_system`) — the
 * opposite of what this suite asserted before that migration. The donor kept
 * the toggle device-local, and parity P1 did NOT move it at first, but a
 * choice made once during onboarding should not have to be repeated on a
 * second device, the same reasoning `water_unit` (0140) already established
 * for this table — see `healthLocalStorage.test.ts`'s own `HEALTH-STORE-044`.
 *
 * Runs against the REAL `storageHelpers` (in-memory MMKV) and the REAL storage
 * modules. `@api/health` is mocked via `fakeGoalServer`, a small in-memory
 * simulator of the shared `health_goals` row.
 */

import { healthApi } from '@api/health';
import { storageHelpers } from '@services/storage';

import { HEALTH_CACHE_KEYS } from '../../healthCacheKeys';
import { loadHealthGoals } from '../../healthGoalsStorage';
import {
  createHealthKitService,
  type HealthKitBridge,
  type HealthKitImportSink,
  type HealthKitRawAuthorization,
} from '../../healthKit';
import {
  HEALTHKIT_READ_IDENTIFIERS,
  type HealthKitSample,
  type HealthKitWeightPayload,
} from '../../healthKitTypes';
import {
  DEFAULT_HEALTH_PREFS,
  HEALTH_UNIT_SYSTEM_KEY,
  loadHealthPrefs,
  setPreferredUnit,
  todayDateKey,
  type WeightEntry,
} from '../../healthLocalStorage';
import { clearHealthCache } from '../../healthRepository';
import { dominantUnit } from '../../healthWeightAnalytics';
import {
  fakeGoalServer,
  installHealthApiDefaults,
  type MockedHealthApi,
} from '../../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

/** Midday, so the local date key is the same on either side of UTC. */
const FIXED_NOW = new Date('2026-07-26T12:00:00.000Z');

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * 1. The write itself — what the More row actually persists.
 * ------------------------------------------------------------------ */

describe('HEALTH-MORE-076 — the unit write', () => {
  it('persists through the shared goal row, the key every reader loads', async () => {
    const goal = fakeGoalServer(api, { unit_system: null });

    const returned = await setPreferredUnit('lb');
    expect(returned.preferredUnit).toBe('lb');
    expect(returned.unitSystem).toBe('imperial');

    // The shared server row, not just the cache: a reader that re-fetches
    // (the widget snapshot, a second device) has to find it too.
    expect(goal.goal.unit_system).toBe('imperial');

    // …and a freshly mounted screen reads back exactly that.
    expect((await loadHealthPrefs()).preferredUnit).toBe('lb');
  });

  it('round-trips in BOTH directions, not just away from the default', async () => {
    // kg is the default, so "switch to lb" can pass on a writer that only ever
    // writes lb. Switching back is what proves the value is the argument.
    const goal = fakeGoalServer(api, { unit_system: null });

    await setPreferredUnit('lb');
    expect((await loadHealthPrefs()).preferredUnit).toBe('lb');

    await setPreferredUnit('kg');
    expect((await loadHealthPrefs()).preferredUnit).toBe('kg');
    expect(goal.goal.unit_system).toBe('metric');
  });

  it('IS a network write — the opposite of the old device-local toggle', async () => {
    fakeGoalServer(api, { unit_system: null });

    await setPreferredUnit('lb');
    await loadHealthPrefs();

    expect(api.saveGoal).toHaveBeenCalledWith(expect.objectContaining({ unit_system: 'imperial' }));
    expect(api.getGoal).toHaveBeenCalled();
  });

  it('leaves the rest of the preference record intact', async () => {
    fakeGoalServer(api, { unit_system: 'metric' });
    const next = await setPreferredUnit('lb');

    expect(Object.keys(next).sort()).toEqual(Object.keys(DEFAULT_HEALTH_PREFS).sort());
  });

  it('cannot switch on HealthKit or AI as a side effect', async () => {
    // Shell invariant (BRD §7): both stay OFF regardless of what was persisted.
    // The More tab has no control for either, so a unit write that flipped one
    // would be the only way they could ever become true.
    fakeGoalServer(api, { unit_system: null });

    const after = await setPreferredUnit('lb');
    expect(after.healthKitEnabled).toBe(false);
    expect(after.aiEnabled).toBe(false);
    expect((await loadHealthPrefs()).healthKitEnabled).toBe(false);
  });

  it('the cached copy is cleared on sign-out, exactly as the privacy explainer claims', async () => {
    // "Signing out clears the copy cached on this device" is a promise the More
    // tab makes in words. `health.unitSystem.v1` is the offline cache the unit
    // system is mirrored into, so if any key has to be in that list it is this
    // one — the server row itself is per-account, not per-device, and is
    // untouched by sign-out.
    expect(HEALTH_CACHE_KEYS).toContain(HEALTH_UNIT_SYSTEM_KEY);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The readers — the screens that render the chosen unit.
 * ------------------------------------------------------------------ */

describe('HEALTH-MORE-077 — the Goals screen reads the More choice', () => {
  it('labels the goals snapshot with the unit chosen on More', async () => {
    await setPreferredUnit('lb');
    expect((await loadHealthGoals()).unit).toBe('lb');

    await setPreferredUnit('kg');
    expect((await loadHealthGoals()).unit).toBe('kg');
  });

  it('falls back to kilograms when nothing was ever chosen', async () => {
    // A never-touched More tab must still give the Goals screen a unit; a blank
    // one renders "82" with no idea what it is.
    expect((await loadHealthGoals()).unit).toBe(DEFAULT_HEALTH_PREFS.preferredUnit);
    expect((await loadHealthGoals()).unit).toBe('kg');
  });
});

describe('HEALTH-MORE-078 — the Weight tab uses it as a FALLBACK, not an override', () => {
  const entry = (unit: 'kg' | 'lb', id: string): WeightEntry => ({
    id,
    value: 80,
    unit,
    loggedAt: '2026-07-26T09:00:00.000Z',
    date: '2026-07-26',
    note: '',
    source: 'manual',
  });

  it('uses the More preference when the log is empty', async () => {
    await setPreferredUnit('lb');
    const preferred = (await loadHealthPrefs()).preferredUnit;
    expect(dominantUnit([], preferred)).toBe('lb');
  });

  it('does NOT re-label existing readings that were logged in another unit', async () => {
    // The preference decides how NEW input is entered, never what an old row
    // means. Re-labelling a 80 kg reading as 80 lb would rewrite the member's
    // history from a settings tap — the single most damaging thing this
    // preference could do.
    await setPreferredUnit('lb');
    const preferred = (await loadHealthPrefs()).preferredUnit;
    expect(dominantUnit([entry('kg', 'w1'), entry('kg', 'w2')], preferred)).toBe('kg');
  });
});

/* ------------------------------------------------------------------ *
 * 3. The importer — Apple Health writes in the member's unit.
 * ------------------------------------------------------------------ */

/** A bridge that is available and fully authorised, with one body-mass sample. */
function grantedBridge(samples: readonly HealthKitSample[]): HealthKitBridge {
  const granted = Object.fromEntries(
    HEALTHKIT_READ_IDENTIFIERS.map((id) => [id, 'sharingAuthorized' as HealthKitRawAuthorization]),
  );
  return {
    isAvailable: () => true,
    getAuthorizationStatus: async () => granted,
    requestAuthorization: async () => granted,
    querySamples: async (query) => samples.filter((s) => s.type === query.type),
    queryWorkouts: async () => [],
  };
}

/** A sink that records what would have been POSTed instead of posting it. */
function recordingSink(): { sink: HealthKitImportSink; weights: HealthKitWeightPayload[] } {
  const weights: HealthKitWeightPayload[] = [];
  return {
    weights,
    sink: {
      listExisting: async () => [],
      create: async () => undefined,
      remove: async () => undefined,
      listExistingWeight: async () => [],
      createWeight: async (payload) => {
        weights.push(payload);
      },
      removeWeight: async () => undefined,
    },
  };
}

describe('HEALTH-MORE-079 — Apple Health imports in the unit More chose', () => {
  function bodyMassSample(): HealthKitSample {
    const day = todayDateKey();
    return {
      type: 'bodyMass',
      startedAt: `${day}T09:00:00.000Z`,
      endedAt: `${day}T09:00:00.000Z`,
      value: 80,
      unit: 'kg',
    };
  }

  async function importWith(unit: 'kg' | 'lb'): Promise<HealthKitWeightPayload[]> {
    await setPreferredUnit(unit);
    const { sink, weights } = recordingSink();
    // No `weightUnit` in the config ON PURPOSE — the default resolver is the
    // thing under test, and passing one would stub out the whole contract.
    const service = createHealthKitService({ bridge: grantedBridge([bodyMassSample()]), sink });
    await service.requestPermission();
    // `importNow` yields via a real `setTimeout(…, 0)` between per-type reads
    // (lets a foreground drag finish its gesture handoff) — under this file's
    // fake timers that promise never settles on its own, so it must be flushed
    // alongside the await rather than awaited directly.
    const importing = service.importNow({ days: 1 });
    await jest.runAllTimersAsync();
    await importing;
    return weights;
  }

  it('writes kilograms for a member who kept the default', async () => {
    const weights = await importWith('kg');
    expect(weights).toHaveLength(1);
    expect(weights[0].unit).toBe('kg');
    expect(weights[0].source).toBe('healthkit');
    expect(weights[0].weight).toBeCloseTo(80, 1);
  });

  it('writes POUNDS — converted, not relabelled — for a member who chose lb', async () => {
    // The two failure modes are opposite and both silent: storing `80` with a
    // `lb` label (an 80 lb member), or storing `176` with a `kg` label. The
    // magnitude assertion is what tells them apart.
    const weights = await importWith('lb');
    expect(weights).toHaveLength(1);
    expect(weights[0].unit).toBe('lb');
    expect(weights[0].weight).toBeGreaterThan(150);
    expect(weights[0].weight).toBeLessThan(200);
  });

  it('imports in kilograms when the preference cannot be read at all', async () => {
    // `safely(..., 'kg')` — a storage read that throws must not abort an import
    // or invent a unit. kg is HealthKit's own unit, so it is the honest default.
    const spy = jest
      .spyOn(storageHelpers, 'getObject')
      .mockRejectedValue(new Error('storage unavailable'));
    try {
      const { sink, weights } = recordingSink();
      const service = createHealthKitService({
        bridge: grantedBridge([bodyMassSample()]),
        sink,
      });
      await service.requestPermission();
      // See `importWith` above — the per-type read yields on a real timer.
      const importing = service.importNow({ days: 1 });
      await jest.runAllTimersAsync();
      await importing;
      expect(weights).toHaveLength(1);
      expect(weights[0].unit).toBe('kg');
    } finally {
      spy.mockRestore();
    }
  });
});
