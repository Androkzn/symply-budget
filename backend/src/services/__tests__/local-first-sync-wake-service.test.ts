/**
 * The per-brand sync-wake policy, and the peer query it drives.
 *
 * THE BUG THIS PINS (three defects that compounded into "Health never syncs"):
 *
 *  1. **Wrong wake type.** The selector was
 *     `isFullBudget(env) ? BUDGET_SYNC_WAKE_TYPE : HOUSE_SYNC_WAKE_TYPE`.
 *     Health's `budgetMode` is `'minimal'` (brand-capabilities.ts), so Health
 *     fell into the `else` and emitted `house_sync_wake`. The client filter is a
 *     hard equality on the type string, so every Health wake was dropped on
 *     arrival — the push was delivered and then discarded.
 *
 *  2. **The exclusion excluded everyone.** The peer query is
 *     `... AND id != ? AND user_id != ?`. Excluding the caller's `user_id` is
 *     right for Budget/House, whose households hold several users. It is WRONG
 *     for Health: a personal ledger is ONE user with N devices, so
 *     `user_id != <the only user>` matches **zero rows** and the wake is
 *     structurally impossible. LF-WAKE-121 replays exactly that query against
 *     the same seeded household and shows it waking nobody.
 *
 *  3. **Dropping `excludeUserId` alone would have been worse.** With neither
 *     exclusion the caller is in its own fan-out: deposit → wake → syncOnce →
 *     deposit. `requiresSourceDeviceId` is what makes the call sites refuse
 *     instead (LF-WAKE-140, and the 400 in local-first-v2-sync-wake.test.ts).
 *
 * AND THE FOURTH, WHICH WAS THE SAME DEFECT ON THE OTHER BRANDS
 * ------------------------------------------------------------
 * Defect 2 was diagnosed as "Health is personal, so its exclusion has to differ".
 * The narrower truth is that `excludeUserId` was never the right predicate for
 * anybody: a peer is a DEVICE, and the caller's own second device is a peer.
 * Budget/House applied the user exclusion ON TOP OF the device one, so a member
 * with a phone and a tablet had their second device dropped from every fan-out
 * their first one caused — the only peer in the household that could never be
 * woken. Excluding the depositing device alone is now the rule on every brand
 * (LF-WAKE-116, LF-WAKE-130, LF-WAKE-134); the user exclusion survives only as
 * the fallback for a request that names no device (LF-WAKE-117, LF-WAKE-132).
 *
 * Harness: `cloudflare:test` D1 with the real post-0156 `lf_devices` shape, so
 * the peer query is executed by SQLite rather than by a hand-written double —
 * the defect lived in a WHERE clause, which is precisely what a double hides.
 * Expo is intercepted at `fetch`.
 */

import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isFullBudget, type AppBrand } from '../../config/brand';
import type { Env } from '../../types';
import {
  BUDGET_SYNC_WAKE_TYPE,
  HEALTH_SYNC_WAKE_TYPE,
  HOUSE_SYNC_WAKE_TYPE,
  LOCAL_FIRST_SYNC_WAKE_TYPES,
  LOCAL_FIRST_WAKE_POLICY,
  LocalFirstSyncWakeService,
  PROHIBITED_WAKE_PAYLOAD_KEYS,
  buildHealthSyncWakePayload,
  buildSyncWakeRequest,
  requiresSourceDeviceId,
  resolveSyncWakePolicy,
  validateOpaqueWakePayload,
} from '../local-first-sync-wake-service';

const testEnv = env as unknown as Env;

const ALL_BRANDS: readonly AppBrand[] = [
  'symply-house',
  'symply-budget',
  'symply-kaizen',
  'symply-health',
];

/* -------------------------------------------------------------------------- */
/* D1 — the real control-plane shape (migrations 0152 + 0154 + 0156)           */
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
  // Post-0156: PRIMARY KEY (household_id, id) — one row per (household, device).
  // The FK is kept: this pool reports PRAGMA foreign_keys = 1 like deployed D1.
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
];

async function createTables(): Promise<void> {
  for (const stmt of DDL) {
    await testEnv.DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
}

async function resetTables(): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_devices');
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

async function seedDevice(input: {
  householdId: string;
  deviceId: string;
  userId: string;
  token?: string | null;
  status?: 'active' | 'revoked';
}): Promise<void> {
  const now = new Date().toISOString();
  await testEnv.DB.prepare(
    `INSERT INTO lf_devices
      (id, household_id, user_id, device_label, signing_public_key, agreement_public_key,
       status, last_seen_at, created_at, revoked_at, expo_push_token, push_platform)
     VALUES (?, ?, ?, NULL, 'sign', 'agree', ?, ?, ?, NULL, ?, 'ios')`,
  )
    .bind(
      input.deviceId,
      input.householdId,
      input.userId,
      input.status ?? 'active',
      now,
      now,
      input.token ?? null,
    )
    .run();
}

/* -------------------------------------------------------------------------- */
/* Env + Expo doubles                                                         */
/* -------------------------------------------------------------------------- */

function brandEnv(brand: AppBrand): Env {
  return { ...testEnv, APP_BRAND: brand, EXPO_ACCESS_TOKEN: 'expo-test-token' } as Env;
}

type ExpoMessage = {
  to: string;
  data: Record<string, unknown>;
  _contentAvailable?: boolean;
  sound?: unknown;
  title?: unknown;
  body?: unknown;
};

/** Captures every message Expo was asked to deliver, across all batches. */
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

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Health: a PERSONAL ledger — one user, two devices. */
const HH_SOLO = 'hh_health_solo';
const USER_SOLO = 'u_solo';
const DEV_A = 'dev_health_a';
const DEV_B = 'dev_health_b';
const TOKEN_A = 'ExponentPushToken[health-a]';
const TOKEN_B = 'ExponentPushToken[health-b]';

/** Budget/House: a SHARED household — two users, three devices. */
const HH_SHARED = 'hh_shared';
const USER_1 = 'u_one';
const USER_2 = 'u_two';
const DEV_1A = 'dev_one_a';
const DEV_1B = 'dev_one_b';
const DEV_2A = 'dev_two_a';
const TOKEN_1A = 'ExponentPushToken[one-a]';
const TOKEN_1B = 'ExponentPushToken[one-b]';
const TOKEN_2A = 'ExponentPushToken[two-a]';

async function seedSolo(): Promise<void> {
  await seedHousehold(HH_SOLO, USER_SOLO);
  await seedDevice({ householdId: HH_SOLO, deviceId: DEV_A, userId: USER_SOLO, token: TOKEN_A });
  await seedDevice({ householdId: HH_SOLO, deviceId: DEV_B, userId: USER_SOLO, token: TOKEN_B });
}

async function seedShared(): Promise<void> {
  await seedHousehold(HH_SHARED, USER_1);
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_1A, userId: USER_1, token: TOKEN_1A });
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_1B, userId: USER_1, token: TOKEN_1B });
  await seedDevice({ householdId: HH_SHARED, deviceId: DEV_2A, userId: USER_2, token: TOKEN_2A });
}

beforeEach(async () => {
  await createTables();
  await resetTables();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ========================================================================== */
/* Policy table                                                               */
/* ========================================================================== */

describe('LOCAL_FIRST_WAKE_POLICY', () => {
  it('LF-WAKE-100: is TOTAL over AppBrand — no brand can fall through to undefined', () => {
    // A partial map would hand a future brand `undefined.wakeType` at the call
    // site, i.e. a 500 on deposit rather than a missing push.
    expect(Object.keys(LOCAL_FIRST_WAKE_POLICY).sort()).toEqual([...ALL_BRANDS].sort());
    for (const brand of ALL_BRANDS) {
      const policy = LOCAL_FIRST_WAKE_POLICY[brand];
      expect(policy).toBeDefined();
      expect(LOCAL_FIRST_SYNC_WAKE_TYPES).toContain(policy.wakeType);
      expect(['caller-user', 'refuse']).toContain(policy.fallbackExclusion);
    }
  });

  it('LF-WAKE-101: Health → health_sync_wake, and has NO fallback exclusion', () => {
    expect(LOCAL_FIRST_WAKE_POLICY['symply-health']).toEqual({
      wakeType: HEALTH_SYNC_WAKE_TYPE,
      fallbackExclusion: 'refuse',
    });
  });

  it('LF-WAKE-102: Budget and House keep their type, and degrade to the caller user', () => {
    expect(LOCAL_FIRST_WAKE_POLICY['symply-budget']).toEqual({
      wakeType: BUDGET_SYNC_WAKE_TYPE,
      fallbackExclusion: 'caller-user',
    });
    expect(LOCAL_FIRST_WAKE_POLICY['symply-house']).toEqual({
      wakeType: HOUSE_SYNC_WAKE_TYPE,
      fallbackExclusion: 'caller-user',
    });
    // Kaizen 404s `/v2` before any wake, but the row must exist (LF-WAKE-100).
    expect(LOCAL_FIRST_WAKE_POLICY['symply-kaizen'].fallbackExclusion).toBe('caller-user');
  });

  it('LF-WAKE-103: the three wake types are distinct — the client filter is a hard equality', () => {
    expect(new Set(LOCAL_FIRST_SYNC_WAKE_TYPES).size).toBe(LOCAL_FIRST_SYNC_WAKE_TYPES.length);
    expect(HEALTH_SYNC_WAKE_TYPE).toBe('health_sync_wake');
  });
});

describe('resolveSyncWakePolicy', () => {
  it('LF-WAKE-110: resolves each brand off APP_BRAND', () => {
    expect(resolveSyncWakePolicy(brandEnv('symply-health')).wakeType).toBe(HEALTH_SYNC_WAKE_TYPE);
    expect(resolveSyncWakePolicy(brandEnv('symply-budget')).wakeType).toBe(BUDGET_SYNC_WAKE_TYPE);
    expect(resolveSyncWakePolicy(brandEnv('symply-house')).wakeType).toBe(HOUSE_SYNC_WAKE_TYPE);
  });

  it('LF-WAKE-111: Health no longer inherits the House type from the isFullBudget selector', () => {
    const healthEnv = brandEnv('symply-health');

    // The pre-fix selector, verbatim. Health's budgetMode is 'minimal', so
    // `isFullBudget` is false and the expression yields the HOUSE type.
    const preFix = isFullBudget(healthEnv) ? BUDGET_SYNC_WAKE_TYPE : HOUSE_SYNC_WAKE_TYPE;
    expect(isFullBudget(healthEnv)).toBe(false);
    expect(preFix).toBe(HOUSE_SYNC_WAKE_TYPE);

    // …and that is exactly what the client dropped.
    expect(resolveSyncWakePolicy(healthEnv).wakeType).toBe(HEALTH_SYNC_WAKE_TYPE);
    expect(resolveSyncWakePolicy(healthEnv).wakeType).not.toBe(preFix);
  });

  it('LF-WAKE-112: the same selector was and still is correct for Budget and House', () => {
    // The fix must not have moved Budget/House off the types their clients filter on.
    for (const brand of ['symply-budget', 'symply-house'] as const) {
      const brandedEnv = brandEnv(brand);
      const preFix = isFullBudget(brandedEnv) ? BUDGET_SYNC_WAKE_TYPE : HOUSE_SYNC_WAKE_TYPE;
      expect(resolveSyncWakePolicy(brandedEnv).wakeType).toBe(preFix);
    }
  });
});

describe('requiresSourceDeviceId', () => {
  it('LF-WAKE-113: is true for Health ONLY — it is the brand with no usable fallback', () => {
    expect(requiresSourceDeviceId(LOCAL_FIRST_WAKE_POLICY['symply-health'])).toBe(true);
    expect(requiresSourceDeviceId(LOCAL_FIRST_WAKE_POLICY['symply-budget'])).toBe(false);
    expect(requiresSourceDeviceId(LOCAL_FIRST_WAKE_POLICY['symply-house'])).toBe(false);
    expect(requiresSourceDeviceId(LOCAL_FIRST_WAKE_POLICY['symply-kaizen'])).toBe(false);
  });

  it('LF-WAKE-114: tracks fallbackExclusion for every brand, not a hardcoded list', () => {
    for (const brand of ALL_BRANDS) {
      const policy = LOCAL_FIRST_WAKE_POLICY[brand];
      expect(requiresSourceDeviceId(policy)).toBe(policy.fallbackExclusion === 'refuse');
    }
  });
});

/* ========================================================================== */
/* buildSyncWakeRequest — the exclusion set both call sites share              */
/* ========================================================================== */

describe('buildSyncWakeRequest', () => {
  it('LF-WAKE-115: Health excludes the SOURCE DEVICE and never the caller user', () => {
    expect(
      buildSyncWakeRequest(brandEnv('symply-health'), {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    ).toEqual({
      householdId: HH_SOLO,
      wakeType: HEALTH_SYNC_WAKE_TYPE,
      excludeDeviceId: DEV_A,
      excludeUserId: null,
    });
  });

  it('LF-WAKE-116: Budget/House exclude the SOURCE DEVICE only, so the caller’s other devices stay in', () => {
    // The exclusions are exclusive, not cumulative. Applying both is what used
    // to drop a member's own second device out of every fan-out their first one
    // caused — the one peer in the household that could never be told.
    expect(
      buildSyncWakeRequest(brandEnv('symply-budget'), {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    ).toEqual({
      householdId: HH_SHARED,
      wakeType: BUDGET_SYNC_WAKE_TYPE,
      excludeDeviceId: DEV_1A,
      excludeUserId: null,
    });

    expect(
      buildSyncWakeRequest(brandEnv('symply-house'), {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    ).toEqual({
      householdId: HH_SHARED,
      wakeType: HOUSE_SYNC_WAKE_TYPE,
      excludeDeviceId: DEV_1A,
      excludeUserId: null,
    });
  });

  it('LF-WAKE-117: with no source device, Budget/House fall back to the caller user', () => {
    // No shipped client omits it, but the field is optional on the wire. The
    // fallback is the PRE-FIX behaviour: worse (the caller's own devices are
    // excluded again) but never a self-wake.
    expect(
      buildSyncWakeRequest(brandEnv('symply-house'), {
        householdId: HH_SHARED,
        callerUserId: USER_1,
      }),
    ).toEqual({
      householdId: HH_SHARED,
      wakeType: HOUSE_SYNC_WAKE_TYPE,
      excludeDeviceId: null,
      excludeUserId: USER_1,
    });
  });

  it('LF-WAKE-118: with no source device, Health excludes NOTHING — and the call sites refuse it', () => {
    // `refuse` has no exclusion to fall back to: `user_id != <the only user>`
    // matches zero rows. The request this builds would wake the caller, which is
    // why `requiresSourceDeviceId` gates it one step earlier.
    expect(requiresSourceDeviceId(LOCAL_FIRST_WAKE_POLICY['symply-health'])).toBe(true);
    expect(
      buildSyncWakeRequest(brandEnv('symply-health'), {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
      }),
    ).toEqual({
      householdId: HH_SOLO,
      wakeType: HEALTH_SYNC_WAKE_TYPE,
      excludeDeviceId: null,
      excludeUserId: null,
    });
  });
});

/* ========================================================================== */
/* THE HEADLINE — personal household, 2 devices, ONE user                     */
/* ========================================================================== */

describe('Health personal household — one user, two devices', () => {
  it('LF-WAKE-120: a deposit from device A wakes device B', async () => {
    const expo = stubExpo();
    await seedSolo();
    const healthEnv = brandEnv('symply-health');

    const result = await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    expect(result).toEqual({ attempted: 1, sent: 1 });
    expect(expo.recipients()).toEqual([TOKEN_B]);
    expect(expo.messages()[0]?.data).toEqual({
      type: HEALTH_SYNC_WAKE_TYPE,
      householdId: HH_SOLO,
    });
  });

  it('LF-WAKE-121: the PRE-FIX exclusion wakes nobody in that same household', async () => {
    // This is the bug, executed. Same rows, same service — only the exclusion
    // set is the old one (`user_id != <the only user>`), and it matches zero of
    // the two devices because both belong to that one user.
    const expo = stubExpo();
    await seedSolo();

    const result = await new LocalFirstSyncWakeService(brandEnv('symply-health')).sendSyncWake({
      householdId: HH_SOLO,
      wakeType: HOUSE_SYNC_WAKE_TYPE, // …and the wrong type, for good measure.
      excludeDeviceId: DEV_A,
      excludeUserId: USER_SOLO,
    });

    expect(result).toEqual({ attempted: 0, sent: 0 });
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });

  it('LF-WAKE-122: device A never receives its own wake', async () => {
    const expo = stubExpo();
    await seedSolo();
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    expect(expo.recipients()).not.toContain(TOKEN_A);
  });

  it('LF-WAKE-123: it is symmetric — a deposit from B wakes A', async () => {
    const expo = stubExpo();
    await seedSolo();
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_B,
      }),
    );

    expect(expo.recipients()).toEqual([TOKEN_A]);
  });

  it('LF-WAKE-124: a third device on the same user is woken too', async () => {
    const expo = stubExpo();
    await seedSolo();
    await seedDevice({
      householdId: HH_SOLO,
      deviceId: 'dev_health_c',
      userId: USER_SOLO,
      token: 'ExponentPushToken[health-c]',
    });
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    expect(expo.recipients().sort()).toEqual(
      [TOKEN_B, 'ExponentPushToken[health-c]'].sort(),
    );
  });

  it('LF-WAKE-125: a revoked or token-less peer is still skipped', async () => {
    const expo = stubExpo();
    await seedSolo();
    await seedDevice({
      householdId: HH_SOLO,
      deviceId: 'dev_revoked',
      userId: USER_SOLO,
      token: 'ExponentPushToken[revoked]',
      status: 'revoked',
    });
    await seedDevice({
      householdId: HH_SOLO,
      deviceId: 'dev_no_token',
      userId: USER_SOLO,
      token: null,
    });
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    expect(expo.recipients()).toEqual([TOKEN_B]);
  });

  it('LF-WAKE-126: another household in the same D1 is never in the fan-out', async () => {
    const expo = stubExpo();
    await seedSolo();
    await seedShared();
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    expect(expo.recipients()).toEqual([TOKEN_B]);
  });
});

/* ========================================================================== */
/* The refusal that keeps defect 2's fix from becoming a push loop            */
/* ========================================================================== */

describe('unexcluded fan-out', () => {
  it('LF-WAKE-140: with NO exclusions the caller is in its own fan-out, and it warns', async () => {
    // Why `requiresSourceDeviceId` exists. Dropping `excludeUserId` for Health
    // without demanding a device id leaves nothing between a wake and the
    // caller waking itself: deposit → wake → syncOnce → deposit.
    const expo = stubExpo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSolo();

    const result = await new LocalFirstSyncWakeService(brandEnv('symply-health')).sendSyncWake({
      householdId: HH_SOLO,
      wakeType: HEALTH_SYNC_WAKE_TYPE,
    });

    expect(result.attempted).toBe(2);
    expect(expo.recipients().sort()).toEqual([TOKEN_A, TOKEN_B].sort());
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unexcluded fan-out'),
      expect.objectContaining({ householdId: HH_SOLO }),
    );
  });

  it('LF-WAKE-141: a supplied exclusion is never treated as "exclude nothing"', async () => {
    // The earlier form bound '' for a missing exclusion and compared `id != ''`,
    // which is true for every row.
    const expo = stubExpo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedSolo();

    await new LocalFirstSyncWakeService(brandEnv('symply-health')).sendSyncWake({
      householdId: HH_SOLO,
      wakeType: HEALTH_SYNC_WAKE_TYPE,
      excludeDeviceId: DEV_A,
      excludeUserId: null,
    });

    expect(expo.recipients()).toEqual([TOKEN_B]);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('unexcluded fan-out'),
      expect.anything(),
    );
  });
});

/* ========================================================================== */
/* Budget / House — unregressed                                               */
/* ========================================================================== */

describe('Budget and House shared households', () => {
  it('LF-WAKE-130: Budget wakes the OTHER MEMBER and the caller’s own second device', async () => {
    const expo = stubExpo();
    await seedShared();
    const budgetEnv = brandEnv('symply-budget');

    const result = await new LocalFirstSyncWakeService(budgetEnv).sendSyncWake(
      buildSyncWakeRequest(budgetEnv, {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    );

    // TOKEN_1B is USER_1's own other device. It used to be excluded along with
    // the depositing one, purely because it shared a user_id with it — so a
    // change made on the tablet reached the housemate's phone in seconds and the
    // author's own phone not until they next opened the app.
    expect(result).toEqual({ attempted: 2, sent: 2 });
    expect(expo.recipients().sort()).toEqual([TOKEN_1B, TOKEN_2A].sort());
    expect(expo.messages()[0]?.data).toEqual({
      type: BUDGET_SYNC_WAKE_TYPE,
      householdId: HH_SHARED,
    });
  });

  it('LF-WAKE-131: House behaves identically, with house_sync_wake', async () => {
    const expo = stubExpo();
    await seedShared();
    const houseEnv = brandEnv('symply-house');

    await new LocalFirstSyncWakeService(houseEnv).sendSyncWake(
      buildSyncWakeRequest(houseEnv, {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    );

    expect(expo.recipients().sort()).toEqual([TOKEN_1B, TOKEN_2A].sort());
    expect(expo.messages()[0]?.data).toEqual({
      type: HOUSE_SYNC_WAKE_TYPE,
      householdId: HH_SHARED,
    });
  });

  it('LF-WAKE-131b: the depositing device never receives its own wake', async () => {
    // The whole reason the device exclusion has to be present rather than
    // merely preferred: deposit → wake → syncOnce → deposit.
    const expo = stubExpo();
    await seedShared();
    const houseEnv = brandEnv('symply-house');

    await new LocalFirstSyncWakeService(houseEnv).sendSyncWake(
      buildSyncWakeRequest(houseEnv, {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    );

    expect(expo.recipients()).not.toContain(TOKEN_1A);
  });

  it('LF-WAKE-132: with no sourceDeviceId, Budget/House degrade to the user exclusion', async () => {
    const expo = stubExpo();
    await seedShared();
    const budgetEnv = brandEnv('symply-budget');

    const result = await new LocalFirstSyncWakeService(budgetEnv).sendSyncWake(
      buildSyncWakeRequest(budgetEnv, { householdId: HH_SHARED, callerUserId: USER_1 }),
    );

    // Worse than the device exclusion — USER_1's own second device is dropped
    // again — but never a self-wake, which is the only thing the fallback owes.
    expect(result).toEqual({ attempted: 1, sent: 1 });
    expect(expo.recipients()).toEqual([TOKEN_2A]);
    expect(expo.recipients()).not.toContain(TOKEN_1A);
  });

  it('LF-WAKE-133: a third member is woken alongside the second', async () => {
    const expo = stubExpo();
    await seedShared();
    await seedDevice({
      householdId: HH_SHARED,
      deviceId: 'dev_three_a',
      userId: 'u_three',
      token: 'ExponentPushToken[three-a]',
    });
    const budgetEnv = brandEnv('symply-budget');

    await new LocalFirstSyncWakeService(budgetEnv).sendSyncWake(
      buildSyncWakeRequest(budgetEnv, {
        householdId: HH_SHARED,
        callerUserId: USER_1,
        sourceDeviceId: DEV_1A,
      }),
    );

    expect(expo.recipients().sort()).toEqual(
      [TOKEN_1B, TOKEN_2A, 'ExponentPushToken[three-a]'].sort(),
    );
  });

  it('LF-WAKE-134: a ONE-MEMBER Budget household with two devices wakes the second one', async () => {
    // The case the old policy got structurally wrong. Budget/House households
    // MAY hold several users; they do not have to, and a household of one
    // person with a phone and a tablet is two peers, not zero. Excluding by
    // user_id made this household unsyncable in the background — the same
    // failure Health had, on a brand nobody thought to check for it.
    const expo = stubExpo();
    await seedHousehold('hh_budget_solo', 'u_budget_solo');
    await seedDevice({
      householdId: 'hh_budget_solo',
      deviceId: 'dev_bs_a',
      userId: 'u_budget_solo',
      token: 'ExponentPushToken[bs-a]',
    });
    await seedDevice({
      householdId: 'hh_budget_solo',
      deviceId: 'dev_bs_b',
      userId: 'u_budget_solo',
      token: 'ExponentPushToken[bs-b]',
    });
    const budgetEnv = brandEnv('symply-budget');

    const result = await new LocalFirstSyncWakeService(budgetEnv).sendSyncWake(
      buildSyncWakeRequest(budgetEnv, {
        householdId: 'hh_budget_solo',
        callerUserId: 'u_budget_solo',
        sourceDeviceId: 'dev_bs_a',
      }),
    );

    expect(result).toEqual({ attempted: 1, sent: 1 });
    expect(expo.recipients()).toEqual(['ExponentPushToken[bs-b]']);
  });

  it('LF-WAKE-135: a lone device in a lone-member household still wakes nobody', async () => {
    // The genuinely peerless case, kept distinct from LF-WAKE-134 so "wakes
    // nobody" cannot quietly come back as the answer for both.
    const expo = stubExpo();
    await seedHousehold('hh_lone', 'u_lone');
    await seedDevice({
      householdId: 'hh_lone',
      deviceId: 'dev_lone',
      userId: 'u_lone',
      token: 'ExponentPushToken[lone]',
    });
    const houseEnv = brandEnv('symply-house');

    const result = await new LocalFirstSyncWakeService(houseEnv).sendSyncWake(
      buildSyncWakeRequest(houseEnv, {
        householdId: 'hh_lone',
        callerUserId: 'u_lone',
        sourceDeviceId: 'dev_lone',
      }),
    );

    expect(result).toEqual({ attempted: 0, sent: 0 });
    expect(expo.fetchMock).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* Payload safety — no health data ever rides on a push                       */
/* ========================================================================== */

describe('opaque wake payload', () => {
  it('LF-WAKE-150: buildHealthSyncWakePayload returns only { type, householdId }', () => {
    const payload = buildHealthSyncWakePayload('hh_abc');
    expect(payload).toEqual({ type: HEALTH_SYNC_WAKE_TYPE, householdId: 'hh_abc' });
    expect(Object.keys(payload).sort()).toEqual(['householdId', 'type']);
  });

  it('LF-WAKE-151: health_sync_wake passes the validator, alone and in the default set', () => {
    expect(() =>
      validateOpaqueWakePayload(buildHealthSyncWakePayload('hh_abc'), [HEALTH_SYNC_WAKE_TYPE]),
    ).not.toThrow();
    // The default allowlist must know the type too, or a Health wake would be
    // rejected by any caller that omits the explicit list.
    expect(LOCAL_FIRST_SYNC_WAKE_TYPES).toContain(HEALTH_SYNC_WAKE_TYPE);
    expect(() => validateOpaqueWakePayload(buildHealthSyncWakePayload('hh_abc'))).not.toThrow();
  });

  it('LF-WAKE-152: every prohibited key is rejected on a health payload', () => {
    for (const prohibited of PROHIBITED_WAKE_PAYLOAD_KEYS) {
      expect(() =>
        validateOpaqueWakePayload({
          type: HEALTH_SYNC_WAKE_TYPE,
          householdId: 'hh_1',
          [prohibited]: 'leak',
        }),
      ).toThrow(/prohibited_wake_field/);
    }
  });

  it('LF-WAKE-153: health-shaped extras are rejected as hard as financial ones', () => {
    // Not in PROHIBITED_WAKE_PAYLOAD_KEYS by name — the validator is an
    // ALLOWLIST, which is what makes a new domain safe without a list edit.
    for (const key of ['weightKg', 'calories', 'cycleDay', 'heartRate', 'medication']) {
      expect(() =>
        validateOpaqueWakePayload({ type: HEALTH_SYNC_WAKE_TYPE, householdId: 'hh_1', [key]: 1 }),
      ).toThrow(new RegExp(`prohibited_wake_field:${key}`));
    }
  });

  it('LF-WAKE-154: the wire message carries nothing but the opaque payload', async () => {
    const expo = stubExpo();
    await seedSolo();
    const healthEnv = brandEnv('symply-health');

    await new LocalFirstSyncWakeService(healthEnv).sendSyncWake(
      buildSyncWakeRequest(healthEnv, {
        householdId: HH_SOLO,
        callerUserId: USER_SOLO,
        sourceDeviceId: DEV_A,
      }),
    );

    const message = expo.messages()[0];
    expect(message).toBeDefined();
    validateOpaqueWakePayload(message!.data, [HEALTH_SYNC_WAKE_TYPE]);
    expect(Object.keys(message!.data).sort()).toEqual(['householdId', 'type']);
    // Silent background wake, not a user-visible notification.
    expect(message!._contentAvailable).toBe(true);
    expect(message!.sound).toBeNull();
    expect(message!.title).toBeUndefined();
    expect(message!.body).toBeUndefined();

    const wire = JSON.stringify(expo.messages());
    for (const prohibited of PROHIBITED_WAKE_PAYLOAD_KEYS) {
      expect(wire).not.toContain(`"${prohibited}"`);
    }
  });

  it('LF-WAKE-155: the emitted type is validated against the BRAND type, not the union', async () => {
    // `sendSyncWake` validates with `[wakeType]`, so a mismatch between the
    // policy's type and the payload it builds would throw rather than ship a
    // wake the client silently drops (defect 1's failure mode).
    const expo = stubExpo();
    await seedShared();
    const houseEnv = brandEnv('symply-house');

    await new LocalFirstSyncWakeService(houseEnv).sendSyncWake(
      buildSyncWakeRequest(houseEnv, { householdId: HH_SHARED, callerUserId: USER_1 }),
    );

    expect(expo.messages()[0]?.data.type).toBe(HOUSE_SYNC_WAKE_TYPE);
    expect(() =>
      validateOpaqueWakePayload(expo.messages()[0]!.data, [HEALTH_SYNC_WAKE_TYPE]),
    ).toThrow(/invalid_wake_type/);
  });
});
