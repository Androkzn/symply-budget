/**
 * The HTTP surface of invite management — listing what is outstanding,
 * cancelling it, and telling the invitee whose household they are being asked
 * to join.
 *
 * Separate from `local-first-invite-lifecycle.test.ts`, which pins the SQL: what
 * is pinned here is the contract a client actually meets — the status codes it
 * has to branch on, and the `householdName` the join confirmation is built from.
 * A service that behaves perfectly behind a route that maps
 * "already approved" onto a 500 is still a broken feature.
 *
 * Harness follows `healthPersonalHousehold.test.ts`: the real `/v2` router in a
 * bare Hono app, a jose HS256 JWT, and `cloudflare:test` D1.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import v2Routes from '../local-first-v2';

const testEnv = env as unknown as Env;

const HOUSEHOLD = 'hh_local_routes';
const OWNER = 'u_routes_owner';
const STRANGER = 'u_routes_stranger';
const INVITEE = 'u_routes_invitee';

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS lf_households (
    id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL,
    key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lf_memberships (
    id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, user_id TEXT NOT NULL,
    role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL, revoked_at TEXT, UNIQUE (household_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS lf_invites (
    id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, short_code TEXT NOT NULL,
    secret_hash TEXT NOT NULL, role TEXT NOT NULL, created_by_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', expires_at TEXT NOT NULL, invitee_email TEXT,
    claimed_by_user_id TEXT, claimed_device_id TEXT, claimed_signing_public_key TEXT,
    claimed_agreement_public_key TEXT, sas_verified_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (short_code))`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL, email TEXT, display_name TEXT)`,
];

async function createTables(): Promise<void> {
  for (const ddl of DDL) await testEnv.DB.exec(ddl.replace(/\s+/g, ' '));
}

async function resetTables(): Promise<void> {
  for (const table of ['lf_invites', 'lf_memberships', 'lf_households', 'users']) {
    await testEnv.DB.exec(`DELETE FROM ${table}`);
  }
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(HOUSEHOLD, OWNER, 'The Smiths', now, now)
    .run();
  await testEnv.DB.prepare(
    `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'OWNER', 'active', ?)`,
  )
    .bind('m1', HOUSEHOLD, OWNER, now)
    .run();
  await testEnv.DB.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`)
    .bind(INVITEE, 'them@example.com', 'Sam')
    .run();
}

async function seedInvite(input: {
  id: string;
  shortCode: string;
  status?: string;
  claimedBy?: string | null;
  hoursToExpiry?: number;
}): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_invites (id, household_id, short_code, secret_hash, role, created_by_user_id,
       status, expires_at, claimed_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, 'hash', 'ADULT', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.id,
      HOUSEHOLD,
      input.shortCode,
      OWNER,
      input.status ?? 'active',
      new Date(Date.now() + (input.hoursToExpiry ?? 24) * 3600_000).toISOString(),
      input.claimedBy ?? null,
      now,
      now,
    )
    .run();
}

async function mintToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(
    testEnv.JWT_SECRET ?? 'test-jwt-secret-32-chars-minimum',
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

async function call(method: string, path: string, as: string): Promise<Response> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/v2', v2Routes);
  return app.request(
    `http://x/v2${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await mintToken(as)}`,
      },
    },
    { ...testEnv, APP_BRAND: 'symply-budget', LOCAL_FIRST_API_ENABLED: 'true' } as Env,
  );
}

beforeEach(async () => {
  await createTables();
  await resetTables();
});

describe('GET /v2/invites/lookup', () => {
  it('names the household, which is what the join confirmation is built from', async () => {
    await seedInvite({ id: 'inv_1', shortCode: 'ABC123' });
    const res = await call('GET', '/invites/lookup?code=ABC123', INVITEE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invite: { householdName: string | null } };
    expect(body.invite.householdName).toBe('The Smiths');
  });

  it('answers null rather than omitting the field when the household is gone', async () => {
    // The client branches on null to say "their household"; an absent key and a
    // null one must not be different cases for it to get right.
    await seedInvite({ id: 'inv_1', shortCode: 'ABC123' });
    await testEnv.DB.exec('DELETE FROM lf_households');
    const res = await call('GET', '/invites/lookup?code=ABC123', INVITEE);
    const body = (await res.json()) as { invite: Record<string, unknown> };
    expect(body.invite).toHaveProperty('householdName', null);
  });

  it('is a 404 for a code that does not exist', async () => {
    const res = await call('GET', '/invites/lookup?code=NOPE00', INVITEE);
    expect(res.status).toBe(404);
  });
});

describe('GET /v2/households/:id/invites/outstanding', () => {
  it('returns active and claimed invites together', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    await seedInvite({
      id: 'inv_claimed',
      shortCode: 'BBB222',
      status: 'claimed',
      claimedBy: INVITEE,
    });
    const res = await call('GET', `/households/${HOUSEHOLD}/invites/outstanding`, OWNER);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: Array<{ inviteId: string }> };
    expect(body.invites.map((i) => i.inviteId).sort()).toEqual(['inv_active', 'inv_claimed']);
  });

  it('is a 403 for someone who is not in the household', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    const res = await call('GET', `/households/${HOUSEHOLD}/invites/outstanding`, STRANGER);
    expect(res.status).toBe(403);
  });
});

describe('POST /v2/households/:id/invites/:inviteId/revoke', () => {
  it('cancels an outstanding invite', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    const res = await call(
      'POST',
      `/households/${HOUSEHOLD}/invites/inv_active/revoke`,
      OWNER,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ invite: { inviteId: 'inv_active', status: 'revoked' } });

    // …and it is gone from the list the owner is offered.
    const list = await call('GET', `/households/${HOUSEHOLD}/invites/outstanding`, OWNER);
    expect(((await list.json()) as { invites: unknown[] }).invites).toEqual([]);
  });

  it('is a 409 on an approved invite — that is device revocation, not this', async () => {
    // The distinction matters: the claimant's device already holds the household
    // key, and a route that silently "revoked" it here would report success
    // while leaving an enrolled device in place.
    await seedInvite({
      id: 'inv_approved',
      shortCode: 'CCC333',
      status: 'approved',
      claimedBy: INVITEE,
    });
    const res = await call(
      'POST',
      `/households/${HOUSEHOLD}/invites/inv_approved/revoke`,
      OWNER,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/revoke the device instead/i);
  });

  it('is a 404 for an invite that does not exist', async () => {
    const res = await call('POST', `/households/${HOUSEHOLD}/invites/inv_nope/revoke`, OWNER);
    expect(res.status).toBe(404);
  });

  it('is a 403 for someone who is not in the household', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    const res = await call(
      'POST',
      `/households/${HOUSEHOLD}/invites/inv_active/revoke`,
      STRANGER,
    );
    expect(res.status).toBe(403);
  });

  it('does not 500 when there is no ExecutionContext to hand the notification to', async () => {
    // `app.request()` binds none, and the notification is fire-and-forget: an
    // owner's cancellation must not fail because nobody could be told about it.
    await seedInvite({
      id: 'inv_claimed',
      shortCode: 'BBB222',
      status: 'claimed',
      claimedBy: INVITEE,
    });
    const res = await call(
      'POST',
      `/households/${HOUSEHOLD}/invites/inv_claimed/revoke`,
      OWNER,
    );
    expect(res.status).toBe(200);
  });
});
