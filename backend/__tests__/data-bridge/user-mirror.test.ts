/**
 * Child local user + profile mirror upsert after House auth success.
 */
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, beforeEach } from 'vitest';

import * as schema from '../../src/db/schema';
import { upsertLocalUserMirror } from '../../src/services/child-auth-proxy';
import type { Env } from '../../src/types';

import { createPlatformMirrorTables } from './helpers';

const testEnv = env as unknown as Env;

describe('upsertLocalUserMirror', () => {
  beforeEach(async () => {
    await createPlatformMirrorTables(testEnv.DB);
    await testEnv.DB.prepare('DELETE FROM platform_profile_mirrors').run();
    await testEnv.DB.prepare('DELETE FROM users').run();
  });

  it('inserts user + profile mirror on first login', async () => {
    const e = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
    await upsertLocalUserMirror(e, {
      id: 'u_mirror_1',
      email: 'Mirror.User@Example.com',
      email_verified: true,
      display_name: 'Mirror',
      has_completed_onboarding: false,
    });

    const db = drizzle(testEnv.DB, { schema });
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, 'u_mirror_1'))
      .get();
    expect(user?.email).toBe('mirror.user@example.com');
    expect(user?.email_verified).toBe(true);

    const mirror = await db
      .select()
      .from(schema.platformProfileMirrors)
      .where(eq(schema.platformProfileMirrors.user_id, 'u_mirror_1'))
      .get();
    expect(mirror?.brand_id).toBe('symply-budget');
    expect(mirror?.profile_version).toBe(1);
    expect(JSON.parse(mirror!.payload_json).display_name).toBe('Mirror');
  });

  it('updates existing user without duplicating rows', async () => {
    const e = { ...testEnv, APP_BRAND: 'symply-kaizen' } as Env;
    await upsertLocalUserMirror(e, {
      id: 'u_mirror_2',
      email: 'a@example.com',
      email_verified: false,
      display_name: 'A',
    });
    await upsertLocalUserMirror(e, {
      id: 'u_mirror_2',
      email: 'a@example.com',
      email_verified: true,
      display_name: 'A Updated',
      has_completed_onboarding: true,
    });

    const count = await testEnv.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE id = ?')
      .bind('u_mirror_2')
      .first<{ c: number }>();
    expect(Number(count?.c)).toBe(1);

    const db = drizzle(testEnv.DB, { schema });
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, 'u_mirror_2'))
      .get();
    expect(user?.display_name).toBe('A Updated');
    expect(user?.email_verified).toBe(true);
    expect(user?.has_completed_onboarding).toBe(true);
  });

  it('uses .invalid alias when House omits email', async () => {
    const e = { ...testEnv, APP_BRAND: 'symply-budget' } as Env;
    await upsertLocalUserMirror(e, { id: 'u_no_email' });
    const db = drizzle(testEnv.DB, { schema });
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, 'u_no_email'))
      .get();
    expect(user?.email).toBe('u_no_email@mirror.invalid');
  });
});
