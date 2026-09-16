const mockRenderAsync = jest.fn();
const mockSaveAsync = jest.fn();
const mockResize = jest.fn();
// The real context is chainable: `manipulate(uri).resize({…}).renderAsync()`.
// The old stub exposed only `renderAsync` and resolved it without width/height,
// so `Math.max(undefined, undefined)` was NaN, `needsResize` was always false,
// and the resize branch below was never exercised by any test.
const mockContext: { resize: typeof mockResize; renderAsync: typeof mockRenderAsync } = {
  resize: mockResize,
  renderAsync: mockRenderAsync,
};
const mockManipulate = jest.fn((_uri: string) => mockContext);
jest.mock('expo-image-manipulator', () => ({
  __esModule: true,
  ImageManipulator: { manipulate: (uri: string) => mockManipulate(uri) },
  SaveFormat: { JPEG: 'jpeg' },
}));

import { toVisionSafeAttachment, VISION_SAFE_IMAGE_TYPES } from '../visionSafeAttachment';

/** Size the next `renderAsync()` reports — drives the needsResize decision. */
function renderedSize(width: number, height: number) {
  mockRenderAsync.mockResolvedValue({ width, height, saveAsync: mockSaveAsync });
}

describe('toVisionSafeAttachment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResize.mockReturnValue(mockContext);
    renderedSize(800, 600);
    mockSaveAsync.mockResolvedValue({ uri: 'file://converted.jpg' });
  });

  it('exposes the three vision-safe image mimes', () => {
    expect(VISION_SAFE_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('passes a PDF through untouched', async () => {
    const att = { uri: 'file://a.pdf', name: 'quote.pdf', type: 'application/pdf' };
    const result = await toVisionSafeAttachment(att);
    expect(result).toBe(att);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('passes an already-safe, small-enough JPEG through untouched', async () => {
    const att = { uri: 'file://a.jpg', name: 'photo.jpg', type: 'image/jpeg' };
    const result = await toVisionSafeAttachment(att);
    // Same object back — no re-encode, no rename.
    expect(result).toBe(att);
    expect(mockSaveAsync).not.toHaveBeenCalled();
    expect(mockResize).not.toHaveBeenCalled();
    // It IS measured, though: the size decides whether a re-encode is needed,
    // so a safe mime cannot short-circuit ahead of the measurement.
    expect(mockManipulate).toHaveBeenCalledWith('file://a.jpg');
  });

  it('downscales a safe-mime image whose long edge is over the vision limit', async () => {
    // A 4000×3000 JPEG is vision-safe by mime but too big to send — the
    // measure-first pass is what catches it.
    renderedSize(4000, 3000);
    const att = { uri: 'file://big.jpg', name: 'big.jpg', type: 'image/jpeg' };
    const result = await toVisionSafeAttachment(att);
    expect(mockResize).toHaveBeenCalledWith({ width: 1568 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
    expect(result.uri).toBe('file://converted.jpg');
    expect(result.name).toBe('big.jpg');
  });

  it('scales the width by aspect ratio when the image is taller than it is wide', async () => {
    renderedSize(3000, 4000);
    const att = { uri: 'file://tall.jpg', name: 'tall.jpg', type: 'image/jpeg' };
    await toVisionSafeAttachment(att);
    // Portrait: the LONG edge is the height, so width scales down with it.
    expect(mockResize).toHaveBeenCalledWith({ width: Math.round((3000 / 4000) * 1568) });
  });

  it('re-encodes a HEIC-mime image to JPEG', async () => {
    // iOS Photos hands back "IMG_1345.heic" / mime "image/heic" by default —
    // this is the exact shape that triggered "Could not read that. Please
    // try again." on the Budget "Add with AI" screen.
    const att = { uri: 'file://IMG_1345.heic', name: 'IMG_1345.heic', type: 'image/heic' };
    const result = await toVisionSafeAttachment(att);
    expect(mockManipulate).toHaveBeenCalledWith('file://IMG_1345.heic');
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
    expect(result).toEqual({ uri: 'file://converted.jpg', name: 'IMG_1345.jpg', type: 'image/jpeg' });
  });

  it('re-encodes a .heic-named file even when the declared type is mislabeled', async () => {
    // A cloud picker (or a mislabeled client) can hand back "image/jpeg" for
    // bytes that are actually HEIC — the extension check catches that case
    // even though the type check alone would have let it through.
    const att = { uri: 'file://p.heic', name: 'photo.heic', type: 'image/jpeg' };
    const result = await toVisionSafeAttachment(att);
    expect(mockManipulate).toHaveBeenCalledWith('file://p.heic');
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
  });

  it('preserves extra fields on the attachment (e.g. a client-side size)', async () => {
    const att = { uri: 'file://s.heic', name: 's.heic', type: 'image/heic', size: 12345 };
    const result = await toVisionSafeAttachment(att);
    expect(result.size).toBe(12345);
  });
});
