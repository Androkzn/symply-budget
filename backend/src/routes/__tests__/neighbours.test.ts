/**
 * neighbours.ts + neighbour-service.ts — end-to-end route coverage.
 *
 * House runs local-first, so on most installs these routes are never called:
 * `localNeighboursApi` owns the family on device. This suite exists because the
 * Worker is still the path for a household that is NOT local-first — the
 * incident kill switch — and a path that only runs during an incident is
 * exactly the one nobody notices is broken.
 *
 * It drives the real Hono router against a live miniflare D1, and asserts the
 * behaviours that only show up at the seams:
 *
 *  - the auth gate (401) and the MEMBERSHIP gate (403 for a non-member);
 *  - route ORDER — `/neighbourhoods` and `/people/:id` are declared before
 *    `/:neighbourId`, and without that every area request 404s as a missing
 *    neighbour. This is the single most likely regression in the file;
 *  - coordinate validation, in both the zod layer (400) and the service;
 *  - the two cascades: deleting a home removes its occupants, deleting an area
 *    UNFILES its homes rather than removing them;
 *  - one primary occupant per home, enforced by the server rather than trusted
 *    from the client;
 *  - the same haversine fixtures `neighbourGeo.test.ts` and
 *    `localNeighboursApi.test.ts` assert, so three copies of one formula cannot
 *    drift apart.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import { errorHandler } from '../../middleware/error-handler';
import { distanceMeters } from '../../services/neighbour-service';
import {
  createCoreTables,
  resetAllTables,
} from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import neighbourRoutes from '../neighbours';

const testEnv = env as unknown as Env;
const UID = 'u_nbr_owner';
const MEMBER = 'u_nbr_member';
const OUTSIDER = 'u_nbr_outsider';
const HID = 'hh_nbr_1';

/** The Vancouver street fixture shared with the two client suites. */
const HOME = { latitude: 49.2827, longitude: -123.1207 };
const WILSONS = { latitude: 49.28306, longitude: -123.1207 };
const PATELS = { latitude: 49.2827, longitude: -123.12145 };

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

/**
 * Faithful subset of `schema-neighbours.ts`. FK REFERENCES are omitted to match
 * the plain-DDL style of `createCoreTables` (miniflare D1 does not enforce them
 * here) — which is precisely why the service performs both cascades in code
 * rather than trusting the constraint.
 */
async function createNeighbourTables(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS neighbourhoods (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      photo_key TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS neighbourhoods_household_name_unique
      ON neighbourhoods(household_id, name)`,
    `CREATE TABLE IF NOT EXISTS neighbours (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      neighbourhood_id TEXT,
      label TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'nearby',
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state_province TEXT,
      postal_code TEXT,
      country TEXT,
      formatted_address TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      place_source TEXT NOT NULL DEFAULT 'manual',
      photo_key TEXT,
      notes TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_emergency_contact INTEGER NOT NULL DEFAULT 0,
      has_spare_key INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS neighbour_people (
      id TEXT PRIMARY KEY,
      neighbour_id TEXT NOT NULL,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'adult',
      phone TEXT,
      email TEXT,
      photo_key TEXT,
      notes TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      device_contact_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ];
  for (const sql of statements) {
    await testEnv.DB.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createNeighbourTables();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.exec('DELETE FROM neighbours');
  await testEnv.DB.exec('DELETE FROM neighbour_people');
  await testEnv.DB.exec('DELETE FROM neighbourhoods');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values([
    { id: UID, email: 'owner@example.com', email_verified: true },
    { id: MEMBER, email: 'member@example.com', email_verified: true },
    { id: OUTSIDER, email: 'out@example.com', email_verified: true },
  ]);
  await db.insert(schema.households).values({
    id: HID,
    name: 'NbrTest',
    city: 'Vancouver',
    state_province: 'BC',
    country: 'CA',
  });
  await db.insert(schema.householdMembers).values([
    { id: 'm_nbr_1', household_id: HID, user_id: UID, role: 'owner', joined_at: '2026-01-01T00:00:00Z' },
    { id: 'm_nbr_2', household_id: HID, user_id: MEMBER, role: 'member', joined_at: '2026-01-01T00:00:00Z' },
  ]);
}

const API_ERROR_NAMES = [
  'ApiError',
  'ValidationError',
  'UnauthorizedError',
  'ForbiddenError',
  'NotFoundError',
  'ConflictError',
  'RateLimitError',
];

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', errorHandler());
  app.route('/households/:householdId/neighbours', neighbourRoutes);
  app.onError((error, c) => {
    if (API_ERROR_NAMES.includes((error as Error).name)) {
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json(
        { error: { code: apiError.code, message: apiError.message } },
        apiError.statusCode as 400 | 401 | 403 | 404 | 409
      );
    }
    return c.json({ error: { code: 'internal', message: (error as Error).message } }, 500);
  });
  return app;
}

const jsonHeaders = (token: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
});

let app: ReturnType<typeof mkApp>;
let token: string;

async function createWilsons(overrides: Record<string, unknown> = {}) {
  const res = await app.request(`/households/${HID}/neighbours`, {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({
      label: 'The Wilsons',
      relation: 'next_door',
      latitude: WILSONS.latitude,
      longitude: WILSONS.longitude,
      address_line1: '44 Maple St',
      city: 'Vancouver',
      people: [
        { name: 'Sarah Wilson', phone: '+16045550142', is_primary: true },
        { name: 'Tom Wilson' },
      ],
      ...overrides,
    }),
  }, testEnv);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { neighbour: Record<string, never> };
  return body.neighbour as unknown as {
    id: string;
    people: { id: string; name: string; is_primary: boolean }[];
    person_count: number;
    relation: string;
    place_source: string;
    is_favorite: boolean;
    neighbourhood_id: string | null;
    neighbourhood: { id: string } | null;
    address_line1: string | null;
  };
}

beforeEach(async () => {
  await seed();
  app = mkApp();
  token = await mintToken(UID);
});

describe('auth and membership', () => {
  it('401s without a token', async () => {
    const res = await app.request(`/households/${HID}/neighbours`, {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('lets any MEMBER read and write, not only the owner', async () => {
    // Deliberately not the owner-only gate `HouseholdSpaceService` uses: knowing
    // who lives across the street is exactly the kind of thing every adult in
    // the house needs to be able to add at the moment they learn it.
    const memberToken = await mintToken(MEMBER);
    const res = await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(memberToken),
      body: JSON.stringify({ label: 'Corner house', ...PATELS }),
    }, testEnv);
    expect(res.status).toBe(201);
  });

  it('403s a non-member', async () => {
    const outsiderToken = await mintToken(OUTSIDER);
    const res = await app.request(`/households/${HID}/neighbours`, {
      headers: jsonHeaders(outsiderToken),
    }, testEnv);
    expect(res.status).toBe(403);
  });
});

describe('route order', () => {
  it('resolves /neighbourhoods as a literal, not as a neighbour id', async () => {
    // The single most likely regression in this router: moving the
    // `/neighbourhoods` block below `/:neighbourId` makes every area request
    // 404 as a missing neighbour, and the failure reads like a data problem.
    const res = await app.request(`/households/${HID}/neighbours/neighbourhoods`, {
      headers: jsonHeaders(token),
    }, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ neighbourhoods: [] });
  });

  it('resolves /people/:id as a literal too', async () => {
    const created = await createWilsons();
    const res = await app.request(
      `/households/${HID}/neighbours/people/${created.people[0]!.id}`,
      {
        method: 'PATCH',
        headers: jsonHeaders(token),
        body: JSON.stringify({ phone: '+16045550000' }),
      }, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { person: { phone: string } };
    expect(body.person.phone).toBe('+16045550000');
  });
});

describe('create / read / update / delete', () => {
  it('creates a home with its occupants in one call', async () => {
    const created = await createWilsons();
    expect(created.person_count).toBe(2);
    expect(created.relation).toBe('next_door');
    expect(created.address_line1).toBe('44 Maple St');
  });

  it('applies the same defaults the ledger facade does', async () => {
    const res = await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ label: 'Corner house', ...PATELS }),
    }, testEnv);
    const body = (await res.json()) as { neighbour: { relation: string; place_source: string; is_favorite: boolean } };
    expect(body.neighbour.relation).toBe('nearby');
    expect(body.neighbour.place_source).toBe('manual');
    expect(body.neighbour.is_favorite).toBe(false);
  });

  it('400s a home with no position or an impossible one', async () => {
    const missing = await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ label: 'Nowhere' }),
    }, testEnv);
    expect(missing.status).toBe(400);

    const offWorld = await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ label: 'Off-world', latitude: 91, longitude: 0 }),
    }, testEnv);
    expect(offWorld.status).toBe(400);
  });

  it('400s half a coordinate move', async () => {
    const created = await createWilsons();
    const res = await app.request(`/households/${HID}/neighbours/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ latitude: 49.3 }),
    }, testEnv);
    expect(res.status).toBe(400);
  });

  it('patches only what was sent', async () => {
    const created = await createWilsons();
    const res = await app.request(`/households/${HID}/neighbours/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ notes: 'Feeds the cat' }),
    }, testEnv);
    const body = (await res.json()) as {
      neighbour: { notes: string; address_line1: string; relation: string; people: unknown[] };
    };
    expect(body.neighbour.notes).toBe('Feeds the cat');
    expect(body.neighbour.address_line1).toBe('44 Maple St');
    expect(body.neighbour.relation).toBe('next_door');
    expect(body.neighbour.people).toHaveLength(2);
  });

  it('404s a home that is not there', async () => {
    const res = await app.request(`/households/${HID}/neighbours/nbr_missing`, {
      headers: jsonHeaders(token),
    }, testEnv);
    expect(res.status).toBe(404);
  });

  it('filters by relation, favourite and search', async () => {
    await createWilsons();
    await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        label: 'The Patels',
        relation: 'across',
        is_favorite: true,
        notes: 'Has our spare key',
        ...PATELS,
      }),
    }, testEnv);

    const byRelation = await app.request(
      `/households/${HID}/neighbours?relation=across`,
      { headers: jsonHeaders(token) }, testEnv);
    expect(((await byRelation.json()) as { neighbours: unknown[] }).neighbours).toHaveLength(1);

    const byFavourite = await app.request(
      `/households/${HID}/neighbours?is_favorite=true`,
      { headers: jsonHeaders(token) }, testEnv);
    expect(((await byFavourite.json()) as { neighbours: unknown[] }).neighbours).toHaveLength(1);

    // Search reaches the notes, not just the label.
    const bySearch = await app.request(
      `/households/${HID}/neighbours?search=spare%20key`,
      { headers: jsonHeaders(token) }, testEnv);
    expect(((await bySearch.json()) as { neighbours: unknown[] }).neighbours).toHaveLength(1);
  });
});

describe('the delete cascade', () => {
  it('removes the occupants with the home', async () => {
    const created = await createWilsons();
    const res = await app.request(`/households/${HID}/neighbours/${created.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    }, testEnv);
    expect(res.status).toBe(200);

    // Asserted against the TABLE, not against the api: miniflare D1 does not
    // enforce the foreign key here, so a service that relied on the constraint
    // would leave orphans and this is what catches it.
    const rows = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM neighbour_people').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });
});

describe('occupants', () => {
  it('makes the first occupant primary and keeps exactly one', async () => {
    const created = await createWilsons();
    expect(created.people.filter((person) => person.is_primary)).toHaveLength(1);

    const tom = created.people.find((person) => person.name === 'Tom Wilson')!;
    await app.request(`/households/${HID}/neighbours/people/${tom.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ is_primary: true }),
    }, testEnv);

    const res = await app.request(`/households/${HID}/neighbours/${created.id}`, {
      headers: jsonHeaders(token),
    }, testEnv);
    const body = (await res.json()) as {
      neighbour: { people: { name: string; is_primary: boolean }[] };
    };
    // Enforced by the SERVER, not trusted from the client — a bulk import is a
    // caller too, and it has no idea what the other rows say.
    expect(body.neighbour.people.filter((person) => person.is_primary)).toHaveLength(1);
    expect(body.neighbour.people.find((person) => person.is_primary)!.name).toBe('Tom Wilson');
  });

  it('appends a new occupant in order', async () => {
    const created = await createWilsons();
    const res = await app.request(`/households/${HID}/neighbours/${created.id}/people`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: 'Ellie Wilson', role: 'child' }),
    }, testEnv);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { person: { sort_order: number; is_primary: boolean } };
    expect(body.person.sort_order).toBe(2);
    expect(body.person.is_primary).toBe(false);
  });

  it('404s a person from another household', async () => {
    const res = await app.request(`/households/${HID}/neighbours/people/np_missing`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    }, testEnv);
    expect(res.status).toBe(404);
  });
});

describe('neighbourhoods', () => {
  async function createArea(name = 'Maple Court') {
    const res = await app.request(`/households/${HID}/neighbours/neighbourhoods`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name }),
    }, testEnv);
    expect(res.status).toBe(201);
    return ((await res.json()) as { neighbourhood: { id: string; neighbour_count: number } })
      .neighbourhood;
  }

  it('creates one and counts the homes filed under it', async () => {
    const area = await createArea();
    await createWilsons({ neighbourhood_id: area.id });

    const res = await app.request(`/households/${HID}/neighbours/neighbourhoods`, {
      headers: jsonHeaders(token),
    }, testEnv);
    const body = (await res.json()) as { neighbourhoods: { neighbour_count: number }[] };
    expect(body.neighbourhoods[0]!.neighbour_count).toBe(1);
  });

  it('409s a duplicate name rather than letting the unique index throw', async () => {
    await createArea();
    const res = await app.request(`/households/${HID}/neighbours/neighbourhoods`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name: 'Maple Court' }),
    }, testEnv);
    // A sentence, not a constraint violation — the member gets an answer they
    // can act on.
    expect(res.status).toBe(409);
  });

  it('UNFILES its homes on delete rather than removing them', async () => {
    const area = await createArea();
    const home = await createWilsons({ neighbourhood_id: area.id });

    const res = await app.request(
      `/households/${HID}/neighbours/neighbourhoods/${area.id}`,
      { method: 'DELETE', headers: jsonHeaders(token) }, testEnv);
    expect(res.status).toBe(200);

    const after = await app.request(`/households/${HID}/neighbours/${home.id}`, {
      headers: jsonHeaders(token),
    }, testEnv);
    const body = (await after.json()) as {
      neighbour: { neighbourhood_id: string | null; label: string };
    };
    // The member removed a grouping, not a street.
    expect(body.neighbour.neighbourhood_id).toBeNull();
    expect(body.neighbour.label).toBe('The Wilsons');
  });

  it('refuses an area belonging to another property', async () => {
    const res = await app.request(`/households/${HID}/neighbours`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        label: 'Somewhere',
        neighbourhood_id: 'nbh_not_ours',
        ...PATELS,
      }),
    }, testEnv);
    expect(res.status).toBe(404);
  });
});

describe('distanceMeters', () => {
  it('agrees with the fixtures the two client copies assert', () => {
    // Three implementations of one formula exist — this one, `neighbourGeo.ts`
    // and `localNeighboursApi.ts` — for reasons each file states. Identical
    // fixtures are what stop them drifting.
    expect(distanceMeters(HOME, HOME)).toBe(0);
    const nextDoor = distanceMeters(HOME, WILSONS);
    expect(nextDoor).toBeGreaterThan(30);
    expect(nextDoor).toBeLessThan(50);
    expect(distanceMeters(HOME, { latitude: 47.6062, longitude: -122.3321 }) / 1000).toBeCloseTo(
      195.3,
      1
    );
  });
});
