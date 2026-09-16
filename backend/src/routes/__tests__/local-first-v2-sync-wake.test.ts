/**
 * `/v2` sync-wake over HTTP — the two call sites, end to end.
 *
 * `local-first-sync-wake-service.test.ts` owns the policy table and the peer
 * query. This file owns what the ROUTES do with them, because the third defect
 * in the push-wake bug lived only at the route layer:
 *
 *   `POST /v2/households/:id/sync-wake` had NO device id on the wire. Fixing
 *   defect 2 (stop excluding the caller's `user_id` for Health, whose personal
 *   ledger is one user with N devices) would therefore have left that route with
 *   ZERO exclusions — and a caller that wakes ITSELF is not a degraded sync, it
 *   is a push loop: syncOnce → deposit → wake → syncOnce.
 *
 * So the route now parses an optional `{ sourceDeviceId }` and returns
 * **400 `source_device_required`** for a device-only brand that omits it, while
 * the deposit path's `enqueueSyncWake` refuses to emit at all. Both refusals are
 * asserted as ZERO pushes, not merely as a status code — "returned 400" and
 * "woke nobody" are different claims, and only the second one is the bug.
 *
 * Budget/House must be untouched throughout: `sourceDeviceId` stays optional,
 * the caller's own user is still excluded, and other members still get woken.
 *
 * Harness: the real `/v2` router mounted in a bare Hono app, a jose HS256 JWT
 * (as in health-cycle.test.ts), `cloudflare:test` D1/R2/KV, a stub
 * HOUSEHOLD_COORDINATOR (membership is authorised from D1; the DO only returns
 * opaque state), and Expo intercepted at `fetch`.
 */

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BUDGET_SYNC_WAKE_TYPE,
  HEALTH_SYNC_WAKE_TYPE,
  HOUSE_SYNC_WAKE_TYPE,
  LocalFirstSyncWakeService,
  PROHIBITED_WAKE_PAYLOAD_KEYS,
  buildSyncWakeRequest,
  validateOpaqueWakePayload,
} from '../../services/local-first-sync-wake-service';
import type { Env } from '../../types';
import v2Routes from '../local-first-v2';

const testEnv = env as unknown as Env;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Health: a PERSONAL ledger — ONE user, TWO devices. */
const HH_SOLO = 'hh_v2_health_solo';
const USER_SOLO = 'u_v2_solo';
const DEV_A = 'dev_v2_health_a';
const DEV_B = 'dev_v2_health_b';
const TOKEN_A = 'ExponentPushToken[v2-health-a]';
const TOKEN_B = 'ExponentPushToken[v2-health-b]';

/** Budget/House: a SHARED household — two users, three devices. */
const HH_SHARED = 'hh_v2_shared';
const USER_1 = 'u_v2_one';
const USER_2 = 'u_v2_two';
const DEV_1A = 'dev_v2_one_a';
const DEV_1B = 'dev_v2_one_b';
const DEV_2A = 'dev_v2_two_a';
const TOKEN_1A = 'ExponentPushToken[v2-one-a]';
const TOKEN_1B = 'ExponentPushToken[v2-one-b]';
const TOKEN_2A = 'ExponentPushToken[v2-two-a]';

const OUTSIDER = 'u_v2_outsider';

/* -------------------------------------------------------------------------- */
/* D1 — the real control-plane shape (migrations 0152 + 0154 + 0156)          */
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
    household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADULT')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (household_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lf_devices (
    id TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
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
  `CREATE TABLE IF NOT EXISTS lf_mailbox_blobs (
    id TEXT PRIMARY KEY NOT NULL,
    household_id TEXT NOT NULL REFERENCES lf_households(id) ON DELETE CASCADE,
    recipient_device_id TEXT,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    acked_at TEXT
  )`,
];

async function createTables(): Promise<void> {
  for (const stmt of DDL) {
    await testEnv.DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

async function resetTables(): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_mailbox_blobs');
  await testEnv.DB.exec('DELETE FROM lf_devices');
  await testEnv.DB.exec('DELETE FROM lf_memberships');
  await testEnv.DB.exec('DELETE FROM lf_households');
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

async function seedDevice(input: {
  householdId: string;
  deviceId: string;
  userId: string;
  token?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_devices
      (id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
       status, last_seen_at, created_at, revoked_at, expo_push_token, push_platform)
     VALUES (?, ?, ?, NULL, 'sign', 'agree', 'active', ?, ?, NULL, ?, 'ios')`,
  )
    .bind(input.deviceId, input.householdId, input.userId, now, now, input.token ?? null)
    .run();
}

async function seedSolo(): Promise<void> {
  await seedHousehold(HH_SOLO, USER_SOLO);
  await seedMember(HH_SOLO, USER_SOLO);
  await seedDevice({ householdId: HH_SOLO, deviceId: DEV_A, userId: USER_SOLO, token: TOKEN_A });
  await seedDevice({ householdId: HH_SOLO, deviceId: DEV_B, userId: USER_SOLO, token: TOKEN_B });
}

async function seedShared(): Promise<void> {
  await seedHousehold(HH_SHARED, USER_1);
  await seedMember(HH_SHARED, USER_1, 'OWNER');
  await seedMember(HH_SHARED, USER_2, 'ADULT');
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_1A, userId: USER_1, token: TOKEN_1A });
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_1B, userId: USER_1, token: TOKEN_1B });
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_2A, userId: USER_2, token: TOKEN_2A });
}

/**
 * The 10 s deposit-wake coalesce window lives in KV, which outlives a D1 reset.
 * Without this, the second deposit test in a run would be coalesced into the
 * first one's wake and assert against a push that was never sent.
 */
async function clearCoalesceWindow(): Promise<void> {
  const kv = testEnv.CONFIG_KV;
  if (!kv) return;
  for (const householdId of [HH_SOLO, HH_SHARED]) {
    await kv.delete(`lf-wake:${householdId}:*`);
  }
}

/* -------------------------------------------------------------------------- */
/* App + env doubles                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Membership is authorised from `lf_memberships` in D1 before the coordinator is
 * consulted; `getState` then only forwards opaque coordinator state that no wake
 * decision reads. A stub keeps a DO out of a routing test without weakening the
 * authz it exercises (the 403 in LF-V2-WAKE-221 is produced by real D1 rows).
 */
const COORDINATOR_STUB = {
  idFromName: (name: string) => name,
  get: () => ({
    fetch: async () =>
      new Response(JSON.stringify({ householdId: 'stub', devices: [], members: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  }),
} as unknown as Env['HOUSEHOLD_COORDINATOR'];

type Brand = 'symply-health' | 'symply-budget' | 'symply-house';

function brandEnv(brand: Brand): Env {
  return {
    ...testEnv,
    APP_BRAND: brand,
    LOCAL_FIRST_API_ENABLED: 'true',
    EXPO_ACCESS_TOKEN: 'expo-test-token',
    HOUSEHOLD_COORDINATOR: COORDINATOR_STUB,
  } as Env;
}

function mkApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/v2', v2Routes);
  return app;
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
  opts: { token?: string | null; body?: unknown; rawBody?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token === undefined ? await mintToken(USER_SOLO) : opts.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const body =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body);
  return mkApp().request(`http://x/v2${path}`, { method, headers, body }, brandEnv(brand));
}

/* -------------------------------------------------------------------------- */
/* Expo double                                                                 */
/* -------------------------------------------------------------------------- */

type ExpoMessage = {
  to: string;
  data: Record<string, unknown>;
  _contentAvailable?: boolean;
  sound?: unknown;
};

function stubExpo() {
  const batches: ExpoMessage[][] = [];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
    const batch = JSON.parse(String(init?.body)) as ExpoMessage[];
    batches.push(batch);
    return new Response(
      JSON.stringify({ data: batch.map((_m, i) => ({ status: 'ok', id: `ticket-${i}` })) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    messages: (): ExpoMessage[] => batches.flat(),
    recipients: (): string[] => batches.flat().map((m) => m.to),
  };
}

/** The deposit path fires its wake with `void` — poll for it rather than race. */
async function waitForRecipients(
  expo: ReturnType<typeof stubExpo>,
  count: number,
): Promise<string[]> {
  await vi.waitFor(() => expect(expo.recipients()).toHaveLength(count), {
    timeout: 2_000,
    interval: 10,
  });
  return expo.recipients();
}

/**
 * Give a floating `void enqueueSyncWake(...)` every chance to emit before
 * asserting it did not. A "no push" assertion that simply raced the promise
 * would pass against the very bug this file exists to prevent.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const CIPHERTEXT_B64 = btoa('opaque-encrypted-op-batch');

type WakeResponse = { wake: { attempted: number; sent: number } };
type ErrorResponse = { error: { code: string; message: string } };

beforeEach(async () => {
  await createTables();
  await resetTables();
  await clearCoalesceWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ========================================================================== */
/* POST /v2/households/:id/sync-wake — Health (device-only exclusion)          */
/* ========================================================================== */

describe('POST /v2/households/:id/sync-wake — Health', () => {
  it('LF-V2-WAKE-200: wakes the OTHER device of the SAME user', async () => {
    // The headline case, over HTTP. One user, two devices: the peer query the
    // pre-fix code ran (`user_id != <the only user>`) matched zero rows here.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      body: { sourceDeviceId: DEV_A },
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as WakeResponse).toEqual({ wake: { attempted: 1, sent: 1 } });
    expect(expo.recipients()).toEqual([TOKEN_B]);
    expect(expo.messages()[0]?.data).toEqual({
      type: HEALTH_SYNC_WAKE_TYPE,
      householdId: HH_SOLO,
    });
  });

  it('LF-V2-WAKE-201: the caller device never receives its own wake', async () => {
    const expo = stubExpo();
    await seedSolo();

    await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      body: { sourceDeviceId: DEV_A },
    });

    expect(expo.recipients()).not.toContain(TOKEN_A);
  });

  it('LF-V2-WAKE-202: WITHOUT sourceDeviceId → 400 source_device_required, and ZERO pushes', async () => {
    // The refusal, not a fan-out. Emitting here would have put the caller in its
    // own fan-out: syncOnce → deposit → wake → syncOnce.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      body: {},
    });

    expect(res.status).toBe(400);
    expect((await res.json()) as ErrorResponse).toEqual({
      error: {
        code: 'source_device_required',
        message: 'sourceDeviceId is required for this brand',
      },
    });
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no body at all', undefined],
    ['an empty string body', ''],
    ['unparseable JSON', '{not json'],
    ['an explicit null', '{"sourceDeviceId":null}'],
    ['an empty string device id', '{"sourceDeviceId":""}'],
  ])(
    'LF-V2-WAKE-203: %s is refused the same way — 400 and no push',
    async (_label, rawBody) => {
      const expo = stubExpo();
      await seedSolo();

      const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
        ...(rawBody === undefined ? {} : { rawBody }),
      });

      expect(res.status).toBe(400);
      expect(((await res.json()) as ErrorResponse).error.code).toBe('source_device_required');
      await settle();
      expect(expo.fetchMock).not.toHaveBeenCalled();
    },
  );

  it('LF-V2-WAKE-204: a device id that is not the caller’s only narrows the fan-out', async () => {
    // Deliberately NOT validated against the caller: the query is already
    // household-scoped, so the worst a wrong id can do is exclude one more peer
    // in a household the caller is authorised for. Pinned so a future "harden
    // this" change is a conscious one.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      body: { sourceDeviceId: DEV_B },
    });

    expect(res.status).toBe(200);
    expect(expo.recipients()).toEqual([TOKEN_A]);
  });
});

/* ========================================================================== */
/* POST /v2/households/:id/sync-wake — Budget / House (unregressed)            */
/* ========================================================================== */

describe('POST /v2/households/:id/sync-wake — Budget and House', () => {
  it('LF-V2-WAKE-210: Budget WITHOUT sourceDeviceId still succeeds — it stays optional', async () => {
    const expo = stubExpo();
    await seedShared();

    const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/sync-wake`, {
      token: await mintToken(USER_1),
      body: {},
    });

    expect(res.status).toBe(200);
    expect((await res.json()) as WakeResponse).toEqual({ wake: { attempted: 1, sent: 1 } });
    // The caller's user is excluded, so BOTH of USER_1's devices stay out.
    expect(expo.recipients()).toEqual([TOKEN_2A]);
    expect(expo.messages()[0]?.data.type).toBe(BUDGET_SYNC_WAKE_TYPE);
  });

  it('LF-V2-WAKE-211: House WITHOUT sourceDeviceId also succeeds, with house_sync_wake', async () => {
    const expo = stubExpo();
    await seedShared();

    const res = await call('symply-house', 'POST', `/households/${HH_SHARED}/sync-wake`, {
      token: await mintToken(USER_1),
      body: {},
    });

    expect(res.status).toBe(200);
    expect(expo.recipients()).toEqual([TOKEN_2A]);
    expect(expo.messages()[0]?.data).toEqual({
      type: HOUSE_SYNC_WAKE_TYPE,
      householdId: HH_SHARED,
    });
  });

  it('LF-V2-WAKE-212: Budget never answers source_device_required', async () => {
    const expo = stubExpo();
    await seedShared();

    for (const rawBody of ['', '{not json', '{}', '{"sourceDeviceId":null}']) {
      const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/sync-wake`, {
        token: await mintToken(USER_1),
        rawBody,
      });
      expect(res.status).toBe(200);
    }
    expect(expo.recipients()).toEqual([TOKEN_2A, TOKEN_2A, TOKEN_2A, TOKEN_2A]);
  });

  it('LF-V2-WAKE-213: a supplied sourceDeviceId REPLACES the user exclusion, and reaches the caller’s own second device', async () => {
    // The exclusions are exclusive, not cumulative. Naming the device is what
    // lets USER_1's tablet be woken by USER_1's phone — the peer the old
    // cumulative form could never reach, because it shared a user_id with the
    // depositing device.
    const expo = stubExpo();
    await seedShared();

    const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/sync-wake`, {
      token: await mintToken(USER_1),
      body: { sourceDeviceId: DEV_1A },
    });

    expect(res.status).toBe(200);
    expect(expo.recipients().sort()).toEqual([TOKEN_1B, TOKEN_2A].sort());
    // The depositing device itself is still never in its own fan-out.
    expect(expo.recipients()).not.toContain(TOKEN_1A);
  });

  it('LF-V2-WAKE-214: the peer member wakes the owner back, excluding only their own user', async () => {
    const expo = stubExpo();
    await seedShared();

    await call('symply-budget', 'POST', `/households/${HH_SHARED}/sync-wake`, {
      token: await mintToken(USER_2),
      body: { sourceDeviceId: DEV_2A },
    });

    expect(expo.recipients().sort()).toEqual([TOKEN_1A, TOKEN_1B].sort());
    expect(expo.recipients()).not.toContain(TOKEN_2A);
  });
});

/* ========================================================================== */
/* Auth / membership precede the brand policy                                 */
/* ========================================================================== */

describe('sync-wake guards', () => {
  it('LF-V2-WAKE-220: no bearer token → 401, no push', async () => {
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      token: null,
      body: { sourceDeviceId: DEV_A },
    });

    expect(res.status).toBe(401);
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });

  it('LF-V2-WAKE-221: a non-member gets 403 BEFORE the source-device check', async () => {
    // Order matters: a 400 here would tell an unauthorised caller which brand
    // policy the household runs under, and would do it before membership was
    // ever established.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      token: await mintToken(OUTSIDER),
      body: {},
    });

    expect(res.status).toBe(403);
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* The deposit path — POST /v2/households/:id/mailbox                          */
/* ========================================================================== */

describe('POST /v2/households/:id/mailbox — the deposit wake', () => {
  it('LF-V2-WAKE-230: a Health deposit from device A wakes device B', async () => {
    // The end-to-end headline: one personal household, one user, a deposit from
    // A, and B gets a `health_sync_wake`. Impossible by construction pre-fix —
    // wrong type AND an exclusion that matched every row.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_A, ciphertextBase64: CIPHERTEXT_B64 },
    });

    expect(res.status).toBe(201);
    expect(await waitForRecipients(expo, 1)).toEqual([TOKEN_B]);
    expect(expo.messages()[0]?.data).toEqual({
      type: HEALTH_SYNC_WAKE_TYPE,
      householdId: HH_SOLO,
    });
  });

  it('LF-V2-WAKE-231: the depositing device never wakes itself', async () => {
    const expo = stubExpo();
    await seedSolo();

    await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_A, ciphertextBase64: CIPHERTEXT_B64 },
    });

    await waitForRecipients(expo, 1);
    await settle();
    expect(expo.recipients()).not.toContain(TOKEN_A);
    expect(expo.recipients()).toEqual([TOKEN_B]);
  });

  it('LF-V2-WAKE-232: a Health deposit WITHOUT sourceDeviceId emits NOTHING', async () => {
    // Refusal, not a fan-out to everyone-including-self. The deposit itself must
    // still succeed — the blob is the durable part; the wake is the optimisation.
    const expo = stubExpo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { ciphertextBase64: CIPHERTEXT_B64 },
    });

    expect(res.status).toBe(201);
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sync wake skipped'));
  });

  it('LF-V2-WAKE-233: a Budget deposit wakes the other member AND the depositor’s own second device', async () => {
    // The end-to-end shape of the multi-device fix, over HTTP: one deposit from
    // USER_1's phone reaches USER_2's phone and USER_1's tablet alike, and never
    // the phone that deposited.
    const expo = stubExpo();
    await seedShared();

    const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/mailbox`, {
      token: await mintToken(USER_1),
      body: { sourceDeviceId: DEV_1A, ciphertextBase64: CIPHERTEXT_B64 },
    });

    expect(res.status).toBe(201);
    expect((await waitForRecipients(expo, 2)).sort()).toEqual([TOKEN_1B, TOKEN_2A].sort());
    expect(expo.recipients()).not.toContain(TOKEN_1A);
    expect(expo.messages()[0]?.data.type).toBe(BUDGET_SYNC_WAKE_TYPE);
  });

  it('LF-V2-WAKE-234: a Budget deposit WITHOUT sourceDeviceId still wakes the peer member', async () => {
    // Where Health refuses, Budget degrades: the caller-user fallback is on its
    // own sufficient to keep the depositor out of the fan-out. It costs USER_1's
    // own tablet its wake, which is why it is a fallback and not the rule.
    const expo = stubExpo();
    await seedShared();

    const res = await call('symply-budget', 'POST', `/households/${HH_SHARED}/mailbox`, {
      token: await mintToken(USER_1),
      body: { ciphertextBase64: CIPHERTEXT_B64 },
    });

    expect(res.status).toBe(201);
    expect(await waitForRecipients(expo, 1)).toEqual([TOKEN_2A]);
  });

  it('LF-V2-WAKE-235: a `wake: false` chunk deposits without waking anyone', async () => {
    // Chunked push marks every chunk but the last `wake: false`; the fix must
    // not have turned a mid-push chunk into a push notification.
    const expo = stubExpo();
    await seedSolo();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_A, ciphertextBase64: CIPHERTEXT_B64, wake: false },
    });

    expect(res.status).toBe(201);
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });

  it('LF-V2-WAKE-236: a deposit from a device the caller does not own is 403, and silent', async () => {
    const expo = stubExpo();
    await seedSolo();
    await seedShared();

    const res = await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_2A, ciphertextBase64: CIPHERTEXT_B64 },
    });

    expect(res.status).toBe(403);
    await settle();
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* Three copies of the exclusion rule — pinned to agree                       */
/* ========================================================================== */

/**
 * The exclusion rule exists in THREE places, and each is documented as if it
 * were the only one:
 *
 *  1. `buildSyncWakeRequest` (service) — "Both `/v2` call sites go through this
 *     so the two paths cannot drift". Nothing in `src/` calls it.
 *  2. `enqueueSyncWake` (route) — "The ONLY place a sync wake is emitted. Both
 *     `/v2` call sites go through it". Only the mailbox deposit does.
 *  3. The `POST .../sync-wake` handler, which re-derives the same policy inline
 *     and calls `sendSyncWake` directly.
 *
 * They agree today. Nothing enforces it, and the original bug WAS an asymmetry
 * between two wake paths — so these compare the three by the only thing that
 * matters: who actually gets woken.
 */
describe('the deposit path, the sync-wake route and buildSyncWakeRequest agree', () => {
  async function viaService(
    brand: Brand,
    input: { householdId: string; callerUserId: string; sourceDeviceId?: string | null },
  ): Promise<string[]> {
    const expo = stubExpo();
    const brandedEnv = brandEnv(brand);
    await new LocalFirstSyncWakeService(brandedEnv).sendSyncWake(
      buildSyncWakeRequest(brandedEnv, input),
    );
    const recipients = expo.recipients();
    vi.unstubAllGlobals();
    return recipients.sort();
  }

  async function viaSyncWakeRoute(
    brand: Brand,
    input: { householdId: string; callerUserId: string; sourceDeviceId?: string | null },
  ): Promise<string[]> {
    const expo = stubExpo();
    await call(brand, 'POST', `/households/${input.householdId}/sync-wake`, {
      token: await mintToken(input.callerUserId),
      body: { sourceDeviceId: input.sourceDeviceId ?? null },
    });
    const recipients = expo.recipients();
    vi.unstubAllGlobals();
    return recipients.sort();
  }

  async function viaDeposit(
    brand: Brand,
    input: { householdId: string; callerUserId: string; sourceDeviceId?: string | null },
  ): Promise<string[]> {
    await clearCoalesceWindow();
    const expo = stubExpo();
    await call(brand, 'POST', `/households/${input.householdId}/mailbox`, {
      token: await mintToken(input.callerUserId),
      body: { sourceDeviceId: input.sourceDeviceId ?? null, ciphertextBase64: CIPHERTEXT_B64 },
    });
    await settle();
    const recipients = expo.recipients();
    vi.unstubAllGlobals();
    return recipients.sort();
  }

  it('LF-V2-WAKE-250: Health — all three wake exactly device B', async () => {
    await seedSolo();
    const input = { householdId: HH_SOLO, callerUserId: USER_SOLO, sourceDeviceId: DEV_A };

    expect(await viaService('symply-health', input)).toEqual([TOKEN_B]);
    expect(await viaSyncWakeRoute('symply-health', input)).toEqual([TOKEN_B]);
    expect(await viaDeposit('symply-health', input)).toEqual([TOKEN_B]);
  });

  it('LF-V2-WAKE-251: Budget — all three wake every device but the depositing one', async () => {
    await seedShared();
    const input = { householdId: HH_SHARED, callerUserId: USER_1, sourceDeviceId: DEV_1A };
    const expected = [TOKEN_1B, TOKEN_2A].sort();

    expect(await viaService('symply-budget', input)).toEqual(expected);
    expect(await viaSyncWakeRoute('symply-budget', input)).toEqual(expected);
    expect(await viaDeposit('symply-budget', input)).toEqual(expected);
  });

  it('LF-V2-WAKE-252: House with no source device — all three still agree', async () => {
    await seedShared();
    const input = { householdId: HH_SHARED, callerUserId: USER_1 };

    expect(await viaService('symply-house', input)).toEqual([TOKEN_2A]);
    expect(await viaSyncWakeRoute('symply-house', input)).toEqual([TOKEN_2A]);
    expect(await viaDeposit('symply-house', input)).toEqual([TOKEN_2A]);
  });
});

/* ========================================================================== */
/* Payload safety over the wire                                                */
/* ========================================================================== */

describe('wake payload safety', () => {
  it('LF-V2-WAKE-240: the deposit wake carries only { type, householdId }', async () => {
    const expo = stubExpo();
    await seedSolo();

    await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_A, ciphertextBase64: CIPHERTEXT_B64 },
    });
    await waitForRecipients(expo, 1);

    const message = expo.messages()[0];
    expect(message).toBeDefined();
    validateOpaqueWakePayload(message!.data, [HEALTH_SYNC_WAKE_TYPE]);
    expect(Object.keys(message!.data).sort()).toEqual(['householdId', 'type']);
    expect(message!._contentAvailable).toBe(true);
    expect(message!.sound).toBeNull();
  });

  it('LF-V2-WAKE-241: no prohibited key and no ciphertext ever reaches the push', async () => {
    const expo = stubExpo();
    await seedSolo();

    await call('symply-health', 'POST', `/households/${HH_SOLO}/mailbox`, {
      body: { sourceDeviceId: DEV_A, ciphertextBase64: CIPHERTEXT_B64 },
    });
    await waitForRecipients(expo, 1);

    const wire = JSON.stringify(expo.messages());
    for (const prohibited of PROHIBITED_WAKE_PAYLOAD_KEYS) {
      expect(wire).not.toContain(`"${prohibited}"`);
    }
    // The deposited op batch is opaque to the relay and must stay off the push.
    expect(wire).not.toContain(CIPHERTEXT_B64);
    expect(wire).not.toContain('opaque-encrypted-op-batch');
    // Nor any device or user identifier.
    expect(wire).not.toContain(USER_SOLO);
    expect(wire).not.toContain(DEV_A);
  });

  it('LF-V2-WAKE-242: the /sync-wake route emits the same opaque payload', async () => {
    const expo = stubExpo();
    await seedSolo();

    await call('symply-health', 'POST', `/households/${HH_SOLO}/sync-wake`, {
      body: { sourceDeviceId: DEV_A },
    });

    const message = expo.messages()[0];
    expect(message).toBeDefined();
    validateOpaqueWakePayload(message!.data, [HEALTH_SYNC_WAKE_TYPE]);
    expect(JSON.stringify(message!.data)).not.toContain(DEV_A);
  });
});
