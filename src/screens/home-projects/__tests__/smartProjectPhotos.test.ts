/**
 * How a member's per-photo note reaches the model.
 *
 * The mechanism is a numbered block appended to `description`, because the
 * photos are sent as image blocks in `photo_keys` order ahead of the text — so
 * "Photo 3" and the third image the model sees are the same picture with no new
 * wire format and no version skew against a Worker that has not shipped a
 * `photo_notes` field.
 *
 * That makes the NUMBERING the whole contract, and it is exactly what breaks
 * silently: if an upload fails and the caller numbers against the photos it
 * tried rather than the ones that landed, every note after the failure points
 * at the wrong picture, the request still succeeds, and the plan comes back
 * describing the wrong wall with no error anywhere. The wizard's job is to pass
 * only the photos that uploaded; this module's job is to number whatever it is
 * given, contiguously, from one.
 */
import {
  composeSmartDraftDescription,
  MAX_DESCRIPTION_CHARS,
  SMART_PROJECT_MAX_PHOTOS,
  type DraftPhoto,
} from '../smartProjectPhotos';

function photo(overrides: Partial<DraftPhoto> = {}): DraftPhoto {
  return {
    id: 'p1',
    uri: 'file:///tmp/p1.jpg',
    width: 2048,
    height: 1536,
    mime: 'image/jpeg',
    source: 'camera',
    ...overrides,
  };
}

const DESCRIPTION =
  'I have a shed with a roof and a concrete floor but the inside is bare frame.';

describe('the description sent for generation', () => {
  it('is the member’s own words when nothing is annotated', () => {
    expect(composeSmartDraftDescription(DESCRIPTION, [])).toBe(DESCRIPTION);
    expect(
      composeSmartDraftDescription(DESCRIPTION, [photo(), photo({ id: 'p2' })]),
    ).toBe(DESCRIPTION);
  });

  it('trims, so a trailing newline from the textarea is not sent as content', () => {
    expect(composeSmartDraftDescription(`  ${DESCRIPTION}\n\n`, [])).toBe(DESCRIPTION);
  });

  it('numbers a note by its position among ALL the photos, not among the notes', () => {
    const out = composeSmartDraftDescription(DESCRIPTION, [
      photo({ id: 'a' }),
      photo({ id: 'b' }),
      photo({ id: 'c', note: 'damp patch under the window' }),
    ]);
    // The model receives three images; this one is the third.
    expect(out).toContain('Photo 3: damp patch under the window');
    expect(out).not.toContain('Photo 1');
  });

  it('lists several in the order the member arranged them', () => {
    const out = composeSmartDraftDescription(DESCRIPTION, [
      photo({ id: 'a', note: 'north wall' }),
      photo({ id: 'b' }),
      photo({ id: 'c', note: 'the old consumer unit' }),
    ]);
    expect(out.indexOf('Photo 1: north wall')).toBeGreaterThan(-1);
    expect(out.indexOf('Photo 3: the old consumer unit')).toBeGreaterThan(
      out.indexOf('Photo 1: north wall'),
    );
    // Un-annotated photos are not mentioned: saying "(no note)" spends the
    // budget on nothing and invites the model to remark on the absence.
    expect(out).not.toContain('Photo 2');
  });

  /**
   * The failed-upload case, stated as the wizard experiences it.
   *
   * Photo 2 of three did not upload, so the model is sent images 1 and 3 as its
   * first and second. Handed only what landed, the numbering follows the model's
   * view — which is the only view that matters.
   */
  it('renumbers from one when the caller passes only what uploaded', () => {
    const all = [
      photo({ id: 'a', note: 'north wall' }),
      photo({ id: 'b', note: 'ceiling' }),
      photo({ id: 'c', note: 'the old consumer unit' }),
    ];
    const landed = [all[0]!, all[2]!];
    const out = composeSmartDraftDescription(DESCRIPTION, landed);
    expect(out).toContain('Photo 1: north wall');
    expect(out).toContain('Photo 2: the old consumer unit');
    expect(out).not.toContain('Photo 3');
    expect(out).not.toContain('ceiling');
  });

  it('ignores a note that is only whitespace', () => {
    expect(
      composeSmartDraftDescription(DESCRIPTION, [photo({ note: '   \n ' })]),
    ).toBe(DESCRIPTION);
  });
});

describe('the 4000-character server limit', () => {
  /**
   * The route rejects an over-long description outright rather than truncating,
   * so overflowing it does not cost the member a note — it costs them the whole
   * generation. The member's own words are never what gets dropped.
   */
  it('never returns more than the server accepts', () => {
    const long = 'x'.repeat(MAX_DESCRIPTION_CHARS - 40);
    const photos = Array.from({ length: SMART_PROJECT_MAX_PHOTOS }, (_, i) =>
      photo({ id: `p${i}`, note: `a note about wall number ${i} in this room` }),
    );
    const out = composeSmartDraftDescription(long, photos);
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    expect(out.startsWith(long)).toBe(true);
  });

  it('appends nothing at all rather than a header with no notes under it', () => {
    const long = 'x'.repeat(MAX_DESCRIPTION_CHARS - 5);
    const out = composeSmartDraftDescription(long, [
      photo({ note: 'this cannot possibly fit' }),
    ]);
    expect(out).toBe(long);
    expect(out).not.toContain('What to look at');
  });

  it('keeps the notes that DO fit and stops at the first that does not', () => {
    // 100 characters of room. The header takes 41 of them and the first note
    // 20, so the second — 57 characters — is the one that cannot fit.
    const long = 'x'.repeat(MAX_DESCRIPTION_CHARS - 100);
    const out = composeSmartDraftDescription(long, [
      photo({ id: 'a', note: 'north wall' }),
      photo({ id: 'b', note: 'a very much longer note that will not fit at all' }),
    ]);
    expect(out).toContain('Photo 1: north wall');
    expect(out).not.toContain('Photo 2');
    expect(out.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
  });
});

describe('the shared photo cap', () => {
  /**
   * The client, the route validator and the generator's own slice all read this
   * one constant. They were three independent `8`s before, and a client that
   * offered more than the route accepted would not have lost the extra photos —
   * `z.array().max()` rejects the whole body, so the member would have lost the
   * generation.
   */
  it('is the contract value, not a client-side copy of it', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const contracts = require('@symply/contracts') as {
      SMART_PROJECT_MAX_PHOTOS: number;
    };
    expect(SMART_PROJECT_MAX_PHOTOS).toBe(contracts.SMART_PROJECT_MAX_PHOTOS);
    expect(SMART_PROJECT_MAX_PHOTOS).toBe(10);
  });
});
