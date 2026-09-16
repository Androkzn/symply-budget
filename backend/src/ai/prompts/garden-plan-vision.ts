/**
 * Read a yard from a site plan, a survey PDF page, or an aerial photo.
 *
 * ## What this extracts, and what it deliberately does not
 *
 * The model returns STRUCTURE — a lot outline, the areas inside it, and the
 * things standing on them — in coordinates normalized `0..1` over the supplied
 * IMAGE, y downward. It returns no latitude, no longitude and no scale, and it
 * is told not to guess at any of them.
 *
 * That is the whole design. A model asked to georeference a scanned survey will
 * confidently produce coordinates that are wrong by a street, and a yard plan
 * that is wrong by a street is worse than no yard plan — every task pinned in it
 * points at a neighbour's garden. So the division of labour is:
 *
 *  - **the model supplies the structure** (which shape is the house, which
 *    region is the back yard, that there is a shed near the north fence);
 *  - **the member's own traced lot supplies the coordinates**, and the client
 *    fits the model's normalized geometry onto it;
 *  - **the member supplies the correction**, because everything below lands as a
 *    draft they drag before it is saved.
 *
 * ## The vocabulary comes from the CALLER
 *
 * `elements[].preset` is constrained to a list the client sends with the
 * request. The 56-entry preset catalogue lives in the mobile bundle
 * (`src/types/garden-object-presets.ts`) and nowhere else; copying it here would
 * create a second list that silently drifts every time a preset is renamed, and
 * the failure mode of that drift is a model confidently emitting an id no client
 * can resolve. Letting the caller declare its own vocabulary keeps exactly one
 * copy, and a client that adds a preset gets it in the prompt the same day.
 */

/** The most elements one image may yield, matching the plan-wide object cap. */
export const MAX_VISION_ELEMENTS = 60;

/** Zone kinds, mirroring `GARDEN_ZONE_KINDS` in the mobile bundle. */
export const VISION_ZONE_KINDS = [
  'house',
  'front_yard',
  'back_yard',
  'side_yard',
  'garden',
  'driveway',
  'other',
] as const;

export interface RawVisionPolygonPoint {
  x: number;
  y: number;
}

export interface RawVisionZone {
  kind: string;
  label?: string | null;
  polygon?: Array<{ x?: unknown; y?: unknown }> | null;
  confidence?: unknown;
}

export interface RawVisionElement {
  preset?: unknown;
  label?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  confidence?: unknown;
}

export interface RawGardenPlanVision {
  readable?: unknown;
  plan_kind?: unknown;
  lot_polygon?: Array<{ x?: unknown; y?: unknown }> | null;
  zones?: RawVisionZone[] | null;
  elements?: RawVisionElement[] | null;
  north_heading_degrees?: unknown;
  notes?: unknown;
}

const POLYGON_SCHEMA = {
  type: 'array',
  minItems: 3,
  maxItems: 24,
  items: {
    type: 'object',
    properties: {
      x: { type: 'number', minimum: 0, maximum: 1 },
      y: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['x', 'y'],
  },
} as const;

export const GARDEN_PLAN_VISION_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description:
        'False when the image is not a plan, photo or sketch of a property, or is too unclear to trace.',
    },
    plan_kind: {
      type: 'string',
      enum: ['site_plan', 'survey', 'aerial_photo', 'sketch', 'other'],
    },
    lot_polygon: {
      ...POLYGON_SCHEMA,
      description:
        'The property boundary as drawn in the image, clockwise. Omit entirely if no lot line is visible.',
    },
    zones: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...VISION_ZONE_KINDS] },
          label: { type: 'string', maxLength: 60 },
          polygon: POLYGON_SCHEMA,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['kind', 'polygon'],
      },
    },
    elements: {
      type: 'array',
      maxItems: MAX_VISION_ELEMENTS,
      items: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            description: 'One of the ids listed in the prompt. Omit the element if none fits.',
          },
          label: { type: 'string', maxLength: 60 },
          x: { type: 'number', minimum: 0, maximum: 1, description: 'Centre, not corner.' },
          y: { type: 'number', minimum: 0, maximum: 1, description: 'Centre, not corner.' },
          width: { type: 'number', minimum: 0.005, maximum: 1 },
          height: { type: 'number', minimum: 0.005, maximum: 1 },
          rotation: { type: 'number', minimum: 0, maximum: 360 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['preset', 'x', 'y', 'width', 'height'],
      },
    },
    north_heading_degrees: {
      type: 'number',
      minimum: 0,
      maximum: 360,
      description:
        'Only if a north arrow is actually drawn. Degrees clockwise from image-up to north.',
    },
    notes: { type: 'string', maxLength: 400 },
  },
  required: ['readable'],
} as const;

export const GARDEN_PLAN_VISION_SYSTEM_PROMPT = `You read residential site plans, survey drawings, aerial photographs and hand sketches, and return the property's structure as geometry.

COORDINATES
- Every coordinate is normalized to the IMAGE: x from 0 (left edge) to 1 (right edge), y from 0 (TOP edge) to 1 (bottom edge).
- y increases DOWNWARD. This is image convention, not map convention.
- Element x and y are the CENTRE of the element, never a corner.
- Never output latitude, longitude, street names, or real-world distances. You cannot know them from an image and a wrong one is worse than none.

WHAT TO TRACE
- lot_polygon: the outer property line, if the image shows one. On an aerial photo with no drawn line, omit it rather than guessing at the neighbours' fences.
- zones: distinct AREAS. Always include the house footprint as kind "house" when a building is visible — its area is subtracted from the yard, so missing it is the most costly omission. Then the yard areas around it.
- elements: individual THINGS — a shed, a pool, a driveway, single trees, beds. Only what you can actually see.

RULES
- Trace what is drawn. Do not invent a symmetrical back garden because the front is symmetrical, and do not add a tree because a yard usually has one.
- Prefer FEWER, more confident items. A member correcting six right shapes is faster than one deleting twenty wrong ones.
- Polygons must be simple (non-self-intersecting) and given in order around the shape.
- If the image is not a property plan or is too unclear, set readable=false and return nothing else.
- Set confidence honestly. Low confidence is useful; a confident wrong answer is not.`;

export function buildGardenPlanVisionUserPrompt(args: {
  elementVocabulary: readonly string[];
  hint?: string | null;
}): string {
  const vocabulary = args.elementVocabulary.join(', ');
  const hint = args.hint?.trim();
  return [
    'Read this property plan and return its structure.',
    '',
    `elements[].preset must be exactly one of these ids: ${vocabulary}.`,
    'If something visible matches none of them, leave it out rather than inventing an id.',
    hint ? `\nThe member says: ${hint}` : '',
    '',
    'Remember: coordinates are 0..1 over this image, y downward, and element x/y are centres.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
