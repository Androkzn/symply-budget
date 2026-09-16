/**
 * The arithmetic behind the Smart Project photo editor's crop frame.
 *
 * Pure, and separate from the component, because this is the only part of an
 * image editor that can be WRONG WITHOUT LOOKING WRONG. Every other control
 * fails loudly: a rotate that misfires shows a sideways photo, a flip that
 * misfires shows mirrored text. A crop rectangle that is off by a scale factor
 * produces a perfectly sharp, perfectly plausible picture of the wrong part of
 * the room — and the member's evidence for "the damp is in that corner" quietly
 * becomes a photo of the corner beside it, which is then what the model reads.
 *
 * So the mapping from what is on screen to what is in the file lives here, in
 * functions a test can pin, rather than inline in a gesture handler where the
 * only way to check it is to look at the result and believe it.
 *
 * ## The model
 *
 * The crop FRAME is fixed and centred; the IMAGE moves behind it. That is the
 * camera-roll gesture every member already knows — pinch to zoom, drag to
 * choose what is inside — and it is also the one that cannot produce an empty
 * corner, because the image is clamped to always cover the frame.
 *
 * Two scales compose:
 *
 *  - `coverScale` — the fit that makes the source exactly cover the frame. This
 *    is the zoomed-out limit, and it depends on both aspect ratios.
 *  - the member's own zoom, always `>= 1`, applied on top.
 *
 * Rotation and flips are deliberately NOT in this file. The editor applies
 * those to the bytes as they are tapped and hands us the resulting dimensions,
 * so the crop always runs against an upright image. Carrying a rotation through
 * this maths as a fourth term is the version of it that has a bug in it.
 */

export interface Size {
  width: number;
  height: number;
}

/** Where the member has dragged and zoomed the image behind the frame. */
export interface CropView {
  /** Member zoom on top of `coverScale`. 1 is fully zoomed out. */
  scale: number;
  /** Screen-space offset of the image centre from the frame centre. */
  translateX: number;
  translateY: number;
}

/** A rectangle in SOURCE PIXELS, which is what `expo-image-manipulator` wants. */
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export const IDENTITY_VIEW: CropView = { scale: 1, translateX: 0, translateY: 0 };

/** How far in the member may zoom. Past this a phone photo is mush anyway. */
export const MAX_CROP_ZOOM = 6;

/**
 * The scale at which the source exactly covers the frame — never `contain`.
 *
 * `contain` would letterbox, and a letterboxed crop bakes the bars into the
 * saved file: the member sees a photo of their wall with a black stripe down
 * it, which reads as a rendering bug rather than as a choice they made.
 */
export function coverScale(source: Size, frame: Size): number {
  if (source.width <= 0 || source.height <= 0) return 1;
  return Math.max(frame.width / source.width, frame.height / source.height);
}

/**
 * The furthest the image may be dragged before an edge would enter the frame.
 *
 * Zero on an axis where the image only just covers the frame — that axis has no
 * slack, and letting it drift is exactly how a corner ends up empty.
 */
export function panBounds(source: Size, frame: Size, view: CropView): Size {
  const scale = coverScale(source, frame) * view.scale;
  return {
    width: Math.max(0, (source.width * scale - frame.width) / 2),
    height: Math.max(0, (source.height * scale - frame.height) / 2),
  };
}

/**
 * Pull a pan back inside its bounds.
 *
 * Called on every gesture frame rather than only at the end: a member who drags
 * past the edge and lets go should feel the image stop, not watch it snap back
 * from somewhere it was never allowed to be.
 */
export function clampView(source: Size, frame: Size, view: CropView): CropView {
  const scale = Math.min(MAX_CROP_ZOOM, Math.max(1, view.scale));
  const bounds = panBounds(source, frame, { ...view, scale });
  return {
    scale,
    translateX: Math.min(bounds.width, Math.max(-bounds.width, view.translateX)),
    translateY: Math.min(bounds.height, Math.max(-bounds.height, view.translateY)),
  };
}

/**
 * What is behind the frame, in source pixels.
 *
 * Derivation, once, so the next reader does not have to re-derive it from the
 * component: with `S` the total scale, the image's top-left sits at
 * `(-w·S/2 + tx, -h·S/2 + ty)` relative to the frame centre, and the frame's
 * own top-left sits at `(-fw/2, -fh/2)`. The offset between them, divided back
 * by `S`, is the crop origin in the source's own coordinates.
 *
 * Rounded to whole pixels and clamped to the source at the end. Both matter:
 * `expo-image-manipulator` treats a fractional or out-of-bounds rect as a hard
 * error on Android, so a half-pixel of floating-point drift at full zoom is the
 * difference between a cropped photo and an alert that says "Could not save".
 */
export function cropRect(source: Size, frame: Size, view: CropView): CropRect {
  const clamped = clampView(source, frame, view);
  const scale = coverScale(source, frame) * clamped.scale;
  if (!Number.isFinite(scale) || scale <= 0) {
    return { originX: 0, originY: 0, width: source.width, height: source.height };
  }

  const width = Math.round(frame.width / scale);
  const height = Math.round(frame.height / scale);
  const originX = Math.round(
    (source.width * scale - frame.width) / 2 / scale - clamped.translateX / scale,
  );
  const originY = Math.round(
    (source.height * scale - frame.height) / 2 / scale - clamped.translateY / scale,
  );

  // Clamp the SIZE first, then the origin against it. The other order lets a
  // rounded-up width push the origin negative on an image that only just covers.
  const w = Math.max(1, Math.min(width, source.width));
  const h = Math.max(1, Math.min(height, source.height));
  return {
    originX: Math.max(0, Math.min(originX, source.width - w)),
    originY: Math.max(0, Math.min(originY, source.height - h)),
    width: w,
    height: h,
  };
}

/**
 * True when the crop would keep the whole image — the "they framed nothing"
 * case.
 *
 * Worth asking, because a no-op crop still costs a full decode, re-encode and
 * write. Skipping it keeps a member who opened the editor to rotate one photo
 * from paying for a needless JPEG generation on all of them, and keeps the
 * saved file at the quality it already had rather than one round-trip below it.
 *
 * The tolerance is a pixel, not zero: `cropRect` rounds, and a source whose
 * aspect does not divide evenly into the frame's lands one pixel short of its
 * own size at zoom 1.
 */
export function isFullFrameCrop(source: Size, rect: CropRect): boolean {
  return (
    rect.originX <= 1 &&
    rect.originY <= 1 &&
    rect.width >= source.width - 2 &&
    rect.height >= source.height - 2
  );
}

// ---------------------------------------------------------------------------
// Aspect presets
// ---------------------------------------------------------------------------

/**
 * `null` means "whatever this photo already is".
 *
 * It is the DEFAULT and it is first in the row, because the common reason to
 * open this editor is to straighten or brighten one wall — not to reframe it.
 * A preset list whose first entry re-crops the photo makes the safe action the
 * one you have to go and find.
 */
export type CropAspect = number | null;

export interface CropAspectOption {
  key: string;
  label: string;
  ratio: CropAspect;
}

export const CROP_ASPECTS: readonly CropAspectOption[] = [
  { key: 'original', label: 'Original', ratio: null },
  { key: 'square', label: 'Square', ratio: 1 },
  { key: 'landscape', label: '4:3', ratio: 4 / 3 },
  { key: 'portrait', label: '3:4', ratio: 3 / 4 },
  { key: 'wide', label: '16:9', ratio: 16 / 9 },
];

/**
 * The frame that fits `aspect` inside the space the canvas has.
 *
 * `null` follows the source's own ratio, so switching to "Original" always
 * returns a frame the un-zoomed image fills exactly — which is what makes
 * `isFullFrameCrop` true again and the save a no-op.
 */
export function frameForAspect(bounds: Size, aspect: CropAspect, source: Size): Size {
  const ratio =
    aspect ??
    (source.width > 0 && source.height > 0 ? source.width / source.height : 1);
  if (!Number.isFinite(ratio) || ratio <= 0) return bounds;

  const width = Math.min(bounds.width, bounds.height * ratio);
  const height = width / ratio;
  return { width: Math.round(width), height: Math.round(height) };
}
