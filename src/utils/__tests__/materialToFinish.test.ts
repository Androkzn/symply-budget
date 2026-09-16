/**
 * Shopping selection → finish material: the bridge that stops a member having
 * to hand-type a colour they already imported.
 *
 * Every assertion below pins a fact whose failure is INVISIBLE on screen, which
 * is why this file exists at all. A finish is a picture a member orders tile
 * against: a fabricated colour renders as a wall they think they chose, a
 * guessed 300 mm repeat draws twice the joints and orders four times the tiles,
 * and a material that fails `materialSchema` does not lose a swatch — it makes
 * `parseRoomSurfaceModel` return null and costs the member the entire room
 * document. None of those announce themselves.
 *
 * Note `packages/**` is outside the root jest roots (see `testPathIgnorePatterns`
 * in `jest.config.js`), so the contract is exercised here, through the same
 * `@symply/contracts` import the app uses.
 */

import {
  finishIdForSelection,
  finishKindForCategory,
  isContinuous,
  materialFromSelection,
  materialSchema,
  type SelectionFinishInput,
} from '@symply/contracts';

/** A tile imported from a shop link with everything migration 0164 added. */
const completeTile: SelectionFinishInput = {
  id: 'sel_tile_1',
  name: 'Calacatta Gold Porcelain',
  category: 'tile',
  color_hex: '#EFEDE6',
  grout_color_hex: '#8a857c',
  unit_w_mm: 600,
  unit_h_mm: 600,
  vendor: 'Tile Depot',
  sku: 'CG-600',
  product_url: 'https://example.test/calacatta-600',
  unit: 'box',
  unit_price_cents: 4599,
};

/** Narrow the union, and fail loudly rather than returning a half-built finish. */
function convert(
  selection: SelectionFinishInput,
  options?: Parameters<typeof materialFromSelection>[1],
) {
  const result = materialFromSelection(selection, options);
  if (!result.ok) {
    throw new Error(
      `Expected a finish, got ${result.reason}: ${result.message}`,
    );
  }
  return result.material;
}

describe('a selection the importer filled in completely', () => {
  /**
   * The whole point of the bridge. Before it, this member had a tile with a
   * colour, a size and a photo in their project and still had to type a hex
   * into the finish editor before a wall stopped rendering as flat grey.
   */
  it('becomes a finish with the colour, size and grout the listing stated', () => {
    const material = convert(completeTile);
    expect(material.colorHex).toBe('#efede6');
    expect(material.unit_w_mm).toBe(600);
    expect(material.unit_h_mm).toBe(600);
    expect(material.groutColorHex).toBe('#8a857c');
    expect(material.kind).toBe('tile');
    expect(material.name).toBe('Calacatta Gold Porcelain');
  });

  /**
   * `parseRoomSurfaceModel` returns null for a document containing ONE invalid
   * material, so an unvalidated finish does not cost a swatch — it costs the
   * whole room. The conversion must therefore never be the thing that lets one
   * through.
   */
  it('produces an object materialSchema.parse accepts', () => {
    expect(() => materialSchema.parse(convert(completeTile))).not.toThrow();
  });

  /**
   * The back-pointer `materialSchema` documents. Without it, promoting this
   * finish back into the budget creates a second line for a purchase the
   * member has already got priced.
   */
  it('keeps a back-pointer to the selection it came from', () => {
    expect(convert(completeTile).selectionId).toBe('sel_tile_1');
  });

  /**
   * Two members tapping the same imported tile onto two walls must upsert one
   * palette entry. Random ids would stack near-identical finishes that the
   * takeoff then groups and prices as separate buys.
   */
  it('derives the same finish id every time, so re-applying does not duplicate', () => {
    expect(convert(completeTile).id).toBe(finishIdForSelection('sel_tile_1'));
    expect(convert(completeTile).id).toBe(convert(completeTile).id);
  });

  /**
   * 'box' is what the listing prints and what the member buys. The kind default
   * for tile is 'tile' — right for a hand-typed finish, wrong for one whose
   * vendor already said otherwise.
   */
  it('takes the purchase unit from the vendor rather than from the kind default', () => {
    expect(convert(completeTile).unitLabel).toBe('box');
    expect(convert(completeTile).unitPriceCents).toBe(4599);
  });
});

describe('a selection with no colour', () => {
  const noColour: SelectionFinishInput = { ...completeTile, color_hex: null };

  /**
   * `colorHex` is REQUIRED by the contract, and its own comment says why: it is
   * what the renderer draws before the texture downloads, offline, and at
   * thumbnail size. A neutral placeholder would satisfy the schema and put a
   * grey rectangle on a wall that looks exactly like a finish the member chose
   * — a lie with no tell. The conversion refuses instead, and the caller
   * prompts with the colour picker that already exists.
   */
  it('refuses rather than inventing a colour the member never picked', () => {
    const result = materialFromSelection(noColour);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('missing_color');
    // The refusal is expressed in the TYPE: there is no `material` to read, so
    // no caller can reach a fabricated colour by forgetting to check `ok`.
    expect('material' in result).toBe(false);
  });

  /** Same refusal when the page's hex is junk — a bad hex is not a colour. */
  it('refuses a malformed hex instead of coercing it to something drawable', () => {
    expect(
      materialFromSelection({ ...completeTile, color_hex: 'ivory' }).ok,
    ).toBe(false);
  });

  /**
   * The importer emits shorthand despite the instruction, and '#fff' is
   * unambiguous — refusing it would send a member to the colour picker for a
   * colour the page did state.
   */
  it('still accepts a shorthand hex, which is a stated colour', () => {
    expect(convert({ ...completeTile, color_hex: '#FFF' }).colorHex).toBe(
      '#ffffff',
    );
  });
});

describe('a selection whose size nobody stated', () => {
  /**
   * `MATERIAL_KIND_DEFAULTS.tile` holds a 300×300 repeat that is right in the
   * editor — where the member sees the number and can change it — and wrong
   * here, where nothing on screen would say the size was assumed. A 600 mm tile
   * drawn at 300 mm shows twice the joints and orders four times the tiles,
   * with total confidence.
   */
  it('yields a non-repeating finish rather than a guessed tile', () => {
    const material = convert({
      ...completeTile,
      unit_w_mm: null,
      unit_h_mm: null,
    });
    expect(material.unit_w_mm).toBeUndefined();
    expect(material.unit_h_mm).toBeUndefined();
    expect(isContinuous(material)).toBe(true);
  });

  /**
   * Both sides or neither, the same rule `normalizeMaterialAppearance` applies
   * to a listing: a page that printed one dimension gives a width with no
   * height, and squaring it invents a tile nobody sells.
   */
  it('discards a half-stated size instead of squaring the side it has', () => {
    const material = convert({ ...completeTile, unit_h_mm: null });
    expect(material.unit_w_mm).toBeUndefined();
    expect(material.unit_h_mm).toBeUndefined();
  });

  /**
   * A joint only exists between repeats. Carrying a 3 mm default with no repeat
   * would fold a phantom joint into `unitFootprintM2` and draw seams across a
   * finish that has none.
   */
  it('carries no joint width when there is nothing to lay out', () => {
    expect(
      convert({ ...completeTile, unit_w_mm: null, unit_h_mm: null }).groutMm,
    ).toBeUndefined();
  });

  /**
   * `coverageM2PerUnit` is m² per PURCHASE unit, and the purchase unit comes
   * from the vendor — a box, a gallon, a roll — not from our category guess.
   * Defaulting paint's 11 m²/L onto a product sold by the gallon under-orders
   * a whole room, so the field stays absent and `quantityGap` asks the member
   * for the one number only the tin can answer.
   */
  it('never invents a coverage figure measured in the vendor’s own units', () => {
    const paint = convert({
      ...completeTile,
      category: 'paint',
      unit: 'gal',
      unit_w_mm: null,
      unit_h_mm: null,
    });
    expect(paint.kind).toBe('paint');
    expect(paint.coverageM2PerUnit).toBeUndefined();
  });

  /** A size past the schema's 10 m ceiling came from a misread page number. */
  it('drops an out-of-range repeat rather than failing the whole room later', () => {
    const material = convert({ ...completeTile, unit_w_mm: 99_000 });
    expect(material.unit_w_mm).toBeUndefined();
    expect(() => materialSchema.parse(material)).not.toThrow();
  });
});

describe('the swatch photo', () => {
  /**
   * The contract holds only the attachment id because resolving it to bytes is
   * backend-specific — a sealed H6 blob on a local-first household, an R2 url
   * otherwise. Dropping the id here would mean an imported tile could only ever
   * render as its fallback colour, no matter how good the photo was.
   */
  it('carries the durable attachment id through to the finish', () => {
    const material = convert(completeTile, { textureAttachmentId: 'att_9' });
    expect(material.textureAttachmentId).toBe('att_9');
    expect(() => materialSchema.parse(material)).not.toThrow();
  });

  /** No attachment is `null`, not a dangling id the resolver would chase. */
  it('is null when the selection has no durable attachment', () => {
    expect(convert(completeTile).textureAttachmentId).toBeNull();
  });
});

describe('grout colour', () => {
  /**
   * A member who read "matte white grout" off the page has stated a fact. Tile
   * joints are a third of what a tiled wall looks like, and a preview drawn
   * with our default warm grey instead is a different room.
   */
  it('carries through when the listing stated one', () => {
    expect(convert(completeTile).groutColorHex).toBe('#8a857c');
  });

  /**
   * With no stated colour the joints still have to be SOME colour, and the
   * kind default is the same one the manual editor fills in — an imported tile
   * and a hand-typed one should draw alike.
   */
  it('falls back to the kind default when the listing stated none', () => {
    const material = convert({ ...completeTile, grout_color_hex: null });
    expect(material.groutColorHex).toBe('#b8b3aa');
  });

  /** A stated grout colour survives even when the tile size did not. */
  it('survives a selection with no repeat size', () => {
    const material = convert({
      ...completeTile,
      unit_w_mm: null,
      unit_h_mm: null,
    });
    expect(material.groutColorHex).toBe('#8a857c');
  });
});

describe('reading the category', () => {
  /**
   * The importer's vocabulary is fixed (`material-listing-prompt.ts`) but
   * members type their own, so an unrecognised word must land on `other` rather
   * than on a guess: `other` costs one chip tap in the editor, a wrong guess
   * silently applies a pattern and a waste percentage nobody chose.
   */
  it('maps the importer’s words and refuses to guess at the rest', () => {
    expect(finishKindForCategory('tile')).toBe('tile');
    expect(finishKindForCategory('Flooring')).toBe('flooring');
    expect(finishKindForCategory('interior paint')).toBe('paint');
    expect(finishKindForCategory('countertop')).toBe('stone');
    expect(finishKindForCategory('lighting')).toBe('other');
    expect(finishKindForCategory(null)).toBe('other');
  });
});

describe('a selection that cannot be a finish at all', () => {
  /**
   * `name` is `min(1)` in the schema. Validating BEFORE returning is what keeps
   * an unnameable finish out of the document — the alternative is a room that
   * silently stops parsing on the next read.
   */
  it('reports the schema issue instead of returning a broken material', () => {
    const result = materialFromSelection({ ...completeTile, name: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('invalid_finish');
    // Narrow on the DISCRIMINANT, not just on `ok`. Both failure members share
    // `ok: false` and only `invalid_finish` carries `issues`, and an `expect`
    // narrows nothing — so without this line the access below is a type error
    // on a test that passes perfectly well at runtime.
    if (result.reason !== 'invalid_finish') throw new Error('unreachable');
    expect(result.issues.join(' ')).toContain('name');
  });
});
