/**
 * Session revocation + platform deletion saga (House authority).
 */
import { eq, and, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { isPlatformAuthorityEnabled } from '../config/brand-capabilities';
import { JOINED_PLATFORM_BRANDS } from '../config/platform-brands';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { generateId, now } from '../utils/id';
import { hashToken } from '../utils/password';

import { detachUserFromAllHouseholds } from './household-detach';

function db(env: Env) {
  return drizzle(env.DB, { schema });
}

export async function revokeSessionBySid(
  env: Env,
  userId: string,
  sid: string,
  reason: string
): Promise<void> {
  const d = db(env);
  const timestamp = now();

  await d.insert(schema.platformSessionRevocations).values({
    id: generateId(),
    user_id: userId,
    sid,
    reason,
    created_at: timestamp,
  });

  for (const brandId of JOINED_PLATFORM_BRANDS) {
    await d.insert(schema.platformSessionRevocationOutbox).values({
      id: generateId(),
      user_id: userId,
      sid,
      target_brand_id: brandId,
      created_at: timestamp,
    });
  }

  // Revoke legacy refresh tokens for this user (sid-scoped when column present).
  await d
    .update(schema.refreshTokens)
    .set({ revoked_at: timestamp })
    .where(
      and(eq(schema.refreshTokens.user_id, userId), isNull(schema.refreshTokens.revoked_at))
    );

  try {
    await d
      .update(schema.platformRefreshTokens)
      .set({ revoked_at: timestamp })
      .where(
        and(
          eq(schema.platformRefreshTokens.user_id, userId),
          eq(schema.platformRefreshTokens.sid, sid),
          isNull(schema.platformRefreshTokens.revoked_at)
        )
      );
  } catch {
    // ignore if empty
  }
}

export async function startPlatformDeletion(
  env: Env,
  userId: string,
  idempotencyKey: string,
  statusSecret: string
): Promise<{ request_id: string; state: string }> {
  if (idempotencyKey.length < 16) {
    throw new ValidationError({ idempotency_key: ['must be at least 128 bits'] });
  }
  if (statusSecret.length < 32) {
    throw new ValidationError({ status_secret: ['must be at least 256 bits'] });
  }

  const d = db(env);
  const idempotencyFingerprint = await hashToken(idempotencyKey);
  const statusSecretHash = await hashToken(statusSecret);

  const existing = await d
    .select()
    .from(schema.platformDeletionRequests)
    .where(eq(schema.platformDeletionRequests.idempotency_fingerprint, idempotencyFingerprint))
    .get();

  if (existing) {
    return { request_id: existing.id, state: existing.state };
  }

  const requestId = generateId();
  const timestamp = now();

  await d.insert(schema.platformDeletionRequests).values({
    id: requestId,
    user_id: userId,
    idempotency_fingerprint: idempotencyFingerprint,
    status_secret_hash: statusSecretHash,
    pepper_version: '1',
    state: 'pending',
    created_at: timestamp,
    updated_at: timestamp,
  });

  for (const brandId of JOINED_PLATFORM_BRANDS) {
    await d.insert(schema.platformDeletionOutbox).values({
      id: generateId(),
      request_id: requestId,
      target_brand_id: brandId,
      created_at: timestamp,
    });
  }

  // Soft-delete / block local login immediately on House.
  await d
    .update(schema.users)
    .set({ deleted_at: timestamp, updated_at: timestamp })
    .where(eq(schema.users.id, userId));

  await d
    .update(schema.refreshTokens)
    .set({ revoked_at: timestamp })
    .where(
      and(eq(schema.refreshTokens.user_id, userId), isNull(schema.refreshTokens.revoked_at))
    );

  await d
    .update(schema.userAppEntitlements)
    .set({ status: 'revoked', revocation_pending: false, updated_at: timestamp })
    .where(eq(schema.userAppEntitlements.user_id, userId));

  // Same detachment the in-app delete performs: the account leaves every
  // household it belongs to, owner or member.
  await detachUserFromAllHouseholds(d, userId);

  await d
    .update(schema.platformDeletionRequests)
    .set({ state: 'in_progress', updated_at: timestamp })
    .where(eq(schema.platformDeletionRequests.id, requestId));

  return { request_id: requestId, state: 'in_progress' };
}

export async function getDeletionStatusBySecret(
  env: Env,
  statusSecret: string
): Promise<{ request_id: string; state: string }> {
  const d = db(env);
  const statusSecretHash = await hashToken(statusSecret);
  const row = await d
    .select()
    .from(schema.platformDeletionRequests)
    .where(eq(schema.platformDeletionRequests.status_secret_hash, statusSecretHash))
    .get();
  if (!row) throw new NotFoundError('Deletion request');
  return { request_id: row.id, state: row.state };
}

export async function markDeletionBrandTerminal(
  env: Env,
  requestId: string,
  brandId: string,
  terminalState: 'deleted' | 'no_data' | 'retention_bounded'
): Promise<void> {
  const d = db(env);
  const row = await d
    .select()
    .from(schema.platformDeletionOutbox)
    .where(
      and(
        eq(schema.platformDeletionOutbox.request_id, requestId),
        eq(schema.platformDeletionOutbox.target_brand_id, brandId)
      )
    )
    .get();
  if (!row) throw new NotFoundError('Deletion outbox item');

  await d
    .update(schema.platformDeletionOutbox)
    .set({ delivered_at: now(), terminal_state: terminalState })
    .where(eq(schema.platformDeletionOutbox.id, row.id));

  const pending = await d
    .select()
    .from(schema.platformDeletionOutbox)
    .where(
      and(
        eq(schema.platformDeletionOutbox.request_id, requestId),
        isNull(schema.platformDeletionOutbox.delivered_at)
      )
    )
    .all();

  if (pending.length === 0) {
    await d
      .update(schema.platformDeletionRequests)
      .set({ state: 'terminal', terminal_at: now(), updated_at: now() })
      .where(eq(schema.platformDeletionRequests.id, requestId));
  }
}

export function assertHouseOnly(env: Env): void {
  if (!isPlatformAuthorityEnabled(env)) {
    throw new ForbiddenError('House-only platform authority route');
  }
}
