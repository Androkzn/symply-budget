/**
 * Symply Health — INJURY LOG store (parity phase P2), and the WRITE half of the
 * workout-library safety gate.
 *
 * Four layers:
 *
 *  1. VOCABULARY — the one that matters. Every `body_part` this app can send is
 *     folded through the **deployed** `canonicalBodyPart()` tables, read out of
 *     `backend/src/services/health-exercise-service.ts` at test time, and must
 *     land on a joint the gate acts on. This is the failure the whole feature
 *     turns on: if the app records "leftKnee" and the Worker's folder expects
 *     "left knee", the injury is stored, the screen looks correct, and no
 *     exercise is ever flagged. Nothing crashes, nothing 400s — the safety
 *     surface just silently does not exist.
 *  2. PURE — pain clamping, ordering, summaries, date parsing, draft validation.
 *  3. WIRE — the EXACT payload every writer sends, and the `fromWire` mapping.
 *  4. OFFLINE — cached read, optimistic write, sync state, and the third
 *     outcome: a SERVER REJECTION rolls the optimistic row back rather than
 *     leaving a phantom injury gating exercises the Worker never flags.
 */

import fs from 'fs';
import path from 'path';

import { healthInjuriesApi, type HealthInjury } from '@api/healthInjuries';
import { storageHelpers } from '@services/storage';

import {
  activeInjuries,
  addInjury,
  affectsExerciseSuggestions,
  BAD_DATE_MESSAGE,
  bodyPartById,
  bodyPartsByRegion,
  DEFAULT_INJURY_TYPE,
  DEFAULT_PAIN_LEVEL,
  deleteInjury,
  draftFromInjury,
  editInjury,
  emptyInjuryDraft,
  fromWireInjury,
  GATE_UNMAPPED_BODY_PART_IDS,
  HEALTH_INJURIES_KEY,
  humanizeInjuryToken,
  injuriesOffline,
  injuryCauseLabel,
  injuryTypeLabel,
  INJURY_BODY_PARTS,
  INJURY_CAUSES,
  INJURY_REGIONS,
  INJURY_TYPES,
  loadInjuries,
  loggedAgoLabel,
  LONG_NOTES_MESSAGE,
  MAX_INJURY_NOTES,
  MISSING_INJURY_MESSAGE,
  NO_BODY_PART_MESSAGE,
  normalizeInjuries,
  OFFLINE_WRITE_MESSAGE,
  painLevelLabel,
  parseInjuryDateInput,
  reactivateInjury,
  REACTIVATE_OFFLINE_MESSAGE,
  rejectionMessageFor,
  resolveInjury,
  resolvedInjuries,
  sanitizeInjuryDateInput,
  sortInjuries,
  summarizeInjuries,
  validateInjuryDraft,
  type Injury,
} from '../healthInjuryStorage';
import {
  __setHealthOfflineForTests,
  clearHealthCache,
  healthSyncStateFor,
} from '../healthRepository';

jest.mock('@api/healthInjuries');

type MockedInjuriesApi = jest.Mocked<typeof healthInjuriesApi>;
const api = healthInjuriesApi as unknown as MockedInjuriesApi;

/** The Worker answers with the bare object — no `{ data }` envelope. */
function body<T>(payload: T): T {
  return payload;
}

const NETWORK_ERROR = new Error('Network request failed');

/** A refusal from the Worker, carrying only an HTTP status (never a message). */
function httpError(status: number): Error & { response: { status: number } } {
  return Object.assign(new Error('Request failed'), { response: { status } });
}

// Fixed local noon: `todayDateKey()` === '2026-07-13' in every timezone.
const FIXED_NOW = new Date(2026, 6, 13, 12, 0, 0);

function wireInjury(over: Partial<HealthInjury> = {}): HealthInjury {
  return {
    id: over.id ?? 'inj_1',
    user_id: over.user_id ?? 'user-1',
    date: over.date ?? '2026-07-13',
    body_part: over.body_part ?? 'Left Knee',
    pain_level: over.pain_level ?? 2,
    injury_type: over.injury_type ?? 'strain',
    cause: over.cause ?? 'workout',
    muscle_group: over.muscle_group ?? null,
    notes: over.notes ?? null,
    is_active: over.is_active ?? true,
    created_at: over.created_at ?? '2026-07-13T08:00:00.000Z',
    updated_at: over.updated_at ?? '2026-07-13T08:00:00.000Z',
    deleted_at: over.deleted_at ?? null,
  };
}

function injury(over: Partial<Injury> = {}): Injury {
  return {
    id: over.id ?? 'inj_1',
    date: over.date ?? '2026-07-13',
    bodyPart: over.bodyPart ?? 'Left Knee',
    painLevel: over.painLevel ?? 2,
    injuryType: over.injuryType ?? 'strain',
    cause: over.cause ?? 'workout',
    notes: over.notes ?? '',
    isActive: over.isActive ?? true,
    createdAt: over.createdAt ?? '2026-07-13T08:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-13T08:00:00.000Z',
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick'] });
  __setHealthOfflineForTests(false);
  await clearHealthCache([HEALTH_INJURIES_KEY]);
  api.listInjuries.mockResolvedValue(body({ injuries: [] }));
});

afterEach(() => {
  jest.useRealTimers();
  __setHealthOfflineForTests(false);
});

/* ==================================================================== */
/* 1. VOCABULARY — the round trip through the DEPLOYED gate              */
/* ==================================================================== */

/**
 * The Worker's folder, rebuilt from the Worker's OWN tables.
 *
 * The tables are read as source text rather than imported: the service imports
 * `drizzle-orm`, which resolves only from `backend/node_modules` and is not
 * loadable in the RN Jest environment. Reading the file is what makes this a
 * DRIFT test — edit the alias table on the backend and this suite re-reads it,
 * where a hand-copied constant would happily keep agreeing with itself.
 */
const BACKEND_DIR = path.join(__dirname, '..', '..', '..', '..', 'backend');
const EXERCISE_SERVICE = path.join(
  BACKEND_DIR,
  'src',
  'services',
  'health-exercise-service.ts'
);
const CATALOGUE_MIGRATION = path.join(
  BACKEND_DIR,
  'migrations',
  '0123_health_exercise_library.sql'
);

const serviceSource = fs.readFileSync(EXERCISE_SERVICE, 'utf8');

/** Brace-match one `const NAME… = { … }` literal out of the source. */
function objectLiteral(declaration: string): string {
  const start = serviceSource.indexOf(declaration);
  if (start === -1) throw new Error(`${declaration} not found — the gate has been restructured`);
  const open = serviceSource.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < serviceSource.length; i += 1) {
    if (serviceSource[i] === '{') depth += 1;
    else if (serviceSource[i] === '}') {
      depth -= 1;
      if (depth === 0) return serviceSource.slice(open, i + 1);
    }
  }
  throw new Error(`${declaration} literal is unbalanced`);
}

/**
 * Read `key: 'value',` entries out of a literal.
 *
 * Parsed rather than `eval`'d: the whole point is to read a file this suite does
 * not control, and executing it would be a code-injection path through a source
 * tree into the test runner.
 */
function parseStringMap(literal: string): Record<string, string> {
  const out: Record<string, string> = {};
  const entry = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'([^']*)'\s*,?\s*$/;
  for (const line of literal.split('\n')) {
    const match = entry.exec(line);
    if (match !== null) out[match[1]] = match[2];
  }
  return out;
}

/** Read `key: ['a', 'b'],` entries out of a literal. */
function parseArrayMap(literal: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const entry = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[([^\]]*)\]\s*,?\s*$/;
  for (const line of literal.split('\n')) {
    const match = entry.exec(line);
    if (match !== null) {
      out[match[1]] = (match[2].match(/'([^']*)'/g) ?? []).map((token) => token.slice(1, -1));
    }
  }
  return out;
}

/** How many `key:` entries the literal declares, independent of the parsers. */
function countEntryLines(literal: string): number {
  return literal
    .split('\n')
    .filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)).length;
}

const BODY_PART_ALIASES = parseStringMap(objectLiteral('const BODY_PART_ALIASES'));
const BODY_PART_MUSCLES = parseArrayMap(objectLiteral('const BODY_PART_MUSCLES'));

/** The joint tokens the seeded catalogue actually labels its 88 movements with. */
function catalogueJointTokens(): Set<string> {
  const sql = fs.readFileSync(CATALOGUE_MIGRATION, 'utf8');
  const marker = 'INSERT OR IGNORE INTO exercise_library';
  const rows = sql.slice(sql.indexOf(marker));
  // Five JSON arrays per row, in column order:
  // aliases, muscle_groups, secondary_muscles, equipment, body_parts.
  const arrays = rows.match(/'(\[[^\]]*\])'/g) ?? [];
  if (arrays.length === 0 || arrays.length % 5 !== 0) {
    throw new Error(`catalogue parse misaligned (${arrays.length} arrays)`);
  }
  const tokens = new Set<string>();
  for (let i = 4; i < arrays.length; i += 5) {
    for (const token of JSON.parse(arrays[i].slice(1, -1)) as string[]) tokens.add(token);
  }
  return tokens;
}

/** `canonicalBodyPart` — the deployed implementation, over the deployed tables. */
function canonicalBodyPart(raw: string): string {
  let token = String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (token.length === 0) return '';
  token = token.replace(/^(left|right|l|r)_/, '').replace(/_(left|right)$/, '');
  return BODY_PART_ALIASES[token] ?? token;
}

describe('Symply Health injuries — body-part vocabulary round trip', () => {
  it('HEALTH-INJ-041: the folder rebuilt here is byte-for-byte the deployed one', () => {
    // If any of these change on the backend, the reimplementation above is no
    // longer the deployed algorithm and every assertion below becomes a lie.
    expect(serviceSource).toContain(".replace(/[^a-z0-9]+/g, '_')");
    expect(serviceSource).toContain(".replace(/^_+|_+$/g, '')");
    expect(serviceSource).toContain(".replace(/^(left|right|l|r)_/, '')");
    expect(serviceSource).toContain(".replace(/_(left|right)$/, '')");
    expect(serviceSource).toContain('BODY_PART_ALIASES[token] ?? token');
    // And the tables really parsed, rather than yielding a partly-read object
    // that would make some lookups vacuously "miss". The counts are compared
    // against the literals' own entry lines, so a reformat that broke the
    // line-based parse fails HERE rather than quietly weakening HEALTH-INJ-043.
    const aliasLiteral = objectLiteral('const BODY_PART_ALIASES');
    const muscleLiteral = objectLiteral('const BODY_PART_MUSCLES');
    expect(Object.keys(BODY_PART_ALIASES)).toHaveLength(countEntryLines(aliasLiteral));
    expect(Object.keys(BODY_PART_MUSCLES)).toHaveLength(countEntryLines(muscleLiteral));
    expect(Object.keys(BODY_PART_ALIASES).length).toBeGreaterThan(30);
    expect(Object.keys(BODY_PART_MUSCLES).length).toBeGreaterThan(10);
    // Spot-check both directions of the fold actually came through.
    expect(BODY_PART_ALIASES.lumbar).toBe('lower_back');
    expect(BODY_PART_MUSCLES.knee).toContain('quads');
  });

  it('HEALTH-INJ-042: the gate can only fire on a `BODY_PART_MUSCLES` key', () => {
    // `injuryVerdictFor` has two doors: the exercise NAMES the joint, or the
    // joint's muscles hit the row. The first is bounded by the catalogue's own
    // joint tokens — and every one of those is also a muscle-map key, so that
    // one key set is the complete effective vocabulary. This is what makes the
    // next test's assertion sufficient rather than merely necessary.
    const joints = catalogueJointTokens();
    expect(joints.size).toBeGreaterThan(0);
    for (const joint of joints) {
      expect(Object.keys(BODY_PART_MUSCLES)).toContain(joint);
    }
  });

  it('HEALTH-INJ-043: every body part the app can send folds onto the gate', () => {
    const gateKeys = new Set(Object.keys(BODY_PART_MUSCLES));
    const unreachable = INJURY_BODY_PARTS.filter(
      (part) => !gateKeys.has(canonicalBodyPart(part.wire))
    ).map((part) => part.id);

    // Exactly the three the module documents — no more (a silent safety hole)
    // and no fewer (a stale disclaimer shown to the user for no reason).
    expect(unreachable.sort()).toEqual([...GATE_UNMAPPED_BODY_PART_IDS].sort());
  });

  it('HEALTH-INJ-044: the parts that DO gate resolve to the joint a human expects', () => {
    // Spot-checks with the answer written out, so a wrong-but-consistent fold
    // (everything collapsing to one token, say) cannot pass HEALTH-INJ-043.
    const expected: Record<string, string> = {
      leftKnee: 'knee',
      rightKnee: 'knee',
      lowerBack: 'lower_back',
      upperBack: 'back',
      leftShoulder: 'shoulder',
      leftHand: 'wrist',
      leftForearm: 'wrist',
      abdomen: 'core',
      glutes: 'hip',
      leftThigh: 'quad',
      leftCalf: 'calf',
      leftAnkle: 'ankle',
      leftFoot: 'foot',
      groin: 'groin',
      neck: 'neck',
      chest: 'chest',
      leftElbow: 'elbow',
    };
    for (const [id, joint] of Object.entries(expected)) {
      const part = bodyPartById(id);
      expect(part).not.toBeNull();
      expect(canonicalBodyPart(part?.wire ?? '')).toBe(joint);
    }
  });

  it('HEALTH-INJ-045: the DONOR raw value would have silently killed the gate', () => {
    // The negative control, and the whole reason we persist `displayName`
    // instead of `BodyPart.rawValue`: the folder strips a side affix only when
    // a SEPARATOR produced one, so camelCase never reaches a joint.
    const gateKeys = new Set(Object.keys(BODY_PART_MUSCLES));
    for (const id of ['leftKnee', 'lowerBack', 'leftShoulder', 'upperBack', 'rightAnkle']) {
      expect(gateKeys.has(canonicalBodyPart(id))).toBe(false); // donor rawValue
      expect(gateKeys.has(canonicalBodyPart(bodyPartById(id)?.wire ?? ''))).toBe(true); // ours
    }
  });

  it('HEALTH-INJ-046: a write can only ever emit a vocabulary value', async () => {
    // The choke point: `validateInjuryDraft` resolves `body_part` from the
    // picker id, so no screen can invent a string. Drive all 32 through it and
    // assert the emitted payload is the vocabulary entry, unmodified.
    for (const part of INJURY_BODY_PARTS) {
      const validated = validateInjuryDraft({
        ...emptyInjuryDraft('2026-07-13'),
        bodyPartId: part.id,
      });
      expect(validated.valid).toBe(true);
      if (validated.valid) expect(validated.payload.body_part).toBe(part.wire);
    }
  });

  it('HEALTH-INJ-047: the round trip survives a real POST → active-body-parts read', async () => {
    // End to end at the contract level: what `addInjury` puts on the wire is
    // what the Worker would group by, and the canonical it groups under is a
    // joint the exercise gate suppresses on.
    api.createInjury.mockResolvedValue(body({ injury: wireInjury() }));
    api.listInjuries.mockResolvedValue(body({ injuries: [] }));

    const validated = validateInjuryDraft({
      ...emptyInjuryDraft('2026-07-13'),
      bodyPartId: 'leftKnee',
    });
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    await addInjury(validated.payload);

    const sent = api.createInjury.mock.calls[0][0].body_part;
    expect(sent).toBe('Left Knee');
    expect(canonicalBodyPart(sent)).toBe('knee');
    // …and `knee` is what suppresses squats and lunges.
    expect(BODY_PART_MUSCLES.knee).toEqual(expect.arrayContaining(['quads']));
  });
});

/* ==================================================================== */
/* 2. PURE                                                               */
/* ==================================================================== */

describe('Symply Health injuries — vocabulary shape', () => {
  it('HEALTH-INJ-048: ports all 32 donor body parts across the 5 donor regions', () => {
    expect(INJURY_BODY_PARTS).toHaveLength(32);
    expect(new Set(INJURY_BODY_PARTS.map((p) => p.id)).size).toBe(32);
    expect(new Set(INJURY_BODY_PARTS.map((p) => p.wire)).size).toBe(32);
    const groups = bodyPartsByRegion();
    expect(groups.map((g) => g.region)).toEqual([...INJURY_REGIONS]);
    expect(groups.reduce((n, g) => n + g.parts.length, 0)).toBe(32);
    // Head & neck 2, arms 12, torso 4, hips 4, legs 10 — the donor's grouping.
    expect(groups.map((g) => g.parts.length)).toEqual([2, 12, 4, 4, 10]);
  });

  it('HEALTH-INJ-049: ports the donor type and cause vocabularies', () => {
    expect(INJURY_TYPES.map((t) => t.id)).toEqual([
      'pain',
      'soreness',
      'strain',
      'sprain',
      'tightness',
      'weakness',
      'numbness',
      'swelling',
      'bruise',
      'other',
    ]);
    expect(INJURY_CAUSES).toHaveLength(8);
    expect(injuryTypeLabel('sprain')).toBe('Sprain');
    expect(injuryCauseLabel('sportActivity')).toBe('Sport');
    expect(injuryCauseLabel(null)).toBe('Not stated');
    // An unknown token from another client degrades readably, never blank.
    expect(injuryTypeLabel('tendonitis')).toBe('Tendonitis');
    expect(humanizeInjuryToken('sportActivity')).toBe('Sport activity');
  });

  it('HEALTH-INJ-050: the pain scale is names only — no clinical interpretation', () => {
    expect(painLevelLabel(0)).toBe('None');
    expect(painLevelLabel(4)).toBe('Extreme');
    // Out of range degrades to the route's own default rather than throwing.
    expect(painLevelLabel(9)).toBe(painLevelLabel(DEFAULT_PAIN_LEVEL));
    // The donor's `PainLevel.description` strings must not have come along.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'healthInjuryStorage.ts'),
      'utf8'
    );
    for (const clinical of [
      'may limit some activities',
      'unable to perform activities',
      'Consult a professional',
      'Rest, Ice, Compression',
      'Ligament injury',
    ]) {
      // The header quotes them to explain the omission, so match the CODE only.
      const inCode = source
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
        .join('\n');
      expect(inCode).not.toContain(clinical);
    }
  });

  it('HEALTH-INJ-051: unmapped parts are flagged for the screen, mapped ones are not', () => {
    expect(affectsExerciseSuggestions('leftKnee')).toBe(true);
    expect(affectsExerciseSuggestions('head')).toBe(false);
    expect(affectsExerciseSuggestions('leftUpperArm')).toBe(false);
  });
});

describe('Symply Health injuries — ordering, summary and dates', () => {
  it('HEALTH-INJ-052: sorts newest date first, then newest created', () => {
    const rows = [
      injury({ id: 'a', date: '2026-07-01' }),
      injury({ id: 'b', date: '2026-07-13', createdAt: '2026-07-13T06:00:00.000Z' }),
      injury({ id: 'c', date: '2026-07-13', createdAt: '2026-07-13T09:00:00.000Z' }),
    ];
    expect(sortInjuries(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('HEALTH-INJ-053: splits active from resolved', () => {
    const rows = [injury({ id: 'a' }), injury({ id: 'b', isActive: false })];
    expect(activeInjuries(rows).map((r) => r.id)).toEqual(['a']);
    expect(resolvedInjuries(rows).map((r) => r.id)).toEqual(['b']);
  });

  it('HEALTH-INJ-054: the summary counts rows and names only what actually gates', () => {
    const rows = [
      injury({ id: 'a', bodyPart: 'Left Knee' }),
      injury({ id: 'b', bodyPart: 'Lower Back' }),
      // Head is in the vocabulary but the gate does not act on it, so it must
      // NOT be named as steering the library.
      injury({ id: 'c', bodyPart: 'Head' }),
      injury({ id: 'd', bodyPart: 'Left Knee', isActive: false }),
    ];
    expect(summarizeInjuries(rows)).toEqual({
      active: 3,
      resolved: 1,
      gatingParts: ['Left Knee', 'Lower Back'],
    });
  });

  it('HEALTH-INJ-055: an unknown wording is assumed to gate, never promised not to', () => {
    // Written by another client or an older build. Claiming "this will not
    // affect your suggestions" about a string we cannot fold would be a lie in
    // the dangerous direction.
    const rows = [injury({ id: 'x', bodyPart: 'Left Hamstring' })];
    expect(summarizeInjuries(rows).gatingParts).toEqual(['Left Hamstring']);
  });

  it('HEALTH-INJ-056: says how long ago in plain words', () => {
    expect(loggedAgoLabel('2026-07-13', '2026-07-13')).toBe('logged today');
    expect(loggedAgoLabel('2026-07-12', '2026-07-13')).toBe('logged yesterday');
    expect(loggedAgoLabel('2026-07-09', '2026-07-13')).toBe('logged 4 days ago');
    expect(loggedAgoLabel('2026-07-20', '2026-07-13')).toBe('logged for a future date');
    expect(loggedAgoLabel('not-a-date', '2026-07-13')).toBe('date not recorded');
  });

  it('HEALTH-INJ-057: the date field refuses a rolled-over day', () => {
    // Everything but digits and dashes is dropped as it is typed, so a pasted
    // "2026/07-13abc" becomes "202607-13" — still not a valid day, which is the
    // parser's job below, not the sanitiser's.
    expect(sanitizeInjuryDateInput('2026/07-13abc')).toBe('202607-13');
    expect(sanitizeInjuryDateInput('2026-07-13T08:00:00Z')).toBe('2026-07-13');
    expect(parseInjuryDateInput('2026-07-13')).toEqual({ valid: true, date: '2026-07-13' });
    // V8 rolls 30 Feb to 2 March; the route's regex would accept it and the row
    // would then sort against a day the user never chose.
    expect(parseInjuryDateInput('2026-02-30')).toEqual({ valid: false });
    expect(parseInjuryDateInput('')).toEqual({ valid: false });
    expect(parseInjuryDateInput('13-07-2026')).toEqual({ valid: false });
  });
});

describe('Symply Health injuries — draft validation', () => {
  it('HEALTH-INJ-058: the area is the only required field, as in the donor', () => {
    const empty = emptyInjuryDraft('2026-07-13');
    expect(empty.bodyPartId).toBeNull();
    expect(validateInjuryDraft(empty)).toEqual({
      valid: false,
      message: NO_BODY_PART_MESSAGE,
    });

    const ok = validateInjuryDraft({ ...empty, bodyPartId: 'leftKnee' });
    expect(ok).toEqual({
      valid: true,
      payload: {
        date: '2026-07-13',
        body_part: 'Left Knee',
        pain_level: DEFAULT_PAIN_LEVEL,
        injury_type: DEFAULT_INJURY_TYPE,
        cause: 'workout',
        notes: null,
      },
    });
  });

  it('HEALTH-INJ-059: a bad date is refused here, not 400d at the Worker', () => {
    expect(
      validateInjuryDraft({
        ...emptyInjuryDraft('2026-07-13'),
        bodyPartId: 'leftKnee',
        date: '2026-13-01',
      })
    ).toEqual({ valid: false, message: BAD_DATE_MESSAGE });
  });

  it('HEALTH-INJ-060: a whitespace-only note is sent as null, not as spaces', () => {
    const validated = validateInjuryDraft({
      ...emptyInjuryDraft('2026-07-13'),
      bodyPartId: 'neck',
      notes: '   ',
      cause: null,
    });
    expect(validated.valid).toBe(true);
    if (validated.valid) {
      expect(validated.payload.notes).toBeNull();
      expect(validated.payload.cause).toBeNull();
    }
  });

  it('HEALTH-INJ-061: an existing row reopens in the form unchanged', () => {
    const draft = draftFromInjury(
      injury({ bodyPart: 'Lower Back', painLevel: 3, injuryType: 'strain', notes: 'ache' })
    );
    expect(draft.bodyPartId).toBe('lowerBack');
    expect(draft.painLevel).toBe(3);
    expect(draft.notes).toBe('ache');
    // A wording this build does not know resolves to no part, so Save re-asks
    // rather than silently rewriting it to something else.
    expect(draftFromInjury(injury({ bodyPart: 'Left Hamstring' })).bodyPartId).toBeNull();
  });
});

/* ==================================================================== */
/* 3. WIRE                                                               */
/* ==================================================================== */

describe('Symply Health injuries — wire mapping', () => {
  it('HEALTH-INJ-062: maps a row and clamps a pain level outside the donor scale', () => {
    expect(fromWireInjury(wireInjury({ notes: 'twinge' }))).toEqual({
      id: 'inj_1',
      date: '2026-07-13',
      bodyPart: 'Left Knee',
      painLevel: 2,
      injuryType: 'strain',
      cause: 'workout',
      notes: 'twinge',
      isActive: true,
      createdAt: '2026-07-13T08:00:00.000Z',
      updatedAt: '2026-07-13T08:00:00.000Z',
    });
    expect(fromWireInjury(wireInjury({ pain_level: 99 })).painLevel).toBe(4);
    expect(fromWireInjury(wireInjury({ pain_level: -3 })).painLevel).toBe(0);
  });

  it('HEALTH-INJ-063: anything but an explicit true is treated as RESOLVED', () => {
    // Fail safe in the direction that cannot invent a gate the server lacks.
    expect(fromWireInjury(wireInjury({ is_active: 1 as unknown as boolean })).isActive).toBe(
      false
    );
    expect(fromWireInjury(wireInjury({ is_active: false })).isActive).toBe(false);
  });

  it('HEALTH-INJ-064: a corrupt cached snapshot is repaired, never thrown on', () => {
    expect(normalizeInjuries(null)).toEqual([]);
    expect(normalizeInjuries('nope' as unknown as Injury[])).toEqual([]);
    expect(
      normalizeInjuries([injury(), { id: 7 } as unknown as Injury, null as unknown as Injury])
    ).toHaveLength(1);
  });

  it('HEALTH-INJ-065: the read asks for BOTH active and resolved', async () => {
    api.listInjuries.mockResolvedValue(
      body({ injuries: [wireInjury({ id: 'a' }), wireInjury({ id: 'b', is_active: false })] })
    );
    const rows = await loadInjuries();
    // No `?active=` filter: caching a filtered response under the one snapshot
    // key would leave the offline read showing only half the log.
    expect(api.listInjuries).toHaveBeenCalledWith();
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('HEALTH-INJ-066: each writer sends the exact deployed request', async () => {
    api.createInjury.mockResolvedValue(body({ injury: wireInjury() }));
    api.updateInjury.mockResolvedValue(body({ injury: wireInjury() }));
    api.resolveInjury.mockResolvedValue(body({ injury: wireInjury({ is_active: false }) }));
    api.deleteInjury.mockResolvedValue(body({ deleted: true }));

    await addInjury({ body_part: 'Left Knee', pain_level: 2 });
    expect(api.createInjury).toHaveBeenCalledWith({ body_part: 'Left Knee', pain_level: 2 });

    await editInjury('inj_1', { pain_level: 3 });
    expect(api.updateInjury).toHaveBeenCalledWith('inj_1', { pain_level: 3 });

    await resolveInjury('inj_1');
    expect(api.resolveInjury).toHaveBeenCalledWith('inj_1');

    // Re-activation is a PUT, not a second resolve endpoint.
    await reactivateInjury('inj_1');
    expect(api.updateInjury).toHaveBeenLastCalledWith('inj_1', { is_active: true });

    await deleteInjury('inj_1');
    expect(api.deleteInjury).toHaveBeenCalledWith('inj_1');
  });

  it('HEALTH-INJ-067: resolve is NOT delete — the row stays in the log', async () => {
    // The property the whole "history" half of the screen depends on, and the
    // client mirror of backend INJ-019.
    api.resolveInjury.mockResolvedValue(body({ injury: wireInjury({ is_active: false }) }));
    api.listInjuries
      .mockResolvedValueOnce(body({ injuries: [wireInjury({ id: 'inj_1' })] }))
      .mockResolvedValue(body({ injuries: [wireInjury({ id: 'inj_1', is_active: false })] }));

    const result = await resolveInjury('inj_1');
    expect(result.status).toBe('saved');
    expect(result.injuries).toHaveLength(1);
    expect(activeInjuries(result.injuries)).toHaveLength(0);
    expect(resolvedInjuries(result.injuries).map((r) => r.id)).toEqual(['inj_1']);
    expect(api.deleteInjury).not.toHaveBeenCalled();
  });
});

/* ==================================================================== */
/* 4. OFFLINE / REJECTION                                                */
/* ==================================================================== */

describe('Symply Health injuries — offline and rejection', () => {
  it('HEALTH-INJ-068: a failed read falls back to the cache, never blanks', async () => {
    await storageHelpers.setObject(HEALTH_INJURIES_KEY, [injury({ id: 'cached' })]);
    api.listInjuries.mockRejectedValue(NETWORK_ERROR);

    const rows = await loadInjuries();
    expect(rows.map((r) => r.id)).toEqual(['cached']);
    expect(healthSyncStateFor(HEALTH_INJURIES_KEY)).toBe('offline');
    expect(injuriesOffline()).toBe(true);
  });

  it('HEALTH-INJ-069: an offline add keeps the row and says it will sync', async () => {
    __setHealthOfflineForTests(true);
    const result = await addInjury({ body_part: 'Left Knee' });

    expect(api.createInjury).not.toHaveBeenCalled();
    expect(result.status).toBe('offline');
    expect(result.message).toBe(OFFLINE_WRITE_MESSAGE);
    expect(result.injuries.map((r) => r.bodyPart)).toEqual(['Left Knee']);
    // …and it is in the cache, so the tab still shows it after a cold start.
    expect(await storageHelpers.getObject<Injury[]>(HEALTH_INJURIES_KEY)).toHaveLength(1);
  });

  it('HEALTH-INJ-070: a REJECTED add rolls back — no phantom gating injury', async () => {
    // The one that matters: a row the Worker refused would keep "flagging"
    // exercises on this device that the Worker never flags, so the optimistic
    // add must not survive.
    api.listInjuries.mockResolvedValue(body({ injuries: [wireInjury({ id: 'kept' })] }));
    api.createInjury.mockRejectedValue(httpError(400));

    const result = await addInjury({ body_part: 'Left Knee' });
    expect(result.status).toBe('rejected');
    expect(result.message).toBe('That could not be saved. Please try again.');
    expect(result.injuries.map((r) => r.id)).toEqual(['kept']);
    expect(await storageHelpers.getObject<Injury[]>(HEALTH_INJURIES_KEY)).toHaveLength(1);
  });

  it('HEALTH-INJ-071: a 404 on resolve says the entry is gone, in plain words', async () => {
    api.listInjuries.mockResolvedValue(body({ injuries: [wireInjury({ id: 'inj_1' })] }));
    api.resolveInjury.mockRejectedValue(httpError(404));

    const result = await resolveInjury('inj_1');
    expect(result.status).toBe('rejected');
    expect(result.message).toBe(MISSING_INJURY_MESSAGE);
  });

  it('HEALTH-INJ-072: no raw error string can reach the UI', () => {
    expect(rejectionMessageFor(NETWORK_ERROR)).toBeNull(); // no status → offline
    expect(rejectionMessageFor(httpError(503))).toBeNull(); // a wobble is offline
    expect(rejectionMessageFor(httpError(401))).toBe('Please sign in again to save this.');
    expect(rejectionMessageFor(httpError(404))).toBe(MISSING_INJURY_MESSAGE);
    // Whatever comes back, it is one of OUR sentences.
    for (const status of [400, 401, 403, 404, 418, 422]) {
      const message = rejectionMessageFor(httpError(status));
      expect(message).not.toContain('Request failed');
    }
  });

  it('HEALTH-INJ-073: an offline delete drops the row locally and says so', async () => {
    api.listInjuries.mockResolvedValue(
      body({ injuries: [wireInjury({ id: 'a' }), wireInjury({ id: 'b' })] })
    );
    await loadInjuries();
    __setHealthOfflineForTests(true);

    const result = await deleteInjury('a');
    expect(result.status).toBe('offline');
    expect(result.injuries.map((r) => r.id)).toEqual(['b']);
  });
});

/* ==================================================================== */
/* 5. OPTIMISTIC MERGE — what the list shows before the answer arrives    */
/* ==================================================================== */

/**
 * Every writer paints its result into the list before the Worker replies, and
 * offline that optimistic list is the ONLY answer the screen ever gets. Until
 * now every lifecycle case ran against an EMPTY log, so the merge itself —
 * which fields a patch overrides, which it leaves alone, and whether the OTHER
 * rows survive — was never executed once.
 */
describe('Symply Health injuries — optimistic merge', () => {
  /**
   * Two rows in the CACHE, then offline.
   *
   * Offline is the only state in which the optimistic list is the final answer
   * the screen sees, and two rows make "the other row survived" a real
   * assertion rather than a vacuous one.
   */
  async function twoRowLogOffline() {
    api.listInjuries.mockResolvedValue(
      body({
        injuries: [
          wireInjury({
            id: 'inj_1',
            date: '2026-07-13',
            body_part: 'Left Knee',
            pain_level: 2,
            injury_type: 'strain',
            cause: 'workout',
            notes: 'ache after squats',
          }),
          wireInjury({ id: 'inj_2', date: '2026-07-01', body_part: 'Neck' }),
        ],
      })
    );
    await loadInjuries(); // primes the snapshot the offline reads fall back to
    __setHealthOfflineForTests(true);
  }

  it('HEALTH-INJ-074: a partial edit patches ONLY the fields it names', async () => {
    // A PUT sends just the changed keys. If the merge treated an ABSENT key the
    // same as an explicit null, editing the pain level would silently wipe the
    // note and the cause the user had already written.
    await twoRowLogOffline();

    const result = await editInjury('inj_1', { pain_level: 4 });

    const edited = result.injuries.find((r) => r.id === 'inj_1');
    expect(edited).toMatchObject({
      painLevel: 4,
      date: '2026-07-13',
      bodyPart: 'Left Knee',
      injuryType: 'strain',
      cause: 'workout',
      notes: 'ache after squats',
      isActive: true,
    });
    // The row that was NOT edited is untouched and still in the log.
    expect(result.injuries.find((r) => r.id === 'inj_2')).toMatchObject({ bodyPart: 'Neck' });
  });

  it('HEALTH-INJ-075: an explicit null CLEARS the cause, an absent key does not', async () => {
    // `cause` is the one nullable field the form can actively empty, so the
    // merge distinguishes `undefined` (leave alone) from `null` (clear it).
    await twoRowLogOffline();

    // Absent key → the cause the row already had survives.
    const untouched = await editInjury('inj_1', { pain_level: 1 });
    expect(untouched.injuries.find((r) => r.id === 'inj_1')?.cause).toBe('workout');

    // Explicit null → cleared, and the clear sticks in the cache.
    const cleared = await editInjury('inj_1', { cause: null });
    expect(cleared.injuries.find((r) => r.id === 'inj_1')?.cause).toBeNull();
    expect((await loadInjuries()).find((r) => r.id === 'inj_1')?.cause).toBeNull();
  });

  it('HEALTH-INJ-076: a nulled note becomes empty text, never the string "null"', async () => {
    // `notes` binds to a <Text> and to a <TextInput value>; a literal null there
    // renders nothing but makes the field uncontrolled on reopen.
    await twoRowLogOffline();

    const result = await editInjury('inj_1', { notes: null });
    expect(result.injuries.find((r) => r.id === 'inj_1')?.notes).toBe('');
  });

  it('HEALTH-INJ-087: `is_active` in a PATCH moves the row between the two cards', async () => {
    // `editInjury` is the general PUT — the route accepts `is_active` on it, and
    // that flag decides whether the row gates the exercise library at all. The
    // absent-key case must NOT re-open a healed injury.
    await twoRowLogOffline();

    const healed = await editInjury('inj_1', { is_active: false });
    expect(resolvedInjuries(healed.injuries).map((r) => r.id)).toEqual(['inj_1']);

    // A later patch that says nothing about `is_active` leaves it healed.
    const renamed = await editInjury('inj_1', { injury_type: 'sprain' });
    expect(resolvedInjuries(renamed.injuries).map((r) => r.id)).toEqual(['inj_1']);
    expect(renamed.injuries.find((r) => r.id === 'inj_1')?.injuryType).toBe('sprain');
  });

  it('HEALTH-INJ-077: an out-of-scale pain level in a patch is ignored, not stored', async () => {
    // The scale is 0–4 and the labels are indexed by it. A patch carrying
    // anything else keeps the level the row already had rather than rendering
    // an undefined label.
    await twoRowLogOffline();

    const result = await editInjury('inj_1', {
      pain_level: 9 as unknown as 0,
      body_part: 'Lower Back',
    });
    const edited = result.injuries.find((r) => r.id === 'inj_1');
    expect(edited?.painLevel).toBe(2); // unchanged
    expect(edited?.bodyPart).toBe('Lower Back'); // the valid half of the patch applied
  });

  it('HEALTH-INJ-078: resolve and reopen flip only the target row', async () => {
    // The gate reads `isActive`, so flipping the wrong row would suppress
    // exercises for an injury the user never had — or un-suppress one they do.
    await twoRowLogOffline();

    const resolved = await resolveInjury('inj_1');
    expect(resolvedInjuries(resolved.injuries).map((r) => r.id)).toEqual(['inj_1']);
    expect(activeInjuries(resolved.injuries).map((r) => r.id)).toEqual(['inj_2']);

    const reopened = await reactivateInjury('inj_1');
    expect(activeInjuries(reopened.injuries).map((r) => r.id).sort()).toEqual(['inj_1', 'inj_2']);
    expect(reopened.message).toBe(REACTIVATE_OFFLINE_MESSAGE);
  });
});

/* ==================================================================== */
/* 6. MALFORMED INPUT AND ROWS                                           */
/* ==================================================================== */

describe('Symply Health injuries — malformed input and rows', () => {
  it('HEALTH-INJ-079: a body with no `injuries` key reads as an empty log', async () => {
    // The Worker answers BARE, so a renamed key or a 204-shaped body arrives as
    // `{}`. Calling `.map` on that would throw a TypeError into the tab.
    api.listInjuries.mockResolvedValue(body({} as never));
    expect(await loadInjuries()).toEqual([]);
  });

  it('HEALTH-INJ-080: a row missing every nullable column still renders as text', async () => {
    // Written by an older build or drifted after a migration. Every one of these
    // fields lands in a <Text> or a <TextInput value>, so a null must become
    // empty text or the app renders "null" / warns about an uncontrolled input.
    const bare = wireInjury() as unknown as Record<string, unknown>;
    bare.date = null;
    bare.body_part = null;
    bare.pain_level = null;
    bare.injury_type = null;
    bare.cause = null;
    bare.notes = null;
    bare.created_at = null;
    bare.updated_at = null;
    api.listInjuries.mockResolvedValue(body({ injuries: [bare] as never }));

    const [row] = await loadInjuries();
    expect(row).toMatchObject({
      date: '',
      bodyPart: '',
      painLevel: DEFAULT_PAIN_LEVEL,
      injuryType: DEFAULT_INJURY_TYPE,
      cause: null,
      notes: '',
      createdAt: '',
      updatedAt: '',
    });
    // …and the row is still safe to show in the log.
    expect(loggedAgoLabel(row.date)).toBe('date not recorded');
  });

  it('HEALTH-INJ-081: an unmapped cause or a blank token still reads as words', () => {
    // Causes written by another client are shown humanised rather than as the
    // raw token, and an empty token must not render as a lone capital letter.
    expect(injuryCauseLabel('slipped_on_ice')).toBe('Slipped on ice');
    expect(injuryCauseLabel('gardeningMishap')).toBe('Gardening mishap');
    expect(injuryCauseLabel(null)).toBe('Not stated');
    expect(injuryCauseLabel('')).toBe('Not stated');
    expect(humanizeInjuryToken('___')).toBe('');
    expect(humanizeInjuryToken(undefined as unknown as string)).toBe('');
  });

  it('HEALTH-INJ-082: an unknown body-part id resolves to no part rather than a guess', () => {
    // Save re-asks instead of sending a wording the gate cannot fold.
    expect(bodyPartById('leftHamstring')).toBeNull();
    expect(bodyPartById('')).toBeNull();
  });

  it('HEALTH-INJ-083: a non-string in the date field clears it instead of crashing', () => {
    // The field is a controlled <TextInput>; autofill and paste can hand over
    // things that are not strings, and `.replace` on those throws.
    expect(sanitizeInjuryDateInput(undefined as unknown as string)).toBe('');
    expect(parseInjuryDateInput(undefined as unknown as string)).toEqual({ valid: false });
  });

  it('HEALTH-INJ-084: an over-long note is refused in plain words, not 400d at the Worker', () => {
    // The route bounds `notes` at 1000 characters. Sending it anyway would come
    // back as a bare 400 with nothing the screen could say to the user.
    const validated = validateInjuryDraft({
      ...emptyInjuryDraft('2026-07-13'),
      bodyPartId: 'leftKnee',
      notes: 'x'.repeat(MAX_INJURY_NOTES + 1),
    });
    expect(validated).toEqual({ valid: false, message: LONG_NOTES_MESSAGE });
    expect(LONG_NOTES_MESSAGE).not.toMatch(/400|Request failed|Error/);
    // Exactly at the cap is still fine — the bound is inclusive.
    expect(
      validateInjuryDraft({
        ...emptyInjuryDraft('2026-07-13'),
        bodyPartId: 'leftKnee',
        notes: 'x'.repeat(MAX_INJURY_NOTES),
      }).valid
    ).toBe(true);
  });

  it('HEALTH-INJ-085: an out-of-scale pain level in a DRAFT falls back to the default', () => {
    const validated = validateInjuryDraft({
      ...emptyInjuryDraft('2026-07-13'),
      bodyPartId: 'leftKnee',
      painLevel: 7 as unknown as 0,
    });
    expect(validated.valid).toBe(true);
    if (validated.valid) expect(validated.payload.pain_level).toBe(DEFAULT_PAIN_LEVEL);
  });

  it('HEALTH-INJ-086: a malformed "today" cannot make the ago-label read as a number of days', () => {
    // `today` is caller-supplied and carries no regex guard of its own, so a
    // drifted day key would otherwise produce "logged NaN days ago".
    expect(loggedAgoLabel('2026-07-13', 'not-a-date')).toBe('date not recorded');
  });
});
