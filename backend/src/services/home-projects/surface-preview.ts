/**
 * AI surface preview — the photoreal layer, and the leash it runs on.
 *
 * ## What this is for, and what it is not for
 *
 * The device already draws every surface **exactly** to scale: a 300 mm tile is
 * 300 mm on a 3.4 m wall, the grout is 3 mm, the cut course lands where it will
 * land, and the takeoff divides by the identical numbers. That drawing is the
 * source of truth and it needs no model.
 *
 * What it cannot do is show a member what the room will *feel* like — the way
 * light falls across a gloss tile, how a panelled wainscot reads under a matte
 * upper wall. That is what this produces, and it is a **decision aid, never a
 * measurement**. Nothing downstream reads a pixel of it: quantities, costs and
 * the export all come from the geometry.
 *
 * ## The three rules that keep it honest
 *
 * 1. **The brief is computed on the server, from the stored document.** Course
 *    counts and cut sizes are arithmetic (`buildSurfaceScaleBrief`), not
 *    something the client sends and not something the model infers. A client
 *    that wanted to could send a flattering drawing; it cannot send flattering
 *    numbers.
 * 2. **The scale drawing goes in as a reference image**, labelled to the model
 *    as authoritative for shape and layout. Without it the model composes a
 *    generic tiled wall; with it, it composes *this* wall.
 * 3. **Material photos are labelled as colour-and-texture only.** They are the
 *    single largest source of wrong-scale output, because a close-up of one
 *    tile invites the model to treat that tile as the whole composition.
 *
 * ## Cost and blast radius
 *
 * One image per call, at most four references, capped by
 * `MAX_MATERIAL_REFERENCES`. The route is behind `assertCanUseAI`, the same
 * entitlement gate every other AI feature in this Worker sits behind, and usage
 * is recorded through the provider's `onUsage` recorder so it lands in
 * `ai_usage` with the rest.
 *
 * A local-first household never reaches here: `localHomeProjectsApi` refuses
 * with member-facing copy, because the geometry lives on the device and a
 * Worker that cannot read the household's rows would be generating a preview of
 * an empty room. See that facade's header for the tier argument.
 */

import {
  buildSurfaceScaleBrief,
  parseRoomSurfaceModel,
  surfacePreviewInstruction,
  type RoomSurfaceModel,
  type SurfaceScaleBrief,
} from '@symply/contracts';

import type { GenerateImageArgs, ImageReference } from '../../ai/provider';
import type { Env } from '../../types';
import { NotFoundError, ServiceUnavailableError, ValidationError } from '../../utils/errors';

/**
 * How many material photographs ride along.
 *
 * Four is where the marginal picture stops changing the render and starts
 * costing money: a surface with more than four distinct materials on it is
 * already a surface whose preview will be a muddle, and the brief still names
 * every one of them in text.
 */
export const MAX_MATERIAL_REFERENCES = 3;

/** The largest layout PNG the client may send, bytes. */
export const MAX_LAYOUT_BYTES = 4 * 1024 * 1024;

export interface SurfacePreviewParams {
  projectId: string;
  surfaceId: string;
  /**
   * The scale-true drawing the member is looking at, captured from the on-device
   * canvas (`Svg.toDataURL`), base64 PNG without a data-URI prefix.
   *
   * Client-supplied and that is fine: it is a *reference*, and every number the
   * model is held to is computed here from the stored geometry. Omitted is
   * legal — the preview is then prompt-only and correspondingly less faithful,
   * which the caller is told.
   */
  layoutPngBase64?: string;
  size?: GenerateImageArgs['size'];
}

export interface SurfacePreviewResult {
  bytes: ArrayBuffer;
  mime: string;
  model: string;
  brief: SurfaceScaleBrief;
  /** What actually went to the model — stored beside the image as provenance. */
  instruction: string;
  usedLayoutReference: boolean;
  materialReferenceCount: number;
}

/**
 * The pieces this module needs from the surrounding service.
 *
 * Injected rather than imported so the whole flow can be exercised without a
 * Worker, a bucket or a D1 binding — the interesting failures here (a surface
 * that is not in the document, a texture whose object is missing, a provider
 * with no image model) are all reachable with three stub functions.
 */
export interface SurfacePreviewDeps {
  env: Env;
  /** The newest stored geometry payload for this project, or null. */
  loadGeometryPayload: (projectId: string) => Promise<string | null>;
  /** `home_project_attachments.r2_key` for an attachment of this project. */
  resolveAttachmentKey: (
    projectId: string,
    attachmentId: string
  ) => Promise<{ r2_key: string | null; content_type: string | null } | null>;
  /** An image-capable adapter, or null when none is configured. */
  imageProvider: () => Promise<{
    provider: { generateImage?: (args: GenerateImageArgs) => Promise<{ bytes: ArrayBuffer; mime: string; model: string }> };
    model: string;
  } | null>;
}

/**
 * The failures here are reported with the Worker's OWN error classes rather
 * than new ones.
 *
 * `error-handler.ts` maps a fixed list of error *names* to status codes and
 * passes their message through to the client; anything else becomes a generic
 * 500 with the message stripped. So a bespoke `SurfacePreviewUnavailableError`
 * would have turned carefully written member-facing copy — "photo previews are
 * not available right now, your drawing and quantities are unaffected" — into
 * "Internal server error". `ServiceUnavailableError` (503) and `NotFoundError`
 * (404) already say the right thing and already arrive intact.
 */

/**
 * Render one surface.
 *
 * A 404 when the project has no surface document or the id is not in it — both
 * mean the client is looking at something the server does not have, and neither
 * should be papered over with a generic room.
 */
export async function generateSurfacePreview(
  deps: SurfacePreviewDeps,
  params: SurfacePreviewParams
): Promise<SurfacePreviewResult> {
  const payload = await deps.loadGeometryPayload(params.projectId);
  const model: RoomSurfaceModel | null = parseRoomSurfaceModel(payload);
  if (!model) {
    throw new NotFoundError(
      'This project has no room layout yet. Lay the room out first, then try a preview.'
    );
  }
  const surface = model.surfaces.find((entry) => entry.id === params.surfaceId);
  if (!surface) {
    throw new NotFoundError('That surface is no longer part of this room.');
  }

  const adapter = await deps.imageProvider();
  if (!adapter || typeof adapter.provider.generateImage !== 'function') {
    throw new ServiceUnavailableError(
      'Photo previews are not available right now. The scale drawing and the quantities are unaffected.'
    );
  }

  const brief = buildSurfaceScaleBrief(surface, model.materials);
  const instruction = surfacePreviewInstruction(brief);

  const references: ImageReference[] = [];
  if (params.layoutPngBase64) {
    const bytes = decodeBase64(params.layoutPngBase64);
    if (bytes.byteLength > MAX_LAYOUT_BYTES) {
      throw new ValidationError('That drawing is too large to send.');
    }
    // First, always. The legend the provider builds is positional, and rule 2
    // in this module's header only holds if the layout is image 1.
    references.push({
      bytes,
      mime: 'image/png',
      filename: 'layout.png',
      role: 'layout',
    });
  }

  // One photo per distinct material, in the order the regions appear, so the
  // largest region's material is the one that survives the cap.
  //
  // The cap counts MATERIALS, not `references.length`. Counting the array would
  // make the limit depend on whether a layout drawing was sent — four photos
  // without one, three with — which is exactly the kind of quiet
  // off-by-a-reference that turns into a bill.
  const seen = new Set<string>();
  let materialCount = 0;
  for (const region of brief.regions) {
    if (materialCount >= MAX_MATERIAL_REFERENCES) break;
    const attachmentId = region.textureAttachmentId;
    if (!attachmentId || seen.has(attachmentId)) continue;
    seen.add(attachmentId);
    const texture = await loadTexture(deps, params.projectId, attachmentId);
    // A texture that will not load is a material described in words instead of
    // shown — degraded, not failed. Taking the whole preview down because one
    // swatch is missing from the bucket would be the wrong trade. It also does
    // not consume a slot: three photos should mean three photos.
    if (texture) {
      references.push(texture);
      materialCount += 1;
    }
  }

  const image = await adapter.provider.generateImage({
    model: adapter.model,
    prompt: instruction,
    references,
    size: params.size ?? sizeFor(brief),
    quality: 'medium',
  });

  return {
    bytes: image.bytes,
    mime: image.mime,
    model: image.model,
    brief,
    instruction,
    usedLayoutReference: Boolean(params.layoutPngBase64),
    materialReferenceCount: references.filter((entry) => entry.role === 'material').length,
  };
}

/**
 * Ask for an image shaped like the surface.
 *
 * A 4 m × 2.4 m wall rendered into a square is either letterboxed by the model
 * or — much worse — filled, which means the wall it drew is not the shape of
 * the wall it was told about. Snapping to the nearest supported aspect keeps
 * the composition honest.
 */
function sizeFor(brief: SurfaceScaleBrief): GenerateImageArgs['size'] {
  if (brief.height_m <= 0) return '1024x1024';
  const aspect = brief.width_m / brief.height_m;
  if (aspect > 1.25) return '1536x1024';
  if (aspect < 0.8) return '1024x1536';
  return '1024x1024';
}

async function loadTexture(
  deps: SurfacePreviewDeps,
  projectId: string,
  attachmentId: string
): Promise<ImageReference | null> {
  try {
    const row = await deps.resolveAttachmentKey(projectId, attachmentId);
    if (!row?.r2_key) return null;
    const object = await deps.env.REPORTS_BUCKET.get(row.r2_key);
    if (!object) return null;
    const bytes = await object.arrayBuffer();
    if (bytes.byteLength === 0) return null;
    return {
      bytes,
      mime: row.content_type || 'image/jpeg',
      filename: `material-${attachmentId}.jpg`,
      role: 'material',
    };
  } catch (err) {
    console.error('surface preview texture load failed', err);
    return null;
  }
}

/** base64 → bytes, tolerating a `data:` prefix a client may have left on. */
function decodeBase64(input: string): ArrayBuffer {
  const comma = input.indexOf(',');
  const raw = input.startsWith('data:') && comma > -1 ? input.slice(comma + 1) : input;
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
