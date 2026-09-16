/**
 * HealthBodyExtrasService — the derivation + guard layer of the Symply Health
 * P2 `body-extras` domain (injuries, activity notification preferences, body
 * insights).
 *
 * The routes are a thin pass-through (covered in
 * routes/__tests__/health-body-extras.test.ts); this suite owns what the phone,
 * the widget and any future workout coach must AGREE on:
 *   - the ACTIVE-BODY-PART derivation that gates exercise suggestions, and the
 *     two — and only two — ways a part leaves it (resolved, soft-deleted),
 *   - resolve-is-not-delete: a healed injury stays fully readable,
 *   - the soft-delete tombstone (`deleted_at` + a bumped `updated_at`) the sync
 *     cursor needs to propagate a delete,
 *   - the preference defaults and the partial upsert keyed on `user_id` (the
 *     table's PRIMARY KEY — there is no `id` column),
 *   - the INTERNAL body-insight write: ownership of the referenced photo and of
 *     an explicitly-supplied insight id. Insights are AI-produced (P3 owns the
 *     producer); nothing here calls an AI provider.
 *
 * D1-backed specs run against live miniflare D1 with the migration-0120 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern
 * as services/__tests__/health-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createBodyExtrasTables,
  createHealthTables,
  resetBodyExtrasTables,
  resetHealthTables,
  seedHealthUsers,
  seedUserFile,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import {
  ACTIVITY_PREFERENCE_DEFAULTS,
  ACTIVITY_PREFERENCE_FIELDS,
  BODY_PHOTO_ANGLES,
  HealthBodyExtrasService,
  MAX_PAIN_LEVEL,
  MIN_PAIN_LEVEL,
} from '../health-body-extras-service';

const testEnv = env as unknown as Env;

const UID = 'u_extras_svc_alice';
const OTHER = 'u_extras_svc_bob';

const D1 = '2026-06-01';
const D2 = '2026-06-02';
const D3 = '2026-06-03';

function svc(): HealthBodyExtrasService {
  return new HealthBodyExtrasService(testEnv.DB);
}

/** Raw row read — proves a SOFT delete really left the row behind. */
async function rawInjury(id: string) {
  return testEnv.DB.prepare('SELECT * FROM injuries WHERE id = ?')
    .bind(id)
    .first<{ id: string; is_active: number; deleted_at: string | null; updated_at: string }>();
}

describe('health-body-extras service', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createBodyExtrasTables(testEnv.DB);
    await resetBodyExtrasTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID, OTHER]);
  });

  /* ==================================================================== */
  /* Injuries                                                              */
  /* ==================================================================== */

  describe('injuries', () => {
    it('applies the donor defaults on create', async () => {
      const injury = await svc().createInjury(UID, { body_part: 'knee' });
      expect(injury.pain_level).toBe(1);
      expect(injury.injury_type).toBe('pain');
      expect(injury.is_active).toBe(true);
      expect(injury.cause).toBeNull();
      expect(injury.muscle_group).toBeNull();
      expect(injury.deleted_at).toBeNull();
      expect(injury.date).toBe(new Date().toISOString().slice(0, 10));
    });

    it('stores both ends of the 0–4 pain scale', async () => {
      for (const pain of [MIN_PAIN_LEVEL, MAX_PAIN_LEVEL]) {
        const row = await svc().createInjury(UID, { body_part: 'knee', pain_level: pain });
        expect(row.pain_level).toBe(pain);
      }
      expect(MIN_PAIN_LEVEL).toBe(0);
      expect(MAX_PAIN_LEVEL).toBe(4);
    });

    it('rejects an out-of-scale pain_level at the DDL CHECK, not just at zod', async () => {
      // The route bound is the first line of defence; this is the backstop that
      // catches any future write path that forgets to validate.
      await expect(
        svc().createInjury(UID, { body_part: 'knee', pain_level: 7 })
      ).rejects.toBeTruthy();
    });

    it('filters by active state, body part and date window', async () => {
      const a = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 1 });
      await svc().createInjury(UID, { date: D2, body_part: 'neck', pain_level: 2 });
      await svc().createInjury(UID, { date: D3, body_part: 'knee', pain_level: 3 });
      await svc().resolveInjury(UID, a.id);

      expect((await svc().listInjuries(UID)).map((r) => r.date)).toEqual([D3, D2, D1]);
      expect((await svc().listInjuries(UID, { active: true })).map((r) => r.date)).toEqual([D3, D2]);
      expect((await svc().listInjuries(UID, { active: false })).map((r) => r.date)).toEqual([D1]);
      expect((await svc().listInjuries(UID, { body_part: 'knee' })).map((r) => r.date)).toEqual([
        D3,
        D1,
      ]);
      expect((await svc().listInjuries(UID, { from: D2 })).map((r) => r.date)).toEqual([D3, D2]);
      expect((await svc().listInjuries(UID, { to: D2 })).map((r) => r.date)).toEqual([D2, D1]);
      expect((await svc().listInjuries(UID, { date: D2 })).map((r) => r.body_part)).toEqual(['neck']);
      expect(await svc().listInjuries(UID, { limit: 1 })).toHaveLength(1);
    });

    it('resolve flips is_active but keeps the row readable as history', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      const resolved = await svc().resolveInjury(UID, injury.id);
      expect(resolved?.is_active).toBe(false);

      const raw = await rawInjury(injury.id);
      expect(raw?.is_active).toBe(0);
      expect(raw?.deleted_at).toBeNull();
      // Still in the log, with its pain level intact — this is not a deletion.
      const history = await svc().listInjuries(UID);
      expect(history).toHaveLength(1);
      expect(history[0].pain_level).toBe(3);
    });

    it('resolve is idempotent and re-stamps updated_at for the sync cursor', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      const first = await svc().resolveInjury(UID, injury.id);
      const second = await svc().resolveInjury(UID, injury.id);
      expect(second?.is_active).toBe(false);
      expect((second?.updated_at ?? '') >= (first?.updated_at ?? '')).toBe(true);
      expect(second?.updated_at).toEqual(expect.any(String));
    });

    it('delete is SOFT — the tombstone survives so the delete can propagate', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      expect(await svc().deleteInjury(UID, injury.id)).toBe(true);

      const raw = await rawInjury(injury.id);
      expect(raw).not.toBeNull();
      expect(raw?.deleted_at).toEqual(expect.any(String));
      // `updated_at` must move too — the sync cursor pulls by it.
      expect(raw?.updated_at).toBe(raw?.deleted_at);

      expect(await svc().listInjuries(UID)).toEqual([]);
      expect(await svc().deleteInjury(UID, injury.id)).toBe(false);
    });

    it('a deleted injury can no longer be updated or resolved', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      await svc().deleteInjury(UID, injury.id);
      expect(await svc().updateInjury(UID, injury.id, { pain_level: 1 })).toBeNull();
      expect(await svc().resolveInjury(UID, injury.id)).toBeNull();
    });

    it('update touches only the fields supplied', async () => {
      const injury = await svc().createInjury(UID, {
        date: D1,
        body_part: 'knee',
        pain_level: 3,
        cause: 'running',
        muscle_group: 'quads',
        notes: 'left side',
      });
      const updated = await svc().updateInjury(UID, injury.id, { pain_level: 1 });
      expect(updated).toMatchObject({
        pain_level: 1,
        body_part: 'knee',
        cause: 'running',
        muscle_group: 'quads',
        notes: 'left side',
      });
      // An explicit null still clears a nullable column.
      const cleared = await svc().updateInjury(UID, injury.id, { notes: null });
      expect(cleared?.notes).toBeNull();
    });

    it('never touches another user injury', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      expect(await svc().updateInjury(OTHER, injury.id, { pain_level: 0 })).toBeNull();
      expect(await svc().resolveInjury(OTHER, injury.id)).toBeNull();
      expect(await svc().deleteInjury(OTHER, injury.id)).toBe(false);
      expect(await svc().listInjuries(OTHER)).toEqual([]);

      const survivor = (await svc().listInjuries(UID))[0];
      expect(survivor).toMatchObject({ pain_level: 3, is_active: true, deleted_at: null });
    });

    it('returns null for an unknown id', async () => {
      expect(await svc().updateInjury(UID, 'inj_nope', { pain_level: 1 })).toBeNull();
      expect(await svc().resolveInjury(UID, 'inj_nope')).toBeNull();
      expect(await svc().deleteInjury(UID, 'inj_nope')).toBe(false);
    });
  });

  /* ==================================================================== */
  /* Active body parts — the workout gate                                  */
  /* ==================================================================== */

  describe('activeBodyParts (safety surface)', () => {
    it('collapses to distinct parts with the worst pain, count and muscle groups', async () => {
      await svc().createInjury(UID, {
        date: D1,
        body_part: 'knee',
        pain_level: 1,
        muscle_group: 'quads',
      });
      await svc().createInjury(UID, {
        date: D2,
        body_part: 'knee',
        pain_level: 3,
        muscle_group: 'quads',
      });
      await svc().createInjury(UID, {
        date: D2,
        body_part: 'knee',
        pain_level: 2,
        muscle_group: 'hamstrings',
      });
      await svc().createInjury(UID, { date: D2, body_part: 'lowerBack', pain_level: 4 });

      const parts = await svc().activeBodyParts(UID);
      expect(parts).toEqual([
        { body_part: 'lowerBack', max_pain_level: 4, injury_count: 1, muscle_groups: [] },
        {
          body_part: 'knee',
          max_pain_level: 3,
          injury_count: 3,
          // Distinct + sorted, so the set is stable across writes.
          muscle_groups: ['hamstrings', 'quads'],
        },
      ]);
    });

    it('excludes a RESOLVED injury', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      await svc().resolveInjury(UID, injury.id);
      expect(await svc().activeBodyParts(UID)).toEqual([]);
      // …while the history read still carries it.
      expect(await svc().listInjuries(UID)).toHaveLength(1);
    });

    it('excludes a SOFT-DELETED injury', async () => {
      const injury = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      await svc().deleteInjury(UID, injury.id);
      expect(await svc().activeBodyParts(UID)).toEqual([]);
    });

    it('keeps a STALE active injury in the set', async () => {
      // Deliberate: only the user resolving or deleting an injury may un-gate a
      // body part. Age alone must never do it.
      await svc().createInjury(UID, { date: '2020-01-01', body_part: 'shoulder', pain_level: 2 });
      expect((await svc().activeBodyParts(UID)).map((p) => p.body_part)).toEqual(['shoulder']);
    });

    it('keeps the part while any sibling injury is still active', async () => {
      const healed = await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 1 });
      await svc().createInjury(UID, { date: D2, body_part: 'knee', pain_level: 4 });
      await svc().resolveInjury(UID, healed.id);
      expect(await svc().activeBodyParts(UID)).toEqual([
        { body_part: 'knee', max_pain_level: 4, injury_count: 1, muscle_groups: [] },
      ]);
    });

    it('is scoped to the user — B never inherits A suppressions', async () => {
      await svc().createInjury(UID, { date: D1, body_part: 'knee', pain_level: 3 });
      expect(await svc().activeBodyParts(OTHER)).toEqual([]);
    });
  });

  /* ==================================================================== */
  /* Activity notification preferences                                     */
  /* ==================================================================== */

  describe('activity notification preferences', () => {
    it('exposes the donor default set', async () => {
      expect(ACTIVITY_PREFERENCE_FIELDS).toHaveLength(10);
      const communityOff = ACTIVITY_PREFERENCE_FIELDS.filter(
        (f) => f.startsWith('notify_community_') && ACTIVITY_PREFERENCE_DEFAULTS[f] === false
      );
      expect(communityOff).toHaveLength(2);
      expect(ACTIVITY_PREFERENCE_DEFAULTS.notify_recipe_updated).toBe(false);
      expect(ACTIVITY_PREFERENCE_DEFAULTS.receive_push_notifications).toBe(true);
      expect(ACTIVITY_PREFERENCE_DEFAULTS.receive_inapp_notifications).toBe(true);
    });

    it('reads defaults with null stamps before anything is saved', async () => {
      const prefs = await svc().getActivityPreferences(UID);
      expect(prefs).toEqual({
        user_id: UID,
        ...ACTIVITY_PREFERENCE_DEFAULTS,
        favourite_workout_types: [],
        created_at: null,
        updated_at: null,
      });
      // Nothing was materialised by the read.
      const row = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM activity_notification_preferences'
      ).first<{ n: number }>();
      expect(row?.n).toBe(0);
    });

    describe('favourite workout types', () => {
      it('defaults to an empty array — never null — before anything is saved', async () => {
        const prefs = await svc().getActivityPreferences(UID);
        expect(prefs.favourite_workout_types).toEqual([]);
      });

      it('round-trips a saved list exactly, in the order sent', async () => {
        const saved = await svc().saveActivityPreferences(UID, {
          favourite_workout_types: ['running', 'tableTennis', 'yoga'],
        });
        expect(saved.favourite_workout_types).toEqual(['running', 'tableTennis', 'yoga']);

        const read = await svc().getActivityPreferences(UID);
        expect(read.favourite_workout_types).toEqual(['running', 'tableTennis', 'yoga']);
      });

      it('replaces the list wholesale on a later save, not merges it', async () => {
        await svc().saveActivityPreferences(UID, {
          favourite_workout_types: ['running', 'cycle'],
        });
        const second = await svc().saveActivityPreferences(UID, {
          favourite_workout_types: ['yoga'],
        });
        expect(second.favourite_workout_types).toEqual(['yoga']);
      });

      it('an explicit empty array clears the list', async () => {
        await svc().saveActivityPreferences(UID, { favourite_workout_types: ['running'] });
        const cleared = await svc().saveActivityPreferences(UID, { favourite_workout_types: [] });
        expect(cleared.favourite_workout_types).toEqual([]);
      });

      it('omitting the field leaves the stored list untouched — a boolean-only patch is not a clear', async () => {
        await svc().saveActivityPreferences(UID, { favourite_workout_types: ['running', 'yoga'] });
        const afterFlagOnly = await svc().saveActivityPreferences(UID, {
          notify_photo_shared: false,
        });
        expect(afterFlagOnly.favourite_workout_types).toEqual(['running', 'yoga']);
        expect(afterFlagOnly.notify_photo_shared).toBe(false);
      });

      it('saving only favourites leaves the ten boolean flags at whatever they already were', async () => {
        await svc().saveActivityPreferences(UID, { notify_recipe_created: false });
        const afterFavouritesOnly = await svc().saveActivityPreferences(UID, {
          favourite_workout_types: ['hiking'],
        });
        expect(afterFavouritesOnly.notify_recipe_created).toBe(false);
        expect(afterFavouritesOnly.favourite_workout_types).toEqual(['hiking']);
      });

      it('a corrupt or foreign JSON blob degrades to an empty list rather than throwing', async () => {
        await svc().saveActivityPreferences(UID, { favourite_workout_types: ['running'] });
        // Hand-corrupt the stored column directly — simulates an older build or
        // a hand-edited row, which `getActivityPreferences` must never 500 on.
        await testEnv.DB.prepare(
          'UPDATE activity_notification_preferences SET favourite_workout_types = ? WHERE user_id = ?'
        )
          .bind('{not valid json', UID)
          .run();

        const prefs = await svc().getActivityPreferences(UID);
        expect(prefs.favourite_workout_types).toEqual([]);
      });

      it('drops non-string entries from a malformed array rather than throwing', async () => {
        await testEnv.DB.prepare(
          `INSERT INTO activity_notification_preferences (user_id, favourite_workout_types, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
          .bind(UID, JSON.stringify(['running', 42, null, 'yoga']), D1, D1)
          .run();

        const prefs = await svc().getActivityPreferences(UID);
        expect(prefs.favourite_workout_types).toEqual(['running', 'yoga']);
      });

      it('keeps users in separate lanes', async () => {
        await svc().saveActivityPreferences(UID, { favourite_workout_types: ['running'] });
        const other = await svc().getActivityPreferences(OTHER);
        expect(other.favourite_workout_types).toEqual([]);
        expect((await svc().getActivityPreferences(UID)).favourite_workout_types).toEqual([
          'running',
        ]);
      });
    });

    it('upserts on the user_id primary key — one row per user, ever', async () => {
      await svc().saveActivityPreferences(UID, { notify_photo_shared: false });
      await svc().saveActivityPreferences(UID, { notify_photo_shared: true });
      await svc().saveActivityPreferences(UID, { receive_push_notifications: false });
      const row = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM activity_notification_preferences WHERE user_id = ?'
      )
        .bind(UID)
        .first<{ n: number }>();
      expect(row?.n).toBe(1);
    });

    it('applies partial updates cumulatively and persists the rest as defaults', async () => {
      const first = await svc().saveActivityPreferences(UID, { notify_recipe_created: false });
      expect(first.notify_recipe_created).toBe(false);
      expect(first.notify_custom_food_created).toBe(true);
      expect(first.created_at).toEqual(expect.any(String));

      const second = await svc().saveActivityPreferences(UID, {
        notify_community_achievement: true,
      });
      expect(second.notify_recipe_created).toBe(false);
      expect(second.notify_community_achievement).toBe(true);
      expect(second.created_at).toBe(first.created_at);
    });

    it('handles an empty patch by materialising the defaults', async () => {
      // drizzle cannot build an UPDATE with no SET columns — the write still has
      // to succeed and return a complete, stamped preference set.
      const prefs = await svc().saveActivityPreferences(UID, {});
      for (const field of ACTIVITY_PREFERENCE_FIELDS) {
        expect(prefs[field], field).toBe(ACTIVITY_PREFERENCE_DEFAULTS[field]);
      }
      expect(prefs.updated_at).toEqual(expect.any(String));
    });

    it('returns booleans, never the stored 0/1', async () => {
      await svc().saveActivityPreferences(UID, { notify_photo_shared: false });
      const prefs = await svc().getActivityPreferences(UID);
      const wrong = ACTIVITY_PREFERENCE_FIELDS.filter((f) => typeof prefs[f] !== 'boolean');
      expect(wrong).toEqual([]);
    });

    it('keeps users in separate lanes', async () => {
      await svc().saveActivityPreferences(UID, { receive_inapp_notifications: false });
      const other = await svc().getActivityPreferences(OTHER);
      expect(other.receive_inapp_notifications).toBe(true);
      expect(other.updated_at).toBeNull();
      expect((await svc().getActivityPreferences(UID)).receive_inapp_notifications).toBe(false);
    });
  });

  /* ==================================================================== */
  /* Body insights — read paths + the guarded internal write               */
  /* ==================================================================== */

  describe('body insights', () => {
    it('accepts every donor angle on the internal photo write', async () => {
      const photo = await seedUserFile(testEnv.DB, UID, 'file_angles');
      for (const angle of BODY_PHOTO_ANGLES) {
        const row = await svc().savePhotoInsight(UID, { photo_id: photo, date: D1, angle });
        expect(row?.angle).toBe(angle);
      }
      expect(await svc().listPhotoInsights(UID)).toHaveLength(BODY_PHOTO_ANGLES.length);
    });

    it('refuses to attach an insight to another user photo', async () => {
      // The guard on the internal write: without it, an in-process producer bug
      // could file A's analysis against B's body photo.
      const foreign = await seedUserFile(testEnv.DB, OTHER, 'file_foreign');
      expect(
        await svc().savePhotoInsight(UID, { photo_id: foreign, date: D1, angle: 'front' })
      ).toBeNull();
      expect(await svc().listPhotoInsights(UID)).toEqual([]);
      expect(await svc().listPhotoInsights(OTHER)).toEqual([]);
    });

    it('refuses an unknown or deleted photo id', async () => {
      expect(
        await svc().savePhotoInsight(UID, { photo_id: 'file_nope', date: D1, angle: 'front' })
      ).toBeNull();

      const photo = await seedUserFile(testEnv.DB, UID, 'file_gone');
      await testEnv.DB.prepare('UPDATE user_files SET deleted_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), photo)
        .run();
      expect(
        await svc().savePhotoInsight(UID, { photo_id: photo, date: D1, angle: 'front' })
      ).toBeNull();
    });

    it('upserts a photo insight by id and refuses another user row id', async () => {
      const photo = await seedUserFile(testEnv.DB, UID, 'file_upsert');
      const first = await svc().savePhotoInsight(UID, {
        photo_id: photo,
        date: D1,
        angle: 'front',
        posture_score: 60,
      });
      const again = await svc().savePhotoInsight(UID, {
        id: first!.id,
        photo_id: photo,
        date: D1,
        angle: 'front',
        posture_score: 75,
      });
      expect(again?.id).toBe(first!.id);
      const rows = await svc().listPhotoInsights(UID);
      expect(rows).toHaveLength(1);
      expect(rows[0].posture_score).toBe(75);

      // OTHER may not overwrite that row by naming its id.
      const otherPhoto = await seedUserFile(testEnv.DB, OTHER, 'file_other_upsert');
      expect(
        await svc().savePhotoInsight(OTHER, {
          id: first!.id,
          photo_id: otherPhoto,
          date: D1,
          angle: 'front',
          posture_score: 1,
        })
      ).toBeNull();
      expect((await svc().listPhotoInsights(UID))[0].posture_score).toBe(75);
    });

    it('refuses a comprehensive insight referencing a foreign photo in ANY slot', async () => {
      const mine = await seedUserFile(testEnv.DB, UID, 'file_mine');
      const foreign = await seedUserFile(testEnv.DB, OTHER, 'file_theirs');
      const slots = [
        'front_photo_id',
        'back_photo_id',
        'left_side_photo_id',
        'right_side_photo_id',
      ] as const;
      for (const slot of slots) {
        const res = await svc().saveComprehensiveInsight(UID, {
          date: D1,
          front_photo_id: mine,
          [slot]: foreign,
        });
        expect(res, slot).toBeNull();
      }
      expect(await svc().listComprehensiveInsights(UID)).toEqual([]);
    });

    it('stores a comprehensive insight and exposes the newest one', async () => {
      const front = await seedUserFile(testEnv.DB, UID, 'file_c_front');
      await svc().saveComprehensiveInsight(UID, {
        date: D1,
        front_photo_id: front,
        overall_posture_score: 60,
        analysis_provider: 'p3-producer',
      });
      await svc().saveComprehensiveInsight(UID, { date: D3, overall_posture_score: 80 });
      await svc().saveComprehensiveInsight(UID, { date: D2, overall_posture_score: 70 });

      expect((await svc().listComprehensiveInsights(UID)).map((r) => r.date)).toEqual([D3, D2, D1]);
      expect((await svc().latestComprehensiveInsight(UID))?.date).toBe(D3);
      expect(
        (await svc().listComprehensiveInsights(UID, { from: D2, to: D2 })).map((r) => r.date)
      ).toEqual([D2]);
      expect(await svc().listComprehensiveInsights(UID, { limit: 1 })).toHaveLength(1);
    });

    it('returns null latest for a user with no analysis', async () => {
      expect(await svc().latestComprehensiveInsight(UID)).toBeNull();
    });

    it('hides tombstoned insights from every read path', async () => {
      const photo = await seedUserFile(testEnv.DB, UID, 'file_tomb');
      const photoInsight = await svc().savePhotoInsight(UID, {
        photo_id: photo,
        date: D1,
        angle: 'front',
      });
      const comprehensive = await svc().saveComprehensiveInsight(UID, { date: D1 });
      const ts = new Date().toISOString();
      await testEnv.DB.prepare('UPDATE body_photo_insights SET deleted_at = ? WHERE id = ?')
        .bind(ts, photoInsight!.id)
        .run();
      await testEnv.DB.prepare('UPDATE body_comprehensive_insights SET deleted_at = ? WHERE id = ?')
        .bind(ts, comprehensive!.id)
        .run();

      expect(await svc().listPhotoInsights(UID)).toEqual([]);
      expect(await svc().listComprehensiveInsights(UID)).toEqual([]);
      expect(await svc().latestComprehensiveInsight(UID)).toBeNull();
    });

    it('scopes every insight read to its owner', async () => {
      const mine = await seedUserFile(testEnv.DB, UID, 'file_scope_mine');
      const theirs = await seedUserFile(testEnv.DB, OTHER, 'file_scope_theirs');
      await svc().savePhotoInsight(UID, { photo_id: mine, date: D1, angle: 'front' });
      await svc().saveComprehensiveInsight(UID, { date: D1 });
      await svc().savePhotoInsight(OTHER, { photo_id: theirs, date: D1, angle: 'back' });

      expect(await svc().listComprehensiveInsights(OTHER)).toEqual([]);
      expect(await svc().latestComprehensiveInsight(OTHER)).toBeNull();
      // Even naming the owner's photo id explicitly.
      expect(await svc().listPhotoInsights(OTHER, { photo_id: mine })).toEqual([]);
      expect(await svc().listPhotoInsights(UID, { photo_id: mine })).toHaveLength(1);
    });
  });
});
