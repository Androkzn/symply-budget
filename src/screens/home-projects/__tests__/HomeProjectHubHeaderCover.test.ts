/**
 * Which attachment stands in for the project beside its name in the hub header.
 *
 * Worth its own suite because the two backends address the bytes differently and
 * NEITHER can render the other's: a server-backed row carries a `url`, a
 * local-first one a sealed `blob` only `HouseBlobImage` opens. Picking a row
 * with neither — a photo still uploading, or a `cover_attachment_id` left
 * dangling by the column's missing foreign key — puts a permanent hole in the
 * header, and nothing else in the codebase would notice.
 */
import type { HomeProjectAttachment } from '@api/home-projects';

import { pickProjectCoverAttachment } from '../HomeProjectHubScreen';

function attachment(over: Partial<HomeProjectAttachment>): HomeProjectAttachment {
  return {
    id: 'hpa_1',
    project_id: 'hp_1',
    selection_id: null,
    kind: 'photo',
    filename: null,
    content_type: 'image/jpeg',
    status: 'ready',
    ...over,
  };
}

describe('the hub header’s cover photo', () => {
  it('prefers the project’s chosen cover over any other photo', () => {
    const chosen = attachment({ id: 'hpa_cover', url: 'https://r2/cover.jpg' });
    const other = attachment({ id: 'hpa_other', url: 'https://r2/other.jpg' });
    expect(pickProjectCoverAttachment('hpa_cover', [other, chosen])).toBe(chosen);
  });

  it('falls back to the first ready photo when no cover was ever chosen', () => {
    const first = attachment({ id: 'hpa_1', url: 'https://r2/1.jpg' });
    const second = attachment({ id: 'hpa_2', url: 'https://r2/2.jpg' });
    expect(pickProjectCoverAttachment(null, [first, second])).toBe(first);
  });

  /**
   * `cover_attachment_id` is a bare `text` column with no `references()`, so it
   * outlives the attachment it names. Rendering that id would leave a hole in
   * the header rather than the photo the project does still have.
   */
  it('falls back rather than honour a dangling cover id', () => {
    const photo = attachment({ id: 'hpa_live', url: 'https://r2/live.jpg' });
    expect(pickProjectCoverAttachment('hpa_deleted', [photo])).toBe(photo);
  });

  it('takes a local-first sealed blob as an address, the same as a url', () => {
    const sealed = attachment({
      id: 'hpa_blob',
      url: null,
      blob: { blobId: 'blob_1' } as HomeProjectAttachment['blob'],
    });
    expect(pickProjectCoverAttachment(null, [sealed])).toBe(sealed);
  });

  it('skips an attachment that is not ready yet, cover or not', () => {
    const uploading = attachment({ id: 'hpa_cover', status: 'uploading', url: null });
    const ready = attachment({ id: 'hpa_ready', url: 'https://r2/ready.jpg' });
    expect(pickProjectCoverAttachment('hpa_cover', [uploading, ready])).toBe(ready);
    expect(pickProjectCoverAttachment('hpa_cover', [uploading])).toBeNull();
  });

  it('skips a ready row with no address at all', () => {
    const addressless = attachment({ id: 'hpa_nowhere', url: null, blob: null });
    expect(pickProjectCoverAttachment(null, [addressless])).toBeNull();
  });

  /**
   * The fallback is scoped to `kind === 'photo'`: a material's product shot or a
   * scanned receipt is an attachment on the project too, and neither is what the
   * member means by "this project".
   */
  it('never falls back to a non-photo attachment', () => {
    const receipt = attachment({ id: 'hpa_doc', kind: 'document', url: 'https://r2/r.pdf' });
    expect(pickProjectCoverAttachment(null, [receipt])).toBeNull();
  });

  it('honours an explicitly chosen cover even when it is not a photo', () => {
    // The picker only ever offers photos; this asserts the id, once set, is
    // trusted rather than second-guessed by the fallback's `kind` filter.
    const doc = attachment({ id: 'hpa_doc', kind: 'document', url: 'https://r2/r.pdf' });
    expect(pickProjectCoverAttachment('hpa_doc', [doc])).toBe(doc);
  });

  it('returns null for a project with no attachments', () => {
    expect(pickProjectCoverAttachment(null, [])).toBeNull();
  });
});
