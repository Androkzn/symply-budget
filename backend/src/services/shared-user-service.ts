/**
 * Shared User / platform identity helpers (House authority).
 */
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { JoinedRuntimeBrandId } from '../config/platform-brands';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { NotFoundError } from '../utils/errors';
import { generateId, now } from '../utils/id';

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export async function ensureAppEntitlement(
  env: Env,
  userId: string,
  brandId: JoinedRuntimeBrandId
): Promise<{ entitlement_version: number; status: string }> {
  const d = db(env);
  const existing = await d
    .select()
    .from(schema.userAppEntitlements)
    .where(
      and(
        eq(schema.userAppEntitlements.user_id, userId),
        eq(schema.userAppEntitlements.brand_id, brandId)
      )
    )
    .get();

  if (existing) {
    if (existing.status !== 'active') {
      await d
        .update(schema.userAppEntitlements)
        .set({
          status: 'active',
          revocation_pending: false,
          updated_at: now(),
        })
        .where(eq(schema.userAppEntitlements.id, existing.id));
    }
    return {
      entitlement_version: existing.entitlement_version,
      status: 'active',
    };
  }

  const id = generateId();
  await d.insert(schema.userAppEntitlements).values({
    id,
    user_id: userId,
    brand_id: brandId,
    entitlement_version: 1,
    status: 'active',
    revocation_pending: false,
    created_at: now(),
    updated_at: now(),
  });
  return { entitlement_version: 1, status: 'active' };
}

export async function upsertPlatformProfile(
  env: Env,
  userId: string,
  fields: {
    display_name?: string | null;
    avatar_url?: string | null;
    contact_email?: string | null;
    contact_email_verified?: boolean;
    locale?: string | null;
    timezone?: string | null;
  }
): Promise<number> {
  const d = db(env);
  const existing = await d
    .select()
    .from(schema.platformProfiles)
    .where(eq(schema.platformProfiles.user_id, userId))
    .get();

  if (!existing) {
    await d.insert(schema.platformProfiles).values({
      user_id: userId,
      display_name: fields.display_name ?? null,
      avatar_url: fields.avatar_url ?? null,
      contact_email: fields.contact_email ?? null,
      contact_email_verified: fields.contact_email_verified ?? false,
      locale: fields.locale ?? null,
      timezone: fields.timezone ?? null,
      profile_version: 1,
      created_at: now(),
      updated_at: now(),
    });
    return 1;
  }

  const nextVersion = existing.profile_version + 1;
  await d
    .update(schema.platformProfiles)
    .set({
      display_name: fields.display_name ?? existing.display_name,
      avatar_url: fields.avatar_url ?? existing.avatar_url,
      contact_email: fields.contact_email ?? existing.contact_email,
      contact_email_verified:
        fields.contact_email_verified ?? existing.contact_email_verified,
      locale: fields.locale ?? existing.locale,
      timezone: fields.timezone ?? existing.timezone,
      profile_version: nextVersion,
      updated_at: now(),
    })
    .where(eq(schema.platformProfiles.user_id, userId));

  try {
    await d.insert(schema.platformProfileOutbox).values({
      id: generateId(),
      user_id: userId,
      profile_version: nextVersion,
      payload_json: JSON.stringify({
        display_name: fields.display_name ?? existing.display_name,
        locale: fields.locale ?? existing.locale,
        timezone: fields.timezone ?? existing.timezone,
      }),
      created_at: now(),
    });
  } catch {
    // 0093 may not be applied yet
  }

  return nextVersion;
}

export async function getSharedUserMe(env: Env, userId: string) {
  const d = db(env);
  const user = await d
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) throw new NotFoundError('User');

  const profile = await d
    .select()
    .from(schema.platformProfiles)
    .where(eq(schema.platformProfiles.user_id, userId))
    .get();

  const entitlements = await d
    .select()
    .from(schema.userAppEntitlements)
    .where(eq(schema.userAppEntitlements.user_id, userId))
    .all();

  return {
    user_id: userId,
    email: user.email,
    display_name: profile?.display_name ?? user.display_name,
    avatar_url: profile?.avatar_url ?? user.avatar_url,
    locale: profile?.locale ?? null,
    timezone: profile?.timezone ?? null,
    profile_version: profile?.profile_version ?? 0,
    entitlements: entitlements.map((e) => ({
      brand_id: e.brand_id,
      entitlement_version: e.entitlement_version,
      status: e.status,
    })),
  };
}
