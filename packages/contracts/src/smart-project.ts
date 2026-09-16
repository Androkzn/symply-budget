import { z } from 'zod';

import { createRoomSurfaceModel } from './room-surface/derive';
import { polygonArea, rectPolygon } from './room-surface/geometry';
import type { RoomSurfaceModel } from './room-surface-model';

/**
 * Smart Project — the contract between the model and the draft it produces.
 *
 * See `documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md`.
 *
 * ## The one rule this module exists to enforce
 *
 * **The model says what exists; this module says how big it is.**
 *
 * `smartProjectGenerationSchema` has no area field, no quantity field and no
 * money field anywhere in it — not as optional, not as a hint. That is not an
 * oversight to be filled in later: a language model doing `6.0 × 3.6` is an
 * avoidable class of error, and one wrong multiplication becomes a wrong
 * material order. The model returns *which* surfaces a room has and what
 * category each is; `deriveSmartProjectSurfaces` below computes every number
 * from the member's typed dimensions using the same geometry code the surface
 * editor has always used.
 *
 * A field the schema does not contain cannot be hallucinated into a draft. That
 * is the whole design.
 *
 * ## Why this lives in contracts
 *
 * The Worker generates drafts and the device ledger renders them. If they
 * disagreed about what a valid draft is, a project generated online would fail
 * to open in a basement — the same reasoning that put `home-project-access.ts`
 * here. Both import this module; neither re-implements it.
 *
 * ## Money
 *
 * There is no price in this file. Smart Project writes budget lines with labels
 * and categories and `estimate_cents = 0`, because a generated number shown at
 * the moment someone is deciding what to spend anchors them to a figure that
 * came from nowhere. The wizard's template tiles had their cost hints removed
 * for exactly this reason; generating a whole budget would be that mistake at
 * ten times the surface area.
 */

// ---------------------------------------------------------------------------
// As-is state — what is ALREADY there
// ---------------------------------------------------------------------------

/**
 * The elements a project can report as already built.
 *
 * This list is the feature's reason for existing. "I have a shed with a roof,
 * walls and a slab, but inside it is bare frame" is a scope defined as much by
 * what is *done* as by what is wanted, and without somewhere to record that,
 * a generated plan re-roofs a shed that has a roof. The member then has to
 * **delete** phases, and deleting a plausible-looking phase is a worse edit
 * than adding a missing one — it requires knowing it is wrong.
 *
 * Grouped by trade because that is the order work happens in, and the phase
 * ordering the model produces is checked against it.
 */
export const AS_IS_ELEMENTS = [
  // Structure
  'foundation_slab',
  'framing',
  'roof',
  'exterior_walls',
  'exterior_cladding',
  // Envelope
  'insulation',
  'vapour_barrier',
  'windows',
  'doors',
  // Systems
  'electrical_supply',
  'electrical_rough_in',
  'lighting',
  'plumbing_rough_in',
  'hvac',
  'ventilation',
  // Finishes
  'wall_covering',
  'ceiling_covering',
  'floor_covering',
  'paint',
  'trim',
  // Process
  'permits',
] as const;

export type AsIsElement = (typeof AS_IS_ELEMENTS)[number];

export const asIsElementSchema = z.enum(AS_IS_ELEMENTS);

/**
 * `unknown` is a first-class answer and must never be collapsed into `absent`.
 *
 * "The description did not say whether there is insulation" and "there is no
 * insulation" lead to different drafts: the first should produce a question for
 * the member, the second a work phase. Treating unknown as absent silently
 * turns every gap in a member's paragraph into budgeted work.
 */
export const asIsStateSchema = z.enum(['present', 'absent', 'unknown']);
export type AsIsState = z.infer<typeof asIsStateSchema>;

export const asIsEntrySchema = z.object({
  element: asIsElementSchema,
  state: asIsStateSchema,
  /**
   * The words in the member's own description that decided this, so review can
   * show *why* the slab was marked done. An inference the member cannot audit
   * is one they cannot correct.
   */
  evidence: z.string().max(400).optional(),
});
export type AsIsEntry = z.infer<typeof asIsEntrySchema>;

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type SmartProjectConfidence = z.infer<typeof confidenceSchema>;

/** Sorted to the top of the review list — see `sortForReview`. */
export const REVIEW_FIRST_CONFIDENCE: readonly SmartProjectConfidence[] = ['low', 'medium'];

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Written to `draft_source` on every row Smart Project creates, and to
 * `extraction_source` on selections (whose column already carried
 * `'manual' | 'link_og' | 'link_ai'` — this is a fourth rung on the same
 * ladder, not a second mechanism).
 *
 * The marker clears the moment a member edits the row: once they have touched
 * it, it is theirs, and continuing to badge it "AI drafted" would misattribute
 * their own decision back to the machine.
 */
export const SMART_DRAFT_SOURCE = 'smart_project' as const;
export const MANUAL_SOURCE = 'manual' as const;

export const draftSourceSchema = z.enum([MANUAL_SOURCE, SMART_DRAFT_SOURCE]);
export type DraftSource = z.infer<typeof draftSourceSchema>;

// ---------------------------------------------------------------------------
// Member input
// ---------------------------------------------------------------------------

/**
 * One measured space. Metres, always — the client converts before sending, so
 * that nothing downstream has to ask which unit a number is in.
 *
 * Bounds are sanity rails, not precision claims: 0.5 m rejects a typo'd decimal
 * point and 60 m rejects a field, while leaving real sheds, garages, basements
 * and shops comfortably inside.
 */
export const smartProjectSpaceDimensionsSchema = z.object({
  label: z.string().min(1).max(80),
  length_m: z.number().finite().min(0.5).max(60),
  width_m: z.number().finite().min(0.5).max(60),
  /** Height at the WALL — the eaves — not at the peak. See `ridge_height_m`. */
  height_m: z.number().finite().min(1.4).max(12),
  /**
   * Height at the ridge, for a room open to a pitched roof. Absent means a flat
   * ceiling, which is the common case indoors and the previous behaviour.
   *
   * This exists because the first real member request was a shed, and a shed's
   * ceiling is almost never flat. Treating a gable as flat under-counts BOTH
   * surfaces at once: the ceiling, because the sloped faces are longer than
   * their footprint, and the walls, because a gable adds a triangle at each
   * end. On a 5 × 3 × 2.5 m shed with a 0.7 m rise that is 16.6 m² of ceiling
   * reported as 15.0, and 42.1 m² of wall reported as 40.0 — a sheet of OSB and
   * a bag of insulation short, in the direction that stops the job.
   *
   * Ridge height rather than pitch in degrees, because a member has a tape
   * measure and not an inclinometer. `ridgeRise` derives the rest.
   */
  ridge_height_m: z.number().finite().min(1.4).max(14).optional(),
});
export type SmartProjectSpaceDimensions = z.infer<typeof smartProjectSpaceDimensionsSchema>;

/**
 * How many photos one draft may carry, on every side of the wire.
 *
 * Exported so the wizard's "Add photos" grid, the request schemas and the
 * generator's own slice all read the SAME number. They were three independent
 * `8`s before the photo step existed, which is a limit that only stays
 * consistent while nobody changes it: a client that offers ten and a route that
 * accepts eight does not degrade to eight — `z.array().max()` rejects the whole
 * request, so the member loses the entire generation rather than two pictures.
 *
 * Ten is a member-facing number, not a model one: it is roughly what someone
 * photographs when they walk a room (each wall, the ceiling, the floor, and the
 * two or three details that made them start the project). The cost ceiling is
 * enforced by resolution instead — see `VISION_LONG_EDGE` on the client, which
 * puts ten photos at well under a megabyte each.
 */
export const SMART_PROJECT_MAX_PHOTOS = 10;

/**
 * Dimensions are **optional at the request level and never inferred**.
 *
 * If the member skips this step the draft is generated without surfaces and
 * without quantities, and the review screen says so. It does not fall back to
 * a typical size: a quantity derived from a guessed area is bought, and the
 * member has no way to see that the number underneath it was invented. The
 * existing `geometry/ai-schematic` job stays what it is — a clearly-labelled
 * scoping aid — and is not wired into this path.
 */
/**
 * What the member asked to be drafted, and nothing else.
 *
 * The wizard asks this outright rather than inferring it, because the three
 * sections are not equally welcome to everybody: somebody who already keeps
 * their own material list wants the phases and would have to delete a
 * twenty-line shopping list to get them, and deleting a plausible-looking row
 * is the edit this feature has always tried to avoid (see `AS_IS_ELEMENTS`).
 *
 * All three default to `true`, which is the behaviour before the step existed.
 * An empty selection is not expressible — the wizard requires one — but it
 * parses, and produces a draft with a title, an as-is record and the questions,
 * which is a coherent (if thin) thing to hand back rather than an error.
 */
export const smartProjectIncludeSchema = z.object({
  /** Phases: the ordered stages of work. The member reads these as "steps". */
  phases: z.boolean().default(true),
  /** Tasks: the individual actions inside those stages, per area and per item. */
  tasks: z.boolean().default(true),
  /** Materials, and the surfaces whose areas give them their quantities. */
  materials: z.boolean().default(true),
});
export type SmartProjectInclude = z.infer<typeof smartProjectIncludeSchema>;

/** The default, and what every caller that does not ask gets. */
export const SMART_PROJECT_INCLUDE_ALL: SmartProjectInclude = {
  phases: true,
  tasks: true,
  materials: true,
};

export const smartProjectRequestSchema = z.object({
  description: z.string().min(20).max(4000),
  spaces: z.array(smartProjectSpaceDimensionsSchema).max(8).optional(),
  attachment_ids: z.array(z.string().min(1)).max(SMART_PROJECT_MAX_PHOTOS).optional(),
  space_id: z.string().min(1).nullable().optional(),
  include: smartProjectIncludeSchema.optional(),
});
export type SmartProjectRequest = z.infer<typeof smartProjectRequestSchema>;

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

/**
 * Surfaces carry a `kind` and a category — never an area.
 *
 * `kind` maps onto the room model's own `floor | ceiling | wall`, which is how
 * `deriveSmartProjectSurfaces` knows which derived polygon to measure. A model
 * that returned "46.1 m² of wall" would be asserting arithmetic it is bad at
 * over dimensions it cannot see.
 */
export const generatedSurfaceSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['floor', 'ceiling', 'wall']),
  category: z.string().min(1).max(40).default('finish'),
  /**
   * Cut-and-breakage allowance. Capped at 40 % because past that the number is
   * not a waste factor, it is a second order of material.
   */
  waste_factor_pct: z.number().int().min(0).max(40).default(10),
  space_label: z.string().max(80).optional(),
});
export type GeneratedSurface = z.infer<typeof generatedSurfaceSchema>;

/**
 * A material names its unit and what one purchasable unit covers — never how
 * many. `coverage_per_unit` × the derived area is the quantity, and that
 * multiplication happens in `computeTakeoff`, which is already tested.
 */
export const generatedMaterialSchema = z.object({
  label: z.string().min(1).max(120),
  surface_name: z.string().max(120).optional(),
  category: z.string().min(1).max(40).default('other'),
  unit: z.string().min(1).max(24).default('unit'),
  coverage_per_unit: z.number().finite().positive().max(1000).optional(),
  coverage_unit: z.enum(['m2', 'sqft', 'lm', 'each']).optional(),
  notes: z.string().max(400).optional(),
  confidence: confidenceSchema.default('medium'),
});
export type GeneratedMaterial = z.infer<typeof generatedMaterialSchema>;

export const generatedPhaseSchema = z.object({
  title: z.string().min(1).max(120),
  sort_order: z.number().int().min(0).max(64),
  /**
   * Titles of phases that must finish first. Kept as titles rather than ids
   * because the model has no ids to refer to; `orderPhases` resolves them and
   * drops any edge that would cycle rather than failing the whole draft.
   */
  depends_on: z.array(z.string().max(120)).max(8).default([]),
  rationale: z.string().max(400).optional(),
});
export type GeneratedPhase = z.infer<typeof generatedPhaseSchema>;

export const generatedTaskSchema = z.object({
  title: z.string().min(1).max(200),
  phase_title: z.string().max(120).optional(),
  rationale: z.string().max(400).optional(),
  confidence: confidenceSchema.default('medium'),
});
export type GeneratedTask = z.infer<typeof generatedTaskSchema>;

/**
 * Blockers carry a `question`, and that is deliberate.
 *
 * "Is this wall load-bearing?" is a blocker. "This wall is load-bearing" is
 * structural engineering from photographs, which the parent BRD forbids in
 * §7.2. The schema makes the safe shape the easy one: a blocker without a
 * question is still valid, but the prompt asks for one every time, and review
 * renders it as the primary line.
 */
export const generatedBlockerSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high']).default('medium'),
  question: z.string().max(400).optional(),
});
export type GeneratedBlocker = z.infer<typeof generatedBlockerSchema>;

export const smartProjectGenerationSchema = z.object({
  title: z.string().min(1).max(120),
  type: z.string().min(1).max(40).default('renovation'),
  template_key: z.string().max(60).nullable().optional(),
  /**
   * "woodworking shop", "home gym", "office". Present only for a change of use,
   * and it is what drives requirements a room-type template cannot express —
   * dust extraction, circuit load, task lighting. Null for a like-for-like
   * renovation.
   */
  target_use: z.string().max(120).nullable().optional(),
  summary: z.string().max(2000).optional(),
  as_is: z.array(asIsEntrySchema).max(AS_IS_ELEMENTS.length).default([]),
  phases: z.array(generatedPhaseSchema).max(24).default([]),
  surfaces: z.array(generatedSurfaceSchema).max(32).default([]),
  /**
   * 120, not the original 64, and the cap is a REJECTION rather than a trim.
   *
   * `safeParse` fails the whole generation when an array is over its max, so a
   * cap set below what the prompt asks for does not quietly drop the tail — it
   * turns a good draft into "Could not draft that". The prompt now asks for the
   * consumables an installation cannot proceed without (a window's foam,
   * sealant, fixings and trim; a vent's ducting, hood and clamps; insulation's
   * adhesive, membrane and tape), which is several rows where it used to be
   * one, and a multi-room conversion reaches 64 without being unreasonable.
   *
   * The cap is a rejection guard, not a target — the prompt's own instruction
   * is to keep the list to the must-haves. Same argument for tasks, now broken
   * down per area and per item rather than one line per phase.
   */
  materials: z.array(generatedMaterialSchema).max(120).default([]),
  tasks: z.array(generatedTaskSchema).max(120).default([]),
  blockers: z.array(generatedBlockerSchema).max(24).default([]),
  confidence: confidenceSchema.default('medium'),
});
export type SmartProjectGeneration = z.infer<typeof smartProjectGenerationSchema>;

/**
 * The JSON Schema handed to the provider.
 *
 * Deliberately a hand-written mirror of the Zod schema rather than a generated
 * one: the provider sees a *narrower* contract than we accept back. It is told
 * about no area, no quantity and no price field, and `additionalProperties:
 * false` means a model that invents one gets a malformed-output error instead
 * of a silently-ignored number. The Zod parse is then the second gate.
 */
export const SMART_PROJECT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: { type: 'string' },
    template_key: { type: ['string', 'null'] },
    target_use: { type: ['string', 'null'] },
    summary: { type: 'string' },
    as_is: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          element: { type: 'string', enum: [...AS_IS_ELEMENTS] },
          state: { type: 'string', enum: ['present', 'absent', 'unknown'] },
          evidence: { type: 'string' },
        },
        required: ['element', 'state'],
        additionalProperties: false,
      },
    },
    phases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          sort_order: { type: 'integer' },
          depends_on: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['title', 'sort_order'],
        additionalProperties: false,
      },
    },
    surfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['floor', 'ceiling', 'wall'] },
          category: { type: 'string' },
          waste_factor_pct: { type: 'integer' },
          space_label: { type: 'string' },
        },
        required: ['name', 'kind'],
        additionalProperties: false,
      },
    },
    materials: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          surface_name: { type: 'string' },
          category: { type: 'string' },
          unit: { type: 'string' },
          coverage_per_unit: { type: 'number' },
          coverage_unit: { type: 'string', enum: ['m2', 'sqft', 'lm', 'each'] },
          notes: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          phase_title: { type: 'string' },
          rationale: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          question: { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['title', 'as_is', 'phases'],
  additionalProperties: false,
} as const;

/**
 * Never throws. The caller is a job handler writing to a draft row: a
 * malformed generation must fail that row with a code, not take down the queue
 * consumer for the whole batch.
 */
export function parseSmartProjectGeneration(input: unknown): SmartProjectGeneration | null {
  const result = smartProjectGenerationSchema.safeParse(input);
  return result.success ? result.data : null;
}

/**
 * Drop the sections the member did not ask for.
 *
 * The prompt already tells the model which sections to return, and this runs
 * anyway — the same belt-and-braces reasoning as `withoutExistingPhases` in the
 * generator. A model that helpfully adds a material list to a phases-only draft
 * has not been helpful: the member unticked it, and the rows would land in
 * their project as things to delete. An instruction is a request; this is the
 * guarantee.
 *
 * `as_is` and `blockers` survive every combination on purpose. Neither is a
 * suggestion: the as-is record is what the model understood the member to
 * *already have* — it is the reason a phase was skipped, and the review banner
 * renders it — and blockers are questions asked back, which is the one thing a
 * draft should never withhold. Unticking "materials" asks for less work
 * proposed, not for a safety question to be swallowed.
 *
 * Surfaces go with materials because that is what they are for here: a surface
 * becomes an option group carrying an area, and the area is where a material's
 * quantity comes from. Kept without materials they would be empty containers.
 */
export function applyIncludeToGeneration(
  generation: SmartProjectGeneration,
  include: SmartProjectInclude = SMART_PROJECT_INCLUDE_ALL
): SmartProjectGeneration {
  return {
    ...generation,
    phases: include.phases ? generation.phases : [],
    tasks: include.tasks ? generation.tasks : [],
    materials: include.materials ? generation.materials : [],
    surfaces: include.materials ? generation.surfaces : [],
  };
}

// ---------------------------------------------------------------------------
// Derivation — every number in a draft is made here
// ---------------------------------------------------------------------------

/**
 * A room model for one measured space, built from the member's typed numbers.
 *
 * Delegates to `createRoomSurfaceModel`, so a Smart Project room is the *same
 * kind of document* as one drawn by hand in the surface editor — same
 * normalisation, same derived floor/ceiling/walls, same `planEdge` indices. The
 * member can open a generated room in the editor and drag a corner, and nothing
 * has to know it was generated.
 *
 * `origin` records that it came from typed dimensions rather than a scan, which
 * is what keeps `area_source` honest downstream.
 */
export function roomModelForSpace(space: SmartProjectSpaceDimensions): RoomSurfaceModel {
  return createRoomSurfaceModel({
    outline: rectPolygon(0, 0, space.length_m, space.width_m),
    wallHeight_m: space.height_m,
    label: space.label,
    origin: SMART_DRAFT_SOURCE,
  });
}

export interface DerivedSurfaceArea {
  name: string;
  kind: 'floor' | 'ceiling' | 'wall';
  category: string;
  /** Square metres, computed here. Never from the model. */
  area_m2: number;
  waste_factor_pct: number;
  space_label: string;
  /** True when a pitched roof changed this from its flat-ceiling footprint. */
  pitched?: boolean;
}

/**
 * Areas are member-facing measurements, so they are rounded to CENTIMETRE-
 * squared and no further.
 *
 * `round4` is the geometry helper and it is right for vertices, where a
 * rounding error compounds across a polygon. An area is read off a card and
 * multiplied once, and "16.5529 m²" claims a precision no tape measure earns —
 * it reads as machine output rather than as a measurement of someone's shed.
 */
function roundArea(m2: number): number {
  return Math.round(m2 * 100) / 100;
}

/**
 * How much higher the ridge is than the walls. `0` for a flat ceiling.
 *
 * Clamped at zero rather than trusted: a member who types the ridge height into
 * the wall-height box and vice versa would otherwise get a negative rise and a
 * ceiling smaller than its own floor.
 */
export function ridgeRise(space: SmartProjectSpaceDimensions): number {
  if (space.ridge_height_m == null) return 0;
  return Math.max(0, space.ridge_height_m - space.height_m);
}

/**
 * Ceiling area, following the roof when there is one.
 *
 * A gable's two faces are each `√((span/2)² + rise²)` long where the footprint
 * is only `span/2`, so the real surface is always larger than the plan. The
 * ridge is assumed to run along the LONGER dimension, which is how sheds,
 * garages and outbuildings are built — the span is therefore the width.
 */
export function ceilingAreaFor(space: SmartProjectSpaceDimensions): number {
  const rise = ridgeRise(space);
  const footprint = space.length_m * space.width_m;
  if (rise <= 0) return roundArea(footprint);
  const span = Math.min(space.length_m, space.width_m);
  const run = Math.max(space.length_m, space.width_m);
  const slope = Math.sqrt((span / 2) ** 2 + rise ** 2);
  return roundArea(2 * slope * run);
}

/**
 * Wall area, including the two gable triangles when the roof is pitched.
 *
 * The triangles are wall — they are framed, and on this member's shed they are
 * visibly studded and would be sheeted with everything else. Omitting them is
 * the same class of error as flattening the ceiling.
 */
export function wallAreaFor(space: SmartProjectSpaceDimensions): number {
  const rectangular = 2 * (space.length_m + space.width_m) * space.height_m;
  const rise = ridgeRise(space);
  if (rise <= 0) return roundArea(rectangular);
  // Two triangles, each ½ · span · rise — so `span · rise` for the pair.
  const span = Math.min(space.length_m, space.width_m);
  return roundArea(rectangular + span * rise);
}

/**
 * Turn the model's surface *list* into surfaces with *areas*, using the room
 * models built from typed dimensions.
 *
 * Walls collapse into one row per space by default. A member planning
 * insulation buys it for "the walls", not for the north wall — and four rows
 * that must be kept in sync is four chances to get it wrong. Anyone who needs
 * per-wall detail opens the surface editor, where per-wall surfaces already
 * exist and are the real ones.
 *
 * Returns `[]` when dimensions were skipped. That is the honest answer and the
 * review screen renders it as "add dimensions to get quantities", not as a
 * room of zero-area surfaces.
 */
export function deriveSmartProjectSurfaces(
  generated: readonly GeneratedSurface[],
  spaces: readonly SmartProjectSpaceDimensions[]
): DerivedSurfaceArea[] {
  if (!spaces.length) return [];

  const out: DerivedSurfaceArea[] = [];

  for (const space of spaces) {
    const model = roomModelForSpace(space);
    const rise = ridgeRise(space);

    /**
     * Floor comes off the polygon; ceiling and walls do not.
     *
     * `roomModelForSpace` is a FLAT model — `createRoomSurfaceModel` derives one
     * ceiling from the outline and one rectangular wall per plan edge, and the
     * room-surface document has no concept of a pitch. That is correct for the
     * surface editor, which draws a plan, and wrong for a takeoff, which buys
     * material for the actual faces. So the floor is read from the model (where
     * the two agree) and the other two are computed from the member's
     * dimensions including the ridge.
     */
    const areaOf = (kind: 'floor' | 'ceiling' | 'wall'): number => {
      if (kind === 'ceiling') return ceilingAreaFor(space);
      if (kind === 'wall') return wallAreaFor(space);
      return roundArea(
        model.surfaces
          .filter(s => s.kind === kind && !s.excluded)
          .reduce((sum, s) => sum + polygonArea(s.outline), 0)
      );
    };

    // Only surfaces the model actually asked for, and only kinds a room has.
    const wanted = generated.filter(
      g => !g.space_label || g.space_label === space.label || spaces.length === 1
    );
    const kinds = new Set(wanted.map(g => g.kind));
    // A room with no surfaces named at all still gets the three every room has,
    // because a draft that omits the floor is more surprising than one that
    // includes a floor the member deletes.
    if (kinds.size === 0) {
      kinds.add('floor');
      kinds.add('ceiling');
      kinds.add('wall');
    }

    for (const kind of ['floor', 'ceiling', 'wall'] as const) {
      if (!kinds.has(kind)) continue;
      const named = wanted.find(g => g.kind === kind);
      const area = areaOf(kind);
      if (area <= 0) continue;
      const pitched = rise > 0 && (kind === 'ceiling' || kind === 'wall');
      out.push({
        name: named?.name ?? defaultSurfaceName(kind, space.label, spaces.length > 1),
        kind,
        category: named?.category ?? 'finish',
        area_m2: area,
        waste_factor_pct: named?.waste_factor_pct ?? 10,
        space_label: space.label,
        ...(pitched ? { pitched: true } : {}),
      });
    }
  }

  return out;
}

function defaultSurfaceName(
  kind: 'floor' | 'ceiling' | 'wall',
  spaceLabel: string,
  qualify: boolean
): string {
  const base = kind === 'wall' ? 'Walls' : kind === 'floor' ? 'Floor' : 'Ceiling';
  return qualify ? `${spaceLabel} — ${base.toLowerCase()}` : base;
}

// ---------------------------------------------------------------------------
// Phase ordering
// ---------------------------------------------------------------------------

/**
 * Topologically order phases, honouring `depends_on` and falling back to
 * `sort_order`.
 *
 * Ordering matters more here than anywhere else in the draft: rough-in before
 * cover-up is not a preference, it is the difference between a plan that works
 * and one that has the member closing a wall before the cable is in it. A model
 * usually gets this right in prose and occasionally scrambles it in a list, so
 * the dependency edges it emits are resolved here rather than trusted in place.
 *
 * A cycle drops the edge that closed it instead of failing the draft — a plan
 * in a slightly wrong order is reviewable; no plan is not.
 */
export function orderPhases(phases: readonly GeneratedPhase[]): GeneratedPhase[] {
  const byTitle = new Map<string, GeneratedPhase>();
  for (const p of phases) byTitle.set(p.title.toLowerCase(), p);

  const state = new Map<string, 'visiting' | 'done'>();
  const ordered: GeneratedPhase[] = [];

  const visit = (phase: GeneratedPhase): void => {
    const key = phase.title.toLowerCase();
    const seen = state.get(key);
    if (seen === 'done' || seen === 'visiting') return; // 'visiting' => cycle: drop the edge
    state.set(key, 'visiting');
    for (const dep of phase.depends_on) {
      const target = byTitle.get(dep.toLowerCase());
      if (target && target !== phase) visit(target);
    }
    state.set(key, 'done');
    ordered.push(phase);
  };

  for (const phase of [...phases].sort((a, b) => a.sort_order - b.sort_order)) visit(phase);

  return ordered.map((p, index) => ({ ...p, sort_order: index }));
}

// ---------------------------------------------------------------------------
// As-is filtering — the point of G2
// ---------------------------------------------------------------------------

/**
 * Which phases the as-is state says are already done.
 *
 * Matching is by keyword against the phase title, and it is deliberately
 * conservative: it only suppresses a phase when an element is explicitly
 * `present`. `unknown` never suppresses anything, because "the member did not
 * mention insulation" is not "the shed is insulated" — that gap should surface
 * as a question, which is what `questionsForUnknowns` produces.
 */
const ELEMENT_PHASE_KEYWORDS: Partial<Record<AsIsElement, readonly string[]>> = {
  roof: ['roof', 'roofing'],
  foundation_slab: ['slab', 'foundation', 'footing'],
  framing: ['fram', 'stud'],
  exterior_walls: ['exterior wall', 'sheath'],
  exterior_cladding: ['siding', 'cladding'],
  insulation: ['insulat'],
  vapour_barrier: ['vapour', 'vapor', 'barrier'],
  windows: ['window'],
  doors: ['door'],
  electrical_supply: ['service', 'panel', 'supply'],
  electrical_rough_in: ['electrical', 'wiring', 'rough-in', 'rough in'],
  lighting: ['light'],
  plumbing_rough_in: ['plumb'],
  hvac: ['hvac', 'heating', 'furnace'],
  ventilation: ['ventilat', 'extraction', 'dust collection'],
  wall_covering: ['drywall', 'wall covering', 'panel'],
  ceiling_covering: ['ceiling'],
  floor_covering: ['floor'],
  paint: ['paint'],
  trim: ['trim', 'baseboard', 'moulding'],
  permits: ['permit'],
};

export function isPhaseAlreadyDone(
  phaseTitle: string,
  asIs: readonly AsIsEntry[]
): AsIsElement | null {
  const title = phaseTitle.toLowerCase();
  for (const entry of asIs) {
    if (entry.state !== 'present') continue;
    const keywords = ELEMENT_PHASE_KEYWORDS[entry.element];
    if (!keywords) continue;
    if (keywords.some(k => title.includes(k))) return entry.element;
  }
  return null;
}

/**
 * Drop phases the as-is state says are finished, and report what was dropped.
 *
 * The caller surfaces the dropped list in review — "we skipped Roofing because
 * you said the roof is done" — because a member who sees only what survived
 * cannot tell whether the model understood them or simply forgot roofing.
 */
export function applyAsIsToPhases(
  phases: readonly GeneratedPhase[],
  asIs: readonly AsIsEntry[]
): { kept: GeneratedPhase[]; dropped: Array<{ phase: GeneratedPhase; because: AsIsElement }> } {
  const kept: GeneratedPhase[] = [];
  const dropped: Array<{ phase: GeneratedPhase; because: AsIsElement }> = [];
  for (const phase of phases) {
    const because = isPhaseAlreadyDone(phase.title, asIs);
    if (because) dropped.push({ phase, because });
    else kept.push(phase);
  }
  return { kept, dropped };
}

/**
 * Elements the description left ambiguous, as questions for the member.
 *
 * This is where `unknown` earns its place in the enum. Each one becomes a
 * low-severity blocker phrased as a question, so a gap in the paragraph turns
 * into something the member can answer rather than something the model guessed.
 */
export function questionsForUnknowns(asIs: readonly AsIsEntry[]): GeneratedBlocker[] {
  return asIs
    .filter(e => e.state === 'unknown')
    .map(e => ({
      title: `Confirm: ${humanizeElement(e.element)}`,
      severity: 'low' as const,
      question: `Is there existing ${humanizeElement(e.element).toLowerCase()}? It changes what this project needs.`,
    }));
}

export function humanizeElement(element: AsIsElement): string {
  return element
    .split('_')
    .map(w => (w === 'hvac' ? 'HVAC' : w))
    .join(' ')
    .replace(/^./, c => c.toUpperCase());
}

/**
 * Low-confidence first, then medium, then high — the order review renders in.
 *
 * A member scrolling a plausible-looking plan top to bottom checks the first
 * few items hardest, so the items most likely to be wrong belong there. Sorting
 * high-confidence items to the top would spend that attention on what needs it
 * least.
 */
export function sortForReview<T extends { confidence?: SmartProjectConfidence }>(
  items: readonly T[]
): T[] {
  const rank = (c: SmartProjectConfidence | undefined): number =>
    c === 'low' ? 0 : c === 'medium' ? 1 : 2;
  return [...items].sort((a, b) => rank(a.confidence) - rank(b.confidence));
}
