/**
 * Migration 0164's eight columns, end to end — the middle of the pipe.
 *
 * Everything around these columns already existed and none of it did anything:
 * the prompts ASKED for the colour, the repeat size and the sale; the
 * normalizers UNDERSTOOD the answer; the card knew how to DRAW it;
 * `materialFromSelection` knew how to put it on a wall. On a server-backed
 * household nothing ever WROTE it, so every one of those parts was dead code
 * from the member's point of view — a shop link importing a discounted 12x24
 * porcelain produced a row with no colour, no repeat and no offer, and the
 * member re-typed by hand what the page had already stated.
 *
 * These tests are about the write, and about the two things that must not come
 * with it:
 *
 *  1. Every client that exists today predates all eight columns. A body without
 *     them has to keep behaving byte for byte.
 *  2. A sale must never become the estimate. `unit_price_cents` stays the only
 *     money a takeoff or a budget line reads.
 *
 * The sale cases are grounded in the two shelf tags in
 * `src/screens/home-projects/__tests__/shelfTagFixtures.test.ts`, photographed
 * at one tile shop and differing in exactly the way that matters: both show a
 * second, lower price and only one of them is a sale.
 */
import { env } from 'cloudflare:test';
import {
  mergeListingIntoDraft,
  type RawMaterialListing,
  type SelectionDraft,
} from '@symply/contracts';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import homeProjectsRouter from '../home-projects';

import { createHomeProjectTables } from './home-projects.test';

const testEnv = env as unknown as Env;

const HID = 'hh_hp_mat_persist';
const UID = 'u_hp_mat_persist_owner';
const MID = 'm_hp_mat_persist_owner';

/** Exactly the 0164 columns, as they read back off a D1 row. */
type PersistedMaterial = {
  id: string;
  name: string;
  version: number;
  qty: number;
  unit_price_cents: number | null;
  vendor: string | null;
  notes: string | null;
  color_hex: string | null;
  grout_color_hex: string | null;
  unit_w_mm: number | null;
  unit_h_mm: number | null;
  list_price_cents: number | null;
  sale_price_cents: number | null;
  discount_pct: number | null;
  sale_ends_at: string | null;
};

type BudgetLine = {
  id: string;
  label: string;
  category: string;
  estimate_cents: number;
  selection_id: string | null;
};

type Hub = {
  selections: PersistedMaterial[];
  budget_lines: BudgetLine[];
};

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum'
  );
  return new jose.SignJWT({
    sub: userId,
    email: `${userId}@example.com`,
    email_verified: true,
  } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/households/:householdId/home-projects', homeProjectsRouter);
  app.onError((error, c) => {
    const named = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
    ];
    if (named.includes((error as Error).name)) {
      const e = error as unknown as {
        code: string;
        message: string;
        statusCode: number;
      };
      return c.json(
        { error: { code: e.code, message: e.message } },
        e.statusCode as 400 | 401 | 403 | 404 | 409
      );
    }
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
  });
  return app;
}

async function seedHousehold(): Promise<void> {
  const db = drizzle(testEnv.DB);
  await db.insert(schema.users).values({
    id: UID,
    email: `${UID}@example.com`,
    email_verified: true,
  });
  await db.insert(schema.households).values({ id: HID, name: 'Materials House' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: new Date().toISOString(),
  });
}

/**
 * A `RawMaterialListing` with every field the type requires, defaulted to the
 * "page said nothing" value, so a fixture states only the facts under test.
 */
function listing(partial: Partial<RawMaterialListing>): RawMaterialListing {
  return {
    name: null,
    brand: null,
    vendor: null,
    sku: null,
    price_amount: null,
    price_currency: 'USD',
    price_basis: null,
    coverage_per_unit: null,
    coverage_unit: null,
    dimensions: null,
    pieces_per_unit: null,
    price_per_area_amount: null,
    price_per_area_unit: null,
    availability: null,
    image_url: null,
    category: null,
    specs: [],
    confidence: 'high',
    ...partial,
  };
}

/**
 * Tag A — "Retail Price $7.13 / SF" over "Trade Price $4.28 / SF".
 *
 * The trade price is deliberately absent from the offer fields: a professional
 * rate is not a discount, and the classification happens at extraction time
 * because nothing downstream can recover it. The 12X24 lives inside the product
 * NAME, which is the commonest layout in a tile shop.
 */
const TAG_A_DANIEL_BLANC = listing({
  name: 'DANIEL BLANC 12X24 MATTE',
  vendor: 'Capital Tile + Stone',
  price_amount: 7.13,
  price_basis: 'sqft',
  color_hex: '#efece6',
  unit_size_w: 12,
  unit_size_h: 24,
  unit_size_unit: 'in',
  list_price_amount: null,
  sale_price_amount: null,
  sale_discount_pct_stated: null,
  sale_ends_at: null,
});

/** Tag B — "RETAIL: $14.42 Sq. Ft." over "NOW: $5.98 Sq. Ft.", printed in red. */
const TAG_B_LONDON_SOHO = listing({
  name: 'LONDON SOHO 8X8 MT',
  vendor: 'Capital Tile + Stone',
  price_amount: 5.98,
  price_basis: 'sqft',
  color_hex: '#2f4f6b',
  grout_color_hex: '#d9d4cc',
  unit_size_w: 8,
  unit_size_h: 8,
  unit_size_unit: 'in',
  list_price_amount: 14.42,
  sale_price_amount: 5.98,
  sale_discount_pct_stated: null,
  sale_ends_at: null,
});

/** What a shelf-tag read turns into, minus the URL a photo cannot have. */
function draftFor(raw: RawMaterialListing): Omit<SelectionDraft, 'productUrl'> {
  const base: SelectionDraft = {
    name: raw.name?.trim() || 'Unnamed shelf tag',
    productUrl: '',
    extractionSource: 'shelf_tag_ai',
  };
  const { productUrl: _productUrl, ...draft } = mergeListingIntoDraft(
    base,
    raw,
    '',
    'USD'
  );
  return draft;
}

describe('home project material appearance + offer persistence (migration 0164)', () => {
  let app: Hono<{ Bindings: Env }>;
  let token: string;
  let projectId: string;

  async function call(path: string, init?: RequestInit): Promise<Response> {
    return app.request(
      `/households/${HID}/home-projects${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init?.headers as Record<string, string> | undefined),
        },
      },
      testEnv
    );
  }

  async function json<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  async function hub(): Promise<Hub> {
    return json<Hub>(await call(`/${projectId}/hub`));
  }

  async function createSelection(
    body: Record<string, unknown>
  ): Promise<Response> {
    return call(`/${projectId}/selections`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** The row as D1 actually holds it, not as a service re-derived it. */
  async function rowById(id: string): Promise<PersistedMaterial> {
    const row = await testEnv.DB.prepare(
      `SELECT id, name, version, qty, unit_price_cents, vendor, notes,
              color_hex, grout_color_hex, unit_w_mm, unit_h_mm,
              list_price_cents, sale_price_cents, discount_pct, sale_ends_at
         FROM home_project_selections WHERE id = ?`
    )
      .bind(id)
      .first<PersistedMaterial>();
    if (!row) throw new Error(`selection ${id} not found`);
    return row;
  }

  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await createHomeProjectTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedHousehold();
    app = mkApp();
    token = await mintToken(UID);
    const res = await call('', {
      method: 'POST',
      body: JSON.stringify({ templateKey: 'blank', title: 'Materials project' }),
    });
    ({
      project: { id: projectId },
    } = await json<{ project: { id: string } }>(res));
  });

  it('round-trips all eight columns out of D1', async () => {
    // The bug this whole file exists for: before this change the route accepted
    // none of these keys and the service wrote none of these columns, so a
    // member who imported a discounted tile got a row with no colour, no repeat
    // size and no offer — and re-typed by hand what the page had stated.
    const res = await createSelection({
      name: 'London Soho 8x8',
      unitPriceCents: 598,
      colorHex: '#2f4f6b',
      groutColorHex: '#d9d4cc',
      unitWMm: 203.2,
      unitHMm: 203.2,
      listPriceCents: 1442,
      salePriceCents: 598,
      discountPct: 59,
      saleEndsAt: '2026-09-30',
    });
    expect(res.status).toBe(201);
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    const stored = await rowById(selection.id);
    expect(stored.color_hex).toBe('#2f4f6b');
    expect(stored.grout_color_hex).toBe('#d9d4cc');
    expect(stored.unit_w_mm).toBe(203.2);
    expect(stored.unit_h_mm).toBe(203.2);
    expect(stored.list_price_cents).toBe(1442);
    expect(stored.sale_price_cents).toBe(598);
    expect(stored.discount_pct).toBe(59);
    expect(stored.sale_ends_at).toBe('2026-09-30');

    // And they come back on the read path, or the card still cannot draw them.
    const fromHub = (await hub()).selections.find((s) => s.id === selection.id);
    expect(fromHub?.color_hex).toBe('#2f4f6b');
    expect(fromHub?.unit_w_mm).toBe(203.2);
    expect(fromHub?.discount_pct).toBe(59);
  });

  it('still accepts a body that names none of the eight', async () => {
    // Every client in the field predates migration 0164, and a released mobile
    // build cannot be recalled. If widening the schema made any of these
    // required — or made their absence mean anything but NULL — every existing
    // app would start 400ing on the one action this screen is for.
    const res = await createSelection({ name: 'Hand-typed paint', qty: 2 });
    expect(res.status).toBe(201);
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    const stored = await rowById(selection.id);
    expect(stored.name).toBe('Hand-typed paint');
    expect(stored.color_hex).toBeNull();
    expect(stored.grout_color_hex).toBeNull();
    expect(stored.unit_w_mm).toBeNull();
    expect(stored.unit_h_mm).toBeNull();
    expect(stored.list_price_cents).toBeNull();
    expect(stored.sale_price_cents).toBeNull();
    expect(stored.discount_pct).toBeNull();
    expect(stored.sale_ends_at).toBeNull();
  });

  it('rejects a malformed hex instead of storing it', async () => {
    // A colour that fails `materialSchema`'s strict `^#[0-9a-fA-F]{6}$` does not
    // cost the member one wrong swatch: `parseRoomSurfaceModel` returns null for
    // the WHOLE document, so a single bad row opens an empty room editor. The
    // cheapest place to stop that is the door.
    const res = await createSelection({
      name: 'Bad colour tile',
      colorHex: 'rebeccapurple',
    });
    expect(res.status).toBe(400);

    // And nothing partial was written on the way to the rejection.
    expect((await hub()).selections).toHaveLength(0);
  });

  it('widens a shorthand hex rather than rejecting or storing it raw', async () => {
    // Models emit `#FFF` despite the instruction, and it is unambiguous. What
    // must never reach the column is the shorthand itself, because the room
    // model's regex would then fail on a colour the member legitimately chose.
    const res = await createSelection({ name: 'White trim', colorHex: '#FFF' });
    expect(res.status).toBe(201);
    const { selection } = await json<{ selection: PersistedMaterial }>(res);
    expect((await rowById(selection.id)).color_hex).toBe('#ffffff');
  });

  it('rejects a discount outside 0-100', async () => {
    // The value is rendered as "save N%" on the card. A negative badges a price
    // RISE as a saving; over 100 claims the shop pays the member to take the
    // tile. Both are numbers a stale retail badge really does produce.
    for (const discountPct of [-5, 140]) {
      const res = await createSelection({ name: 'Impossible deal', discountPct });
      expect(res.status).toBe(400);
    }
    expect((await hub()).selections).toHaveLength(0);
  });

  it('rejects a repeat size past the room model own bound', async () => {
    // 10 m is past any real tile or plank, so a bigger number came from a
    // misread coverage figure. Accepting it here only moves the failure into the
    // Room Surface Model, where it costs the member the whole room document
    // instead of one field.
    const res = await createSelection({ name: 'Impossible plank', unitWMm: 12_000 });
    expect(res.status).toBe(400);
  });

  it('rejects a sale end date that is not a real calendar date', async () => {
    // "2026-02-31" passes a shape check and `Date` rolls it forward to 3 March.
    // The column is read back as a countdown shown to the member, so a garbage
    // date there is a countdown to nothing.
    const res = await createSelection({
      name: 'Sale that never ends',
      saleEndsAt: '2026-02-31',
    });
    expect(res.status).toBe(400);
  });

  it('patches the offer without clobbering the colour, the price or the notes', async () => {
    // The failure guarded: a patch built by spreading `?? null` blanks every
    // column the caller did not mention, so extending a sale would silently
    // erase the colour the member eyedropped and the note they typed. Each new
    // column is guarded on `!== undefined` for exactly this.
    const created = await createSelection({
      name: 'London Soho 8x8',
      unitPriceCents: 598,
      vendor: 'Capital Tile + Stone',
      notes: 'Bathroom floor candidate',
      colorHex: '#2f4f6b',
      unitWMm: 203.2,
      unitHMm: 203.2,
      listPriceCents: 1442,
      salePriceCents: 598,
      discountPct: 59,
    });
    const { selection } = await json<{ selection: PersistedMaterial }>(created);

    const patched = await call(`/${projectId}/selections/${selection.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ saleEndsAt: '2026-10-15', discountPct: 60 }),
    });
    expect(patched.status).toBe(200);

    const stored = await rowById(selection.id);
    expect(stored.sale_ends_at).toBe('2026-10-15');
    expect(stored.discount_pct).toBe(60);
    // Untouched by a patch that never named them.
    expect(stored.color_hex).toBe('#2f4f6b');
    expect(stored.unit_w_mm).toBe(203.2);
    expect(stored.list_price_cents).toBe(1442);
    expect(stored.unit_price_cents).toBe(598);
    expect(stored.vendor).toBe('Capital Tile + Stone');
    expect(stored.notes).toBe('Bathroom floor candidate');
  });

  it('clears a colour on an explicit null, and only on an explicit null', async () => {
    // Absent and null have to mean different things: absent is "this client
    // predates the column", null is "the member cleared a wrong colour". If they
    // collapsed, either existing clients break or a bad swatch is permanent.
    const created = await createSelection({
      name: 'Mis-read swatch',
      colorHex: '#123456',
      unitWMm: 304.8,
      unitHMm: 609.6,
    });
    const { selection } = await json<{ selection: PersistedMaterial }>(created);

    const cleared = await call(`/${projectId}/selections/${selection.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ colorHex: null }),
    });
    expect(cleared.status).toBe(200);

    const stored = await rowById(selection.id);
    expect(stored.color_hex).toBeNull();
    expect(stored.unit_w_mm).toBe(304.8);
    expect(stored.unit_h_mm).toBe(609.6);
  });

  it('estimates from unit_price_cents, never from the sale or list price', async () => {
    /*
      THE decision this feature turns on, pinned.

      Tag B is a real markdown: RETAIL $14.42 → NOW $5.98 per square foot. The
      estimate must be built from $5.98, because that is what the member pays at
      the till today — and it gets there through `unit_price_cents`, which both
      importers already fill with the price the page charges now.

      The two ways to get it wrong, and why neither is chosen:
        - estimating from `list_price_cents` ($14.42) over-quotes the member out
          of a purchase they can actually make;
        - estimating from `sale_price_cents` is right until the sale ends and
          then permanently wrong, because a stored number nobody re-reads keeps
          quoting a price the shop withdrew. "You have $3,000 left" computed
          from a price the member cannot transact at is the failure the split
          exists to prevent.

      So the offer columns are descriptive and `unit_price_cents` is the money.
    */
    const res = await createSelection({
      name: 'London Soho 8x8',
      qty: 3,
      unitPriceCents: 598,
      listPriceCents: 1442,
      salePriceCents: 598,
      discountPct: 59,
    });
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    const stored = await rowById(selection.id);
    // The sale did NOT overwrite the estimate price, and did not shadow it.
    expect(stored.unit_price_cents).toBe(598);
    expect(stored.list_price_cents).toBe(1442);

    const line = (await hub()).budget_lines.find(
      (l) => l.selection_id === selection.id
    );
    // 598 x 3 = 1794. From the list price it would be 4326 — a $25 over-quote
    // on three square feet, and proportionally on a whole floor.
    expect(line?.estimate_cents).toBe(1794);
  });

  it('does not invent an estimate price from a sale price alone', async () => {
    // A body carrying the offer but no `unitPriceCents` describes a deal whose
    // transactable price was never stated. Filling `unit_price_cents` from
    // `sale_price_cents` would put a number in the budget that expires with the
    // promotion; no line at all is the honest answer, and it is what a priced-
    // less selection has always produced.
    const res = await createSelection({
      name: 'Offer with no price',
      listPriceCents: 1442,
      salePriceCents: 598,
      discountPct: 59,
    });
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    expect((await rowById(selection.id)).unit_price_cents).toBeNull();
    expect(
      (await hub()).budget_lines.filter((l) => l.selection_id === selection.id)
    ).toHaveLength(0);
  });

  it('persists NO offer for Tag A, where the second price is a TRADE price', async () => {
    /*
      Capital Tile + Stone, "Retail Price $7.13 / SF" over "Trade Price
      $4.28 / SF". A 40% gap that reads exactly like a promotion and is not one:
      it is the rate a contractor with an account pays.

      Badging it misleads the member twice — once on the card, and again in an
      estimate built from a price they cannot transact at. The classification
      happens at extraction time, and this asserts the whole chain honours it:
      merge → route → column.
    */
    const draft = draftFor(TAG_A_DANIEL_BLANC);
    const res = await createSelection({ ...draft, status: 'idea' });
    expect(res.status).toBe(201);
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    const stored = await rowById(selection.id);
    expect(stored.list_price_cents).toBeNull();
    expect(stored.sale_price_cents).toBeNull();
    expect(stored.discount_pct).toBeNull();
    expect(stored.sale_ends_at).toBeNull();
    // The retail price is the price, and it is the one the estimate uses.
    expect(stored.unit_price_cents).toBe(713);
    // Appearance survives even though there is no offer — they are independent
    // facts and a tile with no sale still has to be drawable.
    expect(stored.color_hex).toBe('#efece6');
    expect(stored.unit_w_mm).toBe(304.8);
    expect(stored.unit_h_mm).toBe(609.6);
  });

  it('persists a 59% offer for Tag B, where the second price IS a sale', async () => {
    // The other half of the pair: RETAIL $14.42 → NOW $5.98 is 58.5%, rounded to
    // 59. The percentage is derived from the two prices rather than copied off a
    // badge, because a "60% OFF" banner outliving its sale is one of the
    // commonest stale facts in retail. A model that treats "lower second number"
    // as "sale" gets Tag A wrong and this one right, and looks correct either
    // way in isolation — which is why the two are asserted together.
    const draft = draftFor(TAG_B_LONDON_SOHO);
    const res = await createSelection({ ...draft, status: 'idea' });
    expect(res.status).toBe(201);
    const { selection } = await json<{ selection: PersistedMaterial }>(res);

    const stored = await rowById(selection.id);
    expect(stored.list_price_cents).toBe(1442);
    expect(stored.sale_price_cents).toBe(598);
    expect(stored.discount_pct).toBe(59);
    // Neither tag printed an end date, and none was invented.
    expect(stored.sale_ends_at).toBeNull();
    // Mirrors, does not replace.
    expect(stored.unit_price_cents).toBe(598);
    expect(stored.color_hex).toBe('#2f4f6b');
    expect(stored.grout_color_hex).toBe('#d9d4cc');
    expect(stored.unit_w_mm).toBe(203.2);
    expect(stored.unit_h_mm).toBe(203.2);
  });

  it('carries a stringified coverage through the merge as a number', async () => {
    // `"23.8" > 0` is true in JavaScript, so a quoted coverage passed the merge's
    // own gate and landed in a field typed `number` with no compiler complaint.
    // It then reached the takeoff: `"23.8" * 2` is 47.6 and looks right, while
    // `"23.8" + 2` is `"23.82"` and does not — the member's box count depended on
    // which operator the estimate happened to use.
    const draft = draftFor(
      listing({
        ...TAG_A_DANIEL_BLANC,
        price_basis: 'box',
        coverage_per_unit: '23.8' as unknown as number,
        coverage_unit: 'sqft',
      })
    );
    expect(typeof draft.coveragePerUnit).toBe('number');
    expect(draft.coveragePerUnit).toBe(23.8);

    const res = await createSelection({ ...draft, status: 'idea' });
    expect(res.status).toBe(201);
  });

  it('carries a stringified repeat size through the merge as millimetres', async () => {
    // Tag A's size lives inside its name — "DANIEL BLANC 12X24 MATTE" — which is
    // precisely the value a provider is most likely to hand back quoted. Dropped
    // silently, it left the material with no repeat, and a preview with no repeat
    // stretches the tile photo to the wall: a room that cannot be built.
    const draft = draftFor(
      listing({
        ...TAG_A_DANIEL_BLANC,
        unit_size_w: '12' as unknown as number,
        unit_size_h: '24' as unknown as number,
      })
    );
    expect(draft.unitWMm).toBe(304.8);
    expect(draft.unitHMm).toBe(609.6);

    const res = await createSelection({ ...draft, status: 'idea' });
    const { selection } = await json<{ selection: PersistedMaterial }>(res);
    const stored = await rowById(selection.id);
    expect(stored.unit_w_mm).toBe(304.8);
    expect(stored.unit_h_mm).toBe(609.6);
  });

  it('carries a stringified stated percentage through the merge as a number', async () => {
    /*
      Plenty of pages advertise "25% off everything" and print only the new
      price, so a stated percentage with no "was" price is a real offer. A quoted
      `"25"` used to be dropped on the floor by the percentage reader, and the
      member saw a full-price card for a discounted tile — silently, with no
      error anywhere.

      The same coercion is what lets the badge CROSS-CHECK fire on a page that
      contradicts its own prices; the arithmetic still wins there, so a member is
      never told 65% when the till will say 59%.
    */
    const draft = draftFor(
      listing({
        ...TAG_A_DANIEL_BLANC,
        sale_discount_pct_stated: '25' as unknown as number,
      })
    );
    expect(draft.discountPct).toBe(25);
    // No "was" price was published, so none is reported — deriving one would
    // print a number the vendor never stated beside a strike-through.
    expect(draft.listPriceCents).toBeNull();

    const res = await createSelection({ ...draft, status: 'idea' });
    const { selection } = await json<{ selection: PersistedMaterial }>(res);
    const stored = await rowById(selection.id);
    expect(stored.discount_pct).toBe(25);
    expect(stored.list_price_cents).toBeNull();
  });
});
