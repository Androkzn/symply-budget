/**
 * Child Worker → House auth proxy (Budget/Kaizen never mint platform tokens).
 * After a successful House response, upsert a local product-user mirror so
 * child D1 FK paths (`users`, household members, etc.) keep working.
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { getAppBrand } from '../config/brand';
import { isAuthProxyToHouseEnabled } from '../config/brand-capabilities';
import type { JoinedRuntimeBrandId } from '../config/platform-brands';
import { childToHouseServiceToken } from '../config/platform-service-tokens';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { now } from '../utils/id';
import { hasPlatformJwtPublicKeys, hasPlatformJwtPrivateKey } from '../utils/platform-jwt';
import { normalizeUserRole } from '../utils/user-role';

import { getHouseService } from './inter-worker-client';

export function houseApiBaseUrl(env: Env): string {
  if (env.HOUSE_API_FALLBACK_URL?.trim()) {
    return env.HOUSE_API_FALLBACK_URL.trim().replace(/\/$/, '');
  }
  return env.ENVIRONMENT === 'production'
    ? 'https://simple-house-api.a-tekhtelev.workers.dev'
    : 'https://simple-house-api-staging.a-tekhtelev.workers.dev';
}

export function mustProxyAuthToHouse(env: Env): boolean {
  if (!isAuthProxyToHouseEnabled(env)) return false;
  if (hasPlatformJwtPublicKeys(env)) return true;
  if (hasPlatformJwtPrivateKey(env)) return true;
  return false;
}

function serviceTokenForHouse(env: Env): string | undefined {
  return childToHouseServiceToken(env);
}

type HouseAuthUser = {
  id: string;
  email?: string;
  email_verified?: boolean;
  display_name?: string | null;
  avatar_url?: string | null;
  has_completed_onboarding?: boolean;
  /** Platform role from House — the identity authority for the fleet. */
  role?: string | null;
};

/**
 * Upsert House user into the child Worker D1 so product routes can resolve membership.
 */
export async function upsertLocalUserMirror(
  env: Env,
  user: HouseAuthUser
): Promise<void> {
  if (!user?.id) return;
  const d = drizzle(env.DB, { schema });
  const timestamp = now();
  const existing = await d
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .get();

  if (existing) {
    await d
      .update(schema.users)
      .set({
        ...(user.email ? { email: user.email.toLowerCase() } : {}),
        email_verified: Boolean(user.email_verified),
        display_name: user.display_name ?? null,
        avatar_url: user.avatar_url ?? null,
        has_completed_onboarding: Boolean(user.has_completed_onboarding),
        // House is the identity authority: mirror the platform role so the
        // child Worker's own gates agree with it. Fails closed via
        // `normalizeUserRole` when House omits the field (older deploy).
        role: normalizeUserRole(user.role),
        updated_at: timestamp,
      })
      .where(eq(schema.users.id, user.id));
  } else {
    await d.insert(schema.users).values({
      id: user.id,
      email: (user.email || `${user.id}@mirror.invalid`).toLowerCase(),
      email_verified: Boolean(user.email_verified),
      display_name: user.display_name ?? null,
      avatar_url: user.avatar_url ?? null,
      has_completed_onboarding: Boolean(user.has_completed_onboarding),
      role: normalizeUserRole(user.role),
      created_at: timestamp,
      updated_at: timestamp,
    });
  }

  const brand = getAppBrand(env) as JoinedRuntimeBrandId;
  try {
    const mirror = await d
      .select()
      .from(schema.platformProfileMirrors)
      .where(
        and(
          eq(schema.platformProfileMirrors.user_id, user.id),
          eq(schema.platformProfileMirrors.brand_id, brand)
        )
      )
      .get();
    const payload = JSON.stringify({
      display_name: user.display_name ?? null,
      email: user.email ?? null,
    });
    if (mirror) {
      await d
        .update(schema.platformProfileMirrors)
        .set({
          profile_version: Math.max(mirror.profile_version, 1),
          payload_json: payload,
          updated_at: timestamp,
        })
        .where(
          and(
            eq(schema.platformProfileMirrors.user_id, user.id),
            eq(schema.platformProfileMirrors.brand_id, brand)
          )
        );
    } else {
      await d.insert(schema.platformProfileMirrors).values({
        user_id: user.id,
        brand_id: brand,
        profile_version: 1,
        payload_json: payload,
        updated_at: timestamp,
      });
    }
  } catch (err) {
    console.warn('[child-auth-proxy] profile mirror upsert skipped', (err as Error).message);
  }
}

/**
 * Forward an auth JSON request to House, then mirror the user locally on 2xx auth responses.
 * Prefer HOUSE_HTTP service binding — public fetch to *.workers.dev returns CF 1042.
 */
export async function proxyAuthToHouse(
  env: Env,
  path: string,
  init: RequestInit
): Promise<Response> {
  const token = serviceTokenForHouse(env);
  const headers = new Headers(init.headers);
  headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  headers.set('X-Platform-Caller-Brand', getAppBrand(env));
  if (token) headers.set('X-Platform-Service-Token', token);

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const request = new Request(`https://house-internal${normalizedPath}`, {
    method: init.method || 'POST',
    headers,
    body: init.body,
  });

  let upstream: Response;
  if (env.HOUSE_HTTP?.fetch) {
    upstream = await env.HOUSE_HTTP.fetch(request);
  } else {
    // Dev / misconfigured: HTTP fallback (requires custom domain or global_fetch_strictly_public).
    const house = getHouseService(env);
    if (house?.ping) {
      try {
        await house.ping();
      } catch {
        // ignore — binding may be RPC-only
      }
    }
    upstream = await fetch(`${houseApiBaseUrl(env)}${normalizedPath}`, {
      method: init.method || 'POST',
      headers,
      body: init.body,
    });
  }

  // Clone body so we can both mirror and return the same payload.
  const text = await upstream.text();
  if (upstream.ok) {
    try {
      const json = JSON.parse(text) as { user?: HouseAuthUser };
      if (json.user?.id) {
        await upsertLocalUserMirror(env, json.user);
      }
    } catch (err) {
      console.warn('[child-auth-proxy] mirror parse/upsert failed', (err as Error).message);
    }
  }

  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
    },
  });
}
