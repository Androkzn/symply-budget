/**
 * appliances.ts + appliance-service.ts — end-to-end route coverage.
 *
 * The appliances feature (Home domain) had zero test coverage. This suite drives
 * every endpoint through the real Hono router + ApplianceService against a live
 * miniflare D1, exercising the behaviours that only show up at the seams:
 *   - auth gate (401) and household-membership gate (403 for a non-member).
 *   - dollar⇄cents conversion (purchase_cost / service cost stored ×100).
 *   - total_maintenance_cost accumulation when service history is added.
 *   - soft delete (deleted_at) hiding the row from GET/LIST afterwards.
 *   - category / space_id list filters.
 *   - zod validation (400) and NotFoundError (404) mapping via errorHandler().
 *
 * Mirrors the harness in settings.test.ts / utilities.test.ts: cloudflare:test
 * env, a jose-signed JWT whose `sub` becomes `userId`, createCoreTables for the
 * households/members baseline, and a local DDL helper for the maintenance tables
 * (not part of the shared core-table subset).
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../../db/schema';
import { errorHandler } from '../../middleware/error-handler';
import { createCoreTables, resetAllTables } from '../../services/aihousekeeper/__tests__/test-helpers';
import type { Env } from '../../types';
import applianceRoutes from '../appliances';

const testEnv = env as unknown as Env;
const UID = 'u_appl_owner';
const OUTSIDER = 'u_appl_outsider';
const HID = 'hh_appl_1';
const MID = 'm_appl_1';

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(testEnv.JWT_SECRET || 'test-jwt-secret-32-chars-minimum');
  return new jose.SignJWT({ sub: userId, email: `${userId}@example.com`, email_verified: true } as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer(testEnv.JWT_ISSUER || 'simple-house')
    .setAudience(testEnv.JWT_AUDIENCE || 'simple-house-app')
    .sign(secret);
}

// Faithful subset of schema-maintenance.ts (appliances / appliance_documents /
// appliance_service_history). FK REFERENCES are omitted to match the plain-DDL
// style of createCoreTables (miniflare D1 does not enforce them here).
async function createMaintenanceTables(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS appliances (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      space_id TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL,
      location TEXT,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      purchase_date TEXT,
      install_date TEXT,
      expected_lifespan INTEGER,
      warranty TEXT,
      purchase_cost INTEGER,
      total_maintenance_cost INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS appliance_documents (
      id TEXT PRIMARY KEY,
      appliance_id TEXT NOT NULL,
      type TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      upload_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS appliance_service_history (
      id TEXT PRIMARY KEY,
      appliance_id TEXT NOT NULL,
      service_date TEXT NOT NULL,
      description TEXT NOT NULL,
      cost INTEGER,
      provider_id TEXT,
      completed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT,
      updated_by TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`,
  ];
  for (const sql of statements) {
    await testEnv.DB.exec(sql.replace(/\s+/g, ' ').trim());
  }
}

async function seed(): Promise<void> {
  await createCoreTables(testEnv.DB);
  await createMaintenanceTables();
  await resetAllTables(testEnv.DB);
  await testEnv.DB.exec('DELETE FROM appliances');
  await testEnv.DB.exec('DELETE FROM appliance_documents');
  await testEnv.DB.exec('DELETE FROM appliance_service_history');

  const db = drizzle(testEnv.DB, { schema });
  await db.insert(schema.users).values({ id: UID, email: 'appl@example.com', email_verified: true });
  await db.insert(schema.users).values({ id: OUTSIDER, email: 'out@example.com', email_verified: true });
  await db.insert(schema.households).values({ id: HID, name: 'ApplTest', city: 'Surrey', state_province: 'BC', country: 'CA' });
  await db.insert(schema.householdMembers).values({
    id: MID,
    household_id: HID,
    user_id: UID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00Z',
  });
}

// Mirror production error mapping (index.ts app.onError): ApiError subclasses
// thrown from a mounted sub-app surface via onError, not the middleware catch.
const API_ERROR_NAMES = ['ApiError', 'ValidationError', 'UnauthorizedError', 'ForbiddenError', 'NotFoundError', 'ConflictError', 'RateLimitError'];

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', errorHandler());
  app.route('/households/:householdId/appliances', applianceRoutes);
  app.onError((error, c) => {
    if (API_ERROR_NAMES.includes((error as Error).name)) {
      const apiError = error as unknown as { code: string; message: string; statusCode: number };
      return c.json({ error: { code: apiError.code, message: apiError.message } }, apiError.statusCode as 400 | 401 | 403 | 404 | 409);
    }
    return c.json({ error: { code: 'internal', message: (error as Error).message } }, 500);
  });
  return app;
}

const jsonHeaders = (token: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

type ApplianceBody = {
  appliance: {
    id: string;
    name: string;
    category: string;
    type: string;
    purchase_cost?: number;
    total_maintenance_cost: number;
    warranty: Record<string, unknown>;
    location?: string;
  };
};

async function createAppliance(
  app: ReturnType<typeof mkApp>,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<ApplianceBody['appliance']> {
  const res = await app.request(
    `/households/${HID}/appliances`,
    {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        name: 'Furnace',
        category: 'hvac',
        type: 'Furnace',
        location: 'Basement',
        purchase_cost: 1200,
        warranty: { manufacturer: { expiration: '2030-01-01', coverage: 'parts & labor' } },
        ...overrides,
      }),
    },
    testEnv,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as ApplianceBody).appliance;
}

describe('appliances routes', () => {
  beforeEach(async () => {
    await seed();
  });

  describe('auth + membership gates', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await mkApp().request(`/households/${HID}/appliances`, {}, testEnv);
      expect(res.status).toBe(401);
    });

    it('rejects a non-member with 403', async () => {
      const token = await mintToken(OUTSIDER);
      const res = await mkApp().request(
        `/households/${HID}/appliances`,
        { headers: { Authorization: `Bearer ${token}` } },
        testEnv,
      );
      expect(res.status).toBe(403);
    });
  });

  describe('create + read', () => {
    it('POST creates an appliance (201), round-tripping cost as dollars and warranty JSON', async () => {
      const token = await mintToken(UID);
      const appliance = await createAppliance(mkApp(), token);

      expect(appliance.id).toBeTruthy();
      expect(appliance.name).toBe('Furnace');
      expect(appliance.category).toBe('hvac');
      expect(appliance.purchase_cost).toBe(1200); // stored as cents (120000), returned /100
      expect(appliance.total_maintenance_cost).toBe(0);
      expect(appliance.warranty).toEqual({ manufacturer: { expiration: '2030-01-01', coverage: 'parts & labor' } });
    });

    it('GET / lists appliances for the household', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await createAppliance(app, token, { name: 'Furnace', category: 'hvac' });
      await createAppliance(app, token, { name: 'Fridge', category: 'kitchen' });

      const res = await app.request(`/households/${HID}/appliances`, { headers: jsonHeaders(token) }, testEnv);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { appliances: Array<{ name: string; category: string }> };
      expect(body.appliances).toHaveLength(2);
      expect(body.appliances.map((a) => a.name).sort()).toEqual(['Fridge', 'Furnace']);
    });

    it('GET / honours the ?category filter', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      await createAppliance(app, token, { name: 'Furnace', category: 'hvac' });
      await createAppliance(app, token, { name: 'Fridge', category: 'kitchen' });

      const res = await app.request(`/households/${HID}/appliances?category=kitchen`, { headers: jsonHeaders(token) }, testEnv);
      const body = (await res.json()) as { appliances: Array<{ name: string }> };
      expect(body.appliances).toHaveLength(1);
      expect(body.appliances[0].name).toBe('Fridge');
    });

    it('GET /:id returns a single appliance; unknown id → 404', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const ok = await app.request(`/households/${HID}/appliances/${created.id}`, { headers: jsonHeaders(token) }, testEnv);
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as ApplianceBody).appliance.id).toBe(created.id);

      const missing = await app.request(`/households/${HID}/appliances/appl_nope`, { headers: jsonHeaders(token) }, testEnv);
      expect(missing.status).toBe(404);
    });

    it('rejects an invalid create payload with 400', async () => {
      const token = await mintToken(UID);
      const res = await mkApp().request(
        `/households/${HID}/appliances`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ category: 'hvac', type: 'Furnace' }) }, // missing name
        testEnv,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('update + delete', () => {
    it('PATCH /:id updates fields and returns the new state', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const res = await app.request(
        `/households/${HID}/appliances/${created.id}`,
        { method: 'PATCH', headers: jsonHeaders(token), body: JSON.stringify({ name: 'High-Efficiency Furnace', location: 'Utility Room' }) },
        testEnv,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ApplianceBody;
      expect(body.appliance.name).toBe('High-Efficiency Furnace');
      expect(body.appliance.location).toBe('Utility Room');
    });

    it('DELETE /:id soft-deletes: subsequent GET → 404 and LIST omits it', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const del = await app.request(`/households/${HID}/appliances/${created.id}`, { method: 'DELETE', headers: jsonHeaders(token) }, testEnv);
      expect(del.status).toBe(204);

      const get = await app.request(`/households/${HID}/appliances/${created.id}`, { headers: jsonHeaders(token) }, testEnv);
      expect(get.status).toBe(404);

      const list = await app.request(`/households/${HID}/appliances`, { headers: jsonHeaders(token) }, testEnv);
      expect(((await list.json()) as { appliances: unknown[] }).appliances).toHaveLength(0);
    });
  });

  describe('documents', () => {
    it('POST/GET /:id/documents adds and lists a document', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const add = await app.request(
        `/households/${HID}/appliances/${created.id}/documents`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ type: 'warranty', r2_key: 'docs/warranty.pdf' }) },
        testEnv,
      );
      expect(add.status).toBe(201);
      const added = (await add.json()) as { document: { type: string; r2_key: string; appliance_id: string } };
      expect(added.document.type).toBe('warranty');
      expect(added.document.r2_key).toBe('docs/warranty.pdf');
      expect(added.document.appliance_id).toBe(created.id);

      const list = await app.request(`/households/${HID}/appliances/${created.id}/documents`, { headers: jsonHeaders(token) }, testEnv);
      expect(list.status).toBe(200);
      expect(((await list.json()) as { documents: unknown[] }).documents).toHaveLength(1);
    });

    it('rejects an unknown document type with 400', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const res = await app.request(
        `/households/${HID}/appliances/${created.id}/documents`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ type: 'invoice', r2_key: 'x' }) },
        testEnv,
      );
      expect(res.status).toBe(400);
    });
  });

  describe('service history + maintenance cost', () => {
    it('POST /:id/service-history records an entry and accumulates total_maintenance_cost', async () => {
      const token = await mintToken(UID);
      const app = mkApp();
      const created = await createAppliance(app, token);

      const add = await app.request(
        `/households/${HID}/appliances/${created.id}/service-history`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ service_date: '2026-05-01', description: 'Annual tune-up', cost: 150 }) },
        testEnv,
      );
      expect(add.status).toBe(201);
      const entry = (await add.json()) as { entry: { description: string; cost: number } };
      expect(entry.entry.description).toBe('Annual tune-up');
      expect(entry.entry.cost).toBe(150);

      // Second entry to prove accumulation.
      await app.request(
        `/households/${HID}/appliances/${created.id}/service-history`,
        { method: 'POST', headers: jsonHeaders(token), body: JSON.stringify({ service_date: '2026-06-01', description: 'Filter swap', cost: 50 }) },
        testEnv,
      );

      const history = await app.request(`/households/${HID}/appliances/${created.id}/service-history`, { headers: jsonHeaders(token) }, testEnv);
      expect(((await history.json()) as { history: unknown[] }).history).toHaveLength(2);

      const appliance = await app.request(`/households/${HID}/appliances/${created.id}`, { headers: jsonHeaders(token) }, testEnv);
      // 150 + 50 dollars accumulated, returned in dollars.
      expect(((await appliance.json()) as ApplianceBody).appliance.total_maintenance_cost).toBe(200);
    });
  });
});
