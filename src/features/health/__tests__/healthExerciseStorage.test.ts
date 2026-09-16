/**
 * Symply Health — WORKOUT LIBRARY store (ported donor `exercise_library`).
 *
 * Three layers, same shape as the other Health store suites:
 *
 *  1. PURE — token humanising, injury copy, ordering, filtering, facets and the
 *     offline substring match.
 *  2. WIRE — the EXACT `fromWire*` mapping, including the invariant that binds
 *     this feature together: **the injury verdict is the SERVER's.** The store
 *     renames `injury_flag` / `injury_body_parts`; it never derives them from
 *     the muscle groups it can see.
 *  3. OFFLINE — the triad: cached read, optimistic write, sync state; plus the
 *     rejection path, which must roll the optimistic favourite back rather than
 *     leave a phantom star behind.
 *
 * Plus the one safety decision that lives on the device: `logExercise` REFUSES
 * an `avoid` movement without an explicit acknowledgement, so a mis-tap on a
 * crowded list cannot quietly record a session the gate warned against.
 *
 * `fakeExerciseServer` keeps a tiny row list because the favourite writer
 * re-reads the catalogue afterwards — a static list mock would report the
 * change as lost.
 */

import { healthExercisesApi, type HealthExercise } from '@api/healthExercises';
import { storageHelpers } from '@services/storage';

import { addWorkoutEntry, HEALTH_WORKOUTS_KEY } from '../healthActivityStorage';
import {
  applyExerciseFilter,
  categoryLabel,
  deriveFacets,
  difficultyLabel,
  EMPTY_EXERCISE_FILTER,
  fromWireExercise,
  fromWireInjury,
  HEALTH_EXERCISES_KEY,
  humanizeToken,
  injuryRank,
  injuryWarningFor,
  INJURY_BLOCK_MESSAGE,
  isFilterActive,
  loadExerciseLibrary,
  logExercise,
  matchExercises,
  MISSING_EXERCISE_MESSAGE,
  normalizeLibrary,
  OFFLINE_WRITE_MESSAGE,
  rejectionMessageFor,
  requiresInjuryAcknowledgement,
  searchExercises,
  setExerciseFavorite,
  sortExercises,
  toWorkoutType,
  viewExercises,
  type ExerciseItem,
} from '../healthExerciseStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';

jest.mock('@api/healthExercises');
jest.mock('../healthActivityStorage', () => {
  const actual = jest.requireActual('../healthActivityStorage');
  return { ...actual, addWorkoutEntry: jest.fn() };
});

type MockedApi = jest.Mocked<typeof healthExercisesApi>;
const api = healthExercisesApi as unknown as MockedApi;
const mockAddWorkout = addWorkoutEntry as jest.Mock;

const NETWORK_ERROR = new Error('Network request failed');
/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
}

function exerciseRow(over: Partial<HealthExercise> = {}): HealthExercise {
  return {
    id: 'ex_squat',
    name: 'Squat',
    aliases: ['squats', 'air_squat'],
    category: 'strength',
    muscle_groups: ['quads', 'glutes'],
    secondary_muscles: ['hamstrings', 'abs'],
    equipment: ['none', 'barbell'],
    body_parts: ['knee', 'hip'],
    difficulty: 'level2',
    difficulty_level: 2,
    instructions: 'Sit the hips back and down, then drive through the whole foot.',
    illustration: 'strength',
    media_url: null,
    default_minutes: 10,
    workout_type: 'strength',
    is_favorite: false,
    injury_flag: null,
    injury_body_parts: [],
    updated_at: '2026-07-25T08:00:00.000Z',
    ...over,
  };
}

function item(over: Partial<ExerciseItem> = {}): ExerciseItem {
  return { ...fromWireExercise(exerciseRow()), ...over };
}

/**
 * A tiny stateful stand-in for `/health/exercises*`. Favouriting mutates the
 * row it holds, so the re-read every writer performs sees the change.
 */
function fakeExerciseServer(rows: HealthExercise[], injuries: HealthExercise['id'][] = []) {
  const state = rows.map((r) => ({ ...r }));
  api.listExercises.mockImplementation(async (params) => {
    const needle = params?.search?.toLowerCase();
    const filtered = needle
      ? state.filter((r) => r.name.toLowerCase().includes(needle))
      : state;
    return {
      exercises: filtered.map((r) => ({ ...r })),
      injury_body_parts: injuries.map((bodyPart) => ({
        body_part: bodyPart,
        canonical: bodyPart,
        max_pain_level: 3,
        injury_count: 1,
      })),
    };
  });
  api.setFavorite.mockImplementation(async (id, isFavorite) => {
    const row = state.find((r) => r.id === id);
    if (!row) throw httpError(404);
    row.is_favorite = isFavorite;
    return { exercise: { ...row } };
  });
  api.getExercise.mockImplementation(async (id) => {
    const row = state.find((r) => r.id === id);
    if (!row) throw httpError(404);
    return { exercise: { ...row } };
  });
  return state;
}

beforeEach(async () => {
  jest.clearAllMocks();
  __setHealthOfflineForTests(false);
  await clearHealthCache([HEALTH_EXERCISES_KEY, HEALTH_WORKOUTS_KEY]);
  mockAddWorkout.mockResolvedValue([]);
});

afterEach(() => {
  __setHealthOfflineForTests(false);
});

/* ==================================================================== */
/* 1. PURE                                                               */
/* ==================================================================== */

describe('HEALTH-EX — display copy', () => {
  it('EX-STORE-001: humanizes a snake_case token for a chip', () => {
    expect(humanizeToken('lower_back')).toBe('Lower back');
    expect(humanizeToken('quads')).toBe('Quads');
    expect(humanizeToken('')).toBe('');
  });

  it('EX-STORE-002: labels difficulty and category, falling back gracefully', () => {
    expect(difficultyLabel('level1')).toBe('Very easy');
    expect(difficultyLabel('level5')).toBe('Very hard');
    // A catalogue that grows a new value must still render something readable.
    expect(difficultyLabel('level9')).toBe('Level9');
    expect(categoryLabel('rehabilitation')).toBe('Rehab');
    expect(categoryLabel('pilates')).toBe('Pilates');
  });
});

describe('HEALTH-EX — injury copy and acknowledgement', () => {
  it('EX-STORE-010: a clear exercise has no warning and needs no confirmation', () => {
    const clear = item();
    expect(injuryWarningFor(clear)).toBeNull();
    expect(requiresInjuryAcknowledgement(clear)).toBe(false);
  });

  it('EX-STORE-011: an AVOID warning names the injury in the user own words', () => {
    const flagged = item({ injuryFlag: 'avoid', injuryBodyParts: ['Left knee'] });
    expect(injuryWarningFor(flagged)).toBe(
      'This loads your left knee. Avoid it until that has healed.'
    );
    expect(requiresInjuryAcknowledgement(flagged)).toBe(true);
  });

  it('EX-STORE-012: a CAUTION warning is softer and needs no confirmation', () => {
    const flagged = item({ injuryFlag: 'caution', injuryBodyParts: ['wrist'] });
    expect(injuryWarningFor(flagged)).toBe('This may involve your wrist. Take it gently.');
    expect(requiresInjuryAcknowledgement(flagged)).toBe(false);
  });

  it('EX-STORE-013: several injuries read as a list', () => {
    const flagged = item({ injuryFlag: 'avoid', injuryBodyParts: ['knee', 'lower_back'] });
    expect(injuryWarningFor(flagged)).toBe(
      'This loads knee and lower back. Avoid it until that has healed.'
    );
  });

  it('EX-STORE-014: a flag with no named part still warns rather than going silent', () => {
    // Defensive: the server always sends the parts, but a flag that renders
    // NOTHING would be worse than a vague one.
    const flagged = item({ injuryFlag: 'avoid', injuryBodyParts: [] });
    expect(injuryWarningFor(flagged)).toContain('an injury you logged');
  });
});

describe('HEALTH-EX — ordering and filtering', () => {
  it('EX-STORE-020: safety outranks a favourite in the default ordering', () => {
    const ordered = sortExercises([
      item({ id: 'a', name: 'Air squat', injuryFlag: 'avoid', isFavorite: true }),
      item({ id: 'b', name: 'Bridge', injuryFlag: 'caution' }),
      item({ id: 'c', name: 'Zebra pose' }),
      item({ id: 'd', name: 'Yoga flow', isFavorite: true }),
    ]);
    // A favourited squat with a live knee injury must not sit at the top.
    expect(ordered.map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
    expect([injuryRank(null), injuryRank('caution'), injuryRank('avoid')]).toEqual([0, 1, 2]);
  });

  it('EX-STORE-021: filters by muscle across PRIMARY and SECONDARY load', () => {
    const items = [
      item({ id: 'a', muscleGroups: ['quads'], secondaryMuscles: [] }),
      item({ id: 'b', muscleGroups: ['chest'], secondaryMuscles: ['quads'] }),
      item({ id: 'c', muscleGroups: ['back'], secondaryMuscles: ['biceps'] }),
    ];
    const filtered = applyExerciseFilter(items, {
      ...EMPTY_EXERCISE_FILTER,
      muscleGroup: 'quads',
    });
    expect(filtered.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('EX-STORE-022: filters AND together', () => {
    const items = [
      item({ id: 'a', category: 'yoga', difficulty: 'level1', equipment: ['yoga_mat'] }),
      item({ id: 'b', category: 'yoga', difficulty: 'level3', equipment: ['yoga_mat'] }),
      item({ id: 'c', category: 'strength', difficulty: 'level1', equipment: ['none'] }),
      item({ id: 'd', category: 'yoga', difficulty: 'level1', equipment: ['none'] }),
    ];
    const filtered = applyExerciseFilter(items, {
      ...EMPTY_EXERCISE_FILTER,
      category: 'yoga',
      difficulty: 'level1',
      equipment: 'yoga_mat',
    });
    expect(filtered.map((e) => e.id)).toEqual(['a']);
  });

  it('EX-STORE-023: favouritesOnly narrows to the starred rows', () => {
    const items = [item({ id: 'a', isFavorite: true }), item({ id: 'b' })];
    expect(
      applyExerciseFilter(items, { ...EMPTY_EXERCISE_FILTER, favoritesOnly: true }).map((e) => e.id)
    ).toEqual(['a']);
  });

  it('EX-STORE-024: isFilterActive knows when the row has anything to clear', () => {
    expect(isFilterActive(EMPTY_EXERCISE_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_EXERCISE_FILTER, muscleGroup: 'quads' })).toBe(true);
    expect(isFilterActive({ ...EMPTY_EXERCISE_FILTER, favoritesOnly: true })).toBe(true);
  });

  it('EX-STORE-025: viewExercises filters, then applies the Worker ordering', () => {
    const items = [
      item({ id: 'a', name: 'Zebra', category: 'yoga' }),
      item({ id: 'b', name: 'Alpha', category: 'yoga', injuryFlag: 'avoid' }),
      item({ id: 'c', name: 'Beta', category: 'strength' }),
    ];
    expect(
      viewExercises(items, { ...EMPTY_EXERCISE_FILTER, category: 'yoga' }).map((e) => e.id)
    ).toEqual(['a', 'b']);
  });

  it('EX-STORE-026: facets are DERIVED from the catalogue, never hardcoded', () => {
    const facets = deriveFacets([
      item({ muscleGroups: ['quads'], secondaryMuscles: ['abs'], equipment: ['none'], difficulty: 'level2', category: 'strength' }),
      item({ muscleGroups: ['chest'], secondaryMuscles: [], equipment: ['barbell', 'bench'], difficulty: 'level4', category: 'cardio' }),
    ]);
    expect(facets.muscleGroups).toEqual(['abs', 'chest', 'quads']);
    expect(facets.equipment).toEqual(['barbell', 'bench', 'none']);
    expect(facets.difficulties).toEqual(['level2', 'level4']);
    expect(facets.categories).toEqual(['cardio', 'strength']);
  });

  it('EX-STORE-027: the offline match covers name, alias, muscle and equipment', () => {
    const items = [item()];
    expect(matchExercises(items, 'squ').map((e) => e.id)).toEqual(['ex_squat']);
    expect(matchExercises(items, 'air squat').map((e) => e.id)).toEqual(['ex_squat']);
    expect(matchExercises(items, 'glutes').map((e) => e.id)).toEqual(['ex_squat']);
    expect(matchExercises(items, 'barbell').map((e) => e.id)).toEqual(['ex_squat']);
    expect(matchExercises(items, 'kayak')).toEqual([]);
    expect(matchExercises(items, '')).toEqual([]);
  });
});

/* ==================================================================== */
/* 2. WIRE                                                               */
/* ==================================================================== */

describe('HEALTH-EX — wire mapping', () => {
  it('EX-STORE-030: renames every server field without recomputing any of them', () => {
    const mapped = fromWireExercise(
      exerciseRow({ is_favorite: true, injury_flag: 'avoid', injury_body_parts: ['Left knee'] })
    );
    expect(mapped).toEqual({
      id: 'ex_squat',
      name: 'Squat',
      aliases: ['squats', 'air_squat'],
      category: 'strength',
      muscleGroups: ['quads', 'glutes'],
      secondaryMuscles: ['hamstrings', 'abs'],
      equipment: ['none', 'barbell'],
      bodyParts: ['knee', 'hip'],
      difficulty: 'level2',
      difficultyLevel: 2,
      instructions: 'Sit the hips back and down, then drive through the whole foot.',
      illustration: 'strength',
      defaultMinutes: 10,
      workoutType: 'strength',
      isFavorite: true,
      injuryFlag: 'avoid',
      injuryBodyParts: ['Left knee'],
      updatedAt: '2026-07-25T08:00:00.000Z',
    });
  });

  it('EX-STORE-031: the injury flag is the SERVER answer, never inferred locally', () => {
    // The muscle groups scream "knee", but the server says clear — and the
    // server is the only thing that has seen the injury log.
    const mapped = fromWireExercise(
      exerciseRow({ muscle_groups: ['quads'], body_parts: ['knee'], injury_flag: null })
    );
    expect(mapped.injuryFlag).toBeNull();
    expect(mapped.injuryBodyParts).toEqual([]);
    expect(injuryWarningFor(mapped)).toBeNull();
  });

  it('EX-STORE-032: a nonsense flag degrades to "not flagged", never to a crash', () => {
    const mapped = fromWireExercise(
      exerciseRow({ injury_flag: 'catastrophic' as unknown as null })
    );
    expect(mapped.injuryFlag).toBeNull();
  });

  it('EX-STORE-033: a malformed row never throws and never yields a non-array', () => {
    const mapped = fromWireExercise({
      id: 'ex_x',
      name: 'X',
      aliases: null,
      muscle_groups: 'quads',
      secondary_muscles: undefined,
      equipment: [1, 'none'],
      body_parts: null,
      difficulty_level: 'two',
      default_minutes: null,
    } as unknown as HealthExercise);
    expect(mapped.aliases).toEqual([]);
    expect(mapped.muscleGroups).toEqual([]);
    expect(mapped.secondaryMuscles).toEqual([]);
    expect(mapped.equipment).toEqual(['none']);
    expect(mapped.bodyParts).toEqual([]);
    expect(mapped.difficultyLevel).toBe(1);
    expect(mapped.defaultMinutes).toBe(10);
  });

  it('EX-STORE-034: an unknown workout_type becomes `other`, so the session still logs', () => {
    expect(toWorkoutType('strength')).toBe('strength');
    expect(toWorkoutType('yoga')).toBe('yoga');
    // A catalogue that grows a type before the app knows it must not drop the
    // session on the floor.
    expect(toWorkoutType('parkour')).toBe('other');
    expect(toWorkoutType('')).toBe('other');
  });

  it('EX-STORE-035: maps an active injury row', () => {
    expect(
      fromWireInjury({ body_part: 'Left knee', canonical: 'knee', max_pain_level: 3, injury_count: 2 })
    ).toEqual({ bodyPart: 'Left knee', canonical: 'knee', maxPainLevel: 3, injuryCount: 2 });
  });

  it('EX-STORE-036: a corrupt cached snapshot is repaired, not handed on', () => {
    expect(normalizeLibrary(null)).toEqual({ exercises: [], injuries: [] });
    expect(normalizeLibrary({ exercises: 'nope', injuries: null } as never)).toEqual({
      exercises: [],
      injuries: [],
    });
    const repaired = normalizeLibrary({
      exercises: [item(), { id: 'broken' } as unknown as ExerciseItem],
      injuries: [{ bodyPart: 'knee', canonical: 'knee', maxPainLevel: 1, injuryCount: 1 }],
    });
    expect(repaired.exercises).toHaveLength(1);
    expect(repaired.injuries).toHaveLength(1);
  });
});

/* ==================================================================== */
/* 3. READS + OFFLINE                                                    */
/* ==================================================================== */

describe('HEALTH-EX — reads', () => {
  it('EX-STORE-040: loads the whole catalogue and mirrors it into the cache', async () => {
    fakeExerciseServer([exerciseRow(), exerciseRow({ id: 'ex_plank', name: 'Plank' })]);

    const library = await loadExerciseLibrary();
    expect(library.exercises.map((e) => e.id)).toEqual(['ex_plank', 'ex_squat']);
    expect(healthSyncStateFor(HEALTH_EXERCISES_KEY)).toBe('synced');

    // Unfiltered on purpose: caching a filtered response under the one snapshot
    // key would leave an offline read showing only the last filter tapped.
    expect(api.listExercises).toHaveBeenCalledWith();
    const cached = await storageHelpers.getObject(HEALTH_EXERCISES_KEY);
    expect((cached as { exercises: ExerciseItem[] }).exercises).toHaveLength(2);
  });

  it('EX-STORE-041: carries the active injuries alongside the catalogue', async () => {
    fakeExerciseServer([exerciseRow({ injury_flag: 'avoid', injury_body_parts: ['knee'] })], [
      'knee',
    ]);
    const library = await loadExerciseLibrary();
    expect(library.injuries.map((i) => i.bodyPart)).toEqual(['knee']);
    expect(library.exercises[0].injuryFlag).toBe('avoid');
  });

  it('EX-STORE-042: falls back to the cached snapshot when the network is gone', async () => {
    fakeExerciseServer([exerciseRow()]);
    await loadExerciseLibrary();

    api.listExercises.mockRejectedValue(NETWORK_ERROR);
    const library = await loadExerciseLibrary();
    // A gym is the most likely place on earth to have no signal.
    expect(library.exercises.map((e) => e.id)).toEqual(['ex_squat']);
    expect(healthSyncStateFor(HEALTH_EXERCISES_KEY)).toBe('offline');
  });

  it('EX-STORE-043: an empty cache and a dead network yields an empty library, not a crash', async () => {
    api.listExercises.mockRejectedValue(NETWORK_ERROR);
    expect(await loadExerciseLibrary()).toEqual({ exercises: [], injuries: [] });
  });

  it('EX-STORE-044: search asks the Worker so the ranking is its own', async () => {
    fakeExerciseServer([exerciseRow(), exerciseRow({ id: 'ex_plank', name: 'Plank' })]);
    const hits = await searchExercises('plank');
    expect(api.listExercises).toHaveBeenLastCalledWith({ search: 'plank' });
    expect(hits.map((e) => e.id)).toEqual(['ex_plank']);
  });

  it('EX-STORE-045: a failed search degrades to the cached catalogue, never a blank screen', async () => {
    fakeExerciseServer([exerciseRow(), exerciseRow({ id: 'ex_plank', name: 'Plank' })]);
    await loadExerciseLibrary();

    api.listExercises.mockRejectedValue(NETWORK_ERROR);
    const hits = await searchExercises('plank');
    expect(hits.map((e) => e.id)).toEqual(['ex_plank']);
  });

  it('EX-STORE-046: a blank needle searches nothing at all', async () => {
    fakeExerciseServer([exerciseRow()]);
    expect(await searchExercises('   ')).toEqual([]);
    expect(api.listExercises).not.toHaveBeenCalled();
  });

  it('EX-STORE-047: a ONE-character needle is matched locally, not shipped to the Worker', async () => {
    // The library search box fires on every keystroke. A single character would
    // match most of the catalogue, so it is answered from the cached snapshot
    // instead of spending a round trip per letter typed.
    fakeExerciseServer([exerciseRow(), exerciseRow({ id: 'ex_plank', name: 'Plank' })]);
    await loadExerciseLibrary();
    api.listExercises.mockClear();

    const hits = await searchExercises('p');

    // The catalogue read is fine; what must NOT happen is a per-keystroke
    // `?search=` round trip.
    expect(
      api.listExercises.mock.calls.filter(([params]) => params?.search !== undefined)
    ).toEqual([]);
    expect(hits.map((e) => e.id)).toEqual(['ex_plank']);
  });

  it('EX-STORE-048: a non-string needle searches nothing rather than throwing', async () => {
    // The box is a controlled <TextInput>, and `.trim()` on a non-string throws
    // straight out of the change handler.
    fakeExerciseServer([exerciseRow()]);
    expect(await searchExercises(undefined as unknown as string)).toEqual([]);
    expect(api.listExercises).not.toHaveBeenCalled();
  });

  it('EX-STORE-049: a body missing `exercises` reads as an empty catalogue, not a crash', async () => {
    // Both the list read and the search read pull `exercises` /
    // `injury_body_parts` off a BARE body, so a renamed key arrives as absent.
    api.listExercises.mockResolvedValue({} as never);

    expect(await loadExerciseLibrary()).toEqual({ exercises: [], injuries: [] });
    expect(await searchExercises('squat')).toEqual([]);
  });

  it('EX-STORE-067: a non-string token or query is treated as empty, not as "undefined"', () => {
    // `humanizeToken` renders muscle / equipment / joint chips, so a stringified
    // `undefined` would print the word "Undefined" on a chip.
    expect(humanizeToken(undefined as unknown as string)).toBe('');
    expect(humanizeToken('')).toBe('');
    expect(matchExercises([item()], undefined as unknown as string)).toEqual([]);
  });

  it('EX-STORE-069: a row with no difficulty or category contributes no empty filter chip', async () => {
    // The filter chips are DERIVED from the catalogue. A row whose columns are
    // blank (an older migration, a partially-seeded row) would otherwise mint a
    // nameless chip that filters to nothing when tapped.
    fakeExerciseServer([
      exerciseRow({ id: 'ex_bare', difficulty: '' as never, category: '' as never }),
      exerciseRow({ id: 'ex_squat' }),
    ]);
    const library = await loadExerciseLibrary();

    const facets = deriveFacets(library.exercises);
    expect(facets.difficulties).toEqual(['level2']);
    expect(facets.categories).toEqual(['strength']);
    expect(facets.difficulties).not.toContain('');
    expect(facets.categories).not.toContain('');
  });

  it('EX-STORE-068: an unmapped refusal still answers in our own words', () => {
    // 409 / 418 / 429 are not documented on the exercise routes, but a proxy
    // can still produce them, and the raw axios message must never surface.
    for (const status of [409, 418, 429]) {
      const message = rejectionMessageFor(httpError(status));
      expect(message).toBe('That could not be saved. Please try again.');
      expect(message).not.toContain('Request failed');
    }
    expect(rejectionMessageFor(httpError(404))).toBe(MISSING_EXERCISE_MESSAGE);
  });
});

/* ==================================================================== */
/* 4. FAVOURITE WRITES                                                   */
/* ==================================================================== */

describe('HEALTH-EX — favourites', () => {
  it('EX-STORE-050: favouriting persists and comes back from the re-read', async () => {
    const state = fakeExerciseServer([exerciseRow()]);
    const result = await setExerciseFavorite('ex_squat', true);

    expect(api.setFavorite).toHaveBeenCalledWith('ex_squat', true);
    expect(state[0].is_favorite).toBe(true);
    expect(result.status).toBe('saved');
    expect(result.message).toBeNull();
    expect(result.library.exercises[0].isFavorite).toBe(true);
  });

  it('EX-STORE-051: un-favouriting is the same path in reverse', async () => {
    const state = fakeExerciseServer([exerciseRow({ is_favorite: true })]);
    const result = await setExerciseFavorite('ex_squat', false);
    expect(state[0].is_favorite).toBe(false);
    expect(result.library.exercises[0].isFavorite).toBe(false);
  });

  it('EX-STORE-052: an offline write keeps the optimistic star and says so', async () => {
    fakeExerciseServer([exerciseRow()]);
    await loadExerciseLibrary();

    api.setFavorite.mockRejectedValue(NETWORK_ERROR);
    const result = await setExerciseFavorite('ex_squat', true);

    expect(result.status).toBe('offline');
    expect(result.message).toBe(OFFLINE_WRITE_MESSAGE);
    // The user still sees what they just did; the next sync reconciles it.
    expect(result.library.exercises[0].isFavorite).toBe(true);
    expect(healthSyncStateFor(HEALTH_EXERCISES_KEY)).toBe('offline');
  });

  it('EX-STORE-053: a SERVER REJECTION rolls the optimistic star back', async () => {
    fakeExerciseServer([exerciseRow()]);
    await loadExerciseLibrary();

    api.setFavorite.mockRejectedValue(httpError(404));
    const result = await setExerciseFavorite('ex_squat', true);

    expect(result.status).toBe('rejected');
    expect(result.message).toBe(MISSING_EXERCISE_MESSAGE);
    // A phantom favourite would outlive the session and reappear cold.
    expect(result.library.exercises[0].isFavorite).toBe(false);
    const cached = await storageHelpers.getObject(HEALTH_EXERCISES_KEY);
    expect((cached as { exercises: ExerciseItem[] }).exercises[0].isFavorite).toBe(false);
  });

  it('EX-STORE-054: rejection copy is chosen by STATUS — no raw error string leaks', () => {
    expect(rejectionMessageFor(httpError(404))).toBe(MISSING_EXERCISE_MESSAGE);
    expect(rejectionMessageFor(httpError(400))).toContain('could not be saved');
    expect(rejectionMessageFor(httpError(401))).toContain('sign in again');
    // A server wobble and a lost connection behave the same.
    expect(rejectionMessageFor(httpError(500))).toBeNull();
    expect(rejectionMessageFor(NETWORK_ERROR)).toBeNull();
    expect(rejectionMessageFor(new Error('ECONNREFUSED at 10.0.0.1'))).toBeNull();
  });

  it('EX-STORE-055: the re-read ordering still puts flagged work last', async () => {
    fakeExerciseServer([
      exerciseRow({ id: 'ex_squat', name: 'Squat', injury_flag: 'avoid', injury_body_parts: ['knee'] }),
      exerciseRow({ id: 'ex_plank', name: 'Plank' }),
    ]);
    const result = await setExerciseFavorite('ex_squat', true);
    expect(result.library.exercises.map((e) => e.id)).toEqual(['ex_plank', 'ex_squat']);
  });
});

/* ==================================================================== */
/* 5. LOG THIS — reuses the EXISTING workouts endpoint                   */
/* ==================================================================== */

describe('HEALTH-EX — log this', () => {
  it('EX-STORE-060: logs through addWorkoutEntry, never a second session writer', async () => {
    const result = await logExercise(item({ name: 'Squat', workoutType: 'strength' }), {
      minutes: 25,
    });

    // Session logging is NOT duplicated: `/health/entries/workouts` owns it.
    expect(mockAddWorkout).toHaveBeenCalledWith({
      type: 'strength',
      minutes: 25,
      note: 'Squat',
      date: undefined,
    });
    expect(result.status).toBe('logged');
    expect(result.minutes).toBe(25);
    expect(result.message).toBe('Logged 25 min of Squat.');
  });

  it('EX-STORE-061: falls back to the catalogue default duration', async () => {
    await logExercise(item({ defaultMinutes: 8 }));
    expect(mockAddWorkout).toHaveBeenCalledWith(expect.objectContaining({ minutes: 8 }));
  });

  it('EX-STORE-062: a duration is clamped to at least one whole minute', async () => {
    await logExercise(item(), { minutes: 0.4 });
    expect(mockAddWorkout).toHaveBeenCalledWith(expect.objectContaining({ minutes: 1 }));
  });

  it('EX-STORE-063: an AVOID exercise is BLOCKED without an acknowledgement', async () => {
    const flagged = item({ injuryFlag: 'avoid', injuryBodyParts: ['knee'] });
    const result = await logExercise(flagged, { minutes: 20 });

    // A single mis-tap on a crowded list must not record a session the gate
    // warned against.
    expect(result.status).toBe('blocked');
    expect(result.message).toBe(INJURY_BLOCK_MESSAGE);
    expect(result.minutes).toBeNull();
    expect(mockAddWorkout).not.toHaveBeenCalled();
  });

  it('EX-STORE-064: an acknowledged AVOID exercise logs normally', async () => {
    const flagged = item({ injuryFlag: 'avoid', injuryBodyParts: ['knee'] });
    const result = await logExercise(flagged, { minutes: 20, acknowledgeInjury: true });
    expect(result.status).toBe('logged');
    expect(mockAddWorkout).toHaveBeenCalledWith(expect.objectContaining({ minutes: 20 }));
  });

  it('EX-STORE-065: a CAUTION exercise needs no acknowledgement', async () => {
    const flagged = item({ injuryFlag: 'caution', injuryBodyParts: ['wrist'] });
    expect((await logExercise(flagged)).status).toBe('logged');
    expect(mockAddWorkout).toHaveBeenCalled();
  });

  it('EX-STORE-066: an offline log still counts and says so', async () => {
    // `addWorkoutEntry` keeps the optimistic entry; the sync state is what tells
    // the user their session is not on the server yet.
    __setHealthOfflineForTests(true);
    mockAddWorkout.mockImplementation(async () => {
      const { writeThrough } = jest.requireActual('../healthRepository');
      return writeThrough(HEALTH_WORKOUTS_KEY, async () => undefined, async () => [], []);
    });

    const result = await logExercise(item({ name: 'Plank' }), { minutes: 5 });
    expect(result.status).toBe('offline');
    expect(result.message).toContain('sync when you are back online');
    expect(result.minutes).toBe(5);
  });
});
