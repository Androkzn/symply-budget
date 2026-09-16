/**
 * Household AI key sharing — the control-plane guarantees.
 *
 * The interesting properties are all authorization and custody, not crypto: the
 * envelope's secrecy is proved in `packages/local-first/__tests__/ai-key-share.test.ts`,
 * and this file proves the Worker gives it to the right people, refuses the
 * wrong ones, and never learns the key.
 *
 * Runs against a live miniflare D1 rather than a fake — these are SQL questions,
 * and a fake would only prove the fake (same reasoning as the household gate test).
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { AiKeyShareService } from '../ai-key-share-service';
import type { Env } from '../../types';

const testEnv = env as unknown as Env;

const HOUSEHOLD = 'hh_share';
const OWNER = 'u_owner';
const MEMBER = 'u_member';
const OUTSIDER = 'u_outsider';

/** A realistic sealed envelope: base64, and containing no key material. */
const SEALED = 'Zm9vYmFyYmF6cXV1eGNvcmdlZ3JhdWx0Z2FycGx5d2FsZG9mcmVkcGx1Z2g=';

async function createTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_memberships (id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, revoked_at TEXT)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT, display_name TEXT)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_ai_key_shares (id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, provider TEXT NOT NULL, ciphertext TEXT NOT NULL, key_epoch INTEGER NOT NULL, envelope_version TEXT NOT NULL DEFAULT 'v1', key_hint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (household_id, owner_user_id, provider))`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_ai_key_share_consents (share_id TEXT NOT NULL, user_id TEXT NOT NULL, consent_version TEXT NOT NULL, consent_at TEXT NOT NULL, last_used_at TEXT, PRIMARY KEY (share_id, user_id))`,
  );
}

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  for (const table of [
    'lf_ai_key_share_consents',
    'lf_ai_key_shares',
    'lf_memberships',
    'lf_households',
    'users',
  ]) {
    await testEnv.DB.exec(`DELETE FROM ${table}`);
  }

  await testEnv.DB.prepare(
    `INSERT INTO lf_households (id, owner_user_id, display_name, key_epoch, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(HOUSEHOLD, OWNER, 'Home', now, now)
    .run();

  for (const [userId, role, name] of [
    [OWNER, 'OWNER', 'Ann'],
    [MEMBER, 'ADULT', 'Bob'],
  ] as const) {
    await testEnv.DB.prepare(
      `INSERT INTO lf_memberships (id, household_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`,
    )
      .bind(`m_${userId}`, HOUSEHOLD, userId, role, now)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`,
    )
      .bind(userId, `${userId}@example.test`, name)
      .run();
  }

  await testEnv.DB.prepare(`INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`)
    .bind(OUTSIDER, 'out@example.test', 'Mallory')
    .run();
}

function service(): AiKeyShareService {
  return new AiKeyShareService(testEnv);
}

async function shareOwnersKey(): Promise<string> {
  const result = await service().upsertShare({
    householdId: HOUSEHOLD,
    userId: OWNER,
    provider: 'anthropic',
    ciphertext: SEALED,
    keyEpoch: 1,
    envelopeVersion: 'v1',
    keyHint: 'abcd',
  });
  return result.id;
}

describe('AiKeyShareService', () => {
  beforeEach(async () => {
    await createTables();
    await seed();
  });

  describe('membership', () => {
    it('refuses to list for a non-member', async () => {
      await expect(service().listShares(HOUSEHOLD, OUTSIDER)).rejects.toThrow(
        /not a member/i,
      );
    });

    it('refuses to share into a household the caller is not in', async () => {
      await expect(
        service().upsertShare({
          householdId: HOUSEHOLD,
          userId: OUTSIDER,
          provider: 'openai',
          ciphertext: SEALED,
          keyEpoch: 1,
          envelopeVersion: 'v1',
          keyHint: 'abcd',
        }),
      ).rejects.toThrow(/not a member/i);
    });

    it('refuses the envelope to a revoked member', async () => {
      const shareId = await shareOwnersKey();
      await service().recordConsent({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
        consentVersion: '2026-07-21',
      });
      await testEnv.DB.prepare(
        `UPDATE lf_memberships SET status = 'revoked' WHERE user_id = ?`,
      )
        .bind(MEMBER)
        .run();

      // Consent already given is not a standing grant — membership is rechecked.
      await expect(
        service().readShareEnvelope({ householdId: HOUSEHOLD, userId: MEMBER, shareId }),
      ).rejects.toThrow(/not a member/i);
    });
  });

  describe('publishing', () => {
    it('stores the sealed envelope and reports the hint', async () => {
      const result = await shareOwnersKey();
      const row = await testEnv.DB.prepare(
        `SELECT ciphertext, key_hint, key_epoch FROM lf_ai_key_shares WHERE id = ?`,
      )
        .bind(result)
        .first<{ ciphertext: string; key_hint: string; key_epoch: number }>();

      expect(row?.ciphertext).toBe(SEALED);
      expect(row?.key_hint).toBe('abcd');
      expect(row?.key_epoch).toBe(1);
    });

    it('replaces the caller’s own share rather than creating a second row', async () => {
      const first = await shareOwnersKey();
      const second = await service().upsertShare({
        householdId: HOUSEHOLD,
        userId: OWNER,
        provider: 'anthropic',
        ciphertext: `${SEALED.slice(0, -4)}AAAA`,
        keyEpoch: 1,
        envelopeVersion: 'v1',
        keyHint: 'wxyz',
      });

      expect(second.id).toBe(first);
      const { results } = await testEnv.DB.prepare(
        `SELECT id FROM lf_ai_key_shares WHERE household_id = ?`,
      )
        .bind(HOUSEHOLD)
        .all();
      expect(results).toHaveLength(1);
    });

    it('rejects a share sealed under a stale key epoch', async () => {
      // The HDK rotated (a device was revoked) but this device sealed under the
      // old one — every other member would fail to open it.
      await testEnv.DB.prepare(`UPDATE lf_households SET key_epoch = 2 WHERE id = ?`)
        .bind(HOUSEHOLD)
        .run();

      await expect(
        service().upsertShare({
          householdId: HOUSEHOLD,
          userId: OWNER,
          provider: 'anthropic',
          ciphertext: SEALED,
          keyEpoch: 1,
          envelopeVersion: 'v1',
          keyHint: 'abcd',
        }),
      ).rejects.toThrow(/stale key epoch/i);
    });

    it('refuses a hint longer than four characters', async () => {
      // Guards against a client that "hints" with most of the key.
      await expect(
        service().upsertShare({
          householdId: HOUSEHOLD,
          userId: OWNER,
          provider: 'anthropic',
          ciphertext: SEALED,
          keyEpoch: 1,
          envelopeVersion: 'v1',
          keyHint: 'sk-ant-api03-abcd',
        }),
      ).rejects.toThrow(/at most 4/i);
    });

    it('refuses a non-base64 envelope', async () => {
      await expect(
        service().upsertShare({
          householdId: HOUSEHOLD,
          userId: OWNER,
          provider: 'anthropic',
          ciphertext: 'sk-ant-api03-a-plaintext-key-by-mistake',
          keyEpoch: 1,
          envelopeVersion: 'v1',
          keyHint: 'abcd',
        }),
      ).rejects.toThrow(/base64/i);
    });

    it('refuses an unknown provider', async () => {
      await expect(
        service().upsertShare({
          householdId: HOUSEHOLD,
          userId: OWNER,
          provider: 'deepseek',
          ciphertext: SEALED,
          keyEpoch: 1,
          envelopeVersion: 'v1',
          keyHint: 'abcd',
        }),
      ).rejects.toThrow(/unsupported/i);
    });
  });

  describe('consent gate', () => {
    it('refuses the envelope to a member who has not accepted the disclosure', async () => {
      const shareId = await shareOwnersKey();
      await expect(
        service().readShareEnvelope({ householdId: HOUSEHOLD, userId: MEMBER, shareId }),
      ).rejects.toThrow(/disclosure/i);
    });

    it('releases the envelope once the member consents', async () => {
      const shareId = await shareOwnersKey();
      await service().recordConsent({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
        consentVersion: '2026-07-21',
      });

      const envelope = await service().readShareEnvelope({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
      });
      expect(envelope.ciphertext).toBe(SEALED);
      expect(envelope.keyEpoch).toBe(1);
      expect(envelope.ownerUserId).toBe(OWNER);
    });

    it('does not ask the owner to consent to their own key', async () => {
      const shareId = await shareOwnersKey();
      const envelope = await service().readShareEnvelope({
        householdId: HOUSEHOLD,
        userId: OWNER,
        shareId,
      });
      expect(envelope.ciphertext).toBe(SEALED);
    });
  });

  describe('listing', () => {
    it('marks the caller’s own share and reports the sharer by name', async () => {
      await shareOwnersKey();

      const [asOwner] = await service().listShares(HOUSEHOLD, OWNER);
      expect(asOwner?.isMine).toBe(true);

      const [asMember] = await service().listShares(HOUSEHOLD, MEMBER);
      expect(asMember?.isMine).toBe(false);
      expect(asMember?.ownerName).toBe('Ann');
      expect(asMember?.keyHint).toBe('abcd');
      expect(asMember?.consented).toBe(false);
    });

    it('never returns the sealed envelope in the list', async () => {
      await shareOwnersKey();
      const [summary] = await service().listShares(HOUSEHOLD, MEMBER);
      expect(JSON.stringify(summary)).not.toContain(SEALED);
    });

    it('reflects the caller’s consent once given', async () => {
      const shareId = await shareOwnersKey();
      await service().recordConsent({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
        consentVersion: '2026-07-21',
      });
      const [summary] = await service().listShares(HOUSEHOLD, MEMBER);
      expect(summary?.consented).toBe(true);
    });
  });

  describe('revocation', () => {
    it('stops a consented member from fetching the envelope again', async () => {
      const shareId = await shareOwnersKey();
      await service().recordConsent({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
        consentVersion: '2026-07-21',
      });
      await service().readShareEnvelope({ householdId: HOUSEHOLD, userId: MEMBER, shareId });

      await service().revokeShare({
        householdId: HOUSEHOLD,
        userId: OWNER,
        provider: 'anthropic',
      });

      await expect(
        service().readShareEnvelope({ householdId: HOUSEHOLD, userId: MEMBER, shareId }),
      ).rejects.toThrow(/not found/i);
      expect(await service().listShares(HOUSEHOLD, MEMBER)).toHaveLength(0);
    });

    it('names the members who were using the key, so they can be told', async () => {
      const shareId = await shareOwnersKey();
      await service().recordConsent({
        householdId: HOUSEHOLD,
        userId: MEMBER,
        shareId,
        consentVersion: '2026-07-21',
      });

      const result = await service().revokeShare({
        householdId: HOUSEHOLD,
        userId: OWNER,
        provider: 'anthropic',
      });
      expect(result.notify).toEqual([MEMBER]);
    });

    it('tells nobody when the share was never accepted', async () => {
      await shareOwnersKey();
      const result = await service().revokeShare({
        householdId: HOUSEHOLD,
        userId: OWNER,
        provider: 'anthropic',
      });
      expect(result.notify).toEqual([]);
    });

    it('lets only the owner revoke their share', async () => {
      await shareOwnersKey();
      // The DELETE is scoped by owner_user_id, so a member's attempt matches no row.
      await expect(
        service().revokeShare({
          householdId: HOUSEHOLD,
          userId: MEMBER,
          provider: 'anthropic',
        }),
      ).rejects.toThrow(/not found/i);
      expect(await service().listShares(HOUSEHOLD, OWNER)).toHaveLength(1);
    });
  });

  describe('notification audience', () => {
    it('excludes the sharer from the members to notify', async () => {
      expect(await service().memberUserIds(HOUSEHOLD, OWNER)).toEqual([MEMBER]);
    });

    it('omits revoked members', async () => {
      await testEnv.DB.prepare(
        `UPDATE lf_memberships SET status = 'revoked' WHERE user_id = ?`,
      )
        .bind(MEMBER)
        .run();
      expect(await service().memberUserIds(HOUSEHOLD, OWNER)).toEqual([]);
    });
  });
});
