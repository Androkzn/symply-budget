import { describe, expect, it } from 'vitest';

import {
  applyAsIsToPhases,
  applyIncludeToGeneration,
  deriveSmartProjectSurfaces,
  isPhaseAlreadyDone,
  orderPhases,
  parseSmartProjectGeneration,
  questionsForUnknowns,
  roomModelForSpace,
  ceilingAreaFor,
  ridgeRise,
  smartProjectRequestSchema,
  sortForReview,
  wallAreaFor,
  SMART_PROJECT_INCLUDE_ALL,
  SMART_PROJECT_JSON_SCHEMA,
  SMART_PROJECT_MAX_PHOTOS,
  type GeneratedPhase,
  type GeneratedSurface,
  type SmartProjectGeneration,
  type SmartProjectSpaceDimensions,
} from '../src/smart-project';

/** The shed from the BRD: 6.0 × 3.6, 2.4 m walls. */
const SHED: SmartProjectSpaceDimensions = {
  label: 'Shed',
  length_m: 6.0,
  width_m: 3.6,
  height_m: 2.4,
};

const phase = (title: string, sort_order: number, depends_on: string[] = []): GeneratedPhase => ({
  title,
  sort_order,
  depends_on,
});

describe('the schema refuses to carry numbers the model would have invented', () => {
  it('has no area, quantity or price property anywhere in the JSON schema', () => {
    const json = JSON.stringify(SMART_PROJECT_JSON_SCHEMA);
    for (const banned of ['area', 'quantity', 'qty', 'price', 'cents', 'cost', 'estimate']) {
      expect(json).not.toContain(banned);
    }
  });

  it('rejects an area a model tries to add to a surface', () => {
    const parsed = parseSmartProjectGeneration({
      title: 'Shed conversion',
      as_is: [],
      phases: [],
      surfaces: [{ name: 'Walls', kind: 'wall', area_m2: 46.1 }],
    });
    // Zod strips unknown keys rather than failing, so assert the number is gone.
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed?.surfaces)).not.toContain('46.1');
  });

  it('locks additionalProperties off so the provider is told no extra fields', () => {
    expect(SMART_PROJECT_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(SMART_PROJECT_JSON_SCHEMA.properties.surfaces.items.additionalProperties).toBe(false);
  });
});

describe('parseSmartProjectGeneration', () => {
  it('returns null rather than throwing on junk, because the caller is a job handler', () => {
    expect(parseSmartProjectGeneration(null)).toBeNull();
    expect(parseSmartProjectGeneration('not json')).toBeNull();
    expect(parseSmartProjectGeneration({ no: 'title' })).toBeNull();
  });

  it('fills defaults so a sparse generation is still a usable draft', () => {
    const parsed = parseSmartProjectGeneration({ title: 'Shed', as_is: [], phases: [] });
    expect(parsed?.type).toBe('renovation');
    expect(parsed?.confidence).toBe('medium');
    expect(parsed?.surfaces).toEqual([]);
  });
});

describe('areas come from the member’s dimensions, never from the model', () => {
  it('derives floor, ceiling and wall areas for the shed', () => {
    const generated: GeneratedSurface[] = [
      { name: 'Walls', kind: 'wall', category: 'finish', waste_factor_pct: 10 },
      { name: 'Ceiling', kind: 'ceiling', category: 'finish', waste_factor_pct: 10 },
      { name: 'Floor', kind: 'floor', category: 'finish', waste_factor_pct: 10 },
    ];
    const derived = deriveSmartProjectSurfaces(generated, [SHED]);

    const floor = derived.find(s => s.kind === 'floor');
    const ceiling = derived.find(s => s.kind === 'ceiling');
    const walls = derived.find(s => s.kind === 'wall');

    // 6.0 × 3.6 = 21.6
    expect(floor?.area_m2).toBeCloseTo(21.6, 2);
    expect(ceiling?.area_m2).toBeCloseTo(21.6, 2);
    // perimeter 2 × (6.0 + 3.6) = 19.2, × 2.4 = 46.08
    expect(walls?.area_m2).toBeCloseTo(46.08, 2);
  });

  it('returns nothing at all when dimensions were skipped — it does not guess', () => {
    const generated: GeneratedSurface[] = [
      { name: 'Walls', kind: 'wall', category: 'finish', waste_factor_pct: 10 },
    ];
    expect(deriveSmartProjectSurfaces(generated, [])).toEqual([]);
  });

  it('still produces the three surfaces every room has when the model named none', () => {
    const derived = deriveSmartProjectSurfaces([], [SHED]);
    expect(derived.map(s => s.kind).sort()).toEqual(['ceiling', 'floor', 'wall']);
  });

  it('collapses the four walls into one row', () => {
    const derived = deriveSmartProjectSurfaces([], [SHED]);
    expect(derived.filter(s => s.kind === 'wall')).toHaveLength(1);
  });

  it('qualifies surface names by space when there is more than one', () => {
    const second: SmartProjectSpaceDimensions = { ...SHED, label: 'Lean-to' };
    const derived = deriveSmartProjectSurfaces([], [SHED, second]);
    expect(derived.some(s => s.name.startsWith('Shed —'))).toBe(true);
    expect(derived.some(s => s.name.startsWith('Lean-to —'))).toBe(true);
  });

  it('builds a room model the surface editor can open unchanged', () => {
    const model = roomModelForSpace(SHED);
    expect(model.units).toBe('m');
    expect(model.surfaces.filter(s => s.kind === 'wall')).toHaveLength(4);
    expect(model.room.wallHeight_m).toBeCloseTo(2.4, 4);
    expect(model.source_meta.origin).toBe('smart_project');
  });
});

/**
 * The gable case, from the first real member request: a 5 × 3 × 2.5 m shed,
 * open to its rafters, being sheeted in OSB.
 *
 * Treating that ceiling as flat under-counts twice over — the sloped faces are
 * longer than their footprint, and a gable adds a triangle of wall at each end.
 * Both errors run short, which is the direction that stops the job.
 */
describe('a pitched roof is measured as a pitched roof', () => {
  const SHED_GABLE: SmartProjectSpaceDimensions = {
    label: 'Shed',
    length_m: 5,
    width_m: 3,
    height_m: 2.5,
    ridge_height_m: 3.2, // 0.7 m rise
  };

  it('follows the slope for the ceiling instead of the footprint', () => {
    // half-span 1.5, rise 0.7 -> slope 1.655; two faces x 5 m = 16.55
    expect(ceilingAreaFor(SHED_GABLE)).toBeCloseTo(16.55, 1);
    // and the flat reading it replaces
    expect(ceilingAreaFor({ ...SHED_GABLE, ridge_height_m: undefined })).toBeCloseTo(15, 2);
  });

  it('adds the two gable triangles to the walls', () => {
    // 2(5+3) x 2.5 = 40, plus span x rise = 3 x 0.7 = 2.1
    expect(wallAreaFor(SHED_GABLE)).toBeCloseTo(42.1, 2);
    expect(wallAreaFor({ ...SHED_GABLE, ridge_height_m: undefined })).toBeCloseTo(40, 2);
  });

  it('leaves the floor alone — a roof does not change the slab', () => {
    const derived = deriveSmartProjectSurfaces([], [SHED_GABLE]);
    expect(derived.find(s => s.kind === 'floor')?.area_m2).toBeCloseTo(15, 2);
  });

  it('marks the surfaces a pitch changed, so review can say why', () => {
    const derived = deriveSmartProjectSurfaces([], [SHED_GABLE]);
    expect(derived.find(s => s.kind === 'ceiling')?.pitched).toBe(true);
    expect(derived.find(s => s.kind === 'wall')?.pitched).toBe(true);
    expect(derived.find(s => s.kind === 'floor')?.pitched).toBeUndefined();
  });

  it('does not mark anything pitched on a flat ceiling', () => {
    const derived = deriveSmartProjectSurfaces([], [SHED]);
    for (const s of derived) expect(s.pitched).toBeUndefined();
  });

  /**
   * A member who puts the peak height in the wall box and the wall height in
   * the peak box would otherwise get a negative rise — and a ceiling smaller
   * than the floor it covers, which is not a shape.
   */
  it('refuses to let a swapped pair produce a ceiling smaller than the floor', () => {
    const swapped: SmartProjectSpaceDimensions = { ...SHED_GABLE, height_m: 3.2, ridge_height_m: 2.5 };
    expect(ridgeRise(swapped)).toBe(0);
    expect(ceilingAreaFor(swapped)).toBeCloseTo(15, 2);
  });

  it('treats an absent ridge height as flat, which is what indoor rooms are', () => {
    expect(ridgeRise(SHED)).toBe(0);
  });

  it('spans the SHORTER dimension — a ridge runs the length of a shed', () => {
    // Same room entered the other way round must measure the same.
    const rotated: SmartProjectSpaceDimensions = { ...SHED_GABLE, length_m: 3, width_m: 5 };
    expect(ceilingAreaFor(rotated)).toBeCloseTo(ceilingAreaFor(SHED_GABLE), 2);
    expect(wallAreaFor(rotated)).toBeCloseTo(wallAreaFor(SHED_GABLE), 2);
  });

  it('accepts the ridge height through the request schema', () => {
    const result = smartProjectRequestSchema.safeParse({
      description: 'I have a shed with a roof, walls and a concrete floor. Convert to a shop.',
      spaces: [SHED_GABLE],
    });
    expect(result.success).toBe(true);
  });
});

describe('phase ordering', () => {
  it('puts a dependency before the phase that needs it', () => {
    const ordered = orderPhases([
      phase('Insulation', 0, ['Electrical rough-in']),
      phase('Electrical rough-in', 1),
    ]);
    expect(ordered.map(p => p.title)).toEqual(['Electrical rough-in', 'Insulation']);
  });

  it('renumbers sort_order to match the resolved order', () => {
    const ordered = orderPhases([
      phase('Wall covering', 0, ['Insulation']),
      phase('Insulation', 1),
    ]);
    expect(ordered.map(p => p.sort_order)).toEqual([0, 1]);
  });

  it('drops the edge that closes a cycle instead of failing the whole draft', () => {
    const ordered = orderPhases([phase('A', 0, ['B']), phase('B', 1, ['A'])]);
    expect(ordered).toHaveLength(2);
    expect(ordered.map(p => p.title).sort()).toEqual(['A', 'B']);
  });

  it('ignores a dependency on a phase that does not exist', () => {
    const ordered = orderPhases([phase('Insulation', 0, ['Nonexistent'])]);
    expect(ordered.map(p => p.title)).toEqual(['Insulation']);
  });

  it('falls back to sort_order when there are no dependencies', () => {
    const ordered = orderPhases([phase('Second', 5), phase('First', 1)]);
    expect(ordered.map(p => p.title)).toEqual(['First', 'Second']);
  });
});

describe('as-is state suppresses work that is already done', () => {
  const asIs = [
    { element: 'roof' as const, state: 'present' as const, evidence: 'it has a roof' },
    { element: 'foundation_slab' as const, state: 'present' as const },
    { element: 'insulation' as const, state: 'absent' as const },
    { element: 'plumbing_rough_in' as const, state: 'unknown' as const },
  ];

  it('matches a finished element to the phase that would have redone it', () => {
    expect(isPhaseAlreadyDone('Roofing', asIs)).toBe('roof');
    expect(isPhaseAlreadyDone('Pour the slab', asIs)).toBe('foundation_slab');
  });

  it('does not suppress a phase for an element marked absent', () => {
    expect(isPhaseAlreadyDone('Insulation', asIs)).toBeNull();
  });

  it('never suppresses on unknown — a gap in the description is not a fact', () => {
    expect(isPhaseAlreadyDone('Plumbing rough-in', asIs)).toBeNull();
  });

  it('drops finished phases and reports why, so review can explain the gap', () => {
    const { kept, dropped } = applyAsIsToPhases(
      [phase('Roofing', 0), phase('Insulation', 1), phase('Wall covering', 2)],
      asIs
    );
    expect(kept.map(p => p.title)).toEqual(['Insulation', 'Wall covering']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].because).toBe('roof');
  });

  it('turns each unknown into a question rather than a guess', () => {
    const questions = questionsForUnknowns(asIs);
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toContain('plumbing rough in');
    expect(questions[0].severity).toBe('low');
  });
});

describe('review ordering', () => {
  it('puts the least trustworthy items where attention actually goes', () => {
    const sorted = sortForReview([
      { id: 'a', confidence: 'high' as const },
      { id: 'b', confidence: 'low' as const },
      { id: 'c', confidence: 'medium' as const },
    ]);
    expect(sorted.map(i => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('the request the member sends', () => {
  it('requires a description long enough to be worth generating from', () => {
    expect(smartProjectRequestSchema.safeParse({ description: 'shed' }).success).toBe(false);
  });

  it('accepts a description with no dimensions at all', () => {
    const result = smartProjectRequestSchema.safeParse({
      description: 'I have a shed with a roof, walls and a concrete floor. Convert to a shop.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a dimension with a misplaced decimal point', () => {
    const result = smartProjectRequestSchema.safeParse({
      description: 'I have a shed with a roof, walls and a concrete floor. Convert to a shop.',
      spaces: [{ label: 'Shed', length_m: 0.06, width_m: 3.6, height_m: 2.4 }],
    });
    expect(result.success).toBe(false);
  });

  /**
   * The cap is the SHARED constant, and the test says so rather than repeating
   * the number.
   *
   * `8` used to be written out in three unrelated places — here, the route's
   * validator and the generator's slice — and a client that offered more than
   * the route accepted would not have degraded to the limit: `z.array().max()`
   * rejects the whole body, so the member would have lost the entire generation
   * rather than two photos. Asserting against the constant is what makes
   * raising it a one-line change instead of a bug.
   */
  it(`caps photos at ${SMART_PROJECT_MAX_PHOTOS}`, () => {
    const description =
      'I have a shed with a roof, walls and a concrete floor. Convert to a shop.';
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

    expect(
      smartProjectRequestSchema.safeParse({
        description,
        attachment_ids: ids(SMART_PROJECT_MAX_PHOTOS),
      }).success,
    ).toBe(true);
    expect(
      smartProjectRequestSchema.safeParse({
        description,
        attachment_ids: ids(SMART_PROJECT_MAX_PHOTOS + 1),
      }).success,
    ).toBe(false);
  });
});

/**
 * The member's own answer to "what should we draft?", enforced.
 *
 * The prompt asks the model for the selected sections and this is the
 * guarantee behind that ask — an instruction can be ignored, and a material
 * list arriving in a phases-only draft is rows the member has to delete from a
 * project they never wanted them in.
 */
describe('what the member asked for is what the draft contains', () => {
  const full = (): SmartProjectGeneration =>
    parseSmartProjectGeneration({
      title: 'Shed to workshop',
      as_is: [
        { element: 'roof', state: 'present', evidence: 'roof is done' },
        { element: 'insulation', state: 'unknown' },
      ],
      phases: [{ title: 'Insulation', sort_order: 0 }],
      surfaces: [{ name: 'Walls', kind: 'wall' }],
      materials: [{ label: 'Mineral wool batts' }],
      tasks: [{ title: 'Insulate the walls' }],
      blockers: [{ title: 'Vapour barrier?' }],
    })!;

  it('keeps everything when nothing was unticked', () => {
    const out = applyIncludeToGeneration(full(), SMART_PROJECT_INCLUDE_ALL);
    expect(out.phases).toHaveLength(1);
    expect(out.tasks).toHaveLength(1);
    expect(out.materials).toHaveLength(1);
    expect(out.surfaces).toHaveLength(1);
  });

  it('defaults to everything, so a caller that does not ask loses nothing', () => {
    const out = applyIncludeToGeneration(full());
    expect(out.phases).toHaveLength(1);
    expect(out.tasks).toHaveLength(1);
    expect(out.materials).toHaveLength(1);
  });

  it('drops a section the member unticked, even when the model returned it', () => {
    const out = applyIncludeToGeneration(full(), {
      phases: true,
      tasks: false,
      materials: false,
    });
    expect(out.phases).toHaveLength(1);
    expect(out.tasks).toEqual([]);
    expect(out.materials).toEqual([]);
  });

  /**
   * Surfaces are what carry the AREA a material's quantity comes from. Left
   * behind without materials they are empty option groups on the project.
   */
  it('takes the surfaces with the materials', () => {
    const out = applyIncludeToGeneration(full(), {
      phases: true,
      tasks: true,
      materials: false,
    });
    expect(out.surfaces).toEqual([]);
  });

  /**
   * The two sections that are never suggestions: what the member was understood
   * to already have (which is why a phase was skipped, and what the review
   * banner shows) and the questions asked back at them.
   */
  it('never withholds the as-is record or the questions', () => {
    const out = applyIncludeToGeneration(full(), {
      phases: false,
      tasks: false,
      materials: false,
    });
    expect(out.as_is).toHaveLength(2);
    expect(out.blockers).toHaveLength(1);
    expect(out.title).toBe('Shed to workshop');
  });

  it('accepts an include on the request, and defaults it to all three', () => {
    const description =
      'I have a shed with a roof, walls and a concrete floor. Convert to a shop.';
    const withInclude = smartProjectRequestSchema.safeParse({
      description,
      include: { phases: true, tasks: false, materials: true },
    });
    expect(withInclude.success).toBe(true);
    expect(withInclude.success && withInclude.data.include).toEqual({
      phases: true,
      tasks: false,
      materials: true,
    });

    // Absent means every section, which is what an older client sends.
    const without = smartProjectRequestSchema.safeParse({ description });
    expect(without.success).toBe(true);
    expect(without.success && without.data.include).toBeUndefined();
  });
});
