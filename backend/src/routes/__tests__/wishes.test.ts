/**
 * wishes.ts routes — long-term dreams / wishlist with a note/image/link feed.
 *
 * Covers CRUD end-to-end (no R2 required — image ENTRIES are posted with an
 * image_key directly, exercising the cover-adoption logic without an upload):
 *   - POST creates a wish (status defaults to 'active')
 *   - GET lists wishes with entry_count / image_count rollups, filterable by status
 *   - GET /:id returns the ordered entry feed
 *   - POST /entries appends note / link / image; validates each kind
 *   - the first image entry auto-adopts as the wish cover; deleting the cover
 *     promotes the next image (or clears it)
 *   - PATCH updates status (moves the wish between filter buckets)
 *   - DELETE removes the wish AND its whole feed (explicit child delete)
 *   - 403 for a user outside the household
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../db/schema';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import wishesRouter from '../wishes';

import { applyBudgetWorkerTestBrand } from './budget-test-helpers';
import { createWishTables, resetWishTables } from './wishes-test-helpers';

const testEnv = env as unknown as Env;

const HID = 'hh_wishes_01';
const UID = 'u_wishes_owner';
const MID = 'm_wishes_owner';

const OTHER_HID = 'hh_wishes_other';
const OTHER_UID = 'u_wishes_outsider';
const OTHER_MID = 'm_wishes_outsider';

interface WishRow {
  id: string;
  title: string;
  status: string;
  cover_image_key: string | null;
  estimated_cost_cents: number | null;
  entry_count: number;
  image_count: number;
}
interface EntryRow {
  id: string;
  kind: string;
  body: string | null;
  image_key: string | null;
  url: string | null;
  author_id: string | null;
  author_name: string | null;
  parent_entry_id: string | null;
  reply_to: { entry_id: string; author_name: string | null; snippet: string } | null;
}
interface WishDetail extends WishRow {
  created_by_name: string | null;
  entries: EntryRow[];
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
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
  app.route('/households/:householdId/wishes', wishesRouter);
  app.onError((error, c) => {
    const apiErrorNames = [
      'ApiError',
      'ValidationError',
      'UnauthorizedError',
      'ForbiddenError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
    ];
    const errorName = (error as Error).name;
    if (apiErrorNames.includes(errorName)) {
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409 | 429 | 500
      );
    }
    return c.json({ error: { code: 'internal_error', message: error.message } }, 500);
  });
  return app;
}

async function seed(): Promise<void> {
  applyBudgetWorkerTestBrand(testEnv);
  await createCoreTables(testEnv.DB);
  await createWishTables(testEnv.DB);
  await resetAllTables(testEnv.DB);
  await resetWishTables(testEnv.DB);

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'wishes@example.com', email_verified: true, display_name: 'Pat Owner' },
    { id: OTHER_UID, email: 'wishes-outsider@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values([
    { id: HID, name: 'WishesTest' },
    { id: OTHER_HID, name: 'WishesOther' },
  ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
    { id: OTHER_MID, household_id: OTHER_HID, user_id: OTHER_UID, role: 'owner', joined_at: '2025-01-01T00:00:00Z' },
  ]);
}

const app = mkApp();

async function req(path: string, token: string, init?: RequestInit): Promise<Response> {
  return app.request(
    `/households/${HID}/wishes${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } },
    testEnv
  );
}

async function createWish(token: string, body: Record<string, unknown>): Promise<WishRow> {
  const res = await req('', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { wish: WishRow }).wish;
}

async function addEntry(token: string, wishId: string, body: Record<string, unknown>): Promise<Response> {
  return req(`/${wishId}/entries`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let token = '';
let otherToken = '';

beforeEach(async () => {
  await seed();
  token = await mintToken(UID);
  otherToken = await mintToken(OTHER_UID);
});

describe('wishes CRUD', () => {
  it('creates a wish with status defaulting to active', async () => {
    const wish = await createWish(token, { title: 'Buy a boat', estimated_cost_cents: 4200000 });
    expect(wish.title).toBe('Buy a boat');
    expect(wish.status).toBe('active');
    expect(wish.cover_image_key).toBeNull();
  });

  it('lists wishes with entry/image rollups', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'note', body: 'Saw one at the marina' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/a.jpg' });

    const res = await req('', token);
    expect(res.status).toBe(200);
    const { wishes } = (await res.json()) as { wishes: WishRow[] };
    expect(wishes).toHaveLength(1);
    expect(wishes[0].entry_count).toBe(2);
    expect(wishes[0].image_count).toBe(1);
  });

  it('returns a single wish with its ordered feed', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'note', body: 'first' });
    await addEntry(token, wish.id, { kind: 'link', url: 'https://example.com/boat', link_title: 'The one' });

    const res = await req(`/${wish.id}`, token);
    expect(res.status).toBe(200);
    const detail = ((await res.json()) as { wish: WishDetail }).wish;
    expect(detail.entries).toHaveLength(2);
    expect(detail.entries[0].kind).toBe('note');
    expect(detail.entries[1].kind).toBe('link');
    expect(detail.entries[1].url).toBe('https://example.com/boat');
  });

  it('updates status, moving the wish between filter buckets', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const patch = await req(`/${wish.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'achieved' }),
    });
    expect(patch.status).toBe(200);

    const active = (await (await req('?status=active', token)).json()) as { wishes: WishRow[] };
    expect(active.wishes).toHaveLength(0);
    const achieved = (await (await req('?status=achieved', token)).json()) as { wishes: WishRow[] };
    expect(achieved.wishes).toHaveLength(1);
  });

  it('deletes the wish and its whole feed', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'note', body: 'keep dreaming' });

    const del = await req(`/${wish.id}`, token, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const gone = await req(`/${wish.id}`, token);
    expect(gone.status).toBe(404);
    const list = (await (await req('', token)).json()) as { wishes: WishRow[] };
    expect(list.wishes).toHaveLength(0);
  });
});

describe('wishes entry validation', () => {
  it('rejects a note with no text (400)', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const res = await addEntry(token, wish.id, { kind: 'note', body: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a link with no url (400)', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const res = await addEntry(token, wish.id, { kind: 'link', link_title: 'no url' });
    expect(res.status).toBe(400);
  });
});

describe('wishes cover image', () => {
  it('adopts the first image entry as the cover', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/first.jpg' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/second.jpg' });

    const list = (await (await req('', token)).json()) as { wishes: WishRow[] };
    expect(list.wishes[0].cover_image_key).toBe('wishes/x/y/first.jpg');
  });

  it('updates the main photo via PATCH cover_image_key', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/first.jpg' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/second.jpg' });

    const patch = await req(`/${wish.id}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_image_key: 'wishes/x/y/second.jpg' }),
    });
    expect(patch.status).toBe(200);

    const list = (await (await req('', token)).json()) as { wishes: WishRow[] };
    expect(list.wishes[0].cover_image_key).toBe('wishes/x/y/second.jpg');
  });

  it('promotes the next image when the cover entry is deleted', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const first = await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/first.jpg' });
    await addEntry(token, wish.id, { kind: 'image', image_key: 'wishes/x/y/second.jpg' });
    const firstId = ((await first.json()) as { entry: EntryRow }).entry.id;

    const del = await req(`/${wish.id}/entries/${firstId}`, token, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const list = (await (await req('', token)).json()) as { wishes: WishRow[] };
    expect(list.wishes[0].cover_image_key).toBe('wishes/x/y/second.jpg');
  });
});

describe('wishes image upload (R2 round-trip)', () => {
  it('stores a picked image in R2 and returns a key that can back an image entry', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });

    const form = new FormData();
    form.append('image', new File(['\xFF\xD8\xFFfake-jpeg'], 'boat.jpg', { type: 'image/jpeg' }));
    const upload = await req(`/${wish.id}/image`, token, { method: 'POST', body: form });
    expect(upload.status).toBe(201);
    const { image_key } = (await upload.json()) as { image_key: string };
    expect(image_key).toContain(`wishes/${HID}/${wish.id}/`);

    // The object really landed in R2.
    const object = await testEnv.REPORTS_BUCKET.head(image_key);
    expect(object).not.toBeNull();

    // Attaching it as an entry adopts it as the wish cover.
    const entryRes = await addEntry(token, wish.id, { kind: 'image', image_key });
    expect(entryRes.status).toBe(201);
    const list = (await (await req('', token)).json()) as { wishes: WishRow[] };
    expect(list.wishes[0].cover_image_key).toBe(image_key);
    expect(list.wishes[0].image_count).toBe(1);
  });

  it('rejects a non-image upload (400)', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const form = new FormData();
    form.append('image', new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
    const res = await req(`/${wish.id}/image`, token, { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('rejects an upload with no file (400)', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const res = await req(`/${wish.id}/image`, token, { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });
});

describe('wishes collaboration — author attribution', () => {
  it('stamps each entry (and the wish) with the posting member', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    await addEntry(token, wish.id, { kind: 'note', body: 'Saw one at the marina' });

    const detail = ((await (await req(`/${wish.id}`, token)).json()) as { wish: WishDetail }).wish;
    expect(detail.created_by_name).toBe('Pat Owner');
    expect(detail.entries[0].author_id).toBe(UID);
    expect(detail.entries[0].author_name).toBe('Pat Owner');
  });
});

describe('wishes collaboration — edit an item', () => {
  it('edits a note body via PATCH', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const noteRes = await addEntry(token, wish.id, { kind: 'note', body: 'first draft' });
    const noteId = ((await noteRes.json()) as { entry: EntryRow }).entry.id;

    const patch = await req(`/${wish.id}/entries/${noteId}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'edited note' }),
    });
    expect(patch.status).toBe(200);

    const detail = ((await (await req(`/${wish.id}`, token)).json()) as { wish: WishDetail }).wish;
    expect(detail.entries[0].body).toBe('edited note');
  });

  it('rejects editing a note to empty (400)', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const noteRes = await addEntry(token, wish.id, { kind: 'note', body: 'keep me' });
    const noteId = ((await noteRes.json()) as { entry: EntryRow }).entry.id;

    const patch = await req(`/${wish.id}/entries/${noteId}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });
    expect(patch.status).toBe(400);
  });
});

describe('wishes collaboration — threaded reply', () => {
  it('links a reply to its parent and returns a quoted preview', async () => {
    const wish = await createWish(token, { title: 'Buy a boat' });
    const parentRes = await addEntry(token, wish.id, { kind: 'note', body: 'What about a sailboat?' });
    const parentId = ((await parentRes.json()) as { entry: EntryRow }).entry.id;

    const replyRes = await addEntry(token, wish.id, {
      kind: 'note',
      body: 'Love it',
      parent_entry_id: parentId,
    });
    expect(replyRes.status).toBe(201);

    const detail = ((await (await req(`/${wish.id}`, token)).json()) as { wish: WishDetail }).wish;
    const reply = detail.entries.find((e) => e.body === 'Love it');
    expect(reply?.parent_entry_id).toBe(parentId);
    expect(reply?.reply_to?.author_name).toBe('Pat Owner');
    expect(reply?.reply_to?.snippet).toBe('What about a sailboat?');
  });

  it('ignores a parent_entry_id from a different wish', async () => {
    const wishA = await createWish(token, { title: 'Wish A' });
    const wishB = await createWish(token, { title: 'Wish B' });
    const foreign = await addEntry(token, wishA.id, { kind: 'note', body: 'in A' });
    const foreignId = ((await foreign.json()) as { entry: EntryRow }).entry.id;

    await addEntry(token, wishB.id, { kind: 'note', body: 'in B', parent_entry_id: foreignId });
    const detail = ((await (await req(`/${wishB.id}`, token)).json()) as { wish: WishDetail }).wish;
    expect(detail.entries[0].parent_entry_id).toBeNull();
    expect(detail.entries[0].reply_to).toBeNull();
  });
});

describe('wishes access control', () => {
  it('returns 403 for a user outside the household', async () => {
    const res = await req('', otherToken);
    expect(res.status).toBe(403);
  });
});
