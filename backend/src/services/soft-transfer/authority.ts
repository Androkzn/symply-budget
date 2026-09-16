/**
 * House Soft Transfer authority — consents, prepare, JTI consume.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import type { JoinedRuntimeBrandId } from '../../config/platform-brands';
import {
  getTransferPackage,
  resolveTransferDirection,
  type TransferPackageId,
} from '../../config/transfer-package-registry';
import * as schema from '../../db/schema';
import type { Env } from '../../types';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { generateId, now } from '../../utils/id';
import { signTransferExportToken } from '../../utils/platform-jwt';
import { assertSoftTransferEnabled } from '../bridge-control';
import { ensureAppEntitlement } from '../shared-user-service';

import { sha256Hex } from './canonical-json';


function db(env: Env) {
  return drizzle(env.DB, { schema });
}

const DEFAULT_PURPOSE: Record<TransferPackageId, string> = {
  'profile.core.v1': 'Share confirmed profile basics across Symply apps',
  'house.property.v1': 'Pre-fill Budget setup from a House household summary',
  'budget.summary.v1': 'Show a high-level Budget summary in Symply House',
  'home_project_cost_summary.v1':
    'Share Home Project cost totals with Symply Budget (categories only, no product links)',
  'profile.core.health.v1': 'Share profile basics with Symply Health onboarding',
  'health.summary.v1': 'Show a high-level Health check-in summary in Symply House',
  'profile.core.language.v1': 'Share profile basics with Symply Language onboarding',
  'language.summary.v1': 'Show a high-level Language learning summary in Symply House',
};

export async function listConsents(env: Env, userId: string) {
  await assertSoftTransferEnabled(env);
  const rows = await db(env)
    .select()
    .from(schema.transferConsents)
    .where(eq(schema.transferConsents.user_id, userId))
    .all();
  return rows.map((r) => ({
    id: r.id,
    package_id: r.package_id,
    source_brand_id: r.source_brand_id,
    destination_brand_id: r.destination_brand_id,
    purpose: r.purpose,
    consent_version: r.consent_version,
    status: r.status,
    expires_at: r.expires_at,
    revoked_at: r.revoked_at,
    created_at: r.created_at,
  }));
}

export async function grantConsent(
  env: Env,
  args: {
    userId: string;
    packageId: string;
    sourceBrandId: string;
    destinationBrandId: string;
    purpose?: string;
    expiresAt?: string | null;
  }
) {
  await assertSoftTransferEnabled(env);
  const direction = resolveTransferDirection(
    args.packageId,
    args.sourceBrandId,
    args.destinationBrandId
  );
  if (!direction) {
    throw new ValidationError({ package_id: ['Unknown or invalid package direction'] });
  }

  await ensureAppEntitlement(env, args.userId, args.sourceBrandId as JoinedRuntimeBrandId);
  await ensureAppEntitlement(env, args.userId, args.destinationBrandId as JoinedRuntimeBrandId);

  const existing = await db(env)
    .select()
    .from(schema.transferConsents)
    .where(
      and(
        eq(schema.transferConsents.user_id, args.userId),
        eq(schema.transferConsents.package_id, args.packageId),
        eq(schema.transferConsents.source_brand_id, args.sourceBrandId),
        eq(schema.transferConsents.destination_brand_id, args.destinationBrandId),
        eq(schema.transferConsents.status, 'active')
      )
    )
    .get();

  if (existing) {
    return {
      id: existing.id,
      package_id: existing.package_id,
      source_brand_id: existing.source_brand_id,
      destination_brand_id: existing.destination_brand_id,
      purpose: existing.purpose,
      consent_version: existing.consent_version,
      status: existing.status,
      expires_at: existing.expires_at,
      created_at: existing.created_at,
    };
  }

  const id = generateId();
  const purpose =
    args.purpose?.trim() ||
    DEFAULT_PURPOSE[args.packageId as TransferPackageId] ||
    'Soft Transfer';
  const timestamp = now();
  await db(env).insert(schema.transferConsents).values({
    id,
    user_id: args.userId,
    source_brand_id: args.sourceBrandId,
    destination_brand_id: args.destinationBrandId,
    package_id: args.packageId,
    purpose,
    consent_version: 1,
    status: 'active',
    expires_at: args.expiresAt ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  return {
    id,
    package_id: args.packageId,
    source_brand_id: args.sourceBrandId,
    destination_brand_id: args.destinationBrandId,
    purpose,
    consent_version: 1,
    status: 'active' as const,
    expires_at: args.expiresAt ?? null,
    created_at: timestamp,
  };
}

export async function revokeConsent(env: Env, userId: string, consentId: string) {
  await assertSoftTransferEnabled(env);
  const row = await db(env)
    .select()
    .from(schema.transferConsents)
    .where(
      and(eq(schema.transferConsents.id, consentId), eq(schema.transferConsents.user_id, userId))
    )
    .get();
  if (!row) throw new NotFoundError('Consent');
  if (row.status !== 'active') return { id: row.id, status: row.status };

  const timestamp = now();
  await db(env)
    .update(schema.transferConsents)
    .set({ status: 'revoked', revoked_at: timestamp, updated_at: timestamp })
    .where(eq(schema.transferConsents.id, consentId));
  return { id: consentId, status: 'revoked' as const };
}

export async function prepareTransfer(
  env: Env,
  args: {
    userId: string;
    packageId: string;
    sourceBrandId: string;
    destinationBrandId: string;
    consentId: string;
    idempotencyKey: string;
    sourceContextId?: string | null;
    destinationContextId?: string | null;
  }
): Promise<{
  operation_id: string;
  transfer_token: string;
  expires_at: string;
  consent_id: string;
}> {
  await assertSoftTransferEnabled(env);

  if (!args.idempotencyKey || args.idempotencyKey.length < 16) {
    throw new ValidationError({
      idempotency_key: ['Idempotency-Key must be ≥128-bit CSPRNG (≥16 chars)'],
    });
  }

  const direction = resolveTransferDirection(
    args.packageId,
    args.sourceBrandId,
    args.destinationBrandId
  );
  if (!direction) {
    throw new ValidationError({ package_id: ['Unknown or invalid package direction'] });
  }

  const fingerprint = await sha256Hex(
    [
      args.userId,
      args.packageId,
      args.sourceBrandId,
      args.destinationBrandId,
      args.consentId,
      args.idempotencyKey,
      args.sourceContextId ?? '',
      args.destinationContextId ?? '',
    ].join('|')
  );

  const existingOp = await db(env)
    .select()
    .from(schema.transferPrepareOperations)
    .where(eq(schema.transferPrepareOperations.idempotency_fingerprint, fingerprint))
    .get();

  if (existingOp) {
    // Re-issue is not allowed for consumed JTIs; return conflict if expired.
    if (Date.parse(existingOp.expires_at) < Date.now()) {
      throw new ConflictError('Prepare idempotency key expired — use a new key');
    }
    throw new ConflictError('Prepare already issued for this Idempotency-Key');
  }

  const consent = await db(env)
    .select()
    .from(schema.transferConsents)
    .where(
      and(
        eq(schema.transferConsents.id, args.consentId),
        eq(schema.transferConsents.user_id, args.userId)
      )
    )
    .get();
  if (!consent || consent.status !== 'active') {
    throw new ForbiddenError('Active consent required');
  }
  if (
    consent.package_id !== args.packageId ||
    consent.source_brand_id !== args.sourceBrandId ||
    consent.destination_brand_id !== args.destinationBrandId
  ) {
    throw new ForbiddenError('Consent does not match package direction');
  }
  if (consent.expires_at && Date.parse(consent.expires_at) < Date.now()) {
    throw new ForbiddenError('Consent expired');
  }

  await ensureAppEntitlement(env, args.userId, args.sourceBrandId as JoinedRuntimeBrandId);
  await ensureAppEntitlement(env, args.userId, args.destinationBrandId as JoinedRuntimeBrandId);

  const pkg = getTransferPackage(args.packageId);
  if (!pkg) throw new ValidationError({ package_id: ['Unknown package'] });
  if (pkg.requiresSourceHousehold && !args.sourceContextId) {
    throw new ValidationError({ source_context_id: ['Source household required'] });
  }
  if (pkg.requiresDestinationHousehold && !args.destinationContextId) {
    throw new ValidationError({ destination_context_id: ['Destination household required'] });
  }

  const operationId = generateId();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const timestamp = now();
  const jtiHash = await sha256Hex(jti);

  await db(env).insert(schema.tokenExchangeJtis).values({
    jti_hash: jtiHash,
    user_id: args.userId,
    operation_id: operationId,
    package_id: args.packageId,
    source_brand_id: args.sourceBrandId,
    destination_brand_id: args.destinationBrandId,
    expires_at: expiresAt,
    created_at: timestamp,
  });

  await db(env).insert(schema.transferPrepareOperations).values({
    id: generateId(),
    user_id: args.userId,
    idempotency_fingerprint: fingerprint,
    package_id: args.packageId,
    source_brand_id: args.sourceBrandId,
    destination_brand_id: args.destinationBrandId,
    consent_id: args.consentId,
    operation_id: operationId,
    status: 'prepared',
    expires_at: expiresAt,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const transferToken = await signTransferExportToken(
    {
      sub: args.userId,
      operation_id: operationId,
      package_id: args.packageId,
      source_brand_id: args.sourceBrandId,
      destination_brand_id: args.destinationBrandId,
      context_id: args.sourceContextId ?? args.destinationContextId ?? 'none',
      jti,
    },
    env,
    120
  );

  return {
    operation_id: operationId,
    transfer_token: transferToken,
    expires_at: expiresAt,
    consent_id: args.consentId,
  };
}

/**
 * Atomically consume transfer JTI. Returns claims context when first consumer wins.
 */
export async function consumeTransferJti(
  env: Env,
  args: { jti: string; operationId: string; userId: string }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const jtiHash = await sha256Hex(args.jti);
  const row = await db(env)
    .select()
    .from(schema.tokenExchangeJtis)
    .where(eq(schema.tokenExchangeJtis.jti_hash, jtiHash))
    .get();
  if (!row) return { ok: false, reason: 'unknown_jti' };
  if (row.user_id !== args.userId) return { ok: false, reason: 'user_mismatch' };
  if (row.operation_id !== args.operationId) return { ok: false, reason: 'operation_mismatch' };
  if (Date.parse(row.expires_at) < Date.now()) return { ok: false, reason: 'expired' };
  if (row.consumed_at) return { ok: false, reason: 'already_consumed' };

  const result = await db(env)
    .update(schema.tokenExchangeJtis)
    .set({ consumed_at: now() })
    .where(
      and(
        eq(schema.tokenExchangeJtis.jti_hash, jtiHash),
        isNull(schema.tokenExchangeJtis.consumed_at)
      )
    )
    .run();

  // D1 run() may not expose changes consistently — re-read.
  const after = await db(env)
    .select()
    .from(schema.tokenExchangeJtis)
    .where(eq(schema.tokenExchangeJtis.jti_hash, jtiHash))
    .get();
  if (!after?.consumed_at) return { ok: false, reason: 'consume_failed' };
  void result;
  return { ok: true };
}

export async function getConsentForUser(env: Env, userId: string, consentId: string) {
  return db(env)
    .select()
    .from(schema.transferConsents)
    .where(
      and(eq(schema.transferConsents.id, consentId), eq(schema.transferConsents.user_id, userId))
    )
    .get();
}

export async function getPrepareOperation(env: Env, operationId: string) {
  return db(env)
    .select()
    .from(schema.transferPrepareOperations)
    .where(eq(schema.transferPrepareOperations.operation_id, operationId))
    .get();
}
