/**
 * HealthExerciseService — the derivation layer of the Symply Health WORKOUT
 * LIBRARY (ported donor `exercise_library`).
 *
 * The routes are a thin pass-through (covered in
 * routes/__tests__/health-exercises.test.ts); this suite owns what the screen,
 * the offline cache and any future routine generator must AGREE on:
 *
 *   - THE INJURY GATE. The safety rule of the whole feature: an exercise that
 *     loads a body part with an ACTIVE injury is flagged and de-prioritised.
 *     Covered from both ends — the free-text → joint folding a user's typed
 *     "Left Knee" has to survive, and the avoid/caution/clear verdict itself.
 *   - THE SHIPPED CATALOGUE. Specs run against the REAL seed in
 *     `migrations/0123_health_exercise_library.sql`, not a fixture, so a row
 *     with an unparseable JSON column, an unknown muscle token or a
 *     `workout_type` the entries route would reject fails HERE.
 *   - Filter + search correctness, and the ordering that puts safe work first.
 *   - Favourites: the soft-delete tombstone the sync cursor needs, and the
 *     revive-in-place that stops one tombstone accruing per toggle.
 *
 * D1-backed specs run against live miniflare D1 with the migration-0123 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern
 * as services/__tests__/health-body-extras-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthExerciseTables,
  createHealthTables,
  insertHealthRow,
  readHealthRow,
  resetHealthExerciseTables,
  resetHealthTables,
  seedExerciseCatalogueFromMigration,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import {
  canonicalBodyPart,
  compareExercises,
  difficultyLevelOf,
  EXERCISE_CATEGORY_VALUES,
  EXERCISE_DIFFICULTY_LEVELS,
  HealthExerciseService,
  injuryRank,
  injuryVerdictFor,
  musclesForBodyPart,
  normalizeToken,
  parseTokenArray,
  searchScore,
  type ActiveInjuryPart,
  type ExerciseView,
} from '../health-exercise-service';

const testEnv = env as unknown as Env;

const UID = 'u_ex_svc_alice';
const OTHER = 'u_ex_svc_bob';

/** The app's own WorkoutType union — a catalogue row must be loggable. */
const APP_WORKOUT_TYPES = ['walk', 'run', 'strength', 'cycle', 'swim', 'yoga', 'other'];

/** Every muscle token the seed is allowed to use (donor vocabulary). */
const MUSCLE_TOKENS = new Set([
  'chest',
  'back',
  'lower_back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'hip_flexors',
  'adductors',
  'full_body',
]);

/** Every joint token the injury gate understands. */
const JOINT_TOKENS = new Set([
  'neck',
  'shoulder',
  'elbow',
  'wrist',
  'back',
  'lower_back',
  'chest',
  'core',
  'hip',
  'groin',
  'knee',
  'quad',
  'hamstring',
  'calf',
  'ankle',
  'foot',
]);

function svc(): HealthExerciseService {
  return new HealthExerciseService(testEnv.DB);
}

function part(over: Partial<ActiveInjuryPart> = {}): ActiveInjuryPart {
  const bodyPart = over.body_part ?? 'knee';
  return {
    body_part: bodyPart,
    canonical: over.canonical ?? canonicalBodyPart(bodyPart),
    max_pain_level: over.max_pain_level ?? 2,
    injury_count: over.injury_count ?? 1,
  };
}

async function seedInjury(
  userId: string,
  bodyPart: string,
  over: { active?: boolean; deleted?: boolean; pain?: number; id?: string } = {}
): Promise<void> {
  const ts = '2026-07-01T00:00:00.000Z';
  await insertHealthRow(testEnv.DB, 'injuries', {
    id: over.id ?? `inj_${userId}_${bodyPart.replace(/\W+/g, '_')}`,
    user_id: userId,
    date: '2026-07-01',
    body_part: bodyPart,
    pain_level: over.pain ?? 2,
    injury_type: 'pain',
    cause: null,
    muscle_group: null,
    notes: null,
    is_active: over.active === false ? 0 : 1,
    created_at: ts,
    updated_at: ts,
    deleted_at: over.deleted ? ts : null,
  });
}

function view(over: Partial<ExerciseView> = {}): ExerciseView {
  return {
    id: over.id ?? 'ex_x',
    name: over.name ?? 'Exercise',
    aliases: over.aliases ?? [],
    category: over.category ?? 'strength',
    muscle_groups: over.muscle_groups ?? [],
    secondary_muscles: over.secondary_muscles ?? [],
    equipment: over.equipment ?? [],
    body_parts: over.body_parts ?? [],
    difficulty: over.difficulty ?? 'level1',
    difficulty_level: over.difficulty_level ?? 1,
    instructions: over.instructions ?? null,
    illustration: over.illustration ?? null,
    media_url: over.media_url ?? null,
    default_minutes: over.default_minutes ?? 10,
    workout_type: over.workout_type ?? 'strength',
    is_favorite: over.is_favorite ?? false,
    injury_flag: over.injury_flag ?? null,
    injury_body_parts: over.injury_body_parts ?? [],
    updated_at: over.updated_at ?? '2026-07-01T00:00:00.000Z',
  };
}

let seededCount = 0;

beforeEach(async () => {
  await createHealthTables(testEnv.DB);
  await createHealthExerciseTables(testEnv.DB);
  await resetHealthTables(testEnv.DB);
  await resetHealthExerciseTables(testEnv.DB);
  await seedHealthUsers(testEnv.DB, [UID, OTHER]);
  seededCount = await seedExerciseCatalogueFromMigration(testEnv.DB);
});

/* ==================================================================== */
/* PURE — token normalisation                                            */
/* ==================================================================== */

describe('HEALTH-EX-SVC — token normalisation', () => {
  it('EX-SVC-001: folds case, whitespace and punctuation to one canonical token', () => {
    expect(normalizeToken('Lower Back')).toBe('lower_back');
    expect(normalizeToken('  LOWER   back ')).toBe('lower_back');
    expect(normalizeToken('lower-back')).toBe('lower_back');
    expect(normalizeToken('Push-up!')).toBe('push_up');
    expect(normalizeToken('')).toBe('');
  });

  it('EX-SVC-002: parseTokenArray never throws and never returns a non-array', () => {
    expect(parseTokenArray('["chest","Triceps"]')).toEqual(['chest', 'triceps']);
    // A half-migrated / hand-edited row must degrade, not 500 the library.
    expect(parseTokenArray('not json')).toEqual([]);
    expect(parseTokenArray('{"chest":1}')).toEqual([]);
    expect(parseTokenArray('[1,null,"abs"]')).toEqual(['abs']);
    expect(parseTokenArray(null)).toEqual([]);
    expect(parseTokenArray(undefined)).toEqual([]);
    expect(parseTokenArray('')).toEqual([]);
  });

  it('EX-SVC-003: difficultyLevelOf maps the donor 5-star scale, unknown → gentlest', () => {
    expect(EXERCISE_DIFFICULTY_LEVELS.map(difficultyLevelOf)).toEqual([1, 2, 3, 4, 5]);
    expect(difficultyLevelOf('beginner')).toBe(1);
    expect(difficultyLevelOf('level9')).toBe(1);
    expect(difficultyLevelOf('')).toBe(1);
  });

  it('EX-SVC-004: a MISSING column degrades to the gentlest level and an empty token', () => {
    // Both read straight off a catalogue row. A pre-0123 row, or one a partial
    // migration left short, must not throw inside the list every browse hits.
    expect(difficultyLevelOf(null as unknown as string)).toBe(1);
    expect(difficultyLevelOf(undefined as unknown as string)).toBe(1);
    expect(normalizeToken(null as unknown as string)).toBe('');
    expect(normalizeToken(undefined as unknown as string)).toBe('');
  });
});

/* ==================================================================== */
/* PURE — free-text injury body part → canonical joint                   */
/* ==================================================================== */

describe('HEALTH-EX-SVC — injury body-part folding', () => {
  it('EX-SVC-010: strips the side, which carries no biomechanical meaning', () => {
    for (const raw of ['Left knee', 'right knee', 'knee left', 'L knee', 'KNEE']) {
      expect(canonicalBodyPart(raw)).toBe('knee');
    }
  });

  it('EX-SVC-011: folds plurals and lay terms onto the joint vocabulary', () => {
    expect(canonicalBodyPart('shoulders')).toBe('shoulder');
    expect(canonicalBodyPart('rotator cuff')).toBe('shoulder');
    expect(canonicalBodyPart('lumbar')).toBe('lower_back');
    expect(canonicalBodyPart('low back')).toBe('lower_back');
    expect(canonicalBodyPart('Thoracic Spine')).toBe('back');
    expect(canonicalBodyPart('pecs')).toBe('chest');
    expect(canonicalBodyPart('abs')).toBe('core');
    expect(canonicalBodyPart('achilles')).toBe('ankle');
    expect(canonicalBodyPart('glutes')).toBe('hip');
    expect(canonicalBodyPart('forearms')).toBe('wrist');
  });

  it('EX-SVC-011a: a body part with no letters at all folds to nothing, not to a stray token', () => {
    // `injuries.body_part` is free text bounded only by length, so "???" and
    // "  " both reach the gate. An empty canonical must match no muscle rather
    // than becoming a token that accidentally does.
    for (const raw of ['???', '   ', '---', '!!']) {
      expect(canonicalBodyPart(raw)).toBe('');
      expect(musclesForBodyPart(raw)).toEqual([]);
    }
  });

  it('EX-SVC-012: an unrecognised part matches nothing rather than everything', () => {
    // A typo must never flag the whole catalogue — that would train users to
    // ignore the gate, which is the one thing a safety surface cannot afford.
    expect(canonicalBodyPart('spleeen')).toBe('spleeen');
    expect(musclesForBodyPart('spleeen')).toEqual([]);
    expect(
      injuryVerdictFor(
        { muscle_groups: ['quads'], secondary_muscles: ['glutes'], body_parts: ['knee'] },
        [part({ body_part: 'spleeen' })]
      )
    ).toEqual({ flag: null, body_parts: [] });
  });

  it('EX-SVC-013: every joint the gate understands maps to real muscle tokens', () => {
    for (const joint of JOINT_TOKENS) {
      const muscles = musclesForBodyPart(joint);
      expect(muscles.length).toBeGreaterThan(0);
      for (const muscle of muscles) expect(MUSCLE_TOKENS.has(muscle)).toBe(true);
    }
  });
});

/* ==================================================================== */
/* PURE — the injury gate verdict                                        */
/* ==================================================================== */

describe('HEALTH-EX-SVC — injury gate verdict', () => {
  const squat = {
    muscle_groups: ['quads', 'glutes'],
    secondary_muscles: ['hamstrings', 'abs'],
    body_parts: ['knee', 'hip', 'lower_back', 'ankle'],
  };
  const pushup = {
    muscle_groups: ['chest', 'triceps'],
    secondary_muscles: ['shoulders', 'abs'],
    body_parts: ['shoulder', 'elbow', 'wrist'],
  };

  it('EX-SVC-020: no active injury means no flag at all', () => {
    expect(injuryVerdictFor(squat, [])).toEqual({ flag: null, body_parts: [] });
  });

  it('EX-SVC-021: naming the injured joint is AVOID', () => {
    // The whole reason `body_parts` exists: a WRIST injury has to reach a
    // push-up, whose muscles are chest/triceps and mention no wrist at all.
    const verdict = injuryVerdictFor(pushup, [part({ body_part: 'Left wrist' })]);
    expect(verdict.flag).toBe('avoid');
    // Reported in the USER's own wording, not the folded token.
    expect(verdict.body_parts).toEqual(['Left wrist']);
  });

  it('EX-SVC-022: a PRIMARY muscle the injured joint drives is AVOID', () => {
    expect(injuryVerdictFor(squat, [part({ body_part: 'knee' })]).flag).toBe('avoid');
  });

  it('EX-SVC-023: only a SECONDARY muscle is CAUTION', () => {
    const curl = {
      muscle_groups: ['biceps'],
      secondary_muscles: ['forearms'],
      body_parts: ['elbow'],
    };
    // A wrist injury drives `forearms`, which is only this movement's secondary
    // load and is not named among its joints.
    const verdict = injuryVerdictFor(curl, [part({ body_part: 'wrist' })]);
    expect(verdict.flag).toBe('caution');
    expect(verdict.body_parts).toEqual(['wrist']);
  });

  it('EX-SVC-024: full_body loads everything, so any injury is at least CAUTION', () => {
    const burpee = { muscle_groups: ['full_body'], secondary_muscles: [], body_parts: [] };
    expect(injuryVerdictFor(burpee, [part({ body_part: 'neck' })]).flag).toBe('caution');
    expect(injuryVerdictFor(burpee, [part({ body_part: 'groin' })]).flag).toBe('caution');
  });

  it('EX-SVC-025: an unrelated injury leaves the exercise clear', () => {
    expect(injuryVerdictFor(pushup, [part({ body_part: 'ankle' })])).toEqual({
      flag: null,
      body_parts: [],
    });
  });

  it('EX-SVC-026: AVOID wins over CAUTION when several injuries are active', () => {
    const verdict = injuryVerdictFor(squat, [
      part({ body_part: 'wrist' }), // nothing in a squat
      part({ body_part: 'knee' }), // primary
      part({ body_part: 'core' }), // secondary (abs)
    ]);
    expect(verdict.flag).toBe('avoid');
    expect(verdict.body_parts.sort()).toEqual(['core', 'knee']);
  });

  it('EX-SVC-027: pain level never softens the verdict', () => {
    // Deliberate: a self-reported "0/4" ache on a knee still makes a heavy squat
    // the wrong suggestion, and downgrading on pain would make the gate weakest
    // exactly when someone is under-reporting.
    for (const pain of [0, 1, 2, 3, 4]) {
      expect(injuryVerdictFor(squat, [part({ body_part: 'knee', max_pain_level: pain })]).flag).toBe(
        'avoid'
      );
    }
  });

  it('EX-SVC-028: ranks safe work first, then caution, then avoid', () => {
    expect([injuryRank(null), injuryRank('caution'), injuryRank('avoid')]).toEqual([0, 1, 2]);
    const ordered = [
      view({ id: 'a', name: 'Avoid me', injury_flag: 'avoid', is_favorite: true }),
      view({ id: 'b', name: 'Careful', injury_flag: 'caution' }),
      view({ id: 'c', name: 'Zebra squat' }),
      view({ id: 'd', name: 'Air squat', is_favorite: true }),
    ].sort(compareExercises);
    // Safety outranks even a favourite; favourites only break ties within a rank.
    expect(ordered.map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

/* ==================================================================== */
/* PURE — search relevance                                               */
/* ==================================================================== */

describe('HEALTH-EX-SVC — search relevance', () => {
  const pushup = {
    name: 'Push-up',
    aliases: ['push_up', 'pushups', 'press_up'],
    muscle_groups: ['chest', 'triceps'],
    equipment: ['none'],
  };

  it('EX-SVC-030: exact beats prefix beats substring', () => {
    const exact = searchScore({ ...pushup, aliases: [] }, 'push up');
    const prefix = searchScore({ ...pushup, aliases: [] }, 'push');
    const substring = searchScore({ ...pushup, aliases: [] }, 'sh');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  it('EX-SVC-031: an ALIAS finds the exercise its name never mentions', () => {
    // This is what the donor kept `aliases` for, and the reason it is ported.
    expect(searchScore(pushup, 'press up')).toBeGreaterThan(0);
    expect(searchScore({ ...pushup, aliases: [] }, 'press up')).toBe(0);
  });

  it('EX-SVC-032: a muscle or equipment hit scores, but never outranks a name', () => {
    const byMuscle = searchScore(pushup, 'chest');
    const byName = searchScore(
      { name: 'Chest Fly', aliases: [], muscle_groups: [], equipment: [] },
      'chest'
    );
    expect(byMuscle).toBeGreaterThan(0);
    expect(byName).toBeGreaterThan(byMuscle);
    expect(searchScore(pushup, 'none')).toBeGreaterThan(0);
  });

  it('EX-SVC-033: an empty or unmatched needle scores nothing', () => {
    expect(searchScore(pushup, '')).toBe(0);
    expect(searchScore(pushup, '   ')).toBe(0);
    expect(searchScore(pushup, 'kayaking')).toBe(0);
  });

  it('EX-SVC-034: an alias matches by PREFIX and by substring, ranked in that order', () => {
    // Someone typing "press" mid-word must still reach "press up", and an exact
    // alias must still beat both — otherwise the aliases column only helps a
    // person who already knows the alias in full.
    const aliased = { ...pushup, aliases: ['press_up'] };
    const exactAlias = searchScore(aliased, 'press up');
    const prefixAlias = searchScore(aliased, 'press');
    const substringAlias = searchScore(aliased, 'ess');
    expect(exactAlias).toBeGreaterThan(prefixAlias);
    expect(prefixAlias).toBeGreaterThan(substringAlias);
    expect(substringAlias).toBeGreaterThan(0);
  });
});

/* ==================================================================== */
/* D1 — the SHIPPED catalogue                                            */
/* ==================================================================== */

describe('HEALTH-EX-SVC — shipped catalogue integrity', () => {
  it('EX-SVC-040: migration 0123 seeds a library worth browsing', () => {
    // "A library with no exercises is not a feature." The floor is a real
    // assertion: if a future edit truncates the seed, this fails.
    expect(seededCount).toBeGreaterThanOrEqual(80);
  });

  it('EX-SVC-041: every seeded row survives the service mapping', async () => {
    const { exercises } = await svc().listExercises(UID);
    expect(exercises).toHaveLength(seededCount);

    for (const ex of exercises) {
      expect(ex.id).toMatch(/^ex_[a-z0-9_]+$/);
      expect(ex.name.length).toBeGreaterThan(0);
      // Instructions are the whole point of a detail screen.
      expect(ex.instructions?.length ?? 0).toBeGreaterThan(20);
      expect(EXERCISE_CATEGORY_VALUES).toContain(ex.category);
      expect(EXERCISE_DIFFICULTY_LEVELS).toContain(ex.difficulty);
      expect(ex.difficulty_level).toBeGreaterThanOrEqual(1);
      expect(ex.difficulty_level).toBeLessThanOrEqual(5);
      // "Log this" hands `workout_type` to the EXISTING entries route — a value
      // it does not accept would be a catalogue row that cannot be logged.
      expect(APP_WORKOUT_TYPES).toContain(ex.workout_type);
      expect(ex.default_minutes).toBeGreaterThan(0);
      expect(ex.illustration?.length ?? 0).toBeGreaterThan(0);
      // Video is P4: nothing may ship a third-party media URL.
      expect(ex.media_url).toBeNull();
    }
  });

  it('EX-SVC-041a: an optional media column passes through as NULL, never as a string', async () => {
    // `illustration` and `media_url` are nullable and go straight to the client
    // as an image source. The literal "null" would render a broken tile.
    await insertHealthRow(testEnv.DB, 'exercise_library', {
      id: 'ex_bare_row',
      name: 'Bare Row',
      aliases: '[]',
      category: 'strength',
      muscle_groups: '["back"]',
      secondary_muscles: '[]',
      equipment: '[]',
      body_parts: '["shoulder"]',
      difficulty: 'level1',
      instructions: null,
      illustration: null,
      media_url: null,
      default_minutes: 10,
      workout_type: 'strength',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      deleted_at: null,
    });

    const bare = await svc().getExercise(UID, 'ex_bare_row');
    expect(bare).not.toBeNull();
    expect(bare?.instructions).toBeNull();
    expect(bare?.illustration).toBeNull();
    expect(bare?.media_url).toBeNull();
  });

  it('EX-SVC-042: every seeded muscle / joint token is one the gate understands', async () => {
    const { exercises } = await svc().listExercises(UID);
    for (const ex of exercises) {
      for (const muscle of [...ex.muscle_groups, ...ex.secondary_muscles]) {
        expect(MUSCLE_TOKENS.has(muscle)).toBe(true);
      }
      for (const joint of ex.body_parts) {
        // A joint the gate cannot fold would silently never flag anything.
        expect(JOINT_TOKENS.has(canonicalBodyPart(joint))).toBe(true);
      }
    }
  });

  it('EX-SVC-043: the catalogue covers every category and the full difficulty range', async () => {
    const { exercises } = await svc().listExercises(UID);
    const categories = new Set(exercises.map((e) => e.category));
    for (const category of EXERCISE_CATEGORY_VALUES) expect(categories).toContain(category);
    const levels = new Set(exercises.map((e) => e.difficulty_level));
    expect(levels.has(1)).toBe(true);
    expect(levels.has(4)).toBe(true);
  });

  it('EX-SVC-044: nothing is favourited and nothing is flagged for a clean account', async () => {
    const { exercises, injury_body_parts } = await svc().listExercises(UID);
    expect(injury_body_parts).toEqual([]);
    expect(exercises.every((e) => e.is_favorite === false)).toBe(true);
    expect(exercises.every((e) => e.injury_flag === null)).toBe(true);
    // Default ordering with nothing flagged is plain alphabetical.
    const names = exercises.map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

/* ==================================================================== */
/* D1 — active injuries                                                  */
/* ==================================================================== */

describe('HEALTH-EX-SVC — active injury parts', () => {
  it('EX-SVC-050: only ACTIVE, non-deleted injuries reach the gate', async () => {
    await seedInjury(UID, 'knee');
    await seedInjury(UID, 'shoulder', { active: false, id: 'inj_healed' });
    await seedInjury(UID, 'wrist', { deleted: true, id: 'inj_gone' });

    const parts = await svc().activeInjuryParts(UID);
    expect(parts.map((p) => p.canonical)).toEqual(['knee']);
  });

  it('EX-SVC-051: injuries are USER-scoped — another account never gates mine', async () => {
    await seedInjury(OTHER, 'knee');
    expect(await svc().activeInjuryParts(UID)).toEqual([]);

    const { exercises } = await svc().listExercises(UID);
    expect(exercises.every((e) => e.injury_flag === null)).toBe(true);
  });

  it('EX-SVC-052: several injuries on one joint collapse to the worst pain', async () => {
    await seedInjury(UID, 'Left knee', { pain: 1, id: 'inj_1' });
    await seedInjury(UID, 'right knee', { pain: 4, id: 'inj_2' });

    const parts = await svc().activeInjuryParts(UID);
    expect(parts).toHaveLength(1);
    expect(parts[0].canonical).toBe('knee');
    expect(parts[0].max_pain_level).toBe(4);
    expect(parts[0].injury_count).toBe(2);
  });

  it('EX-SVC-053: joints at the SAME pain level come back in a stable, named order', () => {
    // Without the name tie-break the order is whatever D1 returns, so the
    // injury chips reshuffle between two identical reads of the same screen.
    return (async () => {
      await seedInjury(UID, 'Shoulder', { pain: 3, id: 'inj_s' });
      await seedInjury(UID, 'Knee', { pain: 3, id: 'inj_k' });
      await seedInjury(UID, 'Ankle', { pain: 4, id: 'inj_a' });

      const parts = await svc().activeInjuryParts(UID);
      // Worst pain first, then alphabetical within a level.
      expect(parts.map((p) => p.body_part)).toEqual(['Ankle', 'Knee', 'Shoulder']);
    })();
  });
});

/* ==================================================================== */
/* D1 — the gate applied to the real catalogue                           */
/* ==================================================================== */

describe('HEALTH-EX-SVC — gate over the real catalogue', () => {
  it('EX-SVC-060: a knee injury flags the squat and leaves the neck stretch clear', async () => {
    await seedInjury(UID, 'Left knee', { pain: 3 });
    const { exercises, injury_body_parts } = await svc().listExercises(UID);

    expect(injury_body_parts.map((p) => p.canonical)).toEqual(['knee']);

    const squat = exercises.find((e) => e.id === 'ex_squat');
    expect(squat?.injury_flag).toBe('avoid');
    expect(squat?.injury_body_parts).toEqual(['Left knee']);

    const neck = exercises.find((e) => e.id === 'ex_neck_stretch');
    expect(neck?.injury_flag).toBeNull();
    expect(neck?.injury_body_parts).toEqual([]);
  });

  it('EX-SVC-061: a wrist injury reaches the push-up through its JOINTS, not its muscles', async () => {
    await seedInjury(UID, 'wrist');
    const { exercises } = await svc().listExercises(UID);
    const pushup = exercises.find((e) => e.id === 'ex_pushup');
    // chest + triceps say nothing about a wrist; `body_parts` is what saves it.
    expect(pushup?.muscle_groups).toEqual(['chest', 'triceps']);
    expect(pushup?.injury_flag).toBe('avoid');
  });

  it('EX-SVC-062: flagged work is DE-PRIORITISED, never hidden', async () => {
    await seedInjury(UID, 'knee');
    const { exercises } = await svc().listExercises(UID);

    const flagged = exercises.filter((e) => e.injury_flag !== null);
    expect(flagged.length).toBeGreaterThan(0);
    // Still present — a physio-prescribed rehab move for the injured part must
    // stay findable (RULE 3).
    expect(exercises).toHaveLength(seededCount);

    const ranks = exercises.map((e) => injuryRank(e.injury_flag));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks[ranks.length - 1]).toBeGreaterThan(0);
  });

  it('EX-SVC-063: exclude_flagged is opt-in and drops them entirely', async () => {
    await seedInjury(UID, 'knee');
    const { exercises } = await svc().listExercises(UID, { exclude_flagged: true });
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.length).toBeLessThan(seededCount);
    expect(exercises.every((e) => e.injury_flag === null)).toBe(true);
  });

  it('EX-SVC-064: a flagged SEARCH hit still sorts below a safe one', async () => {
    await seedInjury(UID, 'knee');
    const { exercises } = await svc().listExercises(UID, { search: 'stretch' });
    const ranks = exercises.map((e) => injuryRank(e.injury_flag));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('EX-SVC-065: resolving the injury clears every flag again', async () => {
    await seedInjury(UID, 'knee');
    expect((await svc().listExercises(UID)).exercises.some((e) => e.injury_flag)).toBe(true);

    await testEnv.DB.prepare('UPDATE injuries SET is_active = 0 WHERE user_id = ?')
      .bind(UID)
      .run();

    const { exercises, injury_body_parts } = await svc().listExercises(UID);
    expect(injury_body_parts).toEqual([]);
    expect(exercises.every((e) => e.injury_flag === null)).toBe(true);
  });
});

/* ==================================================================== */
/* D1 — browse, filter, search                                           */
/* ==================================================================== */

describe('HEALTH-EX-SVC — browse and filter', () => {
  it('EX-SVC-070: filters by muscle group across PRIMARY and SECONDARY load', async () => {
    const { exercises } = await svc().listExercises(UID, { muscle_group: 'Glutes' });
    expect(exercises.length).toBeGreaterThan(0);
    for (const ex of exercises) {
      expect(
        ex.muscle_groups.includes('glutes') || ex.secondary_muscles.includes('glutes')
      ).toBe(true);
    }
    // Case + separator insensitive, like every other token in this domain.
    const raw = await svc().listExercises(UID, { muscle_group: 'glutes' });
    expect(raw.exercises.map((e) => e.id)).toEqual(exercises.map((e) => e.id));
  });

  it('EX-SVC-071: filters by equipment, difficulty and category', async () => {
    const mat = await svc().listExercises(UID, { equipment: 'yoga_mat' });
    expect(mat.exercises.length).toBeGreaterThan(0);
    expect(mat.exercises.every((e) => e.equipment.includes('yoga_mat'))).toBe(true);

    const easy = await svc().listExercises(UID, { difficulty: 'level1' });
    expect(easy.exercises.length).toBeGreaterThan(0);
    expect(easy.exercises.every((e) => e.difficulty === 'level1')).toBe(true);

    const cardio = await svc().listExercises(UID, { category: 'cardio' });
    expect(cardio.exercises.length).toBeGreaterThan(0);
    expect(cardio.exercises.every((e) => e.category === 'cardio')).toBe(true);
  });

  it('EX-SVC-072: filters AND together', async () => {
    const { exercises } = await svc().listExercises(UID, {
      category: 'strength',
      equipment: 'none',
      difficulty: 'level2',
    });
    for (const ex of exercises) {
      expect(ex.category).toBe('strength');
      expect(ex.equipment).toContain('none');
      expect(ex.difficulty).toBe('level2');
    }
  });

  it('EX-SVC-073: an unknown token in an OPEN vocabulary matches nothing', async () => {
    expect((await svc().listExercises(UID, { muscle_group: 'gills' })).exercises).toEqual([]);
    expect((await svc().listExercises(UID, { equipment: 'jetpack' })).exercises).toEqual([]);
  });

  it('EX-SVC-074: search finds by name, by alias and by muscle', async () => {
    const byName = await svc().listExercises(UID, { search: 'plank' });
    expect(byName.exercises[0].id).toBe('ex_plank');

    // Alias-only: the word "press up" appears nowhere in any exercise NAME.
    const byAlias = await svc().listExercises(UID, { search: 'press up' });
    expect(byAlias.exercises.map((e) => e.id)).toContain('ex_pushup');

    const byMuscle = await svc().listExercises(UID, { search: 'hamstrings' });
    expect(byMuscle.exercises.length).toBeGreaterThan(0);
  });

  it('EX-SVC-075: a search with no hits returns an empty list, not the catalogue', async () => {
    expect((await svc().listExercises(UID, { search: 'kayaking' })).exercises).toEqual([]);
  });

  it('EX-SVC-076: limit is clamped and never returns more than asked', async () => {
    expect((await svc().listExercises(UID, { limit: 5 })).exercises).toHaveLength(5);
    expect((await svc().listExercises(UID, { limit: 0 })).exercises).toHaveLength(seededCount);
    expect((await svc().listExercises(UID, { limit: -3 })).exercises).toHaveLength(seededCount);
    expect(
      (await svc().listExercises(UID, { limit: 10_000 })).exercises.length
    ).toBe(seededCount);
  });

  it('EX-SVC-077: getExercise returns one decorated row, or null', async () => {
    expect(await svc().getExercise(UID, 'ex_nope')).toBeNull();
    const squat = await svc().getExercise(UID, 'ex_squat');
    expect(squat?.name).toBe('Squat');
    expect(squat?.muscle_groups).toEqual(['quads', 'glutes']);
    expect(squat?.is_favorite).toBe(false);
  });
});

/* ==================================================================== */
/* D1 — favourites                                                       */
/* ==================================================================== */

describe('HEALTH-EX-SVC — favourites', () => {
  it('EX-SVC-080: favouriting is per-user and shows up on the list', async () => {
    await svc().setFavorite(UID, 'ex_plank', true);

    const mine = await svc().listExercises(UID, { favorites: true });
    expect(mine.exercises.map((e) => e.id)).toEqual(['ex_plank']);

    // The catalogue is shared; the favourite is not.
    const theirs = await svc().listExercises(OTHER, { favorites: true });
    expect(theirs.exercises).toEqual([]);
    expect((await svc().getExercise(OTHER, 'ex_plank'))?.is_favorite).toBe(false);
  });

  it('EX-SVC-081: un-favouriting SOFT deletes — the tombstone is what syncs', async () => {
    const added = await svc().setFavorite(UID, 'ex_plank', true);
    expect(added?.is_favorite).toBe(true);

    const row = await testEnv.DB.prepare(
      'SELECT id, updated_at FROM exercise_favorites WHERE user_id = ? AND exercise_id = ?'
    )
      .bind(UID, 'ex_plank')
      .first<{ id: string; updated_at: string }>();
    expect(row).not.toBeNull();

    const removed = await svc().setFavorite(UID, 'ex_plank', false);
    expect(removed?.is_favorite).toBe(false);

    const after = await readHealthRow<{ deleted_at: string | null; updated_at: string }>(
      testEnv.DB,
      'exercise_favorites',
      row!.id
    );
    // The row is still there, tombstoned — a hard DELETE would let another
    // device resurrect the favourite on its next push.
    expect(after?.deleted_at).not.toBeNull();
    expect(after?.updated_at).not.toBe('');
  });

  it('EX-SVC-082: re-favouriting REVIVES the same row instead of piling up tombstones', async () => {
    await svc().setFavorite(UID, 'ex_plank', true);
    await svc().setFavorite(UID, 'ex_plank', false);
    await svc().setFavorite(UID, 'ex_plank', true);
    await svc().setFavorite(UID, 'ex_plank', false);
    await svc().setFavorite(UID, 'ex_plank', true);

    const rows = await testEnv.DB.prepare(
      'SELECT id, deleted_at FROM exercise_favorites WHERE user_id = ?'
    )
      .bind(UID)
      .all<{ id: string; deleted_at: string | null }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results?.[0].deleted_at).toBeNull();
    expect((await svc().getExercise(UID, 'ex_plank'))?.is_favorite).toBe(true);
  });

  it('EX-SVC-083: un-favouriting something that was never a favourite writes nothing', async () => {
    const result = await svc().setFavorite(UID, 'ex_plank', false);
    expect(result?.is_favorite).toBe(false);
    const rows = await testEnv.DB.prepare(
      'SELECT id FROM exercise_favorites WHERE user_id = ?'
    )
      .bind(UID)
      .all();
    // A tombstone for an event that never happened is a lie the sync would carry.
    expect(rows.results).toHaveLength(0);
  });

  it('EX-SVC-084: an unknown exercise id is null, never a phantom favourite', async () => {
    expect(await svc().setFavorite(UID, 'ex_does_not_exist', true)).toBeNull();
    const rows = await testEnv.DB.prepare('SELECT id FROM exercise_favorites').all();
    expect(rows.results).toHaveLength(0);
  });

  it('EX-SVC-085: safety still outranks a favourite in the default ordering', async () => {
    await seedInjury(UID, 'knee');
    await svc().setFavorite(UID, 'ex_squat', true);

    const { exercises } = await svc().listExercises(UID);
    const squat = exercises.find((e) => e.id === 'ex_squat');
    expect(squat?.is_favorite).toBe(true);
    expect(squat?.injury_flag).toBe('avoid');
    // Favourited AND flagged: it must not be sitting at the top of the list.
    expect(exercises.indexOf(squat!)).toBeGreaterThan(0);
    expect(exercises[0].injury_flag).toBeNull();
  });
});
