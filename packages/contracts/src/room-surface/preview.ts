/**
 * The scale brief — what an AI preview is allowed to be told, and why it is
 * computed rather than described.
 *
 * ## The problem this solves
 *
 * "Here is a photo of a tile, here is my wall, show me how it looks" is the
 * request, and it is the one every consumer visualiser answers badly. An image
 * model handed two pictures has no idea that the tile is 300 mm and the wall is
 * 3.4 m, so it draws a plausible number of tiles — usually far too few, because
 * a pleasing composition wants large shapes. The result looks convincing and is
 * unbuildable: the member cannot count courses on it, cannot see where the cut
 * lands at the ceiling, and cannot order from it.
 *
 * **So the model is never asked to work out the scale.** This module computes
 * it — from the same geometry the takeoff divides by — and states it as
 * arithmetic the model only has to follow: *13 full courses across, then a
 * 61 mm cut at the right-hand end; 8 courses up, then a 44 mm cut at the
 * ceiling.* A number is much harder to hallucinate than a proportion.
 *
 * ## What the brief is for, beyond the prompt
 *
 * It is also shown to the member, verbatim, beside the render. A generated
 * image with no statement of what it was told is indistinguishable from a
 * generated image that was told nothing — and this feature's whole claim is
 * that its pictures are to scale. The brief is the receipt.
 *
 * Nothing here calls a model, and nothing here is provider-specific.
 */

import type { Material, Opening, RoomSurfaceModel, Surface } from '../room-surface-model';

import { polygonBounds, round4 } from './geometry';
import { isContinuous, mmToM, TILE_PATTERN_LABELS } from './materials';
import { regionsOf } from './subareas';

/** How a repeat divides into a run: whole units, then the offcut. */
export interface CourseFit {
  /** Repeat pitch — face plus joint, metres. */
  pitch_m: number;
  /** Whole repeats that fit. */
  whole: number;
  /** What is left over, metres. Zero when it divides exactly. */
  cut_m: number;
}

export interface BriefRegion {
  label: string;
  /** Bounding box of the region in surface coordinates, metres. */
  x: number;
  y: number;
  width: number;
  height: number;
  netM2: number;
  materialName: string | null;
  materialKind: Material['kind'] | null;
  colorHex: string | null;
  unit_w_mm: number | null;
  unit_h_mm: number | null;
  groutMm: number | null;
  patternLabel: string | null;
  /** Null for a finish with no repeat — paint, render, a single sheet. */
  across: CourseFit | null;
  up: CourseFit | null;
  /** Attachment id of the member's photo of this material, if any. */
  textureAttachmentId: string | null;
}

export interface SurfaceScaleBrief {
  surfaceId: string;
  surfaceLabel: string;
  kind: Surface['kind'];
  /** Bounding size of the surface, metres. */
  width_m: number;
  height_m: number;
  /** True when the outline is not a plain rectangle — a gable, an alcove. */
  irregular: boolean;
  regions: BriefRegion[];
  openings: Array<Pick<Opening, 'type' | 'x' | 'y' | 'width' | 'height' | 'deducts'>>;
  /**
   * The brief as sentences. This exact text goes to the model *and* to the
   * member — one string, so the two can never describe different pictures.
   */
  lines: string[];
}

/**
 * How many whole repeats fit across a run, and what the offcut is.
 *
 * The joint is part of the pitch (a 300 mm tile with a 3 mm joint repeats every
 * 303 mm), and the final course carries no trailing joint — which is why the
 * remainder is computed against `run + grout` rather than `run`. Getting that
 * backwards puts the cut one joint width out, which is visible on a small
 * format and is the sort of detail that decides whether a member believes the
 * picture.
 */
export function fitCourses(run_m: number, face_mm: number, grout_mm: number): CourseFit {
  const pitch = mmToM(face_mm + grout_mm);
  if (pitch <= 0 || run_m <= 0) return { pitch_m: round4(pitch), whole: 0, cut_m: 0 };
  const whole = Math.floor((run_m + mmToM(grout_mm)) / pitch);
  const consumed = whole * pitch - mmToM(grout_mm);
  return {
    pitch_m: round4(pitch),
    whole: Math.max(0, whole),
    cut_m: round4(Math.max(0, run_m - consumed)),
  };
}

/** Is this outline a plain axis-aligned rectangle? */
function isRectangular(surface: Surface): boolean {
  if (surface.outline.length !== 4) return false;
  const b = polygonBounds(surface.outline);
  const corners = new Set(
    [
      [b.minX, b.minY],
      [b.maxX, b.minY],
      [b.maxX, b.maxY],
      [b.minX, b.maxY],
    ].map(([x, y]) => `${round4(x)},${round4(y)}`)
  );
  return surface.outline.every(([x, y]) => corners.has(`${round4(x)},${round4(y)}`));
}

/**
 * Build the brief for one surface.
 *
 * Region shapes are reduced to their bounding boxes on purpose: an image model
 * cannot be steered by a polygon, and the boundary a member cares about — the
 * wainscot line, the tile-to-paint change — is a straight edge that a box
 * describes exactly. The scale-true drawing, which does carry the real polygon,
 * is what the render is composed against.
 */
export function buildSurfaceScaleBrief(
  surface: Surface,
  materials: readonly Material[]
): SurfaceScaleBrief {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const bounds = polygonBounds(surface.outline);

  const regions: BriefRegion[] = regionsOf(surface)
    .filter((region) => region.netM2 > 0)
    .map((region) => {
      const box = polygonBounds(region.outline);
      const material = region.materialId ? byId.get(region.materialId) : undefined;
      const repeats = material && !isContinuous(material);
      const grout = material?.groutMm ?? 0;
      return {
        label: region.label,
        x: round4(box.minX),
        y: round4(box.minY),
        width: round4(box.width),
        height: round4(box.height),
        netM2: region.netM2,
        materialName: material?.name ?? null,
        materialKind: material?.kind ?? null,
        colorHex: material?.colorHex ?? null,
        unit_w_mm: repeats ? material!.unit_w_mm ?? null : null,
        unit_h_mm: repeats ? material!.unit_h_mm ?? null : null,
        groutMm: repeats ? grout : null,
        patternLabel: repeats ? TILE_PATTERN_LABELS[material!.pattern ?? 'grid'] : null,
        across: repeats ? fitCourses(box.width, material!.unit_w_mm!, grout) : null,
        up: repeats ? fitCourses(box.height, material!.unit_h_mm!, grout) : null,
        textureAttachmentId: material?.textureAttachmentId ?? null,
      };
    });

  const brief: SurfaceScaleBrief = {
    surfaceId: surface.id,
    surfaceLabel: surface.label,
    kind: surface.kind,
    width_m: round4(bounds.width),
    height_m: round4(bounds.height),
    irregular: !isRectangular(surface),
    regions,
    openings: surface.openings.map((opening) => ({
      type: opening.type,
      x: opening.x,
      y: opening.y,
      width: opening.width,
      height: opening.height,
      deducts: opening.deducts,
    })),
    lines: [],
  };
  brief.lines = briefLines(brief);
  return brief;
}

function metres(value: number): string {
  return `${value.toFixed(2)} m`;
}

function millimetres(value: number): string {
  return `${Math.round(value * 1000)} mm`;
}

/**
 * The brief as sentences — the text that goes to the model and to the member.
 *
 * Written as instructions with numbers in them rather than as a description,
 * because a description ("a tiled wall with a painted band above") is exactly
 * the input that produces a picture at the wrong scale. Every measurement is
 * absolute; nothing is expressed as a proportion.
 */
function briefLines(brief: SurfaceScaleBrief): string[] {
  const lines: string[] = [];
  const orientation =
    brief.kind === 'wall'
      ? 'a wall seen straight on'
      : brief.kind === 'floor'
        ? 'a floor seen from above'
        : 'a ceiling seen from below';
  lines.push(
    `${brief.surfaceLabel}: ${orientation}, ${metres(brief.width_m)} wide by ${metres(
      brief.height_m
    )} high.`
  );
  if (brief.irregular) {
    lines.push(
      'The outline is not a plain rectangle — follow the shape in the reference drawing exactly.'
    );
  }

  for (const region of brief.regions) {
    const where =
      brief.regions.length === 1
        ? 'The whole surface'
        : `“${region.label}” (${metres(region.width)} × ${metres(region.height)}, starting ${metres(
            region.x
          )} from the left and ${metres(region.y)} from the bottom)`;

    if (!region.materialName) {
      lines.push(`${where} has no finish chosen — leave it plain and unfinished.`);
      continue;
    }
    if (!region.across || !region.up) {
      lines.push(
        `${where} is ${region.materialName} — a flat ${region.materialKind ?? 'finish'} in ${
          region.colorHex ?? 'the reference colour'
        }, with no pattern or joints.`
      );
      continue;
    }

    lines.push(
      `${where} is ${region.materialName}: pieces of exactly ${region.unit_w_mm} × ${
        region.unit_h_mm
      } mm with a ${region.groutMm} mm joint, laid ${(
        region.patternLabel ?? 'straight grid'
      ).toLowerCase()}.`
    );
    lines.push(
      `  Across its ${metres(region.width)}: ${region.across.whole} whole pieces${
        region.across.cut_m > 0.002
          ? `, then a cut piece ${millimetres(region.across.cut_m)} wide at the end`
          : ' exactly, with no cut'
      }.`
    );
    lines.push(
      `  Up its ${metres(region.height)}: ${region.up.whole} whole courses${
        region.up.cut_m > 0.002
          ? `, then a cut course ${millimetres(region.up.cut_m)} high at the top`
          : ' exactly, with no cut'
      }.`
    );
  }

  for (const opening of brief.openings) {
    lines.push(
      `There is a ${opening.type} ${metres(opening.width)} × ${metres(
        opening.height
      )}, ${metres(opening.x)} from the left and ${metres(opening.y)} from the bottom.`
    );
  }

  return lines;
}

/**
 * The whole-room brief — every surface that is in scope.
 *
 * Used for a room-level preview and for the export a member sends a
 * contractor, which is the same information in the same words.
 */
export function buildRoomScaleBrief(model: RoomSurfaceModel): SurfaceScaleBrief[] {
  return model.surfaces
    .filter((surface) => surface.excluded !== true)
    .map((surface) => buildSurfaceScaleBrief(surface, model.materials));
}

/**
 * The instruction an image model is given.
 *
 * Three rules, in this order, and the order is the point: the scale is
 * non-negotiable, the drawing is authoritative for shape, and the photographs
 * are only for what the materials *look* like. A prompt that leads with "make
 * it look realistic" gets a beautiful picture of a different room.
 */
export function surfacePreviewInstruction(brief: SurfaceScaleBrief): string {
  return [
    'Render a photorealistic interior view of one finished surface, for a homeowner deciding on materials.',
    '',
    'HARD RULES, in priority order:',
    '1. The measurements below are exact. Reproduce the stated piece counts and cut sizes literally — do not choose a tile size that "looks right", and do not resize, crop or stretch a material to make it fit.',
    '2. The reference drawing supplied with this request is authoritative for the shape of the surface, the position of every area boundary and the position of every opening. Match it.',
    '3. Any material photographs supplied show only what the material looks like — its colour, grain and texture. They say nothing about how large it is.',
    '',
    'THE SURFACE:',
    ...brief.lines.map((line) => (line.startsWith('  ') ? line : `- ${line}`)),
    '',
    'Light it naturally and evenly, straight on, with no furniture, no people, no text and no watermark. Do not add fixtures, trims or decoration that are not listed above.',
  ].join('\n');
}
