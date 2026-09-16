/**
 * The crop maths, pinned.
 *
 * This is the one part of the Smart Project photo editor that can be wrong
 * while looking completely right: a scale factor in the wrong place produces a
 * sharp, plausible photograph of the wrong part of the room, which is then what
 * the planner reads and what the member's "the damp is in that corner" quietly
 * stops being evidence for. Every other control fails visibly.
 *
 * Two classes of assertion here, and the second is the one that catches real
 * bugs: the numbers themselves, and the INVARIANTS — that the rect is always
 * whole-pixel and always inside the source. `expo-image-manipulator` treats a
 * fractional or out-of-bounds rect as a hard error on Android, so a half-pixel
 * of floating-point drift at full zoom is the difference between a cropped
 * photo and "Could not save".
 */
import {
  clampView,
  coverScale,
  CROP_ASPECTS,
  cropRect,
  frameForAspect,
  IDENTITY_VIEW,
  isFullFrameCrop,
  MAX_CROP_ZOOM,
  panBounds,
  type CropView,
} from '../photoCrop';

/** A 4:3 landscape photo, which is what a phone camera actually produces. */
const PHOTO = { width: 4000, height: 3000 };
const SQUARE_FRAME = { width: 300, height: 300 };
/** Same 4:3 as the photo — the "Original" preset. */
const MATCHED_FRAME = { width: 320, height: 240 };

describe('coverScale', () => {
  it('fills a square frame from a landscape photo by its SHORT edge', () => {
    // Scaling by the long edge would leave bands top and bottom, and those
    // bands get baked into the saved file.
    expect(coverScale(PHOTO, SQUARE_FRAME)).toBeCloseTo(0.1, 6);
  });

  it('fills a square frame from a portrait photo by its short edge too', () => {
    expect(coverScale({ width: 3000, height: 4000 }, SQUARE_FRAME)).toBeCloseTo(0.1, 6);
  });

  it('survives a source with no dimensions yet rather than returning Infinity', () => {
    // The editor renders one frame before the image has reported its size.
    expect(coverScale({ width: 0, height: 0 }, SQUARE_FRAME)).toBe(1);
  });
});

describe('cropRect at rest', () => {
  it('keeps the whole photo when the frame already matches its shape', () => {
    const rect = cropRect(PHOTO, MATCHED_FRAME, IDENTITY_VIEW);
    expect(rect).toEqual({
      originX: 0,
      originY: 0,
      width: 4000,
      height: 3000,
    });
    expect(isFullFrameCrop(PHOTO, rect)).toBe(true);
  });

  it('takes the centred square out of a landscape photo', () => {
    // 3000 tall means a 3000 square, and the 1000px of extra width is split.
    expect(cropRect(PHOTO, SQUARE_FRAME, IDENTITY_VIEW)).toEqual({
      originX: 500,
      originY: 0,
      width: 3000,
      height: 3000,
    });
  });

  it('is NOT a full-frame crop, so the editor really re-encodes it', () => {
    // The optimisation that skips a no-op crop must not skip a real one.
    expect(isFullFrameCrop(PHOTO, cropRect(PHOTO, SQUARE_FRAME, IDENTITY_VIEW))).toBe(
      false,
    );
  });
});

describe('cropRect while zoomed', () => {
  const zoomed: CropView = { scale: 2, translateX: 0, translateY: 0 };

  it('halves the linear size at 2x, centred', () => {
    expect(cropRect(PHOTO, SQUARE_FRAME, zoomed)).toEqual({
      originX: 1250,
      originY: 750,
      width: 1500,
      height: 1500,
    });
  });

  it('walks the crop to the left edge when the image is dragged fully right', () => {
    const bounds = panBounds(PHOTO, SQUARE_FRAME, zoomed);
    const rect = cropRect(PHOTO, SQUARE_FRAME, {
      ...zoomed,
      translateX: bounds.width,
    });
    expect(rect.originX).toBe(0);
  });

  it('walks it to the right edge, and no further', () => {
    const bounds = panBounds(PHOTO, SQUARE_FRAME, zoomed);
    const rect = cropRect(PHOTO, SQUARE_FRAME, {
      ...zoomed,
      // Twice the legal drag: the clamp, not the caller, is what holds this.
      translateX: -bounds.width * 2,
    });
    expect(rect.originX + rect.width).toBe(PHOTO.width);
  });
});

describe('the invariants that keep the manipulator from throwing', () => {
  const frames = [SQUARE_FRAME, MATCHED_FRAME, { width: 300, height: 169 }];
  const zooms = [1, 1.37, 2, 3.5, MAX_CROP_ZOOM, MAX_CROP_ZOOM * 3];
  const pans = [-5000, -137, 0, 1, 240, 99999];

  it('never produces a fractional, negative or out-of-bounds rectangle', () => {
    for (const frame of frames) {
      for (const scale of zooms) {
        for (const translateX of pans) {
          for (const translateY of pans) {
            const rect = cropRect(PHOTO, frame, { scale, translateX, translateY });

            expect(Number.isInteger(rect.originX)).toBe(true);
            expect(Number.isInteger(rect.originY)).toBe(true);
            expect(Number.isInteger(rect.width)).toBe(true);
            expect(Number.isInteger(rect.height)).toBe(true);

            expect(rect.originX).toBeGreaterThanOrEqual(0);
            expect(rect.originY).toBeGreaterThanOrEqual(0);
            expect(rect.width).toBeGreaterThan(0);
            expect(rect.height).toBeGreaterThan(0);

            expect(rect.originX + rect.width).toBeLessThanOrEqual(PHOTO.width);
            expect(rect.originY + rect.height).toBeLessThanOrEqual(PHOTO.height);
          }
        }
      }
    }
  });

  it('holds for a very tall source too — the phone held upright', () => {
    const tall = { width: 1200, height: 4000 };
    const rect = cropRect(tall, { width: 300, height: 169 }, {
      scale: 4,
      translateX: 9999,
      translateY: -9999,
    });
    expect(rect.originX).toBeGreaterThanOrEqual(0);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(tall.height);
  });
});

describe('clampView', () => {
  it('refuses to zoom out past the cover fit — that is what leaves empty corners', () => {
    expect(clampView(PHOTO, SQUARE_FRAME, { ...IDENTITY_VIEW, scale: 0.2 }).scale).toBe(1);
  });

  it('caps the zoom, so a member cannot crop to nine pixels', () => {
    expect(clampView(PHOTO, SQUARE_FRAME, { ...IDENTITY_VIEW, scale: 40 }).scale).toBe(
      MAX_CROP_ZOOM,
    );
  });

  it('allows no drift at all on an axis with no slack', () => {
    // A 4:3 frame on a 4:3 photo at zoom 1 covers exactly; any pan shows a gap.
    //
    // `toBeCloseTo`, not `toBe`: `320/4000` and `240/3000` are both 0.08 in
    // decimal and NOT the same double, so `coverScale`'s `max` leaves one axis
    // with about 1e-14 of slack. That is a hundredth of a nanometre of pan and
    // `cropRect` rounds it away — the assertion should not pretend the maths is
    // exact when the point being made is that the pan is pinned.
    const clamped = clampView(PHOTO, MATCHED_FRAME, {
      scale: 1,
      translateX: 80,
      translateY: -80,
    });
    expect(clamped.translateX).toBeCloseTo(0, 6);
    expect(clamped.translateY).toBeCloseTo(0, 6);
  });
});

describe('aspect presets', () => {
  const bounds = { width: 340, height: 340 };

  it('offers Original first, because most edits are a straighten and not a reframe', () => {
    expect(CROP_ASPECTS[0]?.ratio).toBeNull();
  });

  it('follows the photo when the preset is Original', () => {
    const frame = frameForAspect(bounds, null, PHOTO);
    expect(frame.width / frame.height).toBeCloseTo(PHOTO.width / PHOTO.height, 2);
    // …and that frame must then be a no-op crop, or "Original" would silently
    // shave a strip off every photo it was selected on.
    expect(isFullFrameCrop(PHOTO, cropRect(PHOTO, frame, IDENTITY_VIEW))).toBe(true);
  });

  it('fits every preset inside the space available', () => {
    for (const option of CROP_ASPECTS) {
      const frame = frameForAspect(bounds, option.ratio, PHOTO);
      expect(frame.width).toBeLessThanOrEqual(bounds.width);
      expect(frame.height).toBeLessThanOrEqual(bounds.height);
      expect(frame.width).toBeGreaterThan(0);
    }
  });

  it('returns a square for the square preset', () => {
    const frame = frameForAspect(bounds, 1, PHOTO);
    expect(frame.width).toBe(frame.height);
  });
});
