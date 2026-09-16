/**
 * Materials — defaults, and the tiling arithmetic the renderer and the takeoff
 * share.
 *
 * ## The one idea in this file
 *
 * A material's look and its quantity come from the **same two numbers**: the
 * real-world size of one repeat, in millimetres. A 600 × 600 porcelain tile and
 * a 75 × 300 subway tile are the same photograph at different scales, and a
 * visualiser that stretches the picture to fit the wall — which is what "apply
 * this texture" means in most tools — shows a room that cannot be built and a
 * tile count that is not the one you order.
 *
 * So `patternCell` below computes the repeating unit in **metres**, the
 * renderer converts it to pixels with the same scale factor it draws the
 * outline with, and `unitFootprintM2` computes coverage from the identical
 * figure. Nothing anywhere is allowed to scale a texture to fit.
 *
 * ## Grout is part of the unit
 *
 * A 300 mm tile with a 3 mm joint occupies 303 mm. Leaving the joint out
 * over-orders by about 2% on a small format and mis-draws every seam, so the
 * joint is added once, here, and both consumers inherit it.
 */

import type { Material, MaterialKind, TilePattern, Vec2 } from '../room-surface-model';

import { newSurfaceId } from './derive';
import { round4 } from './geometry';

/** Millimetres to metres. Named because the conversion appears everywhere. */
export function mmToM(mm: number): number {
  return mm / 1000;
}

/**
 * Sensible defaults per kind, so that "add a tile" produces something that
 * draws correctly before the member has typed a dimension.
 *
 * The numbers are the commonest real product in each category, and the waste
 * percentages are the trade's rules of thumb — 10% for tile and flooring
 * (cuts and breakage), 0 for paint (it is sold by volume and the coverage
 * figure already allows for it).
 */
export const MATERIAL_KIND_DEFAULTS: Record<
  MaterialKind,
  Partial<Material> & { label: string }
> = {
  paint: {
    label: 'Paint',
    colorHex: '#e8e2d9',
    coats: 2,
    coverageM2PerUnit: 11,
    unitLabel: 'L',
    wastePct: 0,
  },
  tile: {
    label: 'Tile',
    colorHex: '#dfe4e6',
    unit_w_mm: 300,
    unit_h_mm: 300,
    groutMm: 3,
    groutColorHex: '#b8b3aa',
    pattern: 'grid',
    wastePct: 10,
    unitLabel: 'tile',
  },
  flooring: {
    label: 'Flooring',
    colorHex: '#b98a55',
    unit_w_mm: 1220,
    unit_h_mm: 190,
    groutMm: 0,
    pattern: 'brick_third',
    wastePct: 10,
    coverageM2PerUnit: 2.2,
    unitLabel: 'box',
  },
  panel: {
    label: 'Panelling',
    colorHex: '#f4f1ea',
    unit_w_mm: 600,
    unit_h_mm: 1200,
    groutMm: 0,
    pattern: 'grid',
    wastePct: 8,
    unitLabel: 'panel',
  },
  wallpaper: {
    label: 'Wallpaper',
    colorHex: '#e6e0d2',
    unit_w_mm: 530,
    unit_h_mm: 1000,
    groutMm: 0,
    pattern: 'grid',
    wastePct: 15,
    coverageM2PerUnit: 5,
    unitLabel: 'roll',
  },
  stone: {
    label: 'Stone',
    colorHex: '#9c968c',
    unit_w_mm: 600,
    unit_h_mm: 300,
    groutMm: 5,
    groutColorHex: '#8c867c',
    pattern: 'brick',
    wastePct: 12,
    unitLabel: 'piece',
  },
  other: {
    label: 'Other',
    colorHex: '#cfd4d8',
    wastePct: 10,
    unitLabel: 'unit',
  },
};

export function createMaterial(input: {
  name: string;
  kind: MaterialKind;
  colorHex?: string;
  textureAttachmentId?: string | null;
}): Material {
  const defaults = MATERIAL_KIND_DEFAULTS[input.kind];
  return {
    ...defaults,
    label: undefined,
    id: newSurfaceId('mt'),
    name: input.name,
    kind: input.kind,
    colorHex: input.colorHex ?? defaults.colorHex ?? '#cfd4d8',
    textureAttachmentId: input.textureAttachmentId ?? null,
  } as Material;
}

/** A material with no repeat — a flat colour or a single sheet. */
export function isContinuous(material: Material): boolean {
  return !material.unit_w_mm || !material.unit_h_mm;
}

/**
 * The footprint of one unit including its share of the joint, m².
 *
 * This is the divisor for "how many tiles", so it is the joint-inclusive
 * figure: tiles are laid on a grid of (face + joint), and the last row's
 * missing joint is inside the waste allowance many times over.
 */
export function unitFootprintM2(material: Material): number | null {
  if (isContinuous(material)) return null;
  const grout = mmToM(material.groutMm ?? 0);
  const w = mmToM(material.unit_w_mm!) + grout;
  const h = mmToM(material.unit_h_mm!) + grout;
  return round4(w * h);
}

// ---------------------------------------------------------------------------
// Pattern cells
// ---------------------------------------------------------------------------

/** One drawn unit inside a repeating cell. Metres, cell-local, `+y` up. */
export interface PatternTile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PatternCell {
  /** The repeating cell, metres. */
  width: number;
  height: number;
  /**
   * Units to draw inside it. Some deliberately hang outside the cell — that is
   * how a running bond tiles seamlessly, and SVG patterns clip to the cell.
   */
  tiles: PatternTile[];
  /** Whole-field rotation applied by the renderer, degrees. */
  rotationDeg: number;
}

/**
 * The repeating cell for a material's layout.
 *
 * Each case below is the smallest unit that tiles the plane for that pattern,
 * because the renderer turns it straight into an SVG `<Pattern>` and a cell
 * that is larger than it needs to be costs proportionally more to rasterise on
 * a wall drawn at 800 pixels.
 *
 *  - **grid** — one unit.
 *  - **brick / brick_third** — a column of 2 or 3 rows, each offset by a
 *    fraction of the width. Each row draws its unit **twice**, one repeat to
 *    the left, so the piece that the offset pushes past the right edge comes
 *    back in on the left and the seam closes.
 *  - **vertical_stack** — the grid with the unit turned a quarter turn, which
 *    is what "stacked vertical" means for a subway tile.
 *  - **herringbone** — a square of side (w + h) holding four units in the
 *    classic interlock, drawn upright and then rotated 45° by the renderer.
 *    That is the standard construction and it tiles exactly for any w and h,
 *    not only the 2:1 the pattern is usually cut in.
 */
export function patternCell(material: Material): PatternCell | null {
  if (isContinuous(material)) return null;
  const grout = mmToM(material.groutMm ?? 0);
  const w = round4(mmToM(material.unit_w_mm!));
  const h = round4(mmToM(material.unit_h_mm!));
  const cw = round4(w + grout);
  const ch = round4(h + grout);
  const rotationDeg = material.rotationDeg ?? 0;
  const pattern: TilePattern = material.pattern ?? 'grid';

  switch (pattern) {
    case 'grid':
      return { width: cw, height: ch, tiles: [{ x: 0, y: 0, width: w, height: h }], rotationDeg };

    case 'vertical_stack':
      // The unit turned a quarter turn — the cell swaps too, or the joints stop
      // lining up with the faces.
      return {
        width: ch,
        height: cw,
        tiles: [{ x: 0, y: 0, width: h, height: w }],
        rotationDeg,
      };

    case 'brick':
      return offsetRows(w, h, cw, ch, 2, rotationDeg);

    case 'brick_third':
      return offsetRows(w, h, cw, ch, 3, rotationDeg);

    case 'herringbone': {
      const side = round4(cw + ch);
      return {
        width: side,
        height: side,
        tiles: [
          { x: 0, y: 0, width: w, height: h },
          { x: cw, y: 0, width: h, height: w },
          { x: 0, y: ch, width: h, height: w },
          { x: ch, y: cw, width: w, height: h },
        ],
        rotationDeg: rotationDeg + 45,
      };
    }

    default:
      return { width: cw, height: ch, tiles: [{ x: 0, y: 0, width: w, height: h }], rotationDeg };
  }
}

function offsetRows(
  w: number,
  h: number,
  cw: number,
  ch: number,
  rows: number,
  rotationDeg: number
): PatternCell {
  const tiles: PatternTile[] = [];
  for (let row = 0; row < rows; row += 1) {
    const offset = round4((cw * row) / rows);
    tiles.push({ x: offset, y: round4(ch * row), width: w, height: h });
    // The wrap-around copy. Without it every offset row shows a gap at the left
    // edge of the cell exactly `offset` wide, which reads as a missing tile.
    tiles.push({ x: round4(offset - cw), y: round4(ch * row), width: w, height: h });
  }
  return { width: cw, height: round4(ch * rows), tiles, rotationDeg };
}

/**
 * How many units cover an area, including waste.
 *
 * `Math.ceil` at the end and nowhere earlier: rounding the area up and then the
 * count up charges the member twice for the same partial tile.
 */
export function unitsForArea(material: Material, areaM2: number): number | null {
  const footprint = unitFootprintM2(material);
  if (!footprint || footprint <= 0 || areaM2 <= 0) return null;
  const withWaste = areaM2 * (1 + (material.wastePct ?? 0) / 100);
  return Math.ceil(withWaste / footprint);
}

/**
 * How many purchase units — litres, boxes, rolls — an area needs.
 *
 * Paint multiplies by `coats`, because a litre covers its stated area *once*
 * and the member is buying two passes. Everything else with a `coverageM2PerUnit`
 * divides the waste-inclusive area by it.
 */
export function purchaseUnitsForArea(material: Material, areaM2: number): number | null {
  if (!material.coverageM2PerUnit || material.coverageM2PerUnit <= 0 || areaM2 <= 0) return null;
  const coats = material.kind === 'paint' ? material.coats ?? 1 : 1;
  const withWaste = areaM2 * (1 + (material.wastePct ?? 0) / 100) * coats;
  return Math.ceil(withWaste / material.coverageM2PerUnit);
}

/**
 * The size a repeat is drawn at, in a frame where 1 metre is `pxPerMetre`
 * pixels.
 *
 * Trivial, and it exists so that no component multiplies by a scale it invented
 * — the single most likely way for the preview to stop being to scale.
 */
export function cellPixelSize(cell: PatternCell, pxPerMetre: number): { w: number; h: number } {
  return { w: cell.width * pxPerMetre, h: cell.height * pxPerMetre };
}

/** A short human summary — "300 × 300 mm · 3 mm joint · running bond". */
export function describeMaterialUnit(material: Material): string | null {
  if (isContinuous(material)) return null;
  const parts = [`${material.unit_w_mm} × ${material.unit_h_mm} mm`];
  if (material.groutMm) parts.push(`${material.groutMm} mm joint`);
  const patternLabel = TILE_PATTERN_LABELS[material.pattern ?? 'grid'];
  if (patternLabel) parts.push(patternLabel.toLowerCase());
  return parts.join(' · ');
}

export const TILE_PATTERN_LABELS: Record<TilePattern, string> = {
  grid: 'Straight grid',
  brick: 'Running bond',
  brick_third: 'Third offset',
  herringbone: 'Herringbone',
  vertical_stack: 'Stacked vertical',
};

/**
 * A starter palette, so the first surface a member opens has something to
 * assign without a trip to a form.
 *
 * Deliberately generic and neutral: these are placeholders that make the
 * preview legible, not product recommendations, and nothing here claims a
 * brand, a price or a SKU.
 */
export function starterPalette(): Material[] {
  return [
    createMaterial({ name: 'Wall paint', kind: 'paint', colorHex: '#efeae1' }),
    createMaterial({ name: 'Ceiling paint', kind: 'paint', colorHex: '#fbfbfa' }),
    createMaterial({ name: 'Floor tile', kind: 'tile', colorHex: '#d7dcdf' }),
  ];
}

/** Position of a tile's top-left within the cell, for a `+y`-down renderer. */
export function tileTopLeft(cell: PatternCell, tile: PatternTile): Vec2 {
  return [tile.x, cell.height - tile.y - tile.height];
}
