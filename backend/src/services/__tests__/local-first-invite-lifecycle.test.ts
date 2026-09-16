/**
 * The half of household enrolment that happens after the code is handed over:
 * naming the household, listing what is still outstanding, cancelling it, and
 * retiring it when nobody acted in time.
 *
 * Each of these closes a state that had no exit. An invitee confirmed a join
 * that replaced their budget knowing only an opaque `hh_local_…` id; an owner
 * who closed the app could neither show nor cancel the code they had minted;
 * and an invite that expired left its claimant on "Waiting for approval…"
 * forever, because `expires_at` was advisory and the row never moved.
 *
 * Runs against a live miniflare D1 rather than a fake — these are SQL questions,
 * and a fake would only prove the fake.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import { LocalFirstControlService } from '../local-first-control-service';

const testEnv = env as unknown as Env;

const HOUSEHOLD = 'hh_local_test';
const OWNER = 'u_owner';
const INVITEE = 'u_invitee';
const STRANGER = 'u_stranger';

async function createTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_memberships (id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_invites (id TEXT PRIMARY KEY NOT NULL, household_id TEXT NOT NULL, short_code TEXT NOT NULL, secret_hash TEXT NOT NULL, role TEXT NOT NULL, created_by_user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', expires_at TEXT NOT NULL, invitee_email TEXT, claimed_by_user_id TEXT, claimed_device_id TEXT, claimed_signing_public_key TEXT, claimed_agreement_public_key TEXT, sas_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY NOT NULL, email TEXT, display_name TEXT)`,
  );
}

/** `hours` from now, negative for the past. */
function at(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

async function seedInvite(input: {
  id: string;
  shortCode: string;
  status?: string;
  expiresAt?: string;
  claimedBy?: string | null;
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
      input.expiresAt ?? at(24),
      input.claimedBy ?? null,
      now,
      now,
    )
    .run();
}

function service(): LocalFirstControlService {
  return new LocalFirstControlService(testEnv);
}

beforeEach(async () => {
  await createTables();
  await testEnv.DB.exec('DELETE FROM lf_invites');
  await testEnv.DB.exec('DELETE FROM lf_memberships');
  await testEnv.DB.exec('DELETE FROM lf_households');
  await testEnv.DB.exec('DELETE FROM users');
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
  await testEnv.DB.prepare(
    `INSERT INTO users (id, email, display_name) VALUES (?, ?, ?)`,
  )
    .bind(INVITEE, 'them@example.com', 'Sam')
    .run();
});

describe('lookupInvite — naming the household', () => {
  it('says which household the code opens, not just its id', async () => {
    // The invitee confirms a join that REPLACES the budget on their device.
    // An opaque id is not something anyone can consent to.
    await seedInvite({ id: 'inv_1', shortCode: 'ABC123' });
    const found = await service().lookupInviteByShortCode('abc123');
    expect(found).toMatchObject({ householdId: HOUSEHOLD, householdName: 'The Smiths' });
  });

  it('still resolves an invite whose household row has gone missing', async () => {
    // LEFT JOIN, not INNER: a dangling invite must fail honestly later rather
    // than read as "invite not found" here.
    await seedInvite({ id: 'inv_1', shortCode: 'ABC123' });
    await testEnv.DB.exec('DELETE FROM lf_households');
    const found = await service().lookupInviteByShortCode('ABC123');
    expect(found).toMatchObject({ inviteId: 'inv_1', householdName: null });
  });

  it('answers the same by id as by code', async () => {
    await seedInvite({ id: 'inv_1', shortCode: 'ABC123' });
    const byCode = await service().lookupInviteByShortCode('ABC123');
    const byId = await service().lookupInviteById('inv_1');
    expect(byId).toEqual(byCode);
  });
});

describe('listOutstandingInvites', () => {
  it('carries unclaimed invites, which the who-is-waiting list cannot', async () => {
    // The gap this closes: an owner who minted a code and closed the app had no
    // way back to it — it lived in the screen's memory and nowhere else.
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    await seedInvite({ id: 'inv_claimed', shortCode: 'BBB222', status: 'claimed', claimedBy: INVITEE });
    const invites = await service().listOutstandingInvites(HOUSEHOLD, OWNER);
    expect(invites.map((i) => i.inviteId).sort()).toEqual(['inv_active', 'inv_claimed']);
  });

  it('resolves the claimant to a person', async () => {
    await seedInvite({ id: 'inv_claimed', shortCode: 'BBB222', status: 'claimed', claimedBy: INVITEE });
    const [invite] = await service().listOutstandingInvites(HOUSEHOLD, OWNER);
    expect(invite).toMatchObject({ claimedByEmail: 'them@example.com', claimedByDisplayName: 'Sam' });
  });

  it('leaves out invites that are already settled', async () => {
    await seedInvite({ id: 'inv_approved', shortCode: 'CCC333', status: 'approved' });
    await seedInvite({ id: 'inv_revoked', shortCode: 'DDD444', status: 'revoked' });
    await seedInvite({ id: 'inv_expired', shortCode: 'EEE555', status: 'expired' });
    expect(await service().listOutstandingInvites(HOUSEHOLD, OWNER)).toEqual([]);
  });

  it('refuses a stranger', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    await expect(service().listOutstandingInvites(HOUSEHOLD, STRANGER)).rejects.toThrow(
      'not_a_member',
    );
  });
});

describe('revokeInvite', () => {
  it('kills a code that was sent to the wrong person', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    const context = await service().revokeInvite({
      householdId: HOUSEHOLD,
      inviteId: 'inv_active',
      actorUserId: OWNER,
    });
    expect(context.status).toBe('revoked');
    expect(await service().listOutstandingInvites(HOUSEHOLD, OWNER)).toEqual([]);
  });

  it('returns the claimant, so somebody can be told the wait is over', async () => {
    await seedInvite({ id: 'inv_claimed', shortCode: 'BBB222', status: 'claimed', claimedBy: INVITEE });
    const context = await service().revokeInvite({
      householdId: HOUSEHOLD,
      inviteId: 'inv_claimed',
      actorUserId: OWNER,
    });
    expect(context).toMatchObject({ claimedByUserId: INVITEE, householdName: 'The Smiths' });
  });

  it('refuses an approved invite rather than quietly un-enrolling a device', async () => {
    // That device holds the household key. Removing it is device revocation —
    // a different act, with different consequences.
    await seedInvite({ id: 'inv_approved', shortCode: 'CCC333', status: 'approved', claimedBy: INVITEE });
    await expect(
      service().revokeInvite({
        householdId: HOUSEHOLD,
        inviteId: 'inv_approved',
        actorUserId: OWNER,
      }),
    ).rejects.toThrow('invite_already_approved');
  });

  it('is idempotent, and does not re-notify on the second tap', async () => {
    await seedInvite({ id: 'inv_revoked', shortCode: 'DDD444', status: 'revoked', claimedBy: INVITEE });
    const context = await service().revokeInvite({
      householdId: HOUSEHOLD,
      inviteId: 'inv_revoked',
      actorUserId: OWNER,
    });
    // Status comes back as it already was — the route only notifies on a
    // transition it actually made.
    expect(context.status).toBe('revoked');
  });

  it('refuses a stranger', async () => {
    await seedInvite({ id: 'inv_active', shortCode: 'AAA111' });
    await expect(
      service().revokeInvite({
        householdId: HOUSEHOLD,
        inviteId: 'inv_active',
        actorUserId: STRANGER,
      }),
    ).rejects.toThrow('not_a_member');
  });
});

describe('sweepExpiredInvites', () => {
  it('retires invites nobody acted on in time', async () => {
    await seedInvite({ id: 'inv_old', shortCode: 'AAA111', expiresAt: at(-1) });
    await seedInvite({ id: 'inv_fresh', shortCode: 'BBB222', expiresAt: at(5) });
    await service().sweepExpiredInvites();
    const outstanding = await service().listOutstandingInvites(HOUSEHOLD, OWNER);
    expect(outstanding.map((i) => i.inviteId)).toEqual(['inv_fresh']);
  });

  it('returns only the ones with somebody left waiting', async () => {
    // An unclaimed invite that lapses disappoints nobody; a claimed one leaves a
    // device on "Waiting for approval…" that will never come.
    await seedInvite({ id: 'inv_unclaimed', shortCode: 'AAA111', expiresAt: at(-1) });
    await seedInvite({
      id: 'inv_claimed',
      shortCode: 'BBB222',
      status: 'claimed',
      claimedBy: INVITEE,
      expiresAt: at(-2),
    });
    const notifiable = await service().sweepExpiredInvites();
    expect(notifiable.map((c) => c.inviteId)).toEqual(['inv_claimed']);
    expect(notifiable[0]).toMatchObject({ claimedByUserId: INVITEE, status: 'expired' });
  });

  it('leaves settled invites alone, so nobody is told twice', async () => {
    await seedInvite({
      id: 'inv_approved',
      shortCode: 'CCC333',
      status: 'approved',
      claimedBy: INVITEE,
      expiresAt: at(-10),
    });
    expect(await service().sweepExpiredInvites()).toEqual([]);
    const row = await testEnv.DB.prepare(`SELECT status FROM lf_invites WHERE id = 'inv_approved'`)
      .first<{ status: string }>();
    expect(row?.status).toBe('approved');
  });
});
