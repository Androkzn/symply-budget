/**
 * Symply Health — Men's Health / vitality tracking (donor `MensHealthView`).
 *
 * The score formulas are ported VERBATIM from the donor's computed properties,
 * so they are pinned arithmetic-by-arithmetic: this is a wellness self-check the
 * screen labels with a disclaimer, and a drifting formula would quietly change
 * what the app tells someone about their own body.
 *
 * On top of that the suite covers the wire layer (the donor's ~25 snake_case
 * columns ↔ the screen's camelCase entry, with D1's 0/1 integers standing in for
 * booleans) and the offline layer, which matters more here than anywhere else:
 * this is intimate data logged once a day, and a dropped request must not look
 * like the entry was lost.
 */

import { healthApi, type HealthMensEntry } from '@api/health';
import { storageHelpers } from '@services/storage';

import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';
import {
  activeIssues,
  clampKegelSets,
  clampScale,
  createEmptyVitalityEntry,
  deleteVitalityEntry,
  energyScore,
  erectionScore,
  HEALTH_MENS_SETTINGS_KEY,
  HEALTH_VITALITY_KEY,
  libidoDescription,
  loadVitalityEntries,
  loadVitalityForDate,
  mentalScore,
  NEUTRAL_SCORE,
  saveVitalityEntry,
  sexualHealthScore,
  summarizeVitality,
  VITALITY_ISSUE_LABELS,
  VITALITY_ISSUES,
  VITALITY_SCALE_ICONS,
  VITALITY_SCALE_LABELS,
  VITALITY_SCALES,
  vitalityScore,
  vitalityStatus,
  type VitalityEntry,
} from '../healthVitalityStorage';
import {
  installHealthApiDefaults,
  mensRow,
  NETWORK_ERROR,
  ok,
  type MockedHealthApi,
} from '../test-utils/healthApiTestKit';

jest.mock('@api/health');

const api = healthApi as unknown as MockedHealthApi;

const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);
const TODAY = '2026-07-13';

function entry(over: Partial<VitalityEntry> = {}): VitalityEntry {
  return { ...createEmptyVitalityEntry(over.date ?? TODAY), ...over };
}

/** Stand-in for `/health/mens-health/entries` — strictly one row per date. */
function fakeMensServer(): { rows: HealthMensEntry[] } {
  const state = { rows: [] as HealthMensEntry[] };
  api.listMensHealth.mockImplementation(() => Promise.resolve(ok({ entries: [...state.rows] })));
  api.saveMensHealth.mockImplementation((body) => {
    const row = mensRow({
      ...(body as unknown as Partial<HealthMensEntry>),
      id: `v-${body.date}`,
      updated_at: new Date().toISOString(),
    });
    state.rows = [...state.rows.filter((r) => r.date !== body.date), row];
    return Promise.resolve(ok({ entry: row }));
  });
  return state;
}

beforeEach(async () => {
  await storageHelpers.clearAll();
  await clearHealthCache([]);
  __setHealthOfflineForTests(false);
  jest.resetAllMocks();
  installHealthApiDefaults(api);
  jest.useFakeTimers().setSystemTime(FIXED_NOW);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
  jest.useRealTimers();
});

/* ---------------------------------------------------------------- */
/* Donor contract + clamps                                           */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — donor contract', () => {
  it('HEALTH-VITAL-001: every issue and every 1–10 scale carries a label', () => {
    expect(VITALITY_ISSUES).toHaveLength(7);
    for (const issue of VITALITY_ISSUES) expect(VITALITY_ISSUE_LABELS[issue]).toBeTruthy();
    for (const scale of VITALITY_SCALES) {
      expect(VITALITY_SCALE_LABELS[scale]).toBeTruthy();
      expect(VITALITY_SCALE_ICONS[scale]).toBeTruthy();
    }
  });

  it('HEALTH-VITAL-002: an empty entry starts at the donor neutral midpoint', () => {
    const empty = createEmptyVitalityEntry(TODAY);

    // Every slider opens at 5/10 rather than 0, so an untouched day reads as
    // "neutral", not as "worst possible".
    expect(empty).toMatchObject({
      id: `vitality-${TODAY}`,
      date: TODAY,
      libido: 5,
      sexualDesireLevel: 5,
      energyLevel: 5,
      mentalClarity: 5,
      mood: 5,
      sleepQuality: 5,
      stressLevel: 5,
      kegelSets: 0,
      notes: '',
      loggedAt: '',
    });
    // The optional 1–10 fields stay null so "not recorded" survives a round trip.
    expect(empty.overallSatisfaction).toBeNull();
    expect(empty.morningErectionQuality).toBeNull();
    expect(empty.erectionQuality).toBeNull();
  });

  it('HEALTH-VITAL-003: clamps every scale into 1–10 and kegel sets into 0–50', () => {
    expect(clampScale(7)).toBe(7);
    expect(clampScale(0)).toBe(1);
    expect(clampScale(99)).toBe(10);
    expect(clampScale(6.6)).toBe(7);
    expect(clampScale(NaN)).toBe(1);

    expect(clampKegelSets(3)).toBe(3);
    expect(clampKegelSets(-1)).toBe(0);
    expect(clampKegelSets(999)).toBe(50);
    expect(clampKegelSets(NaN)).toBe(0);
  });
});

/* ---------------------------------------------------------------- */
/* Scores — ported verbatim from the donor                           */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — sub-scores', () => {
  it('HEALTH-VITAL-004: an unlogged day scores the donor neutral 50 on every axis', () => {
    // "No data" must never read as "bad" — an unlogged day would otherwise drag
    // the trend down and imply a problem the user never reported.
    expect(NEUTRAL_SCORE).toBe(50);
    expect(sexualHealthScore(null)).toBe(50);
    expect(erectionScore(null)).toBe(50);
    expect(energyScore(null)).toBe(50);
    expect(mentalScore(null)).toBe(50);
    expect(vitalityScore(null)).toBe(50);
  });

  it('HEALTH-VITAL-005: a neutral logged day also scores 50 across the board', () => {
    const neutral = entry();
    expect(sexualHealthScore(neutral)).toBe(50);
    expect(erectionScore(neutral)).toBe(50);
    expect(energyScore(neutral)).toBe(50);
    expect(mentalScore(neutral)).toBe(50);
    expect(vitalityScore(neutral)).toBe(50);
  });

  it('HEALTH-VITAL-006: sexual health = libido ±5/pt, +10 for activity, +3/pt satisfaction', () => {
    // 50 + (8−5)×5 = 65, +10 for activity, + (9−5)×3 = 87.
    expect(
      sexualHealthScore(
        entry({ libido: 8, hadPartnerSex: true, overallSatisfaction: 9 })
      )
    ).toBe(87);

    // Satisfaction only counts when there WAS activity — otherwise it would
    // reward a rating for a day nothing happened.
    expect(sexualHealthScore(entry({ libido: 8, overallSatisfaction: 9 }))).toBe(65);

    // Issues subtract: 50 − 20 (libido 1) − 10 anxiety − 15 low desire = 5.
    expect(
      sexualHealthScore(entry({ libido: 1, hadPerformanceAnxiety: true, hadLowDesire: true }))
    ).toBe(5);
  });

  it('HEALTH-VITAL-007: erection health = +20 morning, +2/pt quality, +3/pt overall', () => {
    // 50 + 20 + (8−5)×2 + (9−5)×3 = 88.
    expect(
      erectionScore(
        entry({ hadMorningErection: true, morningErectionQuality: 8, erectionQuality: 9 })
      )
    ).toBe(88);

    // 50 + (1−5)×3 − 20 − 15 = 3.
    expect(
      erectionScore(
        entry({
          erectionQuality: 1,
          hadErectionDifficulty: true,
          hadMaintenanceDifficulty: true,
        })
      )
    ).toBe(3);
  });

  it('HEALTH-VITAL-008: energy is the raw 1–10 level ×10, mental blends clarity/mood/stress', () => {
    expect(energyScore(entry({ energyLevel: 9 }))).toBe(90);
    expect(energyScore(entry({ energyLevel: 1 }))).toBe(10);

    // clarity×5 + mood×5 − (stress − 5)×3: low stress ADDS, high stress subtracts.
    expect(mentalScore(entry({ mentalClarity: 9, mood: 9, stressLevel: 2 }))).toBe(99);
    expect(mentalScore(entry({ mentalClarity: 4, mood: 4, stressLevel: 9 }))).toBe(28);
  });

  it('HEALTH-VITAL-009: every sub-score is bounded to 0–100', () => {
    // The screen renders these straight into percentage rings, so an unbounded
    // 112 or −5 would overdraw the arc.
    expect(
      sexualHealthScore(
        entry({ libido: 10, hadPartnerSex: true, overallSatisfaction: 10 })
      )
    ).toBe(100);
    expect(mentalScore(entry({ mentalClarity: 10, mood: 10, stressLevel: 1 }))).toBe(100);
    expect(
      erectionScore(
        entry({
          erectionQuality: 1,
          hadErectionDifficulty: true,
          hadMaintenanceDifficulty: true,
          hadMorningErection: false,
        })
      )
    ).toBeGreaterThanOrEqual(0);
  });

  it('HEALTH-VITAL-010: the headline score FLOORS the mean of the four sub-scores', () => {
    const good = entry({
      libido: 8,
      hadPartnerSex: true,
      overallSatisfaction: 9,
      hadMorningErection: true,
      morningErectionQuality: 8,
      erectionQuality: 9,
      energyLevel: 9,
      mentalClarity: 9,
      mood: 9,
      stressLevel: 2,
    });

    // (87 + 88 + 90 + 99) / 4 = 91 — floored, never rounded up, so the headline
    // can never read higher than the parts justify.
    expect(vitalityScore(good)).toBe(91);
  });

  it('HEALTH-VITAL-011: the status band boundaries are inclusive at 80 / 60 / 40', () => {
    expect(vitalityStatus(80)).toBe('Peak performance');
    expect(vitalityStatus(79)).toBe('Good condition');
    expect(vitalityStatus(60)).toBe('Good condition');
    expect(vitalityStatus(59)).toBe('Room for improvement');
    expect(vitalityStatus(40)).toBe('Room for improvement');
    expect(vitalityStatus(39)).toBe('Needs attention');
  });

  it('HEALTH-VITAL-012: libidoDescription reads the drive band, or prompts to track', () => {
    expect(libidoDescription(null)).toBe('Track your sex drive');
    expect(libidoDescription(entry({ libido: 8 }))).toBe('High drive');
    expect(libidoDescription(entry({ libido: 5 }))).toBe('Normal range');
    expect(libidoDescription(entry({ libido: 4 }))).toBe('Below average');
  });

  it('HEALTH-VITAL-013: activeIssues lists only the flagged issues, in card order', () => {
    expect(activeIssues(null)).toEqual([]);
    expect(activeIssues(entry())).toEqual([]);
    expect(
      activeIssues(entry({ hadLowDesire: true, hadPerformanceAnxiety: true }))
    ).toEqual(['hadPerformanceAnxiety', 'hadLowDesire']); // donor's listed order
  });
});

describe('healthVitalityStorage — trend summary', () => {
  it('HEALTH-VITAL-014: averages LOGGED days only and totals kegel sets', () => {
    const days = [
      entry({ date: '2026-07-13', energyLevel: 8, kegelSets: 3, hadLowDesire: true }),
      entry({ date: '2026-07-12', energyLevel: 5, kegelSets: 2 }),
      entry({ date: '2026-06-01', energyLevel: 1, kegelSets: 99 }), // outside the range
    ];

    // Dividing by the whole range instead of the logged days would understate
    // every figure on the Trends tab.
    expect(summarizeVitality(days, ['2026-07-12', '2026-07-13'])).toEqual({
      daysLogged: 2,
      averageScore: Math.round((vitalityScore(days[0]) + vitalityScore(days[1])) / 2),
      averageEnergy: 6.5,
      kegelSets: 5,
      issueDays: 1,
    });
  });

  it('HEALTH-VITAL-015: a range with nothing logged summarizes to zeroes, not to 50', () => {
    // The neutral 50 is a per-DAY placeholder; a range average of 50 would claim
    // data that does not exist.
    expect(summarizeVitality([], ['2026-07-13'])).toEqual({
      daysLogged: 0,
      averageScore: 0,
      averageEnergy: 0,
      kegelSets: 0,
      issueDays: 0,
    });
  });
});

/* ---------------------------------------------------------------- */
/* Wire contract                                                     */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — wire contract', () => {
  it('HEALTH-VITAL-016: an empty account reads as no entries', async () => {
    expect(await loadVitalityEntries()).toEqual([]);
    expect(await loadVitalityForDate()).toBeNull();
  });

  it('HEALTH-VITAL-017: maps snake_case columns onto the camelCase entry', async () => {
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({
            id: 'v-1',
            date: TODAY,
            libido: 8,
            had_partner_sex: true,
            overall_satisfaction: 9,
            had_morning_erection: true,
            morning_erection_quality: 8,
            erection_quality: 9,
            sexual_desire_level: 7,
            had_performance_anxiety: true,
            energy_level: 6,
            mental_clarity: 7,
            mood: 8,
            sleep_quality: 4,
            stress_level: 3,
            exercised: true,
            kegel_sets: 3,
            notes: 'Good day',
            updated_at: '2026-07-13T20:00:00.000Z',
          }),
        ],
      })
    );

    expect(await loadVitalityEntries()).toEqual<VitalityEntry[]>([
      {
        ...createEmptyVitalityEntry(TODAY),
        id: 'v-1',
        libido: 8,
        hadPartnerSex: true,
        overallSatisfaction: 9,
        hadMorningErection: true,
        morningErectionQuality: 8,
        erectionQuality: 9,
        sexualDesireLevel: 7,
        hadPerformanceAnxiety: true,
        energyLevel: 6,
        mentalClarity: 7,
        mood: 8,
        sleepQuality: 4,
        stressLevel: 3,
        exercised: true,
        kegelSets: 3,
        notes: 'Good day',
        loggedAt: '2026-07-13T20:00:00.000Z',
      },
    ]);
    expect(healthSyncStateFor(HEALTH_VITALITY_KEY)).toBe('synced');
  });

  it('HEALTH-VITAL-018: reads D1 integer booleans as booleans', async () => {
    api.listMensHealth.mockResolvedValue(
      ok({
        entries: [
          mensRow({
            date: TODAY,
            // D1 has no boolean type — flags come back as 1 / 0 integers.
            had_masturbation: 1 as unknown as boolean,
            had_orgasm: 0 as unknown as boolean,
            exercised: 1 as unknown as boolean,
          }),
        ],
      })
    );

    const [loaded] = await loadVitalityEntries();
    // A truthy `1` reaching a `Switch` as a number crashes React Native, so the
    // coercion is not cosmetic.
    expect(loaded.hadMasturbation).toBe(true);
    expect(loaded.hadOrgasm).toBe(false);
    expect(loaded.exercised).toBe(true);
  });

  it('HEALTH-VITAL-019: null columns become the donor neutral defaults, not NaN', async () => {
    api.listMensHealth.mockResolvedValue(ok({ entries: [mensRow({ date: TODAY })] }));

    const [loaded] = await loadVitalityEntries();

    // Every 1–10 slider needs a number to bind to; `null` would render an empty
    // track and score the day as NaN.
    expect(loaded).toMatchObject({
      libido: 5,
      sexualDesireLevel: 5,
      energyLevel: 5,
      mentalClarity: 5,
      mood: 5,
      sleepQuality: 5,
      stressLevel: 5,
      kegelSets: 0,
      notes: '',
    });
    // The genuinely optional fields stay null — see HEALTH-VITAL-006.
    expect(loaded.overallSatisfaction).toBeNull();
    expect(vitalityScore(loaded)).toBe(50);
  });

  it('HEALTH-VITAL-020: saveVitalityEntry writes every donor column in snake_case', async () => {
    fakeMensServer();

    await saveVitalityEntry({ libido: 8, energyLevel: 7, kegelSets: 3, notes: '  Good day  ' }, TODAY);

    expect(api.saveMensHealth).toHaveBeenCalledWith({
      date: TODAY,
      libido: 8,
      had_partner_sex: false,
      had_masturbation: false,
      had_orgasm: false,
      overall_satisfaction: null,
      had_morning_erection: false,
      morning_erection_quality: null,
      erection_quality: null,
      had_erotic_dream: false,
      sexual_desire_level: 5,
      had_erection_difficulty: false,
      had_maintenance_difficulty: false,
      had_premature_ejaculation: false,
      had_delayed_ejaculation: false,
      had_performance_anxiety: false,
      had_low_desire: false,
      had_pain_or_discomfort: false,
      energy_level: 7,
      mental_clarity: 5,
      mood: 5,
      sleep_quality: 5,
      stress_level: 5,
      exercised: false,
      kegel_sets: 3,
      notes: 'Good day', // trimmed before it reaches the wire
    });
  });

  it('HEALTH-VITAL-021: out-of-range values are clamped before they are sent', async () => {
    fakeMensServer();

    await saveVitalityEntry({ libido: 99, stressLevel: 0, kegelSets: 999 }, TODAY);

    const sent = api.saveMensHealth.mock.calls[0][0];
    expect(sent.libido).toBe(10);
    expect(sent.stress_level).toBe(1);
    expect(sent.kegel_sets).toBe(50);
  });

  it('HEALTH-VITAL-022: saving merges into the same day rather than appending', async () => {
    fakeMensServer();

    await saveVitalityEntry({ libido: 8, mood: 7 }, TODAY);
    const entries = await saveVitalityEntry({ energyLevel: 9 }, TODAY);

    // One entry per day is the donor's model; a second row would double-count
    // the day in every Trends average.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ libido: 8, mood: 7, energyLevel: 9 });
  });

  it('HEALTH-VITAL-023: clearing a day writes an EMPTY entry instead of deleting the row', async () => {
    fakeMensServer();
    await saveVitalityEntry({ libido: 9, kegelSets: 4 }, TODAY);

    const entries = await deleteVitalityEntry(TODAY);

    // The donor has no per-day delete endpoint, and "logged nothing" IS what the
    // screen means by clearing — so the row survives with neutral values and the
    // refreshed list still contains the day.
    expect(api.saveMensHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: TODAY, libido: 5, kegel_sets: 0, notes: '' })
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ libido: 5, kegelSets: 0 });
    expect(vitalityScore(entries[0])).toBe(NEUTRAL_SCORE);
  });

  it('HEALTH-VITAL-024: loadVitalityForDate picks the single entry for that day', async () => {
    fakeMensServer();
    await saveVitalityEntry({ libido: 8 }, '2026-07-12');
    await saveVitalityEntry({ libido: 3 }, TODAY);

    expect((await loadVitalityForDate())?.libido).toBe(3);
    expect((await loadVitalityForDate('2026-07-12'))?.libido).toBe(8);
    expect(await loadVitalityForDate('2026-01-01')).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* Offline contract                                                  */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — offline contract', () => {
  it('HEALTH-VITAL-025: a failed read falls back to the cached entries', async () => {
    await storageHelpers.setObject(HEALTH_VITALITY_KEY, [entry({ date: TODAY, libido: 8 })]);
    api.listMensHealth.mockRejectedValue(NETWORK_ERROR);

    expect((await loadVitalityEntries())[0].libido).toBe(8);
    expect(healthSyncStateFor(HEALTH_VITALITY_KEY)).toBe('offline');
  });

  it('HEALTH-VITAL-026: an offline save returns and caches the merged optimistic entry', async () => {
    await storageHelpers.setObject(HEALTH_VITALITY_KEY, [
      entry({ date: TODAY, libido: 8, mood: 7 }),
    ]);
    __setHealthOfflineForTests(true);

    const entries = await saveVitalityEntry({ energyLevel: 9 }, TODAY);

    expect(entries[0]).toMatchObject({ libido: 8, mood: 7, energyLevel: 9 });
    expect(entries[0].loggedAt).toBe(FIXED_NOW.toISOString());
    expect(api.saveMensHealth).not.toHaveBeenCalled();
    expect((await loadVitalityForDate())?.energyLevel).toBe(9);
  });

  it('HEALTH-VITAL-027: an offline clear removes the day from the optimistic list', async () => {
    await storageHelpers.setObject(HEALTH_VITALITY_KEY, [entry({ date: TODAY, libido: 9 })]);
    __setHealthOfflineForTests(true);

    // Offline the optimistic value simply drops the day, so the screen and the
    // server briefly disagree about whether the day exists (see HEALTH-VITAL-023).
    expect(await deleteVitalityEntry(TODAY)).toEqual([]);
  });

  it('HEALTH-VITAL-028: corrupt cached rows are dropped rather than scored', async () => {
    await storageHelpers.setObject(HEALTH_VITALITY_KEY, [
      entry({ date: TODAY }),
      { id: 'bad', date: '2026-07-12' }, // no libido / energyLevel to score
      null,
    ]);
    __setHealthOfflineForTests(true);

    expect((await loadVitalityEntries()).map((e) => e.date)).toEqual([TODAY]);
  });

  it('HEALTH-VITAL-029: a non-array cached snapshot degrades to empty, not a crash', async () => {
    await storageHelpers.setObject(HEALTH_VITALITY_KEY, 'nope');
    __setHealthOfflineForTests(true);

    // DEFECT (HEALTH-VITAL-029): same pattern as HEALTH-STORE-043 — the loader
    // calls `.filter` straight on the cached value, so a corrupt snapshot throws
    // a TypeError into the screen instead of showing empty state.
    expect(await loadVitalityEntries()).toEqual([]);
  });
});

/* ---------------------------------------------------------------- */
/* Partial / malformed wire payloads                                 */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — partial server payloads', () => {
  it('HEALTH-VITAL-030: a body with no `entries` key reads as an empty log, not a crash', async () => {
    // The Worker returns the payload BARE, so a route change or a 204-shaped
    // body arrives as `{}`. Reading `.map` off that would throw a TypeError into
    // the tab before the disclaimer card ever renders.
    api.listMensHealth.mockResolvedValue(ok({} as never));

    expect(await loadVitalityEntries()).toEqual([]);
    // …and the day still opens on the neutral baseline rather than "no data".
    expect(await loadVitalityForDate(TODAY)).toBeNull();
  });

  it('HEALTH-VITAL-031: a row with no id or updated_at still loads and scores', async () => {
    // `id` is the React list key and `updated_at` is what `loggedAt.length > 0`
    // uses to decide "logged today". A row missing either used to be scoreable
    // in principle but had never been fed through the mapper.
    const bare = mensRow({ date: TODAY, libido: 8, energy_level: 7 }) as unknown as Record<
      string,
      unknown
    >;
    delete bare.id;
    delete bare.updated_at;
    api.listMensHealth.mockResolvedValue(ok({ entries: [bare] as never }));

    const [loaded] = await loadVitalityEntries();

    // Falls back to the deterministic per-day id so the row is still addressable
    // and a second read cannot duplicate it.
    expect(loaded.id).toBe(`vitality-${TODAY}`);
    // No timestamp means "never logged" — the screen must show the neutral 50,
    // not treat a phantom entry as a logged day.
    expect(loaded.loggedAt).toBe('');
    expect(loaded.libido).toBe(8);
  });

  it('HEALTH-VITAL-032: saveVitalityEntry defaults to TODAY when no date is passed', async () => {
    // Every screen call site omits the date — this is the path the app actually
    // takes, and it was the one path the suite never took.
    const server = fakeMensServer();

    await saveVitalityEntry({ libido: 9 });

    expect(api.saveMensHealth).toHaveBeenCalledWith(expect.objectContaining({ date: TODAY }));
    expect(server.rows.map((r) => r.date)).toEqual([TODAY]);
    expect((await loadVitalityForDate())?.libido).toBe(9);
  });
});

/* ---------------------------------------------------------------- */
/* Posture — the server surface this tab reaches for                 */
/* ---------------------------------------------------------------- */

describe('healthVitalityStorage — server surface inventory', () => {
  /**
   * The Worker ships FOUR mens-health routes and the app now calls all four:
   * `/entries` (GET + PUT) behind the day's log, and `/settings` (GET + PUT)
   * behind the "What to show" card. The settings pair was a deployed route with
   * NO client until the section-preferences port landed; the Worker-side
   * contract for it lives in
   * `backend/src/routes/__tests__/health-mens-health.test.ts`.
   *
   * These two specs are the inventory guard for that surface. They are anchored
   * on MODULE RESOLUTION — the real modules, not a string grep — so adding a
   * fifth call, or a store function that reaches for one, fails here and points
   * whoever added it at the tests it needs. Both lists are deliberately exact
   * rather than `toContain`: the point is to catch the ADDITION.
   */
  it('HEALTH-VITAL-040: the mens-health client is exactly the four known calls', () => {
    // `jest.mock('@api/health')` at the top of this file automocks the module, so
    // the REAL export list has to be requested explicitly.
    const actual = jest.requireActual('@api/health') as {
      healthApi: Record<string, unknown>;
    };
    const mensCalls = Object.keys(actual.healthApi)
      .filter((k) => /mens/i.test(k))
      .sort();

    expect(mensCalls).toEqual([
      'getMensHealthSettings',
      'listMensHealth',
      'saveMensHealth',
      'saveMensHealthSettings',
    ]);
  });

  it('HEALTH-VITAL-041: the store exposes exactly six server-touching functions', () => {
    // Every exported fn that awaits the network is enumerated, so a new one
    // cannot slip in un-tested — this list IS the inventory of what the tab can
    // do to the server. Detected by NAME rather than by `AsyncFunction`, because
    // Babel down-levels async functions in the Jest transform.
    const store = jest.requireActual('../healthVitalityStorage') as Record<string, unknown>;
    const serverFns = Object.keys(store)
      .filter((k) => typeof store[k] === 'function' && /^(load|save|delete)/.test(k))
      .sort();

    expect(serverFns).toEqual([
      'deleteVitalityEntry',
      'loadMensTrackSettings',
      'loadVitalityEntries',
      'loadVitalityForDate',
      'saveMensTrackSettings',
      'saveVitalityEntry',
    ]);
  });

  it('HEALTH-VITAL-042: the two surfaces use SEPARATE cache keys', () => {
    // The day's entries and the section preferences share one screen but not one
    // cache slot. Collapsing them would make a settings write clobber the offline
    // copy of the log — the most sensitive data in the app — on a device that
    // happened to be offline when a toggle was flipped.
    expect(HEALTH_VITALITY_KEY).toBe('health.vitality.v1');
    expect(HEALTH_MENS_SETTINGS_KEY).toBe('health.mensSettings.v1');
    expect(HEALTH_MENS_SETTINGS_KEY).not.toBe(HEALTH_VITALITY_KEY);
  });
});
