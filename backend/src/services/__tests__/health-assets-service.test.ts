/**
 * HealthAssetsService — the derived / privacy-bearing layer of the P2 `assets`
 * domain (files, widget preferences, fridge).
 *
 * The routes are a thin pass-through (covered in
 * routes/__tests__/health-assets.test.ts); this suite owns what the HTTP layer
 * cannot reach:
 *   - the pure helpers (key derivation, name sanitisation, expiry normalisation
 *     and the `today + N` cutoff maths),
 *   - the `storage_key` projection — the column exists, holds a real key, and
 *     still never appears in anything the service hands out,
 *   - the widget snapshot's summarisation, including malformed stored payloads,
 *   - PROOF that miniflare D1 enforces migration 0120's CHECK constraints, which
 *     is the whole reason the zod twin in the route file has to exist: without
 *     it a bad write is a 500, not a 400.
 *
 * D1-backed specs run against live miniflare D1 with the 0120 DDL from
 * routes/__tests__/health-test-helpers.ts (same cross-directory helper pattern
 * as services/__tests__/health-service.test.ts).
 */

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createHealthAssetTables,
  createHealthTables,
  resetHealthAssetTables,
  resetHealthTables,
  seedHealthUsers,
} from '../../routes/__tests__/health-test-helpers';
import type { Env } from '../../types';
import {
  HealthAssetsService,
  MAX_FILE_BYTES,
  WIDGET_PREFERENCE_DEFAULTS,
  contentPathFor,
  expiryCutoff,
  normalizeExpiryDate,
  resolveSmallMetric,
  sanitizeFileName,
  storageKeyFor,
  type WidgetPreferenceValues,
} from '../health-assets-service';
import { HealthService } from '../health-service';

const testEnv = env as unknown as Env;

const UID = 'u_assetsvc_alice';
const OTHER = 'u_assetsvc_bob';

const D1 = '2026-06-01';
const TODAY = '2026-06-10';

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]).buffer;

function svc(): HealthAssetsService {
  return new HealthAssetsService(testEnv, testEnv.DB);
}

function health(): HealthService {
  return new HealthService(testEnv.DB);
}

const PHOTO = {
  file_name: 'shot.jpg',
  file_type: 'photo' as const,
  mime_type: 'image/jpeg',
  file_size: 1024,
};

/* ==================================================================== */
/* Pure helpers — no D1, no service instance                             */
/* ==================================================================== */

describe('health-assets pure helpers', () => {
  describe('sanitizeFileName', () => {
    it('keeps an ordinary name intact', () => {
      expect(sanitizeFileName('front (2026-06-01).jpg')).toBe('front (2026-06-01).jpg');
    });

    it('neutralises the characters that would break a Content-Disposition header', () => {
      // The name is client-supplied and gets rendered into a response header —
      // a raw quote or newline is header injection, not a cosmetic problem.
      expect(sanitizeFileName('evil".jpg')).toBe('evil_.jpg');
      expect(sanitizeFileName('a\r\nX-Injected: 1.jpg')).toBe('a_X-Injected_ 1.jpg');
      expect(sanitizeFileName('semi;colon.jpg')).toBe('semi_colon.jpg');
    });

    it('flattens path separators so a name cannot walk the R2 key space', () => {
      expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
      expect(sanitizeFileName('/absolute/path.png')).toBe('_absolute_path.png');
    });

    it('caps at 255 characters', () => {
      expect(sanitizeFileName('x'.repeat(400))).toHaveLength(255);
    });

    it('never returns an empty or whitespace-only name', () => {
      // Empty would produce a bare `filename=""` in the header and an
      // extension-less R2 key; both are avoidable.
      expect(sanitizeFileName('')).toBe('file');
      expect(sanitizeFileName('   ')).toBe('file');
      expect(sanitizeFileName('///')).toBe('_'); // substituted, but still a name
      expect(sanitizeFileName('///')).not.toContain('/');
    });
  });

  describe('storageKeyFor', () => {
    it('namespaces by user and file id under the domain prefix', () => {
      expect(storageKeyFor('u1', 'f_abc', 'shot.jpg')).toBe('health-files/u1/f_abc.jpg');
    });

    it('is never a URL — publishing it is the thing this domain must not do', () => {
      const key = storageKeyFor('u1', 'f_abc', 'shot.jpg');
      expect(key).not.toContain('://');
      expect(key.startsWith('health-files/')).toBe(true);
    });

    it('drops an extension it cannot trust rather than embedding it', () => {
      expect(storageKeyFor('u1', 'f_a', 'noext')).toBe('health-files/u1/f_a');
      expect(storageKeyFor('u1', 'f_a', 'weird.j p g!')).toBe('health-files/u1/f_a.jpg');
      expect(storageKeyFor('u1', 'f_a', 'long.abcdefghijklmnop')).toBe(
        'health-files/u1/f_a.abcdefghij'
      );
    });

    it('cannot be walked out of by a hostile name', () => {
      // The extension is the only client-derived part, and it is stripped to
      // alphanumerics — no slashes, no dots, no traversal.
      const key = storageKeyFor('u1', 'f_a', 'x.../../../secret');
      expect(key).toBe('health-files/u1/f_a.secret');
      expect(key.split('/')).toHaveLength(3);
    });
  });

  describe('contentPathFor', () => {
    it('is a relative, same-origin path — not a public URL', () => {
      expect(contentPathFor('f_abc')).toBe('/health/files/f_abc/content');
      expect(contentPathFor('f_abc')).not.toContain('://');
    });
  });

  describe('normalizeExpiryDate', () => {
    it('passes a plain YYYY-MM-DD through', () => {
      expect(normalizeExpiryDate('2026-06-17')).toBe('2026-06-17');
    });

    it('truncates an ISO timestamp to its UTC day', () => {
      // Why this matters: `expiry_date` is TEXT and compared lexicographically,
      // so '2026-06-17T23:30:00Z' would sort AFTER '2026-06-17' and fall outside
      // a window that should contain it.
      expect(normalizeExpiryDate('2026-06-17T23:30:00.000Z')).toBe('2026-06-17');
      expect(normalizeExpiryDate('2026-06-17T23:30:00+05:00')).toBe('2026-06-17');
    });

    it('returns null for anything it cannot parse', () => {
      expect(normalizeExpiryDate('next tuesday')).toBeNull();
      expect(normalizeExpiryDate('')).toBeNull();
      expect(normalizeExpiryDate('   ')).toBeNull();
      expect(normalizeExpiryDate(null)).toBeNull();
      expect(normalizeExpiryDate(undefined)).toBeNull();
    });

    it('rejects a well-shaped but impossible date', () => {
      // `2026-02-30` is the trap: V8 rolls it over to 2 March instead of
      // failing, so without a round-trip check it would be stored verbatim.
      expect(normalizeExpiryDate('2026-13-45')).toBeNull();
      expect(normalizeExpiryDate('2026-02-30')).toBeNull();
      expect(normalizeExpiryDate('2026-04-31')).toBeNull();
      expect(normalizeExpiryDate('2026-02-29')).toBeNull(); // 2026 is not a leap year
      expect(normalizeExpiryDate('2028-02-29')).toBe('2028-02-29'); // 2028 is
    });
  });

  describe('expiryCutoff', () => {
    it('is today itself at N = 0', () => {
      expect(expiryCutoff('2026-06-10', 0)).toBe('2026-06-10');
    });

    it('adds whole days', () => {
      expect(expiryCutoff('2026-06-10', 7)).toBe('2026-06-17');
    });

    it('crosses month and year boundaries', () => {
      expect(expiryCutoff('2026-06-28', 7)).toBe('2026-07-05');
      expect(expiryCutoff('2026-12-30', 3)).toBe('2027-01-02');
      expect(expiryCutoff('2028-02-28', 1)).toBe('2028-02-29'); // leap year
    });
  });

  describe('resolveSmallMetric', () => {
    const base: WidgetPreferenceValues = { ...WIDGET_PREFERENCE_DEFAULTS };

    it('honours the explicit choice when its domain is visible', () => {
      expect(resolveSmallMetric({ ...base, small_widget_metric: 'calories' })).toBe('calories');
      expect(resolveSmallMetric({ ...base, small_widget_metric: 'water' })).toBe('water');
      expect(resolveSmallMetric(base)).toBe('steps');
    });

    it('falls back to steps when the chosen domain is switched off', () => {
      // Otherwise `show_nutrition: false` would still put calories on a locked
      // screen through the small slot.
      expect(
        resolveSmallMetric({ ...base, small_widget_metric: 'calories', show_nutrition: false })
      ).toBe('steps');
    });

    it('leaves water alone — it has no toggle to hide it', () => {
      expect(
        resolveSmallMetric({ ...base, small_widget_metric: 'water', show_nutrition: false })
      ).toBe('water');
    });
  });
});

/* ==================================================================== */
/* D1-backed                                                             */
/* ==================================================================== */

describe('HealthAssetsService (D1)', () => {
  beforeEach(async () => {
    await createHealthTables(testEnv.DB);
    await createHealthAssetTables(testEnv.DB);
    await resetHealthAssetTables(testEnv.DB);
    await resetHealthTables(testEnv.DB);
    await seedHealthUsers(testEnv.DB, [UID, OTHER]);
  });

  /* ------------------------------ files ---------------------------- */

  describe('files', () => {
    it('stores a real storage_key in D1 and still never hands it out', async () => {
      const { file } = await svc().createFileUpload(UID, PHOTO);

      // The column IS populated — the key exists, it simply never leaves.
      const row = await testEnv.DB.prepare('SELECT storage_key FROM user_files WHERE id = ?')
        .bind(file.id)
        .first<{ storage_key: string }>();
      expect(row?.storage_key).toBe(storageKeyFor(UID, file.id, 'shot.jpg'));

      // Every service read path returns exactly the public projection.
      const expectedKeys = [
        'id',
        'file_name',
        'file_type',
        'mime_type',
        'file_size',
        'category',
        'metadata',
        'created_at',
        'updated_at',
        'content_path',
      ].sort();
      expect(Object.keys(file).sort()).toEqual(expectedKeys);
      expect(Object.keys((await svc().getFile(UID, file.id))!).sort()).toEqual(expectedKeys);
      expect(Object.keys((await svc().listFiles(UID))[0]).sort()).toEqual(expectedKeys);
    });

    it('serialises metadata to JSON TEXT (P1 convention)', async () => {
      const { file } = await svc().createFileUpload(UID, {
        ...PHOTO,
        category: 'body_photos',
        metadata: { angle: 'front', date: D1 },
      });
      expect(file.category).toBe('body_photos');
      expect(JSON.parse(file.metadata!)).toEqual({ angle: 'front', date: D1 });
    });

    it('hides another user files, soft-deleted rows included', async () => {
      const mine = await svc().createFileUpload(UID, PHOTO);
      await svc().createFileUpload(OTHER, PHOTO);

      expect(await svc().listFiles(UID)).toHaveLength(1);
      expect(await svc().getFile(OTHER, mine.file.id)).toBeNull();
      expect(await svc().putFileContent(OTHER, mine.file.id, BYTES)).toBeNull();
      expect(await svc().getFileContent(OTHER, mine.file.id)).toBeNull();
      expect(await svc().deleteFile(OTHER, mine.file.id)).toBe(false);

      // Nothing of A's was touched by any of that.
      expect(await svc().getFile(UID, mine.file.id)).not.toBeNull();
    });

    it('filters by file_type and orders newest first', async () => {
      const a = await svc().createFileUpload(UID, { ...PHOTO, file_name: 'a.jpg' });
      const b = await svc().createFileUpload(UID, {
        ...PHOTO,
        file_name: 'b.jpg',
        file_type: 'body_photo',
      });
      // `created_at` is second-or-better resolution; force a distinct stamp so
      // the ordering assertion is about the query, not about clock luck.
      await testEnv.DB.prepare('UPDATE user_files SET created_at = ? WHERE id = ?')
        .bind('2020-01-01T00:00:00.000Z', a.file.id)
        .run();

      expect((await svc().listFiles(UID)).map((f) => f.file_name)).toEqual(['b.jpg', 'a.jpg']);
      expect((await svc().listFiles(UID, { file_type: 'body_photo' })).map((f) => f.id)).toEqual([
        b.file.id,
      ]);
      expect(await svc().listFiles(UID, { file_type: 'document' })).toEqual([]);
      expect(await svc().listFiles(UID, { limit: 1 })).toHaveLength(1);
    });

    it('round-trips the bytes and corrects the declared size', async () => {
      const { file } = await svc().createFileUpload(UID, { ...PHOTO, file_size: 999_999 });
      const updated = await svc().putFileContent(UID, file.id, BYTES);
      expect(updated?.file_size).toBe(BYTES.byteLength);

      const found = await svc().getFileContent(UID, file.id);
      expect(found).not.toBeNull();
      expect(Array.from(new Uint8Array(await found!.object.arrayBuffer()))).toEqual(
        Array.from(new Uint8Array(BYTES))
      );
    });

    it('stores the R2 object with the VALIDATED mime type, not a client header', async () => {
      // A client could otherwise reserve `image/jpeg` and push `text/html`,
      // which the content proxy would then serve back on our own origin.
      const { file } = await svc().createFileUpload(UID, PHOTO);
      await svc().putFileContent(UID, file.id, BYTES);
      const object = await testEnv.REPORTS_BUCKET.get(storageKeyFor(UID, file.id, 'shot.jpg'));
      expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    });

    it('is idempotent on re-upload, so a retry after a dropped connection is safe', async () => {
      const { file } = await svc().createFileUpload(UID, PHOTO);
      await svc().putFileContent(UID, file.id, BYTES);
      const second = new Uint8Array([1, 2]).buffer;
      const updated = await svc().putFileContent(UID, file.id, second);
      expect(updated?.file_size).toBe(2);
      expect(await svc().listFiles(UID)).toHaveLength(1);
    });

    it('soft-deletes the row but really destroys the bytes', async () => {
      const { file } = await svc().createFileUpload(UID, {
        ...PHOTO,
        file_name: 'private.jpg',
        file_type: 'body_photo',
      });
      const key = storageKeyFor(UID, file.id, 'private.jpg');
      await svc().putFileContent(UID, file.id, BYTES);
      expect(await testEnv.REPORTS_BUCKET.get(key)).not.toBeNull();

      expect(await svc().deleteFile(UID, file.id)).toBe(true);
      // "Delete this body photo" must mean the pixels are gone…
      expect(await testEnv.REPORTS_BUCKET.get(key)).toBeNull();
      // …while the row survives as a tombstone for the sync cursor.
      const row = await testEnv.DB.prepare('SELECT deleted_at FROM user_files WHERE id = ?')
        .bind(file.id)
        .first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();

      expect(await svc().getFile(UID, file.id)).toBeNull();
      expect(await svc().deleteFile(UID, file.id)).toBe(false);
    });

    it('survives deleting a file whose object was already gone from R2', async () => {
      const { file } = await svc().createFileUpload(UID, PHOTO); // never uploaded
      expect(await svc().deleteFile(UID, file.id)).toBe(true);
    });

    it('reports no content for a reserved-but-never-uploaded file', async () => {
      const { file } = await svc().createFileUpload(UID, PHOTO);
      expect(await svc().getFileContent(UID, file.id)).toBeNull();
    });

    it('advertises the donor 50MB cap', () => {
      expect(MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    });
  });

  /* -------------------------- widget prefs -------------------------- */

  describe('widget preferences', () => {
    it('reads the migration defaults for an account with no row', async () => {
      expect(await svc().getWidgetPreferences(UID)).toEqual(WIDGET_PREFERENCE_DEFAULTS);
    });

    it('round-trips booleans through D1 INTEGER columns', async () => {
      await svc().saveWidgetPreferences(UID, {
        show_weight: false,
        show_nutrition: true,
        show_workouts: false,
      });
      const stored = await svc().getWidgetPreferences(UID);
      expect(stored.show_weight).toBe(false);
      expect(stored.show_nutrition).toBe(true);
      expect(stored.show_workouts).toBe(false);
    });

    it('merges rather than replacing, and upserts to a single row', async () => {
      await svc().saveWidgetPreferences(UID, { small_widget_metric: 'water' });
      await svc().saveWidgetPreferences(UID, { chart_type: 'line' });
      const merged = await svc().saveWidgetPreferences(UID, { show_workouts: false });
      expect(merged).toEqual({
        small_widget_metric: 'water',
        chart_type: 'line',
        chart_metric: 'weight',
        show_weight: true,
        show_nutrition: true,
        show_workouts: false,
        small_widget_style: 'standard',
        medium_widget_layout: 'standard',
        medium_primary_metric: 'steps',
        medium_secondary_metric: 'calories',
        medium_show_all_metrics: true,
      });

      const count = await testEnv.DB.prepare(
        'SELECT COUNT(*) AS n FROM widget_preferences WHERE user_id = ?'
      )
        .bind(UID)
        .first<{ n: number }>();
      expect(count?.n).toBe(1);
    });

    it('keeps two users apart on the UNIQUE user_id upsert', async () => {
      await svc().saveWidgetPreferences(UID, { small_widget_metric: 'water' });
      await svc().saveWidgetPreferences(OTHER, { small_widget_metric: 'calories' });
      expect((await svc().getWidgetPreferences(UID)).small_widget_metric).toBe('water');
      expect((await svc().getWidgetPreferences(OTHER)).small_widget_metric).toBe('calories');
    });
  });

  /* --------------------------- snapshot ----------------------------- */

  describe('widgetSnapshot', () => {
    async function seedTracking() {
      const h = health();
      await h.saveGoal(UID, D1, { daily_calories: 2000, daily_water_ml: 2000, daily_steps: 10000 });
      await h.createWeight(UID, { date: D1, weight: 70.5, unit: 'kg' });
      await h.createWater(UID, { date: D1, amount_ml: 300 });
      await h.createWater(UID, { date: D1, amount_ml: 200 });
      await h.createNutrition(UID, {
        date: D1,
        food_name: 'Eggs',
        meal_type: 'breakfast',
        calories: 300,
        proteins: 20,
        carbohydrates: 5,
        fats: 10,
      });
      await h.setSteps(UID, D1, 8000);
    }

    it('sums workout minutes and calories across every session of the day', async () => {
      await seedTracking();
      const h = health();
      await h.createHealthEntry(UID, {
        date: D1,
        entry_type: 'workout',
        data: { workout_type: 'run', minutes: 30, calories: 250 },
      });
      await h.createHealthEntry(UID, {
        date: D1,
        entry_type: 'workout',
        data: { workout_type: 'swim', minutes: 45, calories: 400 },
      });
      // A different day must not bleed in.
      await h.createHealthEntry(UID, {
        date: '2026-06-02',
        entry_type: 'workout',
        data: { workout_type: 'row', minutes: 60, calories: 500 },
      });

      const snap = await svc().widgetSnapshot(UID, D1);
      expect(snap.workouts).toEqual({ count: 2, minutes: 75, calories: 650, goal_minutes: null });
      expect(snap.water).toEqual({ total_ml: 500, goal_ml: 2000 });
      expect(snap.nutrition?.calories).toBe(300);
      expect(snap.weight).toEqual({ value: 70.5, unit: 'kg', date: D1 });
    });

    it('does not crash on a stored workout payload it cannot parse', async () => {
      // The column is free-form TEXT; a row written by an older client (or a
      // partial write) must degrade to zero, not take the whole widget down.
      const ts = new Date().toISOString();
      await testEnv.DB.prepare(
        `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at)
         VALUES (?, ?, ?, 'workout', ?, 'manual', ?, ?)`
      )
        .bind('he_broken', UID, D1, 'not json at all', ts, ts)
        .run();
      await testEnv.DB.prepare(
        `INSERT INTO health_entries (id, user_id, date, entry_type, data, source, created_at, updated_at)
         VALUES (?, ?, ?, 'workout', ?, 'manual', ?, ?)`
      )
        .bind('he_partial', UID, D1, JSON.stringify({ workout_type: 'yoga' }), ts, ts)
        .run();

      const snap = await svc().widgetSnapshot(UID, D1);
      expect(snap.workouts).toEqual({ count: 2, minutes: 0, calories: 0, goal_minutes: null });
    });

    it('carries no file data at all, whatever the user has stored', async () => {
      await seedTracking();
      const body = await svc().createFileUpload(UID, {
        ...PHOTO,
        file_name: 'front.jpg',
        file_type: 'body_photo',
      });
      await svc().putFileContent(UID, body.file.id, BYTES);

      const serialised = JSON.stringify(await svc().widgetSnapshot(UID, D1));
      expect(serialised).not.toContain(body.file.id);
      expect(serialised).not.toContain('front.jpg');
      expect(serialised).not.toContain('body_photo');
      expect(serialised).not.toContain('health-files');
    });

    it('carries no cycle or vitality data either', async () => {
      const h = health();
      await h.logPeriodDay(UID, D1, 4, 'cramps');
      await h.saveMensHealth(UID, D1, { libido: 9, notes: 'private note' });
      const serialised = JSON.stringify(await svc().widgetSnapshot(UID, D1));
      for (const forbidden of ['cramps', 'private note', 'libido', 'flow_level', 'period']) {
        expect(serialised).not.toContain(forbidden);
      }
    });

    it('is scoped per user — B never reads A figures', async () => {
      await seedTracking();
      const snap = await svc().widgetSnapshot(OTHER, D1);
      expect(snap.steps).toEqual({ value: 0, goal: null });
      expect(snap.water).toEqual({ total_ml: 0, goal_ml: null });
      expect(snap.weight).toBeNull();
      expect(snap.nutrition?.calories).toBe(0);
    });
  });

  /* ---------------------------- fridge ------------------------------ */

  describe('fridge', () => {
    it('normalises an ISO expiry to a date on create and on update', async () => {
      const item = await svc().createFridgeItem(UID, {
        name: 'Milk',
        expiry_date: '2026-06-17T23:30:00.000Z',
      });
      expect(item.expiry_date).toBe('2026-06-17');

      const updated = await svc().updateFridgeItem(UID, item.id, {
        expiry_date: '2026-06-20T01:00:00.000Z',
      });
      expect(updated?.expiry_date).toBe('2026-06-20');
    });

    it('distinguishes "leave alone" (undefined) from "clear" (null)', async () => {
      const item = await svc().createFridgeItem(UID, {
        name: 'Milk',
        unit: 'L',
        notes: 'keep me',
        expiry_date: '2026-06-17',
      });
      const untouched = await svc().updateFridgeItem(UID, item.id, { quantity: 3 });
      expect(untouched?.notes).toBe('keep me');
      expect(untouched?.unit).toBe('L');
      expect(untouched?.expiry_date).toBe('2026-06-17');

      const cleared = await svc().updateFridgeItem(UID, item.id, {
        notes: null,
        expiry_date: null,
      });
      expect(cleared?.notes).toBeNull();
      expect(cleared?.expiry_date).toBeNull();
    });

    it('applies defaults from the migration', async () => {
      const item = await svc().createFridgeItem(UID, { name: 'Milk' });
      expect(item.source).toBe('manual');
      expect(item.is_favorite).toBe(false);
      expect(item.quantity).toBeNull();
      expect(item.expiry_date).toBeNull();
    });

    describe('expiring_within_days', () => {
      async function seed() {
        const s = svc();
        await s.createFridgeItem(UID, { name: 'Expired', expiry_date: '2026-06-09' });
        await s.createFridgeItem(UID, { name: 'Today', expiry_date: TODAY });
        await s.createFridgeItem(UID, { name: 'Boundary', expiry_date: '2026-06-17' });
        await s.createFridgeItem(UID, { name: 'JustOutside', expiry_date: '2026-06-18' });
        await s.createFridgeItem(UID, { name: 'Undated' });
      }

      it('includes the past and the exact boundary, excludes the day after', async () => {
        await seed();
        const names = (
          await svc().listFridge(UID, { expiring_within_days: 7, today: TODAY })
        ).map((i) => i.name);
        expect(names).toEqual(['Expired', 'Today', 'Boundary']);
      });

      it('keeps only what is already due at N = 0', async () => {
        await seed();
        const names = (
          await svc().listFridge(UID, { expiring_within_days: 0, today: TODAY })
        ).map((i) => i.name);
        expect(names).toEqual(['Expired', 'Today']);
      });

      it('never returns an undated item — it cannot be "expiring"', async () => {
        await seed();
        const names = (
          await svc().listFridge(UID, { expiring_within_days: 3650, today: TODAY })
        ).map((i) => i.name);
        expect(names).not.toContain('Undated');
        // …but the unfiltered list still has it.
        expect((await svc().listFridge(UID)).map((i) => i.name)).toContain('Undated');
      });

      it('drops soft-deleted rows from both list shapes', async () => {
        await seed();
        const item = (await svc().listFridge(UID)).find((i) => i.name === 'Today')!;
        expect(await svc().deleteFridgeItem(UID, item.id)).toBe(true);
        expect((await svc().listFridge(UID)).map((i) => i.name)).not.toContain('Today');
        expect(
          (await svc().listFridge(UID, { expiring_within_days: 7, today: TODAY })).map((i) => i.name)
        ).not.toContain('Today');
        expect(await svc().deleteFridgeItem(UID, item.id)).toBe(false);
      });

      it('is scoped per user', async () => {
        await seed();
        expect(await svc().listFridge(OTHER)).toEqual([]);
        expect(
          await svc().listFridge(OTHER, { expiring_within_days: 3650, today: TODAY })
        ).toEqual([]);
      });
    });

    it('refuses to touch another user row', async () => {
      const item = await svc().createFridgeItem(UID, { name: 'Milk' });
      expect(await svc().updateFridgeItem(OTHER, item.id, { name: 'Hijacked' })).toBeNull();
      expect(await svc().deleteFridgeItem(OTHER, item.id)).toBe(false);
      expect((await svc().listFridge(UID))[0].name).toBe('Milk');
    });
  });

  /* ------------------- why the zod twin has to exist ---------------- */

  describe('D1 enforces the migration-0120 CHECKs', () => {
    // This is the justification for duplicating every CHECK in zod: these
    // writes REJECT at the database, so a route that skipped validation would
    // answer 500 (constraint error) instead of an honest 400. If this block
    // ever starts passing, the zod layer has become optional — and the route
    // tests that assert 400 would be asserting nothing.
    async function rawInsert(overrides: Partial<Record<string, unknown>>) {
      const ts = new Date().toISOString();
      const row = {
        id: `fr_raw_${crypto.randomUUID()}`,
        name: 'Milk',
        quantity: 1,
        unit: 'L',
        category: 'Dairy',
        notes: null,
        source: 'manual',
        ...overrides,
      };
      return testEnv.DB.prepare(
        `INSERT INTO fridge_items
           (id, user_id, name, quantity, unit, category, notes, source, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
        .bind(
          row.id,
          UID,
          row.name,
          row.quantity,
          row.unit,
          row.category,
          row.notes,
          row.source,
          ts,
          ts
        )
        .run();
    }

    it.each([
      ['empty name', { name: '' }],
      ['name over 200', { name: 'x'.repeat(201) }],
      ['negative quantity', { quantity: -1 }],
      ['unit over 20', { unit: 'u'.repeat(21) }],
      ['category over 50', { category: 'c'.repeat(51) }],
      ['notes over 1000', { notes: 'n'.repeat(1001) }],
      ['unknown source', { source: 'telepathy' }],
    ])('rejects %s at the database', async (_label, overrides) => {
      await expect(rawInsert(overrides)).rejects.toThrow();
    });

    it('rejects an out-of-contract file_type and widget enum too', async () => {
      const ts = new Date().toISOString();
      await expect(
        testEnv.DB.prepare(
          `INSERT INTO user_files (id, user_id, file_name, file_type, mime_type, file_size, storage_key, created_at, updated_at)
           VALUES (?, ?, 'a.jpg', 'avatar', 'image/jpeg', 1, 'k', ?, ?)`
        )
          .bind('f_raw', UID, ts, ts)
          .run()
      ).rejects.toThrow();

      await expect(
        testEnv.DB.prepare(
          `INSERT INTO widget_preferences (id, user_id, small_widget_metric, created_at, updated_at)
           VALUES (?, ?, 'bpm', ?, ?)`
        )
          .bind('wp_raw', UID, ts, ts)
          .run()
      ).rejects.toThrow();
    });

    it('accepts every boundary value the service actually writes', async () => {
      await expect(
        rawInsert({
          name: 'x'.repeat(200),
          quantity: 0,
          unit: 'u'.repeat(20),
          category: 'c'.repeat(50),
          notes: 'n'.repeat(1000),
          source: 'photo',
        })
      ).resolves.toBeTruthy();
    });
  });
});
