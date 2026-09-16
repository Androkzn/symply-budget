/**
 * Metres → pixels, in one place.
 *
 * Every drawn thing in this feature — the outline, the sub-areas, the grout
 * joints, the dimension ticks, the reference image the AI preview is
 * constrained by — has to be at the *same* scale, or the preview stops being to
 * scale and the whole argument for the feature collapses. So there is exactly
 * one projection object, it is built once per canvas, and nothing multiplies by
 * a scale factor it worked out itself.
 *
 * ## The y flip
 *
 * The model is `+y` up (see the contract header: north on a plan, up a wall in
 * an elevation). Screens are `+y` down. The flip happens **here and nowhere
 * else** — a second flip somewhere downstream produces a room that is subtly
 * upside down, which on a symmetrical rectangle is invisible until the day
 * someone puts a window in.
 */

import { polygonBounds, type Bounds, type Vec2 } from '@symply/contracts';

export interface Projection {
  /** Pixels per metre. The number the whole feature agrees on. */
  scale: number;
  /** Size of the drawn content, pixels — excludes padding. */
  drawWidth: number;
  drawHeight: number;
  /** Size of the full canvas including padding, pixels. */
  width: number;
  height: number;
  padding: number;
  /** The model-space box being shown. */
  bounds: Bounds;
  toScreen: (point: Vec2) => Vec2;
  /** Screen → model, for hit-testing a touch. */
  toModel: (point: Vec2) => Vec2;
  /** A model polygon as an SVG path `d`. */
  pathOf: (polygon: readonly Vec2[]) => string;
}

/**
 * Fit a polygon's bounding box into a box of pixels.
 *
 * Uniform scale — the smaller of the two ratios — because a room drawn with
 * different x and y scales is not a drawing of that room. Letterboxing is the
 * price and it is the right one.
 *
 * `maxPxPerMetre` exists for the small-surface case: a 40 cm splashback fitted
 * to a full-width canvas would be drawn at 1200 px/m, and its 3 mm grout joints
 * would render four pixels wide — a picture of grout with some tile in it. The
 * cap keeps a small surface small, which is also what it looks like in the
 * room.
 */
export function fitProjection(
  polygon: readonly Vec2[],
  width: number,
  height: number,
  options?: {
    padding?: number;
    maxPxPerMetre?: number;
    minPxPerMetre?: number;
  },
): Projection {
  const padding = options?.padding ?? 16;
  const bounds = polygonBounds(polygon);
  const availableW = Math.max(1, width - padding * 2);
  const availableH = Math.max(1, height - padding * 2);
  const fitScale = Math.min(
    availableW / Math.max(bounds.width, 0.01),
    availableH / Math.max(bounds.height, 0.01),
  );
  const scale = Math.max(
    options?.minPxPerMetre ?? 1,
    Math.min(fitScale, options?.maxPxPerMetre ?? Infinity),
  );

  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  // Centre the content in whatever the cap left over.
  const offsetX = padding + Math.max(0, (availableW - drawWidth) / 2);
  const offsetY = padding + Math.max(0, (availableH - drawHeight) / 2);

  const toScreen = (point: Vec2): Vec2 => [
    offsetX + (point[0] - bounds.minX) * scale,
    // The one flip. See the module header.
    offsetY + (bounds.maxY - point[1]) * scale,
  ];

  const toModel = (point: Vec2): Vec2 => [
    bounds.minX + (point[0] - offsetX) / scale,
    bounds.maxY - (point[1] - offsetY) / scale,
  ];

  const pathOf = (ring: readonly Vec2[]): string => {
    if (ring.length < 2) return '';
    const [first, ...rest] = ring.map(toScreen);
    return `M ${first[0]} ${first[1]} ${rest
      .map(p => `L ${p[0]} ${p[1]}`)
      .join(' ')} Z`;
  };

  return {
    scale,
    drawWidth,
    drawHeight,
    width,
    height,
    padding,
    bounds,
    toScreen,
    toModel,
    pathOf,
  };
}

/**
 * The screen rectangle a surface-local rect (an opening) occupies.
 *
 * Openings are stored bottom-left-anchored in a `+y`-up frame, so the screen
 * `y` is the **top** edge — the corner that was `y + height` in the model.
 * Getting this backwards puts every window below where it belongs by its own
 * height, which looks plausible on a tall window and wrong on a wide one.
 */
export function projectRect(
  projection: Projection,
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const topLeft = projection.toScreen([rect.x, rect.y + rect.height]);
  return {
    x: topLeft[0],
    y: topLeft[1],
    width: rect.width * projection.scale,
    height: rect.height * projection.scale,
  };
}
