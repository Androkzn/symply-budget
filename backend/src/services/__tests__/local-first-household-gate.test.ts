/**
 * H7 P4 — email/push digests are OFF for local-first households (plan §9, Q8).
 *
 * **The hazard this closes.** Under E2EE the Worker's D1 holds no domain rows for
 * a local-first household, and the plan's expectation was that server compute
 * therefore degrades to a harmless no-op. `mirrorLegacyMembership` broke that
 * assumption: V2 households ARE mirrored into the legacy `households` /
 * `household_members` tables so chat and the other `/households/:id/...`
 * features keep working — which means anything enumerating households now sees
 * local-first ones. For the weekly digest that is not a no-op, because it would
 * compose and **send** an email built from an empty week.
 *
 * Runs against a live miniflare D1 rather than a fake: the gate is one SQL
 * question, and a fake would only prove the fake.
 */
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '../../types';
import {
  isLocalFirstHousehold,
  localFirstHouseholdIds,
} from '../local-first-household-gate';

const testEnv = env as unknown as Env;

async function createTables(): Promise<void> {
  await testEnv.DB.exec(
    `CREATE TABLE IF NOT EXISTS lf_households (id TEXT PRIMARY KEY NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 1, security_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
}

async function seed(ids: string[]): Promise<void> {
  await testEnv.DB.exec('DELETE FROM lf_households');
  const now = new Date().toISOString();
  for (const id of ids) {
    await testEnv.DB.prepare(
      `INSERT INTO lf_households (id, owner_user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, 'u_owner', 'Home', now, now)
      .run();
  }
}

describe('localFirstHouseholdIds', () => {
  beforeEach(async () => {
    await createTables();
    await seed([]);
  });

  it('is empty when no household has gone local-first', async () => {
    expect((await localFirstHouseholdIds(testEnv)).size).toBe(0);
  });

  it('returns every registered local-first household', async () => {
    await seed(['hh_local_a', 'hh_local_b']);
    const ids = await localFirstHouseholdIds(testEnv);
    expect([...ids].sort()).toEqual(['hh_local_a', 'hh_local_b']);
  });

  it('does not claim a server-only household', async () => {
    await seed(['hh_local_a']);
    const ids = await localFirstHouseholdIds(testEnv);
    // A legacy household that never registered with the control plane must keep
    // receiving its digests — this gate only silences the encrypted ones.
    expect(ids.has('hh_server_only')).toBe(false);
  });

  it('answers the single-household question consistently with the set', async () => {
    await seed(['hh_local_a']);
    await expect(isLocalFirstHousehold(testEnv, 'hh_local_a')).resolves.toBe(true);
    await expect(isLocalFirstHousehold(testEnv, 'hh_server_only')).resolves.toBe(false);
  });

  it('fails OPEN on a brand whose D1 predates the control plane', async () => {
    // Kaizen/Health D1s can lack `lf_households` entirely. Throwing here would
    // take down the whole cron tick for a brand that has no local-first
    // households to skip in the first place.
    await testEnv.DB.exec('DROP TABLE IF EXISTS lf_households');
    await expect(localFirstHouseholdIds(testEnv)).resolves.toEqual(new Set());
    await createTables();
  });
});

describe('the digest gate, as the composer applies it', () => {
  // Mirrors `DigestComposer.runDueThisHour`'s predicate. Pinned here because the
  // consequence of getting it backwards is silent and outward-facing: either a
  // local-first household is emailed a digest built from an empty D1, or a
  // normal household stops receiving one.
  const shouldSkip = (localFirst: Set<string>, householdId: string) => localFirst.has(householdId);

  it('skips a local-first household', async () => {
    await createTables();
    await seed(['hh_local_a']);
    const ids = await localFirstHouseholdIds(testEnv);
    expect(shouldSkip(ids, 'hh_local_a')).toBe(true);
  });

  it('still delivers to a server-authoritative household', async () => {
    await createTables();
    await seed(['hh_local_a']);
    const ids = await localFirstHouseholdIds(testEnv);
    expect(shouldSkip(ids, 'hh_legacy_b')).toBe(false);
  });
});
