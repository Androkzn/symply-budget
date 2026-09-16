/**
 * Health personal household — the control plane refuses a second `user_id`.
 *
 * Health plan §1.2 ("Personal, not household") and §6 **Stage He5**: a Health
 * household is one implicit PERSONAL ledger — exactly one `user_id` with N
 * devices. `simplehealth://lf-invite` is *device* enrolment ("your other
 * device"), never a member invite. **DoD He5**: "control-plane test: adding
 * another userId → 403".
 *
 * §2 item 4c promotes this test into **DoD He0**, because dropping
 * `excludeUserId` from the Health peer-wake query removed the only user-scoping
 * predicate there — this 403 "becomes the compensating control once
 * `excludeUserId` is dropped". The two live in one place
 * (`config/local-first-household-policy.ts` beside `LOCAL_FIRST_WAKE_POLICY`)
 * so the premise and its compensator cannot drift apart.
 *
 * The critical constraint is that ONE Worker serves FOUR brands. House and
 * Budget households are multi-member by design, so every refusal below is
 * mirrored by a House/Budget case that must still SUCCEED. The rule is keyed off
 * `APP_BRAND` — a per-Worker binding stamped by the fleet deploy, never a client
 * header — so a caller cannot choose which rule they are judged under.
 *
 * Harness follows `local-first-v2-sync-wake.test.ts`: the real `/v2` router in a
 * bare Hono app, a jose HS256 JWT, `cloudflare:test` D1, and a coordinator stub
 * (authorisation is decided from D1 *before* the DO is consulted, which is
 * exactly what these tests assert).
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  LOCAL_FIRST_HOUSEHOLD_POLICY,
  isPersonalHouseholdBrand,
} from '../../config/local-first-household-policy';
import type { Env } from '../../types';
import { PersonalHouseholdViolationError } from '../../utils/errors';
import v2Routes from '../local-first-v2';

const testEnv = env as unknown as Env;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Health: a PERSONAL ledger — one user, two devices. */
const HH_HEALTH = 'hh_personal_health';
const OWNER = 'u_health_owner';
const INTRUDER = 'u_health_intruder';
const DEV_A = 'dev_health_a';
const DEV_B = 'dev_health_b';

/** House / Budget: a SHARED household — the owner plus a second person. */
const HH_SHARED = 'hh_shared_multi';
const MEMBER_1 = 'u_shared_one';
const MEMBER_2 = 'u_shared_two';
const DEV_1 = 'dev_shared_one';
const DEV_2 = 'dev_shared_two';

const INVITE_ID = 'inv_personal_1';
const SHORT_CODE = 'AB12CD';
const SECRET = 'a0b1c2d3e4f5a6b7c8d9e0f1';
const SIGN_PK = `sign-${'k'.repeat(40)}`;
const AGREE_PK = `agree-${'k'.repeat(40)}`;

/* -------------------------------------------------------------------------- */
/* D1 — the real control-plane shape (migrations 0152 / 0153 / 0154 / 0156)    */
/* -------------------------------------------------------------------------- */

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS lf_households (
    id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    key_epoch INTEGER NOT NULL DEFAULT 1,
    security_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lf_memberships (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (household_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lf_devices (
    id TEXT NOT NULL,
    household_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    device_label TEXT,
    signing_public_key TEXT NOT NULL,
    agreement_public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    expo_push_token TEXT,
    push_platform TEXT,
    push_updated_at TEXT,
    PRIMARY KEY (household_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS lf_invites (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL,
    short_code TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
    created_by_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'claimed', 'approved', 'revoked', 'expired')),
    expires_at TEXT NOT NULL,
    claimed_by_user_id TEXT,
    claimed_device_id TEXT,
    claimed_signing_public_key TEXT,
    claimed_agreement_public_key TEXT,
    invitee_email TEXT,
    sas_verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (short_code)
  )`,
  // Legacy mirror targets. `mirrorLegacyMembership` is best-effort and swallows
  // its own failures, but creating them keeps a successful approval from logging
  // an error that looks like the thing under test failing.
  `CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  // Only what the enrolment paths read: an invite bound to an address has to
  // resolve the claimant's `user_id` to that address before it can refuse them.
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS household_members (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE (household_id, user_id)
  )`,
];

async function createTables(): Promise<void> {
  for (const stmt of DDL) {
    await testEnv.DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

async function resetTables(): Promise<void> {
  for (const table of [
    'users',
    'lf_invites',
    'lf_devices',
    'lf_memberships',
    'lf_households',
    'household_members',
    'households',
  ]) {
    await testEnv.DB.exec(`DELETE FROM ${table}`);
  }
}

async function seedHousehold(householdId: string, ownerUserId: string): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(householdId, ownerUserId, 'seed', now, now)
    .run();
}

async function seedMember(
  householdId: string,
  userId: string,
  role: 'OWNER' | 'ADULT' = 'OWNER',
): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  )
    .bind(crypto.randomUUID(), householdId, userId, role, now)
    .run();
}

async function seedDevice(householdId: string, deviceId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_devices
      (id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
       status, last_seen_at, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'active', ?, ?)`,
  )
    .bind(deviceId, householdId, userId, SIGN_PK, AGREE_PK, now, now)
    .run();
}

async function seedUser(userId: string, email: string): Promise<void> {
  await testEnv.DB.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`)
    .bind(userId, email, null)
    .run();
}

async function seedInvite(input: {
  householdId: string;
  createdByUserId: string;
  status?: 'active' | 'claimed';
  claimedByUserId?: string | null;
  claimedDeviceId?: string | null;
  inviteeEmail?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_invites
      (id, household_id, short_code, secret_hash, role, created_by_user_id, status, expires_at,
       claimed_by_user_id, claimed_device_id, claimed_signing_public_key,
       claimed_agreement_public_key, invitee_email, created_at, updated_at)
     VALUES (?, ?, ?, 'unused-hash', 'ADULT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      INVITE_ID,
      input.householdId,
      SHORT_CODE,
      input.createdByUserId,
      input.status ?? 'active',
      new Date(Date.now() + 3600_000).toISOString(),
      input.claimedByUserId ?? null,
      input.claimedDeviceId ?? null,
      input.claimedByUserId ? SIGN_PK : null,
      input.claimedByUserId ? AGREE_PK : null,
      input.inviteeEmail ?? null,
      now,
      now,
    )
    .run();
}

/**
 * What the owner's device sends when the two humans have matched their digits:
 * the keys it displayed, echoed back so an approval cannot land on a claim that
 * changed since. `seedInvite` writes these same values as the claim on record.
 */
function approveBody() {
  return { confirmedSigningPublicKey: SIGN_PK, confirmedAgreementPublicKey: AGREE_PK };
}

async function membershipUserIds(householdId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    `SELECT user_id FROM lf_memberships WHERE household_id = ? ORDER BY user_id`,
  )
    .bind(householdId)
    .all<{ user_id: string }>();
  return (results ?? []).map((r) => r.user_id);
}

async function deviceOwners(householdId: string): Promise<Array<{ id: string; user: string }>> {
  const { results } = await testEnv.DB.prepare(
    `SELECT id, user_id FROM lf_devices WHERE household_id = ? ORDER BY id`,
  )
    .bind(householdId)
    .all<{ id: string; user_id: string }>();
  return (results ?? []).map((r) => ({ id: r.id, user: r.user_id }));
}

/* -------------------------------------------------------------------------- */
/* Coordinator stub — records whether it was reached at all                    */
/* -------------------------------------------------------------------------- */

/**
 * Authorisation for a personal household is decided from D1 BEFORE the Durable
 * Object is consulted, so a refused join leaves no half-written coordinator
 * state. `calls` is what proves that: a 403 must come with an untouched DO.
 */
function makeCoordinator(): {
  binding: Env['HOUSEHOLD_COORDINATOR'];
  calls: string[];
} {
  const calls: string[] = [];
  let lastClaim: { userId: string; deviceId: string; agreementPublicKey: string } | null = null;

  const stub = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        calls.push(path);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, string>) : {};

        if (path === '/invites/claim') {
          lastClaim = {
            userId: body.userId!,
            deviceId: body.deviceId!,
            agreementPublicKey: body.agreementPublicKey!,
          };
          return Response.json({ invite: { inviteId: body.inviteId, status: 'claimed' } });
        }

        if (path === '/invites/approve') {
          const approved = lastClaim ?? {
            userId: MEMBER_2,
            deviceId: DEV_2,
            agreementPublicKey: AGREE_PK,
          };
          return Response.json({
            state: {
              householdId: 'stub',
              keyEpoch: 1,
              securityRevision: 2,
              members: [{ userId: approved.userId, role: 'ADULT', status: 'active' }],
              devices: [
                {
                  deviceId: approved.deviceId,
                  userId: approved.userId,
                  signingPublicKey: SIGN_PK,
                  agreementPublicKey: approved.agreementPublicKey,
                  status: 'active',
                  enrolledAt: new Date().toISOString(),
                },
              ],
              invites: [],
            },
            approved,
          });
        }

        return Response.json({
          householdId: 'stub',
          keyEpoch: 1,
          securityRevision: 1,
          members: [],
          devices: [],
          invites: [],
        });
      },
    }),
  } as unknown as Env['HOUSEHOLD_COORDINATOR'];

  return { binding: stub, calls };
}

/* -------------------------------------------------------------------------- */
/* App + request helpers                                                       */
/* -------------------------------------------------------------------------- */

type Brand = 'symply-health' | 'symply-budget' | 'symply-house';

let coordinator = makeCoordinator();

function brandEnv(brand: Brand): Env {
  return {
    ...testEnv,
    APP_BRAND: brand,
    LOCAL_FIRST_API_ENABLED: 'true',
    HOUSEHOLD_COORDINATOR: coordinator.binding,
  } as Env;
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

async function call(
  brand: Brand,
  method: string,
  path: string,
  opts: { as: string; body?: unknown },
): Promise<Response> {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/v2', v2Routes);
  return app.request(
    `http://x/v2${path}`,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await mintToken(opts.as)}`,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    brandEnv(brand),
  );
}

const claimBody = (deviceId: string) => ({
  secret: SECRET,
  deviceId,
  signingPublicKey: SIGN_PK,
  agreementPublicKey: AGREE_PK,
});

type ErrorResponse = { error: { code: string; message: string } };

/** The one refusal this file exists to pin. */
const PERSONAL_HOUSEHOLD_403 = 'personal_household_single_user';

beforeEach(async () => {
  coordinator = makeCoordinator();
  await createTables();
  await resetTables();
});

/* ========================================================================== */
/* Health — a second `user_id` is refused                                     */
/* ========================================================================== */

describe('Health personal household — a second user_id is refused (He5 DoD)', () => {
  it('HP-HH-100: claiming an invite as a DIFFERENT user_id → 403, and the DO is never touched', async () => {
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedInvite({ householdId: HH_HEALTH, createdByUserId: OWNER });

    const res = await call(
      'symply-health',
      'POST',
      `/households/${HH_HEALTH}/invites/${INVITE_ID}/claim`,
      { as: INTRUDER, body: claimBody(DEV_B) },
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorResponse).error.code).toBe(PERSONAL_HOUSEHOLD_403);
    // The refusal is an AUTHORISATION decision taken before any state moves —
    // a 403 that had already marked the invite `claimed` would still have
    // handed a foreign device the pending-claim slot.
    expect(coordinator.calls).toEqual([]);
    expect(await membershipUserIds(HH_HEALTH)).toEqual([OWNER]);
  });

  it('HP-HH-101: approving a foreign claim → 403 even though the OWNER is the caller', async () => {
    // Defence in depth. The claim guard is the front door; this is the mutation
    // that would actually write `lf_memberships`, so it re-checks the party
    // being admitted rather than trusting that the claim was guarded.
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedInvite({
      householdId: HH_HEALTH,
      createdByUserId: OWNER,
      status: 'claimed',
      claimedByUserId: INTRUDER,
      claimedDeviceId: DEV_B,
    });

    const res = await call(
      'symply-health',
      'POST',
      `/households/${HH_HEALTH}/invites/${INVITE_ID}/approve`,
      { as: OWNER, body: approveBody() },
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorResponse).error.code).toBe(PERSONAL_HOUSEHOLD_403);
    expect(coordinator.calls).toEqual([]);
    expect(await membershipUserIds(HH_HEALTH)).toEqual([OWNER]);
  });

  it('HP-HH-102: registering a device as a DIFFERENT user_id → 403, no device row', async () => {
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    // A membership row for the intruder — the state a legacy or half-migrated
    // household could be in. Membership alone must not be enough.
    await seedMember(HH_HEALTH, INTRUDER, 'ADULT');

    const res = await call('symply-health', 'POST', `/households/${HH_HEALTH}/devices`, {
      as: INTRUDER,
      body: { deviceId: DEV_B, signingPublicKey: SIGN_PK, agreementPublicKey: AGREE_PK },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorResponse).error.code).toBe(PERSONAL_HOUSEHOLD_403);
    expect(await deviceOwners(HH_HEALTH)).toEqual([]);
  });

  it('HP-HH-103: the refusal names the rule, not just "forbidden"', async () => {
    // "Not a member" and "this ledger is personal" are different facts, and only
    // the second one means the control plane refused to make a personal ledger
    // shared. §15 needs to be able to count it.
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedInvite({ householdId: HH_HEALTH, createdByUserId: OWNER });

    const res = await call(
      'symply-health',
      'POST',
      `/households/${HH_HEALTH}/invites/${INVITE_ID}/claim`,
      { as: INTRUDER, body: claimBody(DEV_B) },
    );

    expect((await res.json()) as ErrorResponse).toEqual({
      error: {
        code: PERSONAL_HOUSEHOLD_403,
        message: 'This household is personal and accepts only its owner',
      },
    });
  });

  it('HP-HH-104: an unknown Health household fails CLOSED — 403, not "join freely"', async () => {
    const res = await call(
      'symply-health',
      'POST',
      `/households/hh_never_minted/invites/${INVITE_ID}/claim`,
      { as: INTRUDER, body: claimBody(DEV_B) },
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorResponse).error.code).toBe(PERSONAL_HOUSEHOLD_403);
    expect(coordinator.calls).toEqual([]);
  });
});

/* ========================================================================== */
/* Health — "your other device" must keep working                             */
/* ========================================================================== */

describe('Health personal household — the SAME user’s second device still enrols', () => {
  it('HP-HH-110: the owner claims their own invite from device B → 200', async () => {
    // The `simplehealth://lf-invite` path (§6): one user, a second device. If
    // the rule above were "reject a second device" instead of "reject a second
    // user", this is what it would have broken.
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedDevice(HH_HEALTH, DEV_A, OWNER);
    await seedInvite({ householdId: HH_HEALTH, createdByUserId: OWNER });

    const res = await call(
      'symply-health',
      'POST',
      `/households/${HH_HEALTH}/invites/${INVITE_ID}/claim`,
      { as: OWNER, body: claimBody(DEV_B) },
    );

    expect(res.status).toBe(200);
    expect(coordinator.calls).toContain('/invites/claim');
  });

  it('HP-HH-111: the owner approves their own device B → 200, still ONE user_id', async () => {
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedDevice(HH_HEALTH, DEV_A, OWNER);
    await seedInvite({ householdId: HH_HEALTH, createdByUserId: OWNER });

    await call('symply-health', 'POST', `/households/${HH_HEALTH}/invites/${INVITE_ID}/claim`, {
      as: OWNER,
      body: claimBody(DEV_B),
    });
    const res = await call(
      'symply-health',
      'POST',
      `/households/${HH_HEALTH}/invites/${INVITE_ID}/approve`,
      { as: OWNER, body: approveBody() },
    );

    expect(res.status).toBe(200);
    expect(await membershipUserIds(HH_HEALTH)).toEqual([OWNER]);
    expect(await deviceOwners(HH_HEALTH)).toEqual([
      { id: DEV_A, user: OWNER },
      { id: DEV_B, user: OWNER },
    ]);
  });

  it('HP-HH-112: the owner registers device B directly → 200, both devices are theirs', async () => {
    await seedHousehold(HH_HEALTH, OWNER);
    await seedMember(HH_HEALTH, OWNER);
    await seedDevice(HH_HEALTH, DEV_A, OWNER);

    const res = await call('symply-health', 'POST', `/households/${HH_HEALTH}/devices`, {
      as: OWNER,
      body: { deviceId: DEV_B, signingPublicKey: SIGN_PK, agreementPublicKey: AGREE_PK },
    });

    expect(res.status).toBe(200);
    expect(await deviceOwners(HH_HEALTH)).toEqual([
      { id: DEV_A, user: OWNER },
      { id: DEV_B, user: OWNER },
    ]);
  });
});

/* ========================================================================== */
/* House / Budget — multi-member enrolment is UNTOUCHED                        */
/* ========================================================================== */

describe('House and Budget stay multi-member — no cross-brand regression', () => {
  it.each([['symply-budget'], ['symply-house']] as const)(
    'HP-HH-120: %s — a SECOND user_id claims and is approved into the household',
    async (brand) => {
      await seedHousehold(HH_SHARED, MEMBER_1);
      await seedMember(HH_SHARED, MEMBER_1);
      await seedDevice(HH_SHARED, DEV_1, MEMBER_1);
      await seedInvite({ householdId: HH_SHARED, createdByUserId: MEMBER_1 });

      const claim = await call(
        brand,
        'POST',
        `/households/${HH_SHARED}/invites/${INVITE_ID}/claim`,
        { as: MEMBER_2, body: claimBody(DEV_2) },
      );
      expect(claim.status).toBe(200);

      const approve = await call(
        brand,
        'POST',
        `/households/${HH_SHARED}/invites/${INVITE_ID}/approve`,
        { as: MEMBER_1, body: approveBody() },
      );
      expect(approve.status).toBe(200);

      // The second person is now a member with their own device — exactly what
      // the Health rule forbids, and exactly what House/Budget are for.
      expect(await membershipUserIds(HH_SHARED)).toEqual([MEMBER_1, MEMBER_2].sort());
      expect(await deviceOwners(HH_SHARED)).toEqual([
        { id: DEV_1, user: MEMBER_1 },
        { id: DEV_2, user: MEMBER_2 },
      ]);
    },
  );

  it.each([['symply-budget'], ['symply-house']] as const)(
    'HP-HH-121: %s — a second member registers their device against the shared household',
    async (brand) => {
      await seedHousehold(HH_SHARED, MEMBER_1);
      await seedMember(HH_SHARED, MEMBER_1);
      await seedMember(HH_SHARED, MEMBER_2, 'ADULT');

      const res = await call(brand, 'POST', `/households/${HH_SHARED}/devices`, {
        as: MEMBER_2,
        body: { deviceId: DEV_2, signingPublicKey: SIGN_PK, agreementPublicKey: AGREE_PK },
      });

      expect(res.status).toBe(200);
      expect(await deviceOwners(HH_SHARED)).toEqual([{ id: DEV_2, user: MEMBER_2 }]);
    },
  );

  it('HP-HH-122: an actual non-member is still refused with the ORIGINAL error, not the new one', async () => {
    // The new rule must not swallow the pre-existing membership check on the
    // brands it does not apply to.
    await seedHousehold(HH_SHARED, MEMBER_1);
    await seedMember(HH_SHARED, MEMBER_1);

    const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/devices`, {
      as: 'u_total_outsider',
      body: { deviceId: DEV_2, signingPublicKey: SIGN_PK, agreementPublicKey: AGREE_PK },
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorResponse).error.code).toBe('forbidden');
  });
});

/* ========================================================================== */
/* The policy itself                                                           */
/* ========================================================================== */

describe('personal-household policy is brand-scoped, not request-scoped', () => {
  it('HP-HH-130: only Health is personal; the map is total over the fleet', () => {
    expect(LOCAL_FIRST_HOUSEHOLD_POLICY).toEqual({
      'symply-health': { personal: true },
      'symply-house': { personal: false },
      'symply-budget': { personal: false },
      'symply-kaizen': { personal: false },
    });
  });

  it('HP-HH-131: the brand comes from APP_BRAND, and a client header cannot move it', () => {
    expect(isPersonalHouseholdBrand({ APP_BRAND: 'symply-health' } as Env)).toBe(true);
    expect(isPersonalHouseholdBrand({ APP_BRAND: 'symply-house' } as Env)).toBe(false);
    expect(isPersonalHouseholdBrand({ APP_BRAND: 'symply-budget' } as Env)).toBe(false);
    // Fail-closed brand resolution: an unset/unknown APP_BRAND throws rather
    // than defaulting to a brand (House) whose rule is the permissive one.
    expect(() => isPersonalHouseholdBrand({} as Env)).toThrow(/APP_BRAND/);
  });

  it('HP-HH-132: the named error carries a 403 and its own code', () => {
    const error = new PersonalHouseholdViolationError();
    expect(error.name).toBe('PersonalHouseholdViolationError');
    expect(error.code).toBe(PERSONAL_HOUSEHOLD_403);
    expect(error.statusCode).toBe(403);
  });
});

/* ========================================================================== */
/* Enrolment verification — the checks that make G4 true at the door           */
/* ========================================================================== */

/**
 * These live here because this is where the claim harness already is. They pin
 * the half of the door that this tier owns: an invite bound to an address must
 * be inert in anyone else's hands, however valid the secret they hold.
 *
 * The other half — approval being pinned to the key a human verified — is
 * enforced inside the coordinator, which this file replaces with a fake, so it
 * is covered in `household-coordinator.test.ts` against the real object.
 */
describe('enrolment verification', () => {
  it('lets the named account claim a bound invite', async () => {
    await seedHousehold(HH_SHARED, MEMBER_1);
    await seedMember(HH_SHARED, MEMBER_1);
    await seedUser(MEMBER_2, 'invited@example.com');
    await seedInvite({
      householdId: HH_SHARED,
      createdByUserId: MEMBER_1,
      inviteeEmail: 'invited@example.com',
    });

    const claim = await call(
      'symply-budget',
      'POST',
      `/households/${HH_SHARED}/invites/${INVITE_ID}/claim`,
      { as: MEMBER_2, body: claimBody(DEV_2) },
    );

    expect(claim.status).toBe(200);
  });

  it('refuses a bound invite claimed by anyone else, however valid the secret', async () => {
    await seedHousehold(HH_SHARED, MEMBER_1);
    await seedMember(HH_SHARED, MEMBER_1);
    await seedUser(MEMBER_2, 'someone.else@example.com');
    await seedInvite({
      householdId: HH_SHARED,
      createdByUserId: MEMBER_1,
      inviteeEmail: 'invited@example.com',
    });

    const claim = await call(
      'symply-budget',
      'POST',
      `/households/${HH_SHARED}/invites/${INVITE_ID}/claim`,
      { as: MEMBER_2, body: claimBody(DEV_2) },
    );

    expect(claim.status).toBe(403);
    // Refused BEFORE the coordinator sees it — an invite a stranger touched must
    // not come back marked `claimed`, or the owner is shown a request to approve
    // that the real invitee can then no longer make.
    const row = await testEnv.DB.prepare(`SELECT status FROM lf_invites WHERE id = ?`)
      .bind(INVITE_ID)
      .first<{ status: string }>();
    expect(row?.status).toBe('active');
  });

  it('fails closed when a bound invite is claimed by an account with no address on file', async () => {
    await seedHousehold(HH_SHARED, MEMBER_1);
    await seedMember(HH_SHARED, MEMBER_1);
    // No `seedUser` — the claimant cannot be resolved to an address at all.
    await seedInvite({
      householdId: HH_SHARED,
      createdByUserId: MEMBER_1,
      inviteeEmail: 'invited@example.com',
    });

    const claim = await call(
      'symply-budget',
      'POST',
      `/households/${HH_SHARED}/invites/${INVITE_ID}/claim`,
      { as: MEMBER_2, body: claimBody(DEV_2) },
    );

    expect(claim.status).toBe(403);
  });

  it('leaves an unbound invite claimable, which is what QR-across-the-table needs', async () => {
    await seedHousehold(HH_SHARED, MEMBER_1);
    await seedMember(HH_SHARED, MEMBER_1);
    await seedInvite({ householdId: HH_SHARED, createdByUserId: MEMBER_1, inviteeEmail: null });

    const claim = await call(
      'symply-budget',
      'POST',
      `/households/${HH_SHARED}/invites/${INVITE_ID}/claim`,
      { as: MEMBER_2, body: claimBody(DEV_2) },
    );

    expect(claim.status).toBe(200);
  });
});
