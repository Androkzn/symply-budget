/**
 * Fit an AI-read plan onto the lot the member traced.
 *
 * ## The problem this solves
 *
 * `gardenPlansApi.analyzePlanImage` returns geometry normalized `0..1` over the
 * IMAGE the member handed over — a photographed survey, a scan, an aerial shot.
 * Those coordinates are meaningless on their own: the image has an unknown
 * scale, an unknown rotation and, usually, a margin of white paper around the
 * drawing. What the app stores is normalized over the LOT's geographic bounding
 * box, and the two spaces line up only by accident.
 *
 * The model is deliberately never asked to bridge that gap. A model asked to
 * georeference a scanned survey answers confidently and wrongly, and a yard plan
 * that is wrong by a street pins every task in a neighbour's garden. So:
 *
 *  - the **model** supplies the structure — which shape is the house, which
 *    region is the back yard, that there is a shed by the north fence;
 *  - the **member's traced lot** supplies the coordinates;
 *  - this module does the arithmetic between them;
 *  - the **member** corrects the result, because everything lands as a draft
 *    they drag before anything is saved.
 *
 * ## The fit is an affine bbox map, and that is on purpose
 *
 * The model's own `lot_polygon` is the registration mark. Its bounding box in
 * image space is mapped onto the full `0..1` of plan space — which the traced
 * lot spans by definition, plan space BEING that lot's bounding box. Every zone
 * and element rides along on the same transform.
 *
 * Two limits worth naming rather than hiding:
 *
 *  - **It does not rotate.** A plan photographed at an angle, or drawn with
 *    north to the right, comes out sheared relative to the satellite view. The
 *    model reports `north_heading_degrees` when a north arrow is actually drawn,
 *    and that is surfaced to the member as a hint to spin the map, rather than
 *    applied silently — a rotation guessed from a mis-read arrow is much worse
 *    than none, because it is wrong in a way that still looks deliberate.
 *  - **It stretches each axis independently.** A drawing whose aspect ratio
 *    differs from the lot's will be distorted. Preserving the aspect ratio
 *    instead would leave the plan floating inside the lot with a margin nobody
 *    asked for, which reads as a bug; filling the lot reads as a draft that
 *    needs nudging, which is what it is.
 *
 * If the model found no lot outline (common on an aerial photo with no drawn
 * boundary) the transform is the identity: the image IS taken as the lot. That
 * is the right assumption for a member who cropped their yard before handing it
 * over, and it is wrong in a way that is obvious on screen and easy to drag out.
 */
import {
  GARDEN_OBJECT_PRESETS,
  buildPresetMetadata,
  getGardenObjectPreset,
} from '@models/garden-object-presets';
import type { GardenPlanObject } from '@models/garden-objects';
import { isGardenZoneKind, type GardenZoneKind } from '@models/garden-zones';

import type { AnalyzedPlanDraft, AnalyzedPlanPoint } from '@api/garden-plans';
import type { NormalizedPoint } from '@utils/gardenGeo';

/** The ids the Worker constrains the model to. Sent with every request. */
export function gardenElementVocabulary(): string[] {
  return GARDEN_OBJECT_PRESETS.map((preset) => preset.id);
}

export interface DraftedZone {
  kind: GardenZoneKind;
  label: string;
  /** Plan space, `0..1`, y down. */
  ring: NormalizedPoint[];
  confidence: number | null;
}

export interface FittedPlanDraft {
  zones: DraftedZone[];
  elements: GardenPlanObject[];
  /** Only when a north arrow was actually drawn. Surfaced, never applied. */
  northHeadingDegrees: number | null;
  notes: string | null;
}

interface Transform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Build the image→plan transform from the model's lot outline.
 *
 * A degenerate bbox (every corner on one line, which a model does emit when it
 * has misread a drawing) falls back to the identity rather than dividing by
 * zero — the alternative is `Infinity` coordinates that React Native Svg renders
 * as nothing at all, with no error anywhere.
 */
function transformFor(lotPolygon: AnalyzedPlanPoint[] | null): Transform {
  const identity: Transform = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };
  if (!lotPolygon || lotPolygon.length < 3) return identity;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of lotPolygon) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) {
    return identity;
  }
  return { offsetX: minX, offsetY: minY, scaleX: 1 / spanX, scaleY: 1 / spanY };
}

function applyPoint(point: AnalyzedPlanPoint, t: Transform): NormalizedPoint {
  return {
    x: clamp01((point.x - t.offsetX) * t.scaleX),
    y: clamp01((point.y - t.offsetY) * t.scaleY),
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Turn a model reading into zones and elements in plan space.
 *
 * Nothing here is saved. The caller shows the result on the map, the member
 * drags what is wrong, and only then does `createMapPlan` run.
 */
export function fitAnalyzedPlanToLot(draft: AnalyzedPlanDraft): FittedPlanDraft {
  const transform = transformFor(draft.lot_polygon);

  const zones: DraftedZone[] = [];
  for (const zone of draft.zones ?? []) {
    const ring = (zone.polygon ?? []).map((point) => applyPoint(point, transform));
    if (ring.length < 3) continue;
    const kind: GardenZoneKind = isGardenZoneKind(zone.kind) ? zone.kind : 'other';
    zones.push({
      kind,
      label: zone.label?.trim() || defaultZoneLabel(kind),
      ring,
      confidence: zone.confidence,
    });
  }

  const elements: GardenPlanObject[] = [];
  for (const element of draft.elements ?? []) {
    const preset = getGardenObjectPreset(element.preset);
    // The Worker already drops ids outside the vocabulary this client sent, so
    // reaching here means a preset was removed between the request and the
    // response — a redeploy mid-call. Skipping is still right: an unresolvable
    // preset renders as nothing and cannot be selected.
    if (!preset) continue;

    const centre = applyPoint({ x: element.x, y: element.y }, transform);
    // Sizes are SPANS, not positions, so they scale but do not translate.
    const width = clamp(element.width * transform.scaleX, 0.03, 0.8);
    const height = clamp(element.height * transform.scaleY, 0.03, 0.8);

    elements.push({
      id: `ai-${preset.id}-${elements.length}`,
      type: preset.type,
      x: centre.x,
      y: centre.y,
      width,
      height,
      rotation: Number.isFinite(element.rotation) ? element.rotation : 0,
      label: element.label?.trim() || preset.defaultLabel,
      color: preset.defaultColor,
      metadata: buildPresetMetadata(preset, { aiDrafted: true }),
    });
  }

  return {
    zones,
    elements,
    northHeadingDegrees: draft.north_heading_degrees,
    notes: draft.notes,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function defaultZoneLabel(kind: GardenZoneKind): string {
  switch (kind) {
    case 'house':
      return 'House';
    case 'front_yard':
      return 'Front yard';
    case 'back_yard':
      return 'Back yard';
    case 'side_yard':
      return 'Side yard';
    case 'garden':
      return 'Garden';
    case 'driveway':
      return 'Driveway';
    default:
      return 'Area';
  }
}
