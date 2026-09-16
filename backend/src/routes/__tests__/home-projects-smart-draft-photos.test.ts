/**
 * Smart Project draft photos — the upload that had no way to happen.
 *
 * The server has always been able to READ photos for a smart draft
 * (`loadPhotos` in the generator turns R2 keys into image blocks), but nothing
 * could produce a key: `home_project_attachments.project_id` is NOT NULL behind
 * a cascade FK, and at draft time the project is exactly what is being invented.
 * `POST /smart-draft/photos` fills that hole.
 *
 * What gets assertions here is what the endpoint REFUSES and what it CLEANS UP,
 * because both are silent when broken: a PDF would be stored, billed and then
 * ignored; a key from a neighbouring household would read their photos into
 * this household's plan; and an un-purged draft photo is a member's picture of
 * their own home left in R2 with no screen that lists it and no delete that
 * reaches it.
 *
 * A separate file from `home-projects-smart-draft.test.ts` on purpose — this
 * one mocks the generator module, which that file's queue-path tests must keep
 * real.
 */
import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as schema from '../../db/schema';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import homeProjectsRouter from '../home-projects';
import { createHomeProjectTables } from './home-projects-test-schema';

const mockAssertCanUseAI = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../../services/entitlement-service', () => ({
  assertCanUseAI: (...args: unknown[]) => mockAssertCanUseAI(...args),
}));

/**
 * Capture what the generator was handed. The plan itself is irrelevant here —
 * these tests are about which keys reach it and what survives afterwards.
 */
const seenKeys: string[][] = [];
vi.mock('../../services/ai/smart-project-generator', () => ({
  generateSmartProjectPlan: vi.fn(
    async (_env: unknown, input: { attachmentR2Keys: string[] }) => {
      seenKeys.push([...input.attachmentR2Keys]);
      return {
        title: 'Shed workshop',
        summary: 'A drafted plan.',
        phases: [],
        tasks: [],
        blockers: [],
        as_is: [],
        rooms: [],
        materials: [],
      };
    }
  ),
}));

const testEnv = env as unknown as Env;

const HID = 'hh_draft_photos_01';
const OTHER_HID = 'hh_draft_photos_02';
const UID = 'u_photo_owner';
const MID = 'm_photo_owner';

const DESCRIPTION =
  'I have a shed with a concrete floor and an open frame inside. I want to line the walls and ceiling with OSB and convert it into a woodworking shop with lighting.';

/** Smallest thing that is unambiguously bytes; content type is what we gate on. */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);

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

function mkApp(): Hono<{ Bindings: Env }> {
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
      const e = error as unknown as { code: string; message: string; statusCode: number };
      return c.json(
        { error: { code: e.code, message: e.message } },
        e.statusCode as 400 | 401 | 403 | 404 | 409
      );
    }
    return c.json(
      { error: { code: 'internal', message: (error as Error).message } },
      500
    );
  });
  return app;
}

async function uploadPhoto(
  app: Hono<{ Bindings: Env }>,
  contentType: string,
  bytes: Uint8Array,
  householdId = HID
): Promise<Response> {
  return app.fetch(
    new Request(
      `https://test.local/households/${householdId}/home-projects/smart-draft/photos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await mintToken(UID)}`,
          'Content-Type': contentType,
        },
        body: bytes,
      }
    ),
    testEnv
  );
}

async function generate(
  app: Hono<{ Bindings: Env }>,
  body: Record<string, unknown>
): Promise<Response> {
  return app.fetch(
    new Request(
      `https://test.local/households/${HID}/home-projects/smart-draft/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await mintToken(UID)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    ),
    testEnv
  );
}

beforeEach(async () => {
  seenKeys.length = 0;
  mockAssertCanUseAI.mockClear();
  await createCoreTables(testEnv.DB);
  await createHomeProjectTables(testEnv.DB);
  await resetAllTables(testEnv.DB);

  const db = drizzle(testEnv.DB);
  const now = new Date().toISOString();
  await db
    .insert(schema.users)
    .values([{ id: UID, email: `${UID}@example.com`, email_verified: true }]);
  await db
    .insert(schema.households)
    .values([
      { id: HID, name: 'Draft Photo House' },
      { id: OTHER_HID, name: 'Somebody Else' },
    ]);
  await db.insert(schema.householdMembers).values([
    { id: MID, household_id: HID, user_id: UID, role: 'owner', joined_at: now },
  ]);
});

describe('uploading a draft photo', () => {
  it('stores the bytes and returns a household-namespaced key', async () => {
    const app = mkApp();
    const res = await uploadPhoto(app, 'image/jpeg', JPEG_BYTES);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      key: string;
      content_type: string;
      size: number;
    };
    expect(body.key).toContain(HID);
    expect(body.key).toContain('smart-drafts/');
    expect(body.key.endsWith('.jpg')).toBe(true);
    expect(body.content_type).toBe('image/jpeg');
    expect(body.size).toBe(JPEG_BYTES.byteLength);

    // Not just a plausible string — the object is really there.
    const stored = await testEnv.REPORTS_BUCKET.get(body.key);
    expect(stored).not.toBeNull();
  });

  it('accepts a charset-suffixed content type', async () => {
    const app = mkApp();
    // iOS sends `image/jpeg` bare, but a fetch polyfill can append one; a 400
    // here would read to the member as "your photo is broken".
    const res = await uploadPhoto(app, 'image/jpeg; charset=binary', JPEG_BYTES);
    expect(res.status).toBe(201);
  });

  it('refuses a PDF, which the generator could never turn into an image', async () => {
    const app = mkApp();
    const res = await uploadPhoto(app, 'application/pdf', JPEG_BYTES);
    expect(res.status).toBe(400);
  });

  it('refuses an empty body', async () => {
    const app = mkApp();
    const res = await uploadPhoto(app, 'image/jpeg', new Uint8Array([]));
    expect(res.status).toBe(400);
  });

  it('refuses a household the member does not belong to', async () => {
    const app = mkApp();
    const res = await uploadPhoto(app, 'image/jpeg', JPEG_BYTES, OTHER_HID);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // And nothing was written on the way to refusing.
    const listed = await testEnv.REPORTS_BUCKET.list({
      prefix: `home-projects/${OTHER_HID}/`,
    });
    expect(listed.objects).toHaveLength(0);
  });
});

describe('generating with draft photos', () => {
  it('passes the uploaded key to the generator', async () => {
    const app = mkApp();
    const up = (await (await uploadPhoto(app, 'image/jpeg', JPEG_BYTES)).json()) as {
      key: string;
    };

    const res = await generate(app, {
      description: DESCRIPTION,
      photo_keys: [up.key],
    });
    expect(res.status).toBe(200);
    expect(seenKeys[0]).toEqual([up.key]);
  });

  it('drops a key belonging to another household', async () => {
    const app = mkApp();
    // Shaped exactly like a real key, but namespaced to somebody else. Without
    // the prefix check this reads their photo into this household's plan.
    const foreign = `home-projects/${OTHER_HID}/smart-drafts/abc.jpg`;
    await testEnv.REPORTS_BUCKET.put(foreign, JPEG_BYTES);

    const res = await generate(app, {
      description: DESCRIPTION,
      photo_keys: [foreign],
    });
    expect(res.status).toBe(200);
    expect(seenKeys[0]).toEqual([]);

    // The neighbour's object is untouched — the guard filters, it does not purge.
    expect(await testEnv.REPORTS_BUCKET.get(foreign)).not.toBeNull();
  });

  it('drops a traversal dressed up as this household', async () => {
    const app = mkApp();
    const res = await generate(app, {
      description: DESCRIPTION,
      photo_keys: [`home-projects/${HID}/smart-drafts/../../../secrets.jpg`],
    });
    expect(res.status).toBe(200);
    expect(seenKeys[0]).toEqual([]);
  });

  it('purges the photo once the plan is drafted', async () => {
    const app = mkApp();
    const up = (await (await uploadPhoto(app, 'image/jpeg', JPEG_BYTES)).json()) as {
      key: string;
    };
    expect(await testEnv.REPORTS_BUCKET.get(up.key)).not.toBeNull();

    await generate(app, { description: DESCRIPTION, photo_keys: [up.key] });

    // A generation input is not a household document; nothing lists it and no
    // delete reaches it, so it has to clean up after itself.
    expect(await testEnv.REPORTS_BUCKET.get(up.key)).toBeNull();
  });
});
