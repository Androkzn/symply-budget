/**
 * The photos a member attaches on step 3 of Smart Project — what one IS, how it
 * gets small enough to send, and how its note reaches the model.
 *
 * Split out of the wizard because all three of those are decisions rather than
 * rendering, and two of them are only observable in the result: a photo that
 * was not shrunk costs the member a timeout on a phone connection, and a note
 * that did not make it into the prompt produces a plan that ignores the one
 * thing they pointed at.
 *
 * ## The two sizes, and why there are two
 *
 * A photo taken here is used twice, for different readers:
 *
 *  - **the model**, once, over the wire — `toVisionSafeAttachment` caps it at
 *    1568px/JPEG 0.8, because that is the resolution above which a vision model
 *    gains nothing and a BYOK request starts hitting its ceiling.
 *  - **the member and their household**, for as long as the project lives —
 *    `normalizeAttachmentImage` caps it at 2048px/JPEG 0.85, because this one
 *    is opened full-screen on a retina phone to look at a tile edge, and on a
 *    local-first household every other member downloads and decrypts it.
 *
 * So the import step normalises ONCE to the larger of the two and everything
 * downstream shrinks from there. The camera original — 3–8 MB of HEIC that
 * `<Image>` cannot even render — never leaves this function.
 */
import { normalizeAttachmentImage } from '@utils/attachmentImage';

/** The shared client/server cap. Re-exported so the wizard imports one name. */
export { SMART_PROJECT_MAX_PHOTOS } from '@symply/contracts';

/**
 * One photo on the step, from the moment it is picked to the moment the project
 * is created.
 *
 * `id` is local and exists only so the grid has a stable key across edits: the
 * `uri` changes every time the member rotates or crops, and keying on it would
 * remount the tile and lose its position mid-gesture.
 */
export interface DraftPhoto {
  id: string;
  /** Current bytes — replaced by each save from the editor. */
  uri: string;
  width: number;
  height: number;
  /** Always `image/jpeg`: the import re-encodes, so HEIC never survives it. */
  mime: 'image/jpeg';
  /**
   * The member's own words about what to look at. Optional, and the reason the
   * editor has a text field at all — see `composeSmartDraftDescription`.
   */
  note?: string;
  /** Where it came from, for the analytics event only. Never shown. */
  source: 'camera' | 'library' | 'files' | 'drive';
}

let photoSeq = 0;

/**
 * Picked bytes → a `DraftPhoto`, at a size the rest of the flow can afford.
 *
 * Throws on an unreadable file rather than returning null: every caller is
 * already inside a try/catch that tells the member which source failed, and a
 * silent null there would drop a photo from the grid with no explanation.
 */
export async function importDraftPhoto(
  uri: string,
  source: DraftPhoto['source'],
): Promise<DraftPhoto> {
  const normalized = await normalizeAttachmentImage(uri);
  photoSeq += 1;
  return {
    id: `p${photoSeq}`,
    uri: normalized.uri,
    width: normalized.width,
    height: normalized.height,
    mime: normalized.mime,
    source,
  };
}

/**
 * The server's own limit on `description`. Mirrored rather than imported as a
 * schema, because what is needed here is the number to budget against.
 */
export const MAX_DESCRIPTION_CHARS = 4000;

/**
 * Fold the members' per-photo notes into the description the model reads.
 *
 * ## Why here and not in a new request field
 *
 * The photos are sent as image blocks in `photo_keys` order, ahead of the text.
 * So "photo 3" in the prose and the third image the model sees are the same
 * picture, with no new wire format, no route change and no version skew between
 * a client that sends notes and a Worker that does not yet read them. A
 * `photo_notes[]` field would be tidier on paper and would be silently dropped
 * by every Worker deployed today — which is the failure mode where the member
 * types a note, sees no error, and gets a plan that ignored it.
 *
 * ## Why only annotated photos are listed
 *
 * The prompt already tells the model how many photos are attached. Listing the
 * un-annotated ones as "(no note)" would spend the description's budget saying
 * nothing, and invites a model to remark on the absence.
 *
 * ## The budget
 *
 * `description` is capped at 4000 characters server-side and the whole request
 * is rejected past it — not truncated. The member's own words are never the
 * thing that gets cut: notes are appended while they fit and dropped when they
 * do not, so the worst case is a plan that ignores the last note rather than a
 * generation that fails outright.
 */
export function composeSmartDraftDescription(
  description: string,
  photos: readonly DraftPhoto[],
): string {
  const base = description.trim();
  const annotated = photos
    .map((photo, index) => ({ index: index + 1, note: photo.note?.trim() }))
    .filter((entry): entry is { index: number; note: string } => !!entry.note);

  if (!annotated.length) return base;

  const header = '\n\nWhat to look at in the attached photos:';
  let out = base + header;
  for (const entry of annotated) {
    const line = `\nPhoto ${entry.index}: ${entry.note}`;
    if (out.length + line.length > MAX_DESCRIPTION_CHARS) break;
    out += line;
  }
  // Every note overflowed — the header alone would be a promise the body does
  // not keep, so nothing is appended at all.
  return out === base + header ? base : out;
}
