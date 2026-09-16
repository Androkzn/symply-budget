/**
 * Takeoff — turning a Room Surface Model into quantities and money.
 *
 * This is the half of the feature that has to be *right* rather than merely
 * convincing. A member looks at the preview to decide and reads this to order,
 * so every number here is derived from the stored geometry by arithmetic that
 * can be checked by hand, and none of it comes from a model.
 *
 * ## What is counted, and what is not
 *
 *  - **Net area** is the region polygon minus the openings charged to it. An
 *    opening is charged to exactly one region, by its centre
 *    (`regionsOf`), so nothing is deducted twice.
 *  - **A surface marked `excluded` contributes nothing.** That is the "we are
 *    not touching the ceiling" case, and it must not be expressed by deleting
 *    the surface — a deleted ceiling comes back the next time the plan is
 *    reconciled, with its material gone.
 *  - **A region with no material contributes to `unassignedM2`**, not to a
 *    quantity. Rolling unassigned area into a total would understate what is
 *    left to decide, which is the number a member is actually managing at the
 *    start of a project.
 *
 * ## Money
 *
 * `unitPriceCents` is per *purchase unit* when the material has one (a litre, a
 * box) and per *unit* otherwise (a tile), because that is how the two kinds of
 * product are sold. When neither is known there is no cost and the line says
 * so — an estimate of zero is indistinguishable on screen from an estimate that
 * really is zero, and this feature exists to feed a budget.
 */

import type { Material, RoomSurfaceModel, Surface } from '../room-surface-model';

import { round4 } from './geometry';
import {
  isContinuous,
  purchaseUnitsForArea,
  unitFootprintM2,
  unitsForArea,
} from './materials';
import { regionsOf } from './subareas';

export interface TakeoffLine {
  materialId: string;
  name: string;
  kind: Material['kind'];
  colorHex: string;
  /** Net finished area this material covers across the whole room, m². */
  netM2: number;
  /** Net plus the material's waste allowance, m². */
  withWasteM2: number;
  /** Repeats needed — tiles, planks, panels. Null for a continuous finish. */
  units: number | null;
  /** Purchase units — litres, boxes, rolls. Null when coverage is unknown. */
  purchaseUnits: number | null;
  /** What the member buys, for display: 'L', 'box', 'tile'. */
  unitLabel: string | null;
  /** Null when the material carries no price. Never defaulted to zero. */
  estimateCents: number | null;
  /** Which surfaces this material appears on, for the "where" line. */
  surfaceLabels: string[];
}

export interface TakeoffSurfaceLine {
  surfaceId: string;
  label: string;
  kind: Surface['kind'];
  grossM2: number;
  netM2: number;
  excluded: boolean;
  regions: Array<{
    label: string;
    materialId: string | null;
    materialName: string | null;
    netM2: number;
  }>;
}

export interface Takeoff {
  lines: TakeoffLine[];
  surfaces: TakeoffSurfaceLine[];
  /** Sum of every priced line. Null when nothing at all is priced. */
  totalEstimateCents: number | null;
  /** Finished area with no material chosen yet, m². */
  unassignedM2: number;
  /** Every net area in the room, m² — the denominator for "x% specified". */
  totalNetM2: number;
}

interface Accumulator {
  material: Material;
  netM2: number;
  surfaceLabels: Set<string>;
}

/**
 * Compute the whole room's takeoff.
 *
 * One pass over the surfaces, accumulating by material. The grouping is by
 * material rather than by surface because that is the order a member buys in —
 * one delivery of tile for the floor and the shower niche — while the
 * per-surface breakdown below is what they check the *drawing* against, so both
 * are returned rather than one being derived on screen from the other.
 */
export function computeTakeoff(model: RoomSurfaceModel): Takeoff {
  const materialsById = new Map(model.materials.map((material) => [material.id, material]));
  const byMaterial = new Map<string, Accumulator>();
  const surfaces: TakeoffSurfaceLine[] = [];
  let unassignedM2 = 0;
  let totalNetM2 = 0;

  for (const surface of model.surfaces) {
    const regions = regionsOf(surface);
    const excluded = surface.excluded === true;
    const surfaceNet = regions.reduce((sum, region) => sum + region.netM2, 0);

    surfaces.push({
      surfaceId: surface.id,
      label: surface.label,
      kind: surface.kind,
      grossM2: round4(regions.reduce((sum, region) => sum + region.grossM2, 0)),
      netM2: round4(surfaceNet),
      excluded,
      regions: regions
        // A base region of zero area is an artefact of a surface that has been
        // fully carved into sub-areas; showing "Floor (rest) — 0.00 m²" beside
        // the regions that replaced it is noise.
        .filter((region) => region.netM2 > 0 || region.subAreaId !== null)
        .map((region) => ({
          label: region.label,
          materialId: region.materialId,
          materialName: region.materialId
            ? materialsById.get(region.materialId)?.name ?? null
            : null,
          netM2: region.netM2,
        })),
    });

    if (excluded) continue;
    totalNetM2 += surfaceNet;

    for (const region of regions) {
      if (region.netM2 <= 0) continue;
      const material = region.materialId ? materialsById.get(region.materialId) : undefined;
      if (!material) {
        unassignedM2 += region.netM2;
        continue;
      }
      const entry = byMaterial.get(material.id) ?? {
        material,
        netM2: 0,
        surfaceLabels: new Set<string>(),
      };
      entry.netM2 += region.netM2;
      entry.surfaceLabels.add(surface.label);
      byMaterial.set(material.id, entry);
    }
  }

  const lines = [...byMaterial.values()]
    .map(toLine)
    .sort((a, b) => b.netM2 - a.netM2 || a.name.localeCompare(b.name));

  const priced = lines.filter((line) => line.estimateCents !== null);
  return {
    lines,
    surfaces,
    totalEstimateCents:
      priced.length > 0 ? priced.reduce((sum, line) => sum + (line.estimateCents ?? 0), 0) : null,
    unassignedM2: round4(unassignedM2),
    totalNetM2: round4(totalNetM2),
  };
}

function toLine(entry: Accumulator): TakeoffLine {
  const { material } = entry;
  const netM2 = round4(entry.netM2);
  const withWasteM2 = round4(netM2 * (1 + (material.wastePct ?? 0) / 100));
  const units = unitsForArea(material, netM2);
  const purchaseUnits = purchaseUnitsForArea(material, netM2);

  return {
    materialId: material.id,
    name: material.name,
    kind: material.kind,
    colorHex: material.colorHex,
    netM2,
    withWasteM2,
    units,
    purchaseUnits,
    unitLabel: material.unitLabel ?? null,
    estimateCents: estimateFor(material, netM2, units, purchaseUnits),
    surfaceLabels: [...entry.surfaceLabels].sort(),
  };
}

/**
 * What this line costs, or null.
 *
 * The order of preference is *what the member is buying*: a purchase unit when
 * the material has one (paint is bought by the litre, flooring by the box), a
 * repeat when it does not (tile is bought by the tile), and area as the last
 * resort for a continuous finish priced per square metre. Nothing falls back to
 * zero — see the module header.
 */
function estimateFor(
  material: Material,
  netM2: number,
  units: number | null,
  purchaseUnits: number | null
): number | null {
  const price = material.unitPriceCents;
  if (price === undefined || price === null) return null;
  if (purchaseUnits !== null) return Math.round(price * purchaseUnits);
  if (units !== null) return Math.round(price * units);
  if (isContinuous(material)) {
    const withWaste = netM2 * (1 + (material.wastePct ?? 0) / 100);
    return Math.round(price * withWaste);
  }
  return null;
}

/**
 * A one-line summary of a material's quantity, in the words the member would
 * use at the counter.
 *
 * Both figures appear when both are known — "18 boxes · 412 planks" — because
 * the box is what they buy and the plank count is what they check the delivery
 * against.
 */
export function describeQuantity(line: TakeoffLine): string {
  const parts: string[] = [];
  if (line.purchaseUnits !== null) {
    parts.push(`${line.purchaseUnits} ${line.unitLabel ?? 'unit'}${line.purchaseUnits === 1 ? '' : 's'}`);
  }
  if (line.units !== null && line.unitLabel !== 'tile') {
    parts.push(`${line.units} pcs`);
  } else if (line.units !== null) {
    parts.push(`${line.units} tiles`);
  }
  if (parts.length === 0) parts.push(`${line.withWasteM2.toFixed(2)} m²`);
  return parts.join(' · ');
}

/**
 * Is this material's quantity trustworthy, and if not, what is missing?
 *
 * Surfaced next to the number rather than hidden, because "0 tiles" for a
 * tile with no size entered looks like an answer and is not one.
 */
export function quantityGap(material: Material): string | null {
  if (material.kind === 'paint') {
    return material.coverageM2PerUnit ? null : 'Add coverage (m² per litre) for a litre count.';
  }
  if (isContinuous(material)) {
    return unitFootprintM2(material) === null && !material.coverageM2PerUnit
      ? 'Add a unit size or coverage for a quantity.'
      : null;
  }
  return null;
}
