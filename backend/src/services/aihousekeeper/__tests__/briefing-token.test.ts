/**
 * briefing-token.ts — plan §B11
 *
 * mint → verify roundtrip, bad signature, expired, malformed, revocation
 * via household_members.deleted_at.
 */

import { env } from 'cloudflare:test';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../../db/schema';
import type { Env } from '../../../types';
import {
  mintBriefingToken,
  verifyBriefingToken,
} from '../briefing-token';

import { createCoreTables, resetAllTables } from './test-helpers';

const testEnv = env as unknown as Env;

async function seedSigningKey() {
  await testEnv.CONFIG_KV.put(
    'aihousekeeper_briefing_signing_key_v1',
    'sufficiently-long-test-signing-key-32-bytes-min'
  );
  await testEnv.CONFIG_KV.put('aihousekeeper_briefing_signing_key_version', 'v1');
}

describe('briefing-token', () => {
  beforeEach(async () => {
    await createCoreTables(testEnv.DB);
    await resetAllTables(testEnv.DB);
    await seedSigningKey();
  });

  it('mint → verify roundtrips with {ok:true, revoked:false}', async () => {
    const token = await mintBriefingToken(
      {
        hid: 'hh_briefing_01',
        date: '2026-04-23',
        uid: 'u_alice_01',
        iat: Math.floor(Date.now() / 1000),
      },
      testEnv
    );
    const result = await verifyBriefingToken(token, testEnv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hid).toBe('hh_briefing_01');
      expect(result.date).toBe('2026-04-23');
      expect(result.revoked).toBe(false);
    }
  });

  it('rejects a tampered signature with bad_signature', async () => {
    const token = await mintBriefingToken(
      {
        hid: 'hh_briefing_02',
        date: '2026-04-23',
        uid: 'u_bob_01',
        iat: Math.floor(Date.now() / 1000),
      },
      testEnv
    );
    // Flip a character in the signature segment.
    const tampered = token.slice(0, -4) + 'AAAA';
    const result = await verifyBriefingToken(tampered, testEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['bad_signature', 'malformed']).toContain(result.reason);
    }
  });

  it('rejects a malformed token (too few parts)', async () => {
    const result = await verifyBriefingToken('onlyonepart', testEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('rejects an expired token', async () => {
    const weekPlusOneSecondAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600 - 1;
    const token = await mintBriefingToken(
      {
        hid: 'hh_briefing_03',
        date: '2026-04-23',
        uid: 'u_carol_01',
        iat: weekPlusOneSecondAgo,
      },
      testEnv
    );
    const result = await verifyBriefingToken(token, testEnv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('reports revoked=true when household_member was soft-deleted after iat', async () => {
    const db = drizzle(testEnv.DB, { schema });
    const hid = 'hh_briefing_04';
    const uid = 'u_dan_01';
    const now = new Date();
    const nowIso = now.toISOString();
    // Seed user + household + member (soft-deleted AFTER iat).
    await db.insert(schema.users).values({
      id: uid,
      email: 'dan@example.com',
      email_verified: true,
    });
    await db.insert(schema.households).values({ id: hid, name: 'Dan House' });
    await db.insert(schema.householdMembers).values({
      id: 'm_dan_01',
      household_id: hid,
      user_id: uid,
      role: 'owner',
      joined_at: new Date(now.getTime() - 86_400_000).toISOString(),
      deleted_at: nowIso,
    });

    // Mint a token issued one hour BEFORE deletion.
    const iat = Math.floor(now.getTime() / 1000) - 3600;
    const token = await mintBriefingToken(
      { hid, date: '2026-04-23', uid, iat },
      testEnv
    );
    const result = await verifyBriefingToken(token, testEnv, db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revoked).toBe(true);
    }
  });
});
