/**
 * HealthSocialService — the rules of the ported Symply Health SOCIAL domain (P4).
 *
 * The routes are a thin pass-through (covered in
 * routes/__tests__/health-social.test.ts, which also owns the CONFIG_KV kill
 * switch, the brand gate and the auth sweeps). This suite owns the things a
 * privacy review actually cares about, at the layer where they are decided:
 *
 *   1. THE SCOPE ALLOWLIST — `validateScopes` is a pure function and is driven
 *      here with no D1 at all, including every sensitive domain by name.
 *   2. THE STORAGE-LEVEL EXCLUSION — migration 0121 puts the same allowlist in a
 *      CHECK constraint, so a bypass of the service still cannot persist a
 *      `cycle` grant. Asserted directly against D1.
 *   3. THE CASCADES — leaving a family, being removed, and un-buddying each
 *      revoke grants SYMMETRICALLY, and only for that relationship type.
 *   4. THE READ PAYLOAD — `readSharedMetrics` returns exactly the granted
 *      groups, computed from the P1 tables, tombstones excluded.
 *
 * D1-backed specs run against live miniflare D1 with the migration-0121 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern
 * as services/__tests__/health-food-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthSocialTables,
  createHealthTables,
  insertHealthRow,
  listHealthRows,
  resetHealthSocialTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import {
  HealthSocialService,
  NEVER_SHAREABLE_SCOPES,
  SHAREABLE_SCOPES,
  assertScopeSetsAreDisjoint,
  generateInviteCode,
  inviteExpiryFrom,
  isPermanentlyExcludedScope,
  isShareableScope,
  normaliseEmail,
  publicGrant,
  round2,
  validateScopes,
  type Failure,
  type Result,
} from '../health-social-service';

const testEnv = env as unknown as Env;

const A = 'u_hs_alice';
const B = 'u_hs_bob';
const C = 'u_hs_carol';
const EMAIL = (id: string) => `${id}@example.com`;

const DAY = '2026-06-01';
const PREV = '2026-05-30';

function svc(): HealthSocialService {
  return new HealthSocialService(testEnv.DB);
}

function asFailure(result: { ok: boolean }): Failure {
  expect(result.ok).toBe(false);
  return result as unknown as Failure;
}

/** Narrows a service `Result<T>` to its success arm, or fails the spec loudly. */
function expectOk<T>(result: Result<T>): { ok: true } & T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  }
  return result;
}

/** A owns a family; `member` joins it through a real invite. Re-entrant. */
async function makeFamily(member: string): Promise<void> {
  const s = svc();
  if (!(await s.getFamily(A))) expectOk(await s.createFamily(A, 'Fam'));
  const invited = expectOk(await s.inviteToFamily(A, EMAIL(member)));
  expectOk(await s.acceptInvitation(member, invited.invitation.id));
}

/** A and `other` become accepted buddies. Returns the connection id. */
async function makeBuddies(other: string): Promise<string> {
  const s = svc();
  const req = expectOk(await s.requestBuddy(A, EMAIL(other)));
  expectOk(await s.acceptBuddy(other, req.request.id));
  return req.request.id;
}

const now = () => new Date().toISOString();

async function seedWeight(user: string, date: string, weight: number): Promise<void> {
  await insertHealthRow(testEnv.DB, 'weight_entries', {
    id: `w_${user}_${date}`,
    user_id: user,
    date,
    weight,
    unit: 'kg',
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  });
}

async function seedWater(user: string, date: string, ml: number, id: string): Promise<void> {
  await insertHealthRow(testEnv.DB, 'water_entries', {
    id,
    user_id: user,
    date,
    amount_ml: ml,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  });
}

async function seedEntry(
  user: string,
  date: string,
  type: string,
  data: Record<string, unknown>,
  id: string,
  deletedAt: string | null = null
): Promise<void> {
  await insertHealthRow(testEnv.DB, 'health_entries', {
    id,
    user_id: user,
    date,
    entry_type: type,
    data: JSON.stringify(data),
    source: 'manual',
    created_at: now(),
    updated_at: now(),
    deleted_at: deletedAt,
  });
}

async function seedNutrition(
  user: string,
  date: string,
  macros: { calories: number; proteins?: number; carbohydrates?: number; fats?: number },
  id: string,
  deletedAt: string | null = null
): Promise<void> {
  await insertHealthRow(testEnv.DB, 'nutrition_entries', {
    id,
    user_id: user,
    date,
    food_name: 'Food',
    meal_type: 'lunch',
    calories: macros.calories,
    proteins: macros.proteins ?? 0,
    carbohydrates: macros.carbohydrates ?? 0,
    fats: macros.fats ?? 0,
    created_at: now(),
    updated_at: now(),
    deleted_at: deletedAt,
  });
}

async function seedHabit(user: string, id: string, archived = false): Promise<void> {
  await insertHealthRow(testEnv.DB, 'user_habits', {
    id,
    user_id: user,
    name: `Habit ${id}`,
    is_archived: archived ? 1 : 0,
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  });
}

async function seedHabitLog(user: string, habitId: string, date: string): Promise<void> {
  await insertHealthRow(testEnv.DB, 'habit_logs', {
    id: `hl_${habitId}_${date}`,
    user_id: user,
    habit_id: habitId,
    date,
    completed_at: now(),
    created_at: now(),
    updated_at: now(),
    deleted_at: null,
  });
}

describe('HealthSocialService', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthSocialTables(testEnv.DB);
    await resetHealthSocialTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [A, B, C]);
  });

  /* ============ 1. Rule 2 — the scope allowlist (pure) ============== */

  describe('validateScopes (no D1)', () => {
    it('accepts every grantable scope', () => {
      const result = expectOk(validateScopes([...SHAREABLE_SCOPES]));
      expect(result.scopes.sort()).toEqual([...SHAREABLE_SCOPES].sort());
    });

    it.each([...NEVER_SHAREABLE_SCOPES])('refuses %s with forbidden_scope', (scope) => {
      const f = asFailure(validateScopes([scope]));
      expect(f.code).toBe('forbidden_scope');
      expect(f.status).toBe(400);
      // Named explicitly so the refusal is unmistakable in a log or a ticket.
      expect(f.message).toContain(scope);
    });

    it('refuses the WHOLE list when one sensitive scope rides along', () => {
      // Never partial: a half-applied grant would share `weight` while the
      // caller believes the request failed.
      const f = asFailure(validateScopes(['weight', 'water', 'cycle']));
      expect(f.code).toBe('forbidden_scope');
      expect(f.message).toContain('cycle');
      expect(f.message).not.toContain('weight');
    });

    it('separates a sensitive scope from a merely unknown one', () => {
      expect(asFailure(validateScopes(['blood_pressure'])).code).toBe('unknown_scope');
      expect(asFailure(validateScopes(['vitality'])).code).toBe('forbidden_scope');
      // A sensitive scope wins even when an unknown one is present, so the
      // strongest signal is the one that surfaces.
      expect(asFailure(validateScopes(['nope', 'cycle'])).code).toBe('forbidden_scope');
    });

    it('rejects an empty list', () => {
      expect(asFailure(validateScopes([])).code).toBe('bad_request');
    });

    it('de-duplicates', () => {
      expect(expectOk(validateScopes(['weight', 'weight', 'water'])).scopes).toEqual([
        'weight',
        'water',
      ]);
    });

    it('is case-sensitive — "Cycle" is unknown, not silently accepted', () => {
      // The refusal must never depend on a case-folding step nobody audits.
      expect(asFailure(validateScopes(['Cycle'])).code).toBe('unknown_scope');
      expect(asFailure(validateScopes(['WEIGHT'])).code).toBe('unknown_scope');
    });
  });

  describe('the scope constants', () => {
    it('never intersect — the module refuses to load if they do', () => {
      expect(() => assertScopeSetsAreDisjoint()).not.toThrow();
      for (const forbidden of NEVER_SHAREABLE_SCOPES) {
        expect(SHAREABLE_SCOPES).not.toContain(forbidden);
        expect(isShareableScope(forbidden)).toBe(false);
        expect(isPermanentlyExcludedScope(forbidden)).toBe(true);
      }
    });

    it('pins the exact grantable set — widening it is a privacy decision', () => {
      // This assertion exists to make "add one more scope" impossible to do
      // accidentally in a refactor: it fails until someone edits it on purpose.
      expect([...SHAREABLE_SCOPES].sort()).toEqual([
        'activity',
        'habits',
        'nutrition',
        'sleep',
        'water',
        'weight',
      ]);
      expect([...NEVER_SHAREABLE_SCOPES].sort()).toEqual([
        'body_measurements',
        'body_photos',
        'cycle',
        'vitality',
      ]);
    });

    it('covers every sensitive P1/P2 table by name', () => {
      // cycle_settings / period_entries / cycle_symptom_entries → cycle
      // mens_health_entries / mens_health_settings              → vitality
      // body_measurements                                        → body_measurements
      // user_files(body_photo) / body_*_insights                 → body_photos
      expect(NEVER_SHAREABLE_SCOPES).toHaveLength(4);
    });
  });

  /* ============ 2. Rule 2 at the storage layer ====================== */

  describe('the D1 CHECK constraint (bypassing the service entirely)', () => {
    it.each([...NEVER_SHAREABLE_SCOPES])('rejects a raw %s grant row', async (scope) => {
      const ts = now();
      await expect(
        testEnv.DB.prepare(
          `INSERT INTO health_metric_shares
             (id, owner_id, viewer_id, relationship_type, relationship_id, scope,
              granted_at, created_at, updated_at)
           VALUES (?, ?, ?, 'family', 'hfam_x', ?, ?, ?, ?)`
        )
          .bind(`hms_${scope}`, A, B, scope, ts, ts, ts)
          .run()
      ).rejects.toThrow();
    });

    it('rejects a self-grant row', async () => {
      const ts = now();
      await expect(
        testEnv.DB.prepare(
          `INSERT INTO health_metric_shares
             (id, owner_id, viewer_id, relationship_type, relationship_id, scope,
              granted_at, created_at, updated_at)
           VALUES ('hms_self', ?, ?, 'family', 'hfam_x', 'weight', ?, ?, ?)`
        )
          .bind(A, A, ts, ts, ts)
          .run()
      ).rejects.toThrow();
    });

    it('rejects a challenge built on a sensitive metric', async () => {
      const ts = now();
      await expect(
        testEnv.DB.prepare(
          `INSERT INTO health_challenges
             (id, creator_id, name, metric, target_value, start_date, created_at, updated_at)
           VALUES ('hchl_bad', ?, 'Cycle', 'cycle', 5, ?, ?, ?)`
        )
          .bind(A, DAY, ts, ts)
          .run()
      ).rejects.toThrow();
    });
  });

  /* ============ 3. Grants: create / revoke / revive ================= */

  describe('grantScopes', () => {
    it('requires a LIVE relationship — 404, never 403', async () => {
      const f = asFailure(
        await svc().grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expect(f.status).toBe(404);
      expect(f.code).toBe('not_found');
    });

    it('is indistinguishable for a stranger and for a non-existent account', async () => {
      const s = svc();
      const stranger = asFailure(
        await s.grantScopes(A, { viewer_id: C, relationship_type: 'buddy', scopes: ['weight'] })
      );
      const ghost = asFailure(
        await s.grantScopes(A, { viewer_id: 'nope', relationship_type: 'buddy', scopes: ['weight'] })
      );
      expect(stranger).toEqual(ghost);
    });

    it('refuses the family type when only a buddy link exists', async () => {
      // The two relationships are separate keys, so a buddy cannot be shared
      // with "as family" and inherit the family cascade.
      await makeBuddies(B);
      const f = asFailure(
        await svc().grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['weight'],
        })
      );
      expect(f.status).toBe(404);
    });

    it('writes one row per scope and none for a refused request', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['weight', 'water'],
        })
      );
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toHaveLength(2);

      asFailure(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['nutrition', 'cycle'],
        })
      );
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toHaveLength(2);
    });

    it('revive-in-place: re-granting a revoked scope reuses the row', async () => {
      await makeFamily(B);
      const s = svc();
      const first = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      const id = (first.grants[0] as { id: string }).id;
      expectOk(await s.revokeGrant(A, id));

      const again = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expect((again.grants[0] as { id: string }).id).toBe(id);
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toHaveLength(1);
    });

    it('a revoked grant stays in the OWNER list (audit) and leaves the viewer list', async () => {
      await makeFamily(B);
      const s = svc();
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(await s.revokeGrant(A, (g.grants[0] as { id: string }).id));

      const owned = await s.listGrants(A);
      expect(owned).toHaveLength(1);
      expect((owned[0] as { active: boolean }).active).toBe(false);
      expect(await s.listReceivedGrants(B)).toEqual([]);
    });

    it('the viewer cannot revoke the owner grant', async () => {
      await makeFamily(B);
      const s = svc();
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expect(asFailure(await s.revokeGrant(B, (g.grants[0] as { id: string }).id)).status).toBe(404);
    });

    it('revoking twice is idempotent and keeps the FIRST revocation stamp', async () => {
      await makeFamily(B);
      const s = svc();
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      const id = (g.grants[0] as { id: string }).id;
      const once = expectOk(await s.revokeGrant(A, id));
      const twice = expectOk(await s.revokeGrant(A, id));
      expect((twice.grant as { revoked_at: string }).revoked_at).toBe(
        (once.grant as { revoked_at: string }).revoked_at
      );
    });
  });

  /* ============ 4. Rules 3 + 4 — revocation and cascades ============ */

  describe('cascades', () => {
    it('leaving a family revokes BOTH directions and nothing else', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(
        await s.grantScopes(B, { viewer_id: A, relationship_type: 'family', scopes: ['water'] })
      );

      const left = expectOk(await s.leaveFamily(B));
      expect(left.revoked).toBe(2);
      expect(await s.listReceivedGrants(A)).toEqual([]);
      expect(await s.listReceivedGrants(B)).toEqual([]);
    });

    it('un-buddying revokes ONLY the buddy grants, leaving family grants intact', async () => {
      await makeFamily(B);
      const link = await makeBuddies(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'buddy', scopes: ['water'] })
      );

      const removed = expectOk(await s.removeBuddy(A, link));
      expect(removed.revoked).toBe(1);
      const left = await s.listReceivedGrants(B);
      expect(left).toHaveLength(1);
      expect((left[0] as { scope: string }).scope).toBe('weight');
    });

    it('does not touch a third party grant', async () => {
      await makeFamily(B);
      await makeFamily(C);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(
        await s.grantScopes(A, { viewer_id: C, relationship_type: 'family', scopes: ['weight'] })
      );

      expectOk(await s.leaveFamily(B));
      expect(await s.listReceivedGrants(B)).toEqual([]);
      // Carol never left, so her grant survives.
      expect(await s.listReceivedGrants(C)).toHaveLength(1);
    });

    it('the owner leaving hands the family to the earliest remaining member', async () => {
      // The donor refused, stranding a family whose owner deleted the app.
      await makeFamily(B);
      const s = svc();
      expectOk(await s.leaveFamily(A));
      const bobs = await s.getFamily(B);
      expect(bobs?.family.owner_id).toBe(B);
      expect(bobs?.role).toBe('owner');
      expect(bobs?.members).toHaveLength(1);
    });

    it('the last member leaving soft-deletes the family', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      expectOk(await s.leaveFamily(A));
      expect(await s.getFamily(A)).toBeNull();
      const rows = await listHealthRows<{ deleted_at: string | null }>(
        testEnv.DB,
        'health_families'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it('leaving frees the user to join another family (partial unique index)', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(await s.leaveFamily(B));
      // The tombstoned membership must not collide with the new one.
      expectOk(await s.createFamily(B, 'Bobs own'));
      expect((await s.getFamily(B))?.family.name).toBe('Bobs own');
    });

    it('removeMember is owner-only and answers 404 for a plain member', async () => {
      await makeFamily(B);
      expect(asFailure(await svc().removeMember(B, A)).status).toBe(404);
      expect((await svc().getFamily(A))?.members).toHaveLength(2);
    });

    it('the owner cannot remove themselves through removeMember', async () => {
      await makeFamily(B);
      expect(asFailure(await svc().removeMember(A, A)).code).toBe('cannot_remove_self');
    });
  });

  /* ============ 5. Rule 1 + 4 — the read path ====================== */

  describe('readSharedMetrics', () => {
    beforeEach(async () => {
      await seedWeight(A, PREV, 71);
      await seedWeight(A, DAY, 70.5);
      await seedWater(A, DAY, 500, 'wa1');
      await seedWater(A, DAY, 250, 'wa2');
      await seedNutrition(A, DAY, { calories: 300, proteins: 10, carbohydrates: 50, fats: 5 }, 'n1');
      await seedEntry(A, DAY, 'steps', { steps: 8000 }, 'e_steps');
      await seedEntry(A, DAY, 'workout', { minutes: 45 }, 'e_w1');
      await seedEntry(A, DAY, 'workout', { minutes: 15 }, 'e_w2');
      await seedEntry(A, DAY, 'sleep', { hours: 7.5 }, 'e_sleep');
      await seedHabit(A, 'h1');
      await seedHabit(A, 'h2');
      await seedHabit(A, 'h_archived', true);
      await seedHabitLog(A, 'h1', DAY);
    });

    it('returns null with no grant, even for a family member', async () => {
      await makeFamily(B);
      expect(await svc().readSharedMetrics(B, A, DAY)).toBeNull();
    });

    it('returns null for your own id — the share path is never a self-read', async () => {
      expect(await svc().readSharedMetrics(A, A, DAY)).toBeNull();
    });

    it('carries EXACTLY the granted groups and computes each correctly', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: [...SHAREABLE_SCOPES],
        })
      );
      const shared = await s.readSharedMetrics(B, A, DAY);
      expect(shared).not.toBeNull();
      expect(shared!.scopes.sort()).toEqual([...SHAREABLE_SCOPES].sort());
      expect(shared!.metrics).toEqual({
        activity: { steps: 8000, workout_minutes: 60, workout_count: 2 },
        nutrition: { calories: 300, proteins: 10, carbohydrates: 50, fats: 5 },
        // Latest entry ON OR BEFORE the day, so a gap day still shows a figure.
        weight: { value: 70.5, unit: 'kg', date: DAY },
        water: { total_ml: 750 },
        habits: { completed: 1, total: 2 },
        sleep: { hours: 7.5 },
      });
    });

    it('the payload keys are exactly the grantable groups — no sensitive key exists', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: [...SHAREABLE_SCOPES],
        })
      );
      const shared = await s.readSharedMetrics(B, A, DAY);
      expect(Object.keys(shared!.metrics).sort()).toEqual([...SHAREABLE_SCOPES].sort());
      for (const forbidden of NEVER_SHAREABLE_SCOPES) {
        expect(shared!.metrics).not.toHaveProperty(forbidden);
      }
      // The measurement / cycle / vitality figures themselves never appear.
      expect(JSON.stringify(shared)).not.toMatch(/waist|flow_level|libido|body_fat/);
    });

    it('a single grant yields a single group', async () => {
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['water'] })
      );
      const shared = await s.readSharedMetrics(B, A, DAY);
      expect(Object.keys(shared!.metrics)).toEqual(['water']);
    });

    it('excludes tombstoned rows from every figure', async () => {
      await makeFamily(B);
      const stamp = now();
      await testEnv.DB.prepare(`UPDATE water_entries SET deleted_at = ? WHERE id = 'wa2'`)
        .bind(stamp)
        .run();
      await testEnv.DB.prepare(`UPDATE nutrition_entries SET deleted_at = ? WHERE id = 'n1'`)
        .bind(stamp)
        .run();
      await testEnv.DB.prepare(`UPDATE health_entries SET deleted_at = ? WHERE id = 'e_w2'`)
        .bind(stamp)
        .run();
      const s = svc();
      expectOk(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['water', 'nutrition', 'activity'],
        })
      );
      const shared = await s.readSharedMetrics(B, A, DAY);
      expect(shared!.metrics.water).toEqual({ total_ml: 500 });
      expect(shared!.metrics.nutrition).toEqual({
        calories: 0,
        proteins: 0,
        carbohydrates: 0,
        fats: 0,
      });
      expect(shared!.metrics.activity).toEqual({
        steps: 8000,
        workout_minutes: 45,
        workout_count: 1,
      });
    });

    it('reads nothing after the grant is revoked', async () => {
      await makeFamily(B);
      const s = svc();
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expect(await s.readSharedMetrics(B, A, DAY)).not.toBeNull();
      expectOk(await s.revokeGrant(A, (g.grants[0] as { id: string }).id));
      expect(await s.readSharedMetrics(B, A, DAY)).toBeNull();
    });

    it('reads nothing once the relationship is gone, even if the row survives', async () => {
      // Defence in depth for rule 4: `revoked_at` is forced back to NULL to
      // simulate a cascade that failed to run. The read must STILL be empty.
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(await s.leaveFamily(B));
      await testEnv.DB.prepare(`UPDATE health_metric_shares SET revoked_at = NULL`).run();
      expect(await svc().readSharedMetrics(B, A, DAY)).toBeNull();
    });

    it('a day with no data still answers, with empty figures', async () => {
      // An empty answer and a denied answer must be different things: the
      // viewer HAS access, there simply is nothing logged.
      await makeFamily(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['water', 'weight'],
        })
      );
      const shared = await s.readSharedMetrics(B, A, '2026-01-01');
      expect(shared).not.toBeNull();
      expect(shared!.metrics.water).toEqual({ total_ml: 0 });
      expect(shared!.metrics.weight).toBeNull();
    });

    it('never reads a third party day through the same grant', async () => {
      await makeFamily(B);
      await seedWeight(C, DAY, 99);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expect(await s.readSharedMetrics(B, C, DAY)).toBeNull();
      expect((await s.readSharedMetrics(B, A, DAY))!.metrics.weight).toEqual({
        value: 70.5,
        unit: 'kg',
        date: DAY,
      });
    });

    it('derives sleep hours from minutes when hours is absent', async () => {
      await makeFamily(B);
      await testEnv.DB.prepare(`DELETE FROM health_entries WHERE id = 'e_sleep'`).run();
      await seedEntry(A, DAY, 'sleep', { minutes: 450 }, 'e_sleep_min');
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['sleep'] })
      );
      expect((await s.readSharedMetrics(B, A, DAY))!.metrics.sleep).toEqual({ hours: 7.5 });
    });

    it('survives a corrupt data blob rather than 500ing', async () => {
      await makeFamily(B);
      await testEnv.DB.prepare(`UPDATE health_entries SET data = 'not json' WHERE id = 'e_steps'`).run();
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['activity'] })
      );
      expect((await s.readSharedMetrics(B, A, DAY))!.metrics.activity).toEqual({
        steps: 0,
        workout_minutes: 60,
        workout_count: 2,
      });
    });
  });

  /* ============ 6. Rule 5 — invites do not leak ==================== */

  describe('invites', () => {
    it('stores the resolved account id but never returns it', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const known = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      const unknown = expectOk(await s.inviteToFamily(A, 'ghost@example.com'));

      expect(Object.keys(known.invitation).sort()).toEqual(
        Object.keys(unknown.invitation).sort()
      );
      expect(known.invitation).not.toHaveProperty('invitee_id');

      const rows = await listHealthRows<{ invitee_email: string; invitee_id: string | null }>(
        testEnv.DB,
        'health_family_invitations'
      );
      const stored = rows.find((r) => r.invitee_email === EMAIL(B));
      // Resolved internally — that is what makes the recipient inbox work.
      expect(stored?.invitee_id).toBe(B);
      expect(rows.find((r) => r.invitee_email === 'ghost@example.com')?.invitee_id).toBeNull();
    });

    it('normalises the address so case and padding cannot fork an invite', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      expectOk(await s.inviteToFamily(A, `  ${EMAIL(B).toUpperCase()} `));
      expect(await s.listReceivedInvitations(B)).toHaveLength(1);
    });

    it('re-inviting refreshes the SAME row instead of colliding', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const first = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      const second = expectOk(await s.inviteToFamily(A, EMAIL(B), 'please join'));
      expect(second.invitation.id).toBe(first.invitation.id);
      expect(second.invitation.invite_code).toBe(first.invitation.invite_code);
      expect(await listHealthRows(testEnv.DB, 'health_family_invitations')).toHaveLength(1);
    });

    it('refuses an expired invitation and marks it expired', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const invite = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      await testEnv.DB.prepare(
        `UPDATE health_family_invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`
      )
        .bind(invite.invitation.id)
        .run();
      expect(asFailure(await s.acceptInvitation(B, invite.invitation.id)).code).toBe(
        'invitation_expired'
      );
      expect(await s.listReceivedInvitations(B)).toEqual([]);
    });

    it('an expired invitation is not listed in the inbox at all', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const invite = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      await testEnv.DB.prepare(
        `UPDATE health_family_invitations SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`
      )
        .bind(invite.invitation.id)
        .run();
      expect(await s.listReceivedInvitations(B)).toEqual([]);
    });

    it('cannot be consumed by anyone but the addressee', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const invite = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      expect(asFailure(await s.acceptInvitation(C, invite.invitation.id)).status).toBe(404);
      expect(asFailure(await s.resolveInviteCode(C, invite.invitation.invite_code)).status).toBe(404);
      expect(expectOk(await s.resolveInviteCode(B, invite.invitation.invite_code)).ok).toBe(true);
    });

    it('joining grants nothing at all', async () => {
      await makeFamily(B);
      const s = svc();
      expect(await s.listReceivedGrants(B)).toEqual([]);
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toEqual([]);
    });
  });

  describe('buddies', () => {
    it('a request never varies with whether the address is registered', async () => {
      const s = svc();
      const known = expectOk(await s.requestBuddy(A, EMAIL(B)));
      const unknown = expectOk(await s.requestBuddy(A, 'ghost@example.com'));
      expect(Object.keys(known.request).sort()).toEqual(Object.keys(unknown.request).sort());
      expect(known.request.status).toBe(unknown.request.status);
      expect(known.request).not.toHaveProperty('recipient_id');
    });

    it('is idempotent — asking twice cannot be used to probe state', async () => {
      const s = svc();
      const first = expectOk(await s.requestBuddy(A, EMAIL(B)));
      const second = expectOk(await s.requestBuddy(A, EMAIL(B)));
      expect(second.request.id).toBe(first.request.id);
      expect(await listHealthRows(testEnv.DB, 'health_buddies')).toHaveLength(1);
    });

    it('a declined request can be re-sent and returns to pending', async () => {
      const s = svc();
      const req = expectOk(await s.requestBuddy(A, EMAIL(B)));
      expectOk(await s.declineBuddy(B, req.request.id));
      expect(expectOk(await s.requestBuddy(A, EMAIL(B))).request.status).toBe('pending');
    });

    it('refuses a self-request', async () => {
      expect(asFailure(await svc().requestBuddy(A, EMAIL(A))).code).toBe('invalid_email');
    });

    it('lists an accepted connection once, from either side', async () => {
      await makeBuddies(B);
      const s = svc();
      expect((await s.listBuddies(A)).map((r) => r.buddy_user_id)).toEqual([B]);
      expect((await s.listBuddies(B)).map((r) => r.buddy_user_id)).toEqual([A]);
    });

    it('a pending request is not a buddy', async () => {
      expectOk(await svc().requestBuddy(A, EMAIL(B)));
      expect(await svc().listBuddies(A)).toEqual([]);
      // …and it cannot back a grant.
      expect(
        asFailure(
          await svc().grantScopes(A, {
            viewer_id: B,
            relationship_type: 'buddy',
            scopes: ['weight'],
          })
        ).status
      ).toBe(404);
    });

    it('only the addressee can accept or decline', async () => {
      const s = svc();
      const req = expectOk(await s.requestBuddy(A, EMAIL(B)));
      expect(asFailure(await s.acceptBuddy(C, req.request.id)).status).toBe(404);
      expect(asFailure(await s.declineBuddy(C, req.request.id)).status).toBe(404);
      // The requester cannot self-accept either.
      expect(asFailure(await s.acceptBuddy(A, req.request.id)).status).toBe(404);
    });

    it('removeBuddy works from either side and 404s for a bystander', async () => {
      const link = await makeBuddies(B);
      expect(asFailure(await svc().removeBuddy(C, link)).status).toBe(404);
      expectOk(await svc().removeBuddy(B, link));
      expect(await svc().listBuddies(A)).toEqual([]);
    });
  });

  /* ============ 7. Small pure helpers ============================== */

  describe('helpers', () => {
    it('generateInviteCode is 8 unambiguous chars', () => {
      for (let i = 0; i < 50; i += 1) {
        const code = generateInviteCode();
        expect(code).toHaveLength(8);
        // No I / O / 0 / 1 — the code is read aloud and typed by hand.
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      }
      const many = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
      expect(many.size).toBeGreaterThan(190);
    });

    it('inviteExpiryFrom defaults to 14 days', () => {
      expect(inviteExpiryFrom('2026-06-01T00:00:00.000Z')).toBe('2026-06-15T00:00:00.000Z');
      expect(inviteExpiryFrom('2026-06-01T00:00:00.000Z', 1)).toBe('2026-06-02T00:00:00.000Z');
    });

    it('normaliseEmail lowercases and trims', () => {
      expect(normaliseEmail('  Bob@Example.COM ')).toBe('bob@example.com');
    });

    it('round2 is terminal rounding', () => {
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(155.555)).toBe(155.56);
    });

    it('publicGrant hides relationship_id and derives `active`', () => {
      const row = {
        id: 'g1',
        owner_id: A,
        viewer_id: B,
        relationship_type: 'family',
        relationship_id: 'hfam_secret',
        scope: 'weight',
        granted_at: 'x',
        revoked_at: null,
      };
      const out = publicGrant(row);
      expect(out.active).toBe(true);
      expect(out).not.toHaveProperty('relationship_id');
      expect(publicGrant({ ...row, revoked_at: 'y' }).active).toBe(false);
    });

    it('scopeCatalogue publishes both lists', () => {
      const cat = svc().scopeCatalogue();
      expect(cat.shareable.sort()).toEqual([...SHAREABLE_SCOPES].sort());
      expect(cat.never_shareable.sort()).toEqual([...NEVER_SHAREABLE_SCOPES].sort());
    });
  });

  /* ============ 8. Community + challenges (service level) =========== */

  describe('community', () => {
    it('reading requires participation; the directory does not', async () => {
      const s = svc();
      const topic = await s.createTopic(A, { title: 'Hydration', category: 'tips' });
      expectOk(await s.postMessage(A, topic.id, 'drink water'));

      expect((await s.listTopics(B)).map((t) => t.id)).toContain(topic.id);
      expect(asFailure(await s.listMessages(B, topic.id)).code).toBe('not_a_participant');
      expectOk(await s.joinTopic(B, topic.id));
      expect(expectOk(await s.listMessages(B, topic.id)).messages).toHaveLength(1);
    });

    it('a message carries no attachment field at all', async () => {
      const s = svc();
      const topic = await s.createTopic(A, { title: 'T', category: 'general' });
      const posted = expectOk(await s.postMessage(A, topic.id, 'hi'));
      expect(Object.keys(posted.message as object).sort()).toEqual(
        [
          'content',
          'created_at',
          'deleted_at',
          'id',
          'is_edited',
          'reply_to_id',
          'topic_id',
          'updated_at',
          'user_id',
        ].sort()
      );
    });

    it('a soft-deleted message leaves the room and decrements the count', async () => {
      const s = svc();
      const topic = await s.createTopic(A, { title: 'T', category: 'general' });
      const posted = expectOk(await s.postMessage(A, topic.id, 'hi'));
      expectOk(await s.deleteMessage(A, (posted.message as { id: string }).id));
      expect(expectOk(await s.listMessages(A, topic.id)).messages).toEqual([]);
      expect((await s.listTopics(A))[0].message_count).toBe(0);
    });

    it('leaving and rejoining a room does not duplicate the seat', async () => {
      const s = svc();
      const topic = await s.createTopic(A, { title: 'T', category: 'general' });
      expectOk(await s.joinTopic(B, topic.id));
      expectOk(await s.leaveTopic(B, topic.id));
      expectOk(await s.joinTopic(B, topic.id));
      const seats = await listHealthRows<{ deleted_at: string | null }>(
        testEnv.DB,
        'health_community_participants'
      );
      expect(seats.filter((r) => r.deleted_at === null)).toHaveLength(2);
    });
  });

  describe('challenges', () => {
    async function makeChallenge(over: Record<string, unknown> = {}) {
      const created = expectOk(
        await svc().createChallenge(A, {
          name: '10k',
          metric: 'activity',
          target_value: 10000,
          visibility: 'public',
          start_date: DAY,
          ...over,
        })
      );
      return (created.challenge as { id: string }).id;
    }

    it('refuses a sensitive metric with the SAME code as a grant would', async () => {
      const f = asFailure(
        await svc().createChallenge(A, {
          name: 'C',
          metric: 'cycle',
          target_value: 1,
          start_date: DAY,
        })
      );
      expect(f.code).toBe('forbidden_scope');
      expect(await listHealthRows(testEnv.DB, 'health_challenges')).toEqual([]);
    });

    it('marks a day complete only when the target is met', async () => {
      const id = await makeChallenge();
      const s = svc();
      const under = expectOk(await s.recordProgress(A, id, { date: DAY, value: 9999 }));
      expect((under.progress as { is_completed: boolean }).is_completed).toBe(false);
      const over = expectOk(await s.recordProgress(A, id, { date: DAY, value: 10000 }));
      expect((over.progress as { is_completed: boolean }).is_completed).toBe(true);
      // Upsert on (challenge, user, day) — a re-entry never stacks.
      expect(await listHealthRows(testEnv.DB, 'health_challenge_progress')).toHaveLength(1);
    });

    it('hides a peer number until they grant the challenge metric', async () => {
      await makeFamily(B);
      const id = await makeChallenge();
      const s = svc();
      expectOk(await s.joinChallenge(B, id));
      expectOk(await s.recordProgress(A, id, { date: DAY, value: 12000 }));
      expectOk(await s.recordProgress(B, id, { date: DAY, value: 3000 }));

      const before = expectOk(await s.challengeProgress(B, id));
      expect(before.leaderboard.map((r) => r.user_id)).toEqual([B]);
      expect(before.hidden_participants).toBe(1);

      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['activity'] })
      );
      const after = expectOk(await s.challengeProgress(B, id));
      expect(after.leaderboard.find((r) => r.user_id === A)?.total).toBe(12000);
      expect(after.hidden_participants).toBe(0);
    });

    it('a grant for another metric does not unlock the leaderboard', async () => {
      await makeFamily(B);
      const id = await makeChallenge({ metric: 'water', target_value: 2000 });
      const s = svc();
      expectOk(await s.joinChallenge(B, id));
      expectOk(await s.recordProgress(A, id, { date: DAY, value: 2500 }));
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      const view = expectOk(await s.challengeProgress(B, id));
      expect(view.leaderboard.map((r) => r.user_id)).toEqual([B]);
    });

    it('a revoked grant re-hides the peer immediately', async () => {
      await makeFamily(B);
      const id = await makeChallenge();
      const s = svc();
      expectOk(await s.joinChallenge(B, id));
      expectOk(await s.recordProgress(A, id, { date: DAY, value: 12000 }));
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['activity'] })
      );
      expect(expectOk(await s.challengeProgress(B, id)).leaderboard).toHaveLength(2);
      expectOk(await s.revokeGrant(A, (g.grants[0] as { id: string }).id));
      expect(expectOk(await s.challengeProgress(B, id)).leaderboard).toHaveLength(1);
    });

    it('a family-visibility challenge is invisible to an outsider', async () => {
      const id = await makeChallenge({ visibility: 'family' });
      expect((await svc().listChallenges(C)).map((c) => c.id)).not.toContain(id);
      expect(asFailure(await svc().joinChallenge(C, id)).status).toBe(404);
    });

    it('leaving tombstones the seat AND the progress rows', async () => {
      const id = await makeChallenge();
      const s = svc();
      expectOk(await s.recordProgress(A, id, { date: DAY, value: 5000 }));
      expectOk(await s.leaveChallenge(A, id));
      const rows = await listHealthRows<{ deleted_at: string | null }>(
        testEnv.DB,
        'health_challenge_progress'
      );
      expect(rows.every((r) => r.deleted_at !== null)).toBe(true);
    });

    it('a peer who leaves stops being counted as hidden', async () => {
      // `hidden_participants` is `others.length - visible.length`, and both are
      // derived from the LIVE seat list. A leaver who kept being counted would
      // tell the caller "someone here is not sharing with you" forever.
      await makeFamily(B);
      const id = await makeChallenge();
      const s = svc();
      expectOk(await s.joinChallenge(B, id));
      expect(expectOk(await s.challengeProgress(A, id)).hidden_participants).toBe(1);
      expectOk(await s.leaveChallenge(B, id));
      const after = expectOk(await s.challengeProgress(A, id));
      expect(after.hidden_participants).toBe(0);
      expect(after.leaderboard.map((r) => r.user_id)).toEqual([A]);
    });
  });

  /* ============ 9. Grant bookkeeping edges ========================== */

  describe('grant bookkeeping', () => {
    it('a repeated scope in one request writes exactly one row', async () => {
      // `validateScopes` de-duplicates, and the upsert target is
      // (owner, viewer, type, scope) — so even a client that sends the same
      // scope three times cannot produce three grants to revoke one at a time.
      await makeFamily(B);
      expectOk(
        await svc().grantScopes(A, {
          viewer_id: B,
          relationship_type: 'family',
          scopes: ['weight', 'weight', 'weight'],
        })
      );
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toHaveLength(1);
    });

    it('the same scope under both relationship types is TWO independent rows', async () => {
      // The upsert key includes `relationship_type`, so un-buddying must be
      // able to revoke the buddy copy while the family copy survives. If the
      // two collapsed into one row, dropping either relationship would revoke
      // access the other one still legitimately conveys.
      await makeFamily(B);
      const link = await makeBuddies(B);
      const s = svc();
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['weight'] })
      );
      expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'buddy', scopes: ['weight'] })
      );
      expect(await listHealthRows(testEnv.DB, 'health_metric_shares')).toHaveLength(2);

      expectOk(await s.removeBuddy(A, link));
      const held = await s.listReceivedGrants(B);
      expect(held.map((g) => (g as { relationship_type: string }).relationship_type)).toEqual([
        'family',
      ]);
    });

    it('removing a request that was never accepted revokes nothing', async () => {
      // `removeBuddy` is also the "cancel my outgoing request" verb. There is
      // no relationship yet, so the cascade must be a no-op rather than an
      // error — and the row has to disappear from both sides.
      const s = svc();
      const req = expectOk(await s.requestBuddy(A, EMAIL(B)));
      const removed = expectOk(await s.removeBuddy(A, req.request.id));
      expect(removed.revoked).toBe(0);
      expect(await s.listBuddies(A)).toEqual([]);
      expect((await s.listBuddyRequests(B)).received).toEqual([]);
    });

    it('lists an accepted connection ONCE even with a mirror row', async () => {
      // Both people can send each other a request before either accepts, which
      // leaves two accepted rows for one relationship. The list must still show
      // one buddy, or the UI paints a duplicate and a grant screen offers the
      // same person twice.
      const s = svc();
      const first = expectOk(await s.requestBuddy(A, EMAIL(B)));
      const mirror = expectOk(await s.requestBuddy(B, EMAIL(A)));
      expectOk(await s.acceptBuddy(B, first.request.id));
      expectOk(await s.acceptBuddy(A, mirror.request.id));
      expect(await listHealthRows(testEnv.DB, 'health_buddies')).toHaveLength(2);
      expect((await s.listBuddies(A)).map((r) => r.buddy_user_id)).toEqual([B]);
      expect((await s.listBuddies(B)).map((r) => r.buddy_user_id)).toEqual([A]);
    });
  });

  /* ============ 9b. A caller with no `users` row ==================== */

  describe('an account this Worker cannot resolve an address for', () => {
    /**
     * Every inbox on this surface is keyed on the CALLER'S OWN email, resolved
     * from the `users` table. A valid token whose `sub` has no row there is not
     * hypothetical: the social tables carry no FK to `users`, the Health Worker
     * has its own D1, and a token minted before a row existed (or after a
     * hard-deleted account) lands exactly here.
     *
     * Every one of those paths has an `if (!email) return …` arm, and none of
     * them had a test. The arm must answer EMPTY / not-found — never crash, and
     * never fall through to a query that matches on `undefined` and returns
     * somebody else's invitation.
     */
    const GHOST = 'u_hs_no_user_row';

    it('reads an empty inbox rather than crashing or matching on undefined', async () => {
      const s = svc();
      expectOk(await s.createFamily(A, 'Fam'));
      const invite = expectOk(await s.inviteToFamily(A, EMAIL(B)));
      expectOk(await s.requestBuddy(A, EMAIL(B)));

      expect(await s.listReceivedInvitations(GHOST)).toEqual([]);
      expect((await s.listBuddyRequests(GHOST)).received).toEqual([]);
      // The real invite exists and is pending — it must still be invisible.
      expect(asFailure(await s.resolveInviteCode(GHOST, invite.invitation.invite_code)).status)
        .toBe(404);
      expect(asFailure(await s.acceptInvitation(GHOST, invite.invitation.id)).status).toBe(404);
      expect(asFailure(await s.declineInvitation(GHOST, invite.invitation.id)).status).toBe(404);
    });

    it('cannot create social state at all — the schema refuses first', async () => {
      // The read arms above are the graceful half; this is the hard half.
      // `health_families.owner_id` and `health_buddies.requester_id` both carry
      // a FOREIGN KEY to `users`, and miniflare D1 enforces them exactly like
      // deployed D1 does. So an account the Worker cannot resolve an address for
      // can never become the owner of a family or the requester of a buddy
      // connection either — there is no path by which it accumulates state that
      // the empty-inbox arms would then have to hide.
      // Drizzle wraps the D1 error, so the FK message lives on `cause`; the
      // rejection itself is the assertion, and no row survives it (below).
      const s = svc();
      await expect(s.createFamily(GHOST, 'Ghost fam')).rejects.toThrow();
      await expect(s.requestBuddy(GHOST, EMAIL(B))).rejects.toThrow();
      expect(await listHealthRows(testEnv.DB, 'health_families')).toEqual([]);
      expect(await listHealthRows(testEnv.DB, 'health_buddies')).toEqual([]);
    });
  });

  /* ============ 10. Defence in depth, compared across the two readers = */

  describe('a grant that outlived its relationship', () => {
    /**
     * Rule 4 says losing a relationship revokes the grants, and every API path
     * that can drop a relationship does run the cascade (proved above). These
     * two specs are about what happens if that cascade ever FAILED — the second
     * line of defence — and both readers now implement it the same way:
     * re-check the grant's OWN relationship type (family grants need a live
     * family, buddy grants need a live buddy), not "family OR buddy".
     *
     * `filterByGrant` (the challenge leaderboard) used to check only the OR
     * form, so for two users who are family AND buddies, a stale FAMILY grant
     * was refused by the metric read but honoured by the leaderboard. Fixed to
     * carry the grant's own `relationship_type` through the query instead of
     * discarding it. Pinned in both directions so neither reader can regress.
     */
    async function staleFamilyGrantWithLiveBuddyLink(): Promise<string> {
      await makeFamily(B);
      await makeBuddies(B);
      const s = svc();
      const g = expectOk(
        await s.grantScopes(A, { viewer_id: B, relationship_type: 'family', scopes: ['activity'] })
      );
      // The family goes away; the buddy connection stays.
      expectOk(await s.leaveFamily(B));
      // …and the cascade is then undone by hand, which is the failure being
      // simulated. A cascade bug alone must not re-open a closed door.
      await testEnv.DB.prepare(`UPDATE health_metric_shares SET revoked_at = NULL WHERE id = ?`)
        .bind((g.grants[0] as { id: string }).id)
        .run();
      return (g.grants[0] as { id: string }).id;
    }

    it('is refused by the metric read, which honours the grant own type', async () => {
      await staleFamilyGrantWithLiveBuddyLink();
      await seedEntry(A, DAY, 'steps', { steps: 8000 }, 'e_steps_dd');
      expect(await svc().readSharedMetrics(B, A, DAY)).toBeNull();
    });

    it('is now refused by the challenge leaderboard too, matching the metric read', async () => {
      await staleFamilyGrantWithLiveBuddyLink();
      const s = svc();
      const created = expectOk(
        await s.createChallenge(A, {
          name: '10k',
          metric: 'activity',
          target_value: 10000,
          visibility: 'public',
          start_date: DAY,
        })
      );
      const id = (created.challenge as { id: string }).id;
      expectOk(await s.joinChallenge(B, id));
      expectOk(await s.recordProgress(A, id, { date: DAY, value: 12000 }));

      const view = expectOk(await s.challengeProgress(B, id));
      expect(view.leaderboard.map((r) => r.user_id)).toEqual([B]);
      expect(view.hidden_participants).toBe(1);
    });
  });
});
