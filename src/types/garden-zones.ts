/**
 * Zones — the middle layer of a yard plan, between the lot and the things in it.
 *
 * ## What a zone is
 *
 * Step one of the map wizard traces ONE polygon: the lot line. Step three drops
 * point-ish objects inside it: a shed, three trees, a fire pit. Between those
 * sits the layer that makes the plan mean anything — the areas. The front yard.
 * The back yard. The footprint of the house itself, which is not yard at all and
 * whose area has to come OUT of the mowable total. A driveway.
 *
 * Without this layer "water the garden" cannot be pinned to the garden, only to
 * a coordinate that happens to be in it, and the mowing estimate counts the roof.
 *
 * ## Why zones ride on `garden_plan_objects` rather than a table of their own
 *
 * The obvious modelling is a `garden_plan_zones` table. It is the wrong call
 * here, and the reason is the local-first ledger rather than taste:
 *
 *  - A new table is a D1 migration AND a ledger schema entry AND a sync
 *    registration AND a facade port AND a parity test — five coordinated
 *    changes across two backends, to store a polygon and a label.
 *  - `garden_plan_objects` already syncs, already has `metadata_json` (which the
 *    normalizer passes through UNTOUCHED on both sides — that is load-bearing,
 *    see `logic/gardenPlanObjects.ts`), and its save path `replaceObjects` is
 *    already local, already clamped identically on device and Worker, and is
 *    already the editor's save.
 *  - Every existing reader degrades correctly. `GardenObjectRenderer` draws an
 *    unknown type by its `shape` fallback, so a zone opened in today's editor
 *    renders as a labelled rectangle over the right patch of ground rather than
 *    as a crash or a hole.
 *
 * So a zone IS an object, of type `zone`, whose `metadata` carries the ring. The
 * `x`/`y`/`width`/`height` on the row stay meaningful — they are the ring's
 * bounding box — which is exactly what selection, hit-testing and the
 * fallback renderer need, and what keeps the row honest for any reader that
 * never learns about {@link ZONE_METADATA_KEY} at all.
 *
 * ## The ring is stored in the object's OWN frame, not the plan's
 *
 * `metadata.zone.polygon` is `[[u, v], ...]` where `u` and `v` are offsets from
 * the object's centre as a FRACTION OF ITS OWN width and height — so a corner at
 * the top-left of the zone's box is `[-0.5, -0.5]` whatever size the zone is.
 *
 * Storing the ring in absolute plan coordinates is the obvious alternative and
 * it is quietly broken. A zone is an ordinary `garden_plan_objects` row, so the
 * vector editor will happily let a member drag, resize and rotate it — and every
 * one of those updates `x`/`y`/`width`/`height` while leaving `metadata`
 * untouched. An absolute ring would keep pointing at the ground the zone used to
 * cover, so the outline would render in the right place (the renderer draws it
 * relative to the object) but SAVE the old shape. The member would see the drag
 * work and find it undone the next time they opened the plan.
 *
 * In the object's own frame there is nothing to keep in step: the box IS the
 * transform, so move, resize and rotate all apply to the outline for free, and
 * the editor needs to know nothing about zones at all.
 *
 * The ring is stored UNCLOSED — the last point is not a repeat of the first —
 * because that is what `MapPolygon` and the SVG `Polygon` element both want.
 * Winding is whatever the member drew; nothing here depends on it.
 */
import type { NormalizedPoint } from '@utils/gardenGeo';

import type { GardenPlanObject } from './garden-objects';

/** The `metadata_json` key the ring and kind live under. */
export const ZONE_METADATA_KEY = 'zone';

export const GARDEN_ZONE_KINDS = [
  'house',
  'front_yard',
  'back_yard',
  'side_yard',
  'garden',
  'driveway',
  'other',
] as const;

export type GardenZoneKind = (typeof GARDEN_ZONE_KINDS)[number];

export interface GardenZoneKindSpec {
  id: GardenZoneKind;
  label: string;
  /** One line of guidance, shown while this kind is the one being drawn. */
  hint: string;
  ionIcon: string;
  color: string;
  /**
   * Does this zone's area count as yard the member maintains?
   *
   * The house footprint and the driveway do not, and the difference is the
   * entire point of tracing them: "1,100 m² of lot" is a land-registry fact,
   * "640 m² of yard" is the number that decides how long mowing takes.
   */
  countsAsYard: boolean;
}

/**
 * The zone palette, in the order the wizard offers them.
 *
 * House first because it is the one members forget and the one that changes the
 * maintained-area number most. Ordering here is the ordering on screen; there is
 * no second list to keep in step.
 */
export const GARDEN_ZONE_KIND_SPECS: readonly GardenZoneKindSpec[] = [
  {
    id: 'house',
    label: 'House',
    hint: 'Trace the roof. Its area is taken out of the yard total.',
    ionIcon: 'home',
    color: '#92400E',
    countsAsYard: false,
  },
  {
    id: 'front_yard',
    label: 'Front yard',
    hint: 'The street side — usually everything between the house and the kerb.',
    ionIcon: 'flower-outline',
    color: '#16A34A',
    countsAsYard: true,
  },
  {
    id: 'back_yard',
    label: 'Back yard',
    hint: 'The private side. Most tasks end up pinned in here.',
    ionIcon: 'leaf',
    color: '#15803D',
    countsAsYard: true,
  },
  {
    id: 'side_yard',
    label: 'Side yard',
    hint: 'The strips down either flank, if you keep them separately.',
    ionIcon: 'resize-outline',
    color: '#0D9488',
    countsAsYard: true,
  },
  {
    id: 'garden',
    label: 'Garden',
    hint: 'Cultivated ground — beds, borders, a vegetable patch.',
    ionIcon: 'rose-outline',
    color: '#A16207',
    countsAsYard: true,
  },
  {
    id: 'driveway',
    label: 'Driveway',
    hint: 'Hard standing. Ploughed and sealed, never mown.',
    ionIcon: 'car-outline',
    color: '#64748B',
    countsAsYard: false,
  },
  {
    id: 'other',
    label: 'Other area',
    hint: 'Anything else you want to name and pin tasks to.',
    ionIcon: 'shapes-outline',
    color: '#7C3AED',
    countsAsYard: true,
  },
] as const;

const SPEC_BY_KIND = new Map<GardenZoneKind, GardenZoneKindSpec>(
  GARDEN_ZONE_KIND_SPECS.map((spec) => [spec.id, spec]),
);

export function gardenZoneKindSpec(kind: GardenZoneKind): GardenZoneKindSpec {
  return SPEC_BY_KIND.get(kind) ?? GARDEN_ZONE_KIND_SPECS[GARDEN_ZONE_KIND_SPECS.length - 1];
}

export function isGardenZoneKind(value: unknown): value is GardenZoneKind {
  return typeof value === 'string' && (GARDEN_ZONE_KINDS as readonly string[]).includes(value);
}

export interface GardenZoneMetadata {
  kind: GardenZoneKind;
  /**
   * UNCLOSED ring in the OBJECT's frame — offsets from its centre as a fraction
   * of its own width and height, so a box corner is `±0.5`. See the header for
   * why this is not plan-space.
   */
  polygon: NormalizedPoint[];
}

/**
 * Build the `metadata` payload for a zone object.
 *
 * Takes the ring in PLAN space plus the box it was measured into, and stores the
 * ring relative to that box. Callers therefore never construct the local frame
 * by hand — `boxOfNormalizedRing` produces the box, this converts against it,
 * and the two cannot disagree.
 */
export function buildZoneMetadata(
  kind: GardenZoneKind,
  ring: readonly NormalizedPoint[],
  box: { x: number; y: number; width: number; height: number },
): Record<string, unknown> {
  // A zero span would make every offset Infinity. It cannot happen for a ring
  // with three non-collinear corners, which is the only kind that gets here, but
  // the fallback keeps a degenerate save finite rather than storing `null`
  // coordinates that render as nothing.
  const spanX = box.width > 0 ? box.width : 1;
  const spanY = box.height > 0 ? box.height : 1;
  return {
    [ZONE_METADATA_KEY]: {
      kind,
      polygon: ring.map((point) => [
        (point.x - box.x) / spanX,
        (point.y - box.y) / spanY,
      ]),
    },
    // `shape` is what `presetMetadataFromObject` reads for the fallback
    // renderer. Declaring it means an OLD build that has never heard of zones
    // still draws this row as a rectangle in the right place rather than
    // dropping it — the degradation described in the header.
    shape: 'rectangle',
    presetId: null,
    iconKey: null,
  };
}

/**
 * Read a zone's ring back off an object, or `null` if it is not a zone.
 *
 * Defensive to the point of paranoia because this parses JSON that has round
 * tripped through two databases and a sync ledger: a ring with a string in it, a
 * `polygon` that is an object, a `kind` from a future version this build does
 * not know — each returns `null` (or the nearest safe value) rather than
 * throwing inside a render pass.
 */
export function zoneMetadataFromObject(
  object: Pick<GardenPlanObject, 'type' | 'metadata'>,
): GardenZoneMetadata | null {
  if (object.type !== 'zone') return null;
  const raw = object.metadata?.[ZONE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const kind = isGardenZoneKind(record.kind) ? record.kind : 'other';
  const polygon = Array.isArray(record.polygon) ? record.polygon : null;
  if (!polygon) return null;
  const ring: NormalizedPoint[] = [];
  for (const entry of polygon) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const x = Number(entry[0]);
    const y = Number(entry[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    ring.push({ x, y });
  }
  if (ring.length < 3) return null;
  return { kind, polygon: ring };
}

export function isZoneObject(object: Pick<GardenPlanObject, 'type'>): boolean {
  return object.type === 'zone';
}

/**
 * The zone's outline in PLAN space, rebuilt from its stored ring and its box.
 *
 * This is the inverse of the conversion {@link buildZoneMetadata} performs, and
 * it is what anything drawing a zone on a MAP needs — the map wants plan
 * coordinates it can turn into latitude and longitude, where the SVG renderer
 * wants the object-local ring it already has.
 *
 * Because the ring is stored in the object's own frame, this automatically
 * reflects any drag or resize the member has since applied in the vector editor.
 * `rotation` is deliberately NOT applied: no surface that calls this rotates a
 * zone (the map draws unrotated polygons, and the wizard writes `rotation: 0`),
 * and silently baking a rotation in here would double it for the SVG renderer,
 * which gets rotation from the caller's transform.
 */
export function zoneRingInPlanSpace(
  object: Pick<GardenPlanObject, 'type' | 'metadata' | 'x' | 'y' | 'width' | 'height'>,
): NormalizedPoint[] | null {
  const zone = zoneMetadataFromObject(object);
  if (!zone) return null;
  return zone.polygon.map((point) => ({
    x: object.x + point.x * object.width,
    y: object.y + point.y * object.height,
  }));
}

/** Partition a plan's objects into its zones and its elements, in one pass. */
export function splitZonesAndElements<T extends Pick<GardenPlanObject, 'type'>>(
  objects: readonly T[],
): { zones: T[]; elements: T[] } {
  const zones: T[] = [];
  const elements: T[] = [];
  for (const object of objects) {
    if (isZoneObject(object)) zones.push(object);
    else elements.push(object);
  }
  return { zones, elements };
}
