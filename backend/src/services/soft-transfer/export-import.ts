/**
 * Soft Transfer export (source Worker) + import (destination Worker).
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { getAppBrand } from '../../config/brand';
import {
  isFullBudgetBrand,
  isHomeApiBrand,
  isJoinedPlatformBrandId,
  isPlatformAuthorityBrand,
  isPlatformAuthorityEnabled,
} from '../../config/brand-capabilities';
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
  ValidationError,
} from '../../utils/errors';
import { generateId, now } from '../../utils/id';
import {
  verifyTransferExportToken,
  hasPlatformJwtPrivateKey,
} from '../../utils/platform-jwt';
import { assertSoftTransferEnabled } from '../bridge-control';
import { getBudgetService, getHouseService } from '../inter-worker-client';

import {
  applyPackagePayload,
  assertClientPayloadAllowed,
  buildPackagePayload,
  normalizeBudgetSummaryClientPayload,
  shouldUseClientBudgetSummaryPayload,
} from './adapters';
import {
  consumeTransferJti,
  getConsentForUser,
  getPrepareOperation,
} from './authority';
import { sha256Hex } from './canonical-json';
import {
  envelopeIdHash,
  schemaHashForManifest,
  signTransferEnvelope,
  verifyTransferEnvelope,
  type TransferEnvelopeBody,
} from './envelope';


function db(env: Env) {
  return drizzle(env.DB, { schema });
}

type TransferBridgeRpc = {
  consumeTransferJti?(args: {
    jti: string;
    operationId: string;
    userId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  exportPackage?(args: {
    transferToken: string;
    sourceHouseholdId?: string | null;
  }): Promise<{ envelope: string; operation_id: string }>;
  importPackage?(args: {
    userId: string;
    envelope: string;
    idempotencyKey: string;
    destinationHouseholdId?: string | null;
  }): Promise<{ status: 'imported' | 'already_imported'; operation_id: string }>;
};

async function consumeJtiViaAuthority(
  env: Env,
  args: { jti: string; operationId: string; userId: string }
) {
  if (isPlatformAuthorityEnabled(env) && hasPlatformJwtPrivateKey(env)) {
    return consumeTransferJti(env, args);
  }
  const house = getHouseService(env) as TransferBridgeRpc | undefined;
  if (!house?.consumeTransferJti) {
    throw new ForbiddenError('House transfer authority unavailable');
  }
  return house.consumeTransferJti(args);
}

export async function exportTransferPackage(
  env: Env,
  args: {
    transferToken: string;
    sourceHouseholdId?: string | null;
    clientPayload?: Record<string, unknown> | null;
    localFirstClient?: boolean;
  }
): Promise<{ envelope: string; operation_id: string }> {
  await assertSoftTransferEnabled(env);

  const claims = await verifyTransferExportToken(args.transferToken, env);
  if (!claims?.sub || !claims.jti || !claims.operation_id) {
    throw new ForbiddenError('Invalid transfer token');
  }

  const brand = getAppBrand(env);
  const packageIdClaim = String(claims.package_id);
  // Language Worker has no shared Soft Transfer crypto — House builds stub
  // language.summary.v1 envelopes when Language proxies export via HOUSE_SERVICE.
  // Sibling summary stubs (no product DB on House) when Language/Health proxy export
  // or House initiates "Import from …" for POC packages.
  const sourceBrandId = String(claims.source_brand_id);
  const houseBuildsSiblingSummaryStub =
    isPlatformAuthorityEnabled(env) &&
    isHomeApiBrand(brand) &&
    isJoinedPlatformBrandId(sourceBrandId) &&
    !isHomeApiBrand(sourceBrandId) &&
    !isFullBudgetBrand(sourceBrandId) &&
    ((packageIdClaim === 'language.summary.v1' && sourceBrandId === 'symply-language') ||
      (packageIdClaim === 'health.summary.v1' && sourceBrandId === 'symply-health'));
  if (claims.source_brand_id !== brand) {
    const houseMayExportForHomeSource =
      isPlatformAuthorityEnabled(env) && isHomeApiBrand(claims.source_brand_id);
    if (!houseMayExportForHomeSource && !houseBuildsSiblingSummaryStub) {
      throw new ForbiddenError('Export must run on source brand Worker');
    }
  }

  const consumed = await consumeJtiViaAuthority(env, {
    jti: String(claims.jti),
    operationId: String(claims.operation_id),
    userId: String(claims.sub),
  });
  if (!consumed.ok) {
    throw new ForbiddenError(`Transfer token not usable (${consumed.reason})`);
  }

  const packageId = String(claims.package_id) as TransferPackageId;
  const direction = resolveTransferDirection(
    packageId,
    String(claims.source_brand_id),
    String(claims.destination_brand_id)
  );
  if (!direction) throw new ValidationError({ package_id: ['Invalid direction'] });

  const pkg = getTransferPackage(packageId)!;
  const sourceHouseholdId =
    args.sourceHouseholdId ??
    (claims.context_id && claims.context_id !== 'none' ? String(claims.context_id) : null);

  assertClientPayloadAllowed({
    packageId,
    sourceBrandId: String(claims.source_brand_id),
    localFirstClient: args.localFirstClient === true,
    clientPayload: args.clientPayload,
  });

  const payload = await resolveExportEnvelopePayload(env, {
    packageId,
    userId: String(claims.sub),
    sourceHouseholdId,
    sourceBrandId: String(claims.source_brand_id),
    clientPayload: args.clientPayload,
    localFirstClient: args.localFirstClient,
  });

  // Prefer prepare operation consent when available (House D1).
  let consentId = 'unknown';
  let consentVersion = 1;
  let purpose: string = packageId;
  if (isPlatformAuthorityEnabled(env)) {
    const op = await getPrepareOperation(env, String(claims.operation_id));
    if (op?.consent_id) {
      consentId = op.consent_id;
      const consent = await getConsentForUser(env, String(claims.sub), op.consent_id);
      if (consent) {
        consentVersion = consent.consent_version;
        purpose = consent.purpose;
      }
    }
  }

  const schemaHash = await schemaHashForManifest(packageId, pkg.version, pkg.fieldManifest);
  const exportedAt = now();
  const expiresAt = new Date(Date.now() + pkg.maxEnvelopeTtlMs).toISOString();

  const body: TransferEnvelopeBody = {
    package_id: packageId,
    schema_version: pkg.version,
    schema_hash: schemaHash,
    field_manifest: [...pkg.fieldManifest],
    purpose,
    user_id: String(claims.sub),
    source_brand_id: String(claims.source_brand_id),
    destination_brand_id: String(claims.destination_brand_id),
    operation_id: String(claims.operation_id),
    consent_id: consentId,
    consent_version: consentVersion,
    context_id: String(claims.context_id ?? 'none'),
    exported_at: exportedAt,
    expires_at: expiresAt,
    payload,
  };

  const envelope = await signTransferEnvelope(body, env);

  await db(env).insert(schema.transferPackageEvents).values({
    id: generateId(),
    package_id: packageId,
    package_version: pkg.version,
    user_id: String(claims.sub),
    source_brand_id: String(claims.source_brand_id),
    destination_brand_id: String(claims.destination_brand_id),
    consent_id: consentId === 'unknown' ? null : consentId,
    operation_id: String(claims.operation_id),
    event_type: 'export',
    event_status: 'ok',
    envelope_id_hash: await envelopeIdHash(envelope),
    created_at: now(),
  });

  return { envelope, operation_id: String(claims.operation_id) };
}

/** Resolve signed envelope payload — client summary or D1 builder. */
export async function resolveExportEnvelopePayload(
  env: Env,
  args: {
    packageId: TransferPackageId;
    userId: string;
    sourceHouseholdId?: string | null;
    sourceBrandId: string;
    clientPayload?: Record<string, unknown> | null;
    localFirstClient?: boolean;
  }
): Promise<Record<string, unknown>> {
  assertClientPayloadAllowed({
    packageId: args.packageId,
    sourceBrandId: args.sourceBrandId,
    localFirstClient: args.localFirstClient === true,
    clientPayload: args.clientPayload,
  });

  if (
    shouldUseClientBudgetSummaryPayload({
      packageId: args.packageId,
      sourceBrandId: args.sourceBrandId,
      localFirstClient: args.localFirstClient === true,
      clientPayload: args.clientPayload,
    })
  ) {
    return normalizeBudgetSummaryClientPayload(args.clientPayload!);
  }

  return buildPackagePayload(env, {
    packageId: args.packageId,
    userId: args.userId,
    sourceHouseholdId: args.sourceHouseholdId,
  });
}

/**
 * When Budget needs a House-sourced envelope, call House RPC export.
 */
export async function exportFromHouseViaRpc(
  env: Env,
  args: { transferToken: string; sourceHouseholdId?: string | null }
): Promise<{ envelope: string; operation_id: string }> {
  const house = getHouseService(env) as TransferBridgeRpc | undefined;
  if (!house?.exportPackage) {
    throw new ForbiddenError('House export RPC unavailable');
  }
  return house.exportPackage(args);
}

/**
 * When the local Worker is not the destination, forward import to the
 * destination brand via service binding (House summaries / Budget property).
 */
export async function importViaDestinationRpc(
  env: Env,
  args: {
    userId: string;
    envelope: string;
    idempotencyKey: string;
    destinationHouseholdId?: string | null;
    destinationBrandId: string;
  }
): Promise<{ status: 'imported' | 'already_imported'; operation_id: string }> {
  let rpc: TransferBridgeRpc | undefined;
  if (isPlatformAuthorityBrand(args.destinationBrandId)) {
    rpc = getHouseService(env) as TransferBridgeRpc | undefined;
  } else if (isFullBudgetBrand(args.destinationBrandId)) {
    rpc = getBudgetService(env) as TransferBridgeRpc | undefined;
  }
  if (!rpc?.importPackage) {
    throw new ForbiddenError(
      `Import RPC unavailable for destination ${args.destinationBrandId}`
    );
  }
  return rpc.importPackage({
    userId: args.userId,
    envelope: args.envelope,
    idempotencyKey: args.idempotencyKey,
    destinationHouseholdId: args.destinationHouseholdId,
  });
}

export async function importTransferPackage(
  env: Env,
  args: {
    userId: string;
    envelope: string;
    idempotencyKey: string;
    destinationHouseholdId?: string | null;
  }
): Promise<{ status: 'imported' | 'already_imported'; operation_id: string }> {
  await assertSoftTransferEnabled(env);

  if (!args.idempotencyKey || args.idempotencyKey.length < 16) {
    throw new ValidationError({
      idempotency_key: ['Idempotency-Key must be ≥128-bit CSPRNG (≥16 chars)'],
    });
  }

  const body = await verifyTransferEnvelope(args.envelope, env);
  if (!body) throw new ForbiddenError('Invalid or expired envelope');
  if (body.user_id !== args.userId) throw new ForbiddenError('Envelope user mismatch');

  const brand = getAppBrand(env);
  if (body.destination_brand_id !== brand) {
    throw new ForbiddenError('Import must run on destination brand Worker');
  }

  const direction = resolveTransferDirection(
    body.package_id,
    body.source_brand_id,
    body.destination_brand_id
  );
  if (!direction) throw new ValidationError({ package_id: ['Invalid direction'] });

  const fingerprint = await sha256Hex(
    [args.userId, body.operation_id, args.idempotencyKey, body.package_id].join('|')
  );

  const existing = await db(env)
    .select()
    .from(schema.transferImportReceipts)
    .where(eq(schema.transferImportReceipts.idempotency_fingerprint, fingerprint))
    .get();
  if (existing) {
    return { status: 'already_imported', operation_id: existing.operation_id };
  }

  const byOp = await db(env)
    .select()
    .from(schema.transferImportReceipts)
    .where(eq(schema.transferImportReceipts.operation_id, body.operation_id))
    .get();
  if (byOp) {
    return { status: 'already_imported', operation_id: byOp.operation_id };
  }

  await applyPackagePayload(env, {
    packageId: body.package_id as TransferPackageId,
    userId: args.userId,
    destinationHouseholdId: args.destinationHouseholdId,
    payload: body.payload,
    operationId: body.operation_id,
  });

  try {
    await db(env).insert(schema.transferImportReceipts).values({
      id: generateId(),
      user_id: args.userId,
      operation_id: body.operation_id,
      idempotency_fingerprint: fingerprint,
      package_id: body.package_id,
      source_brand_id: body.source_brand_id,
      destination_brand_id: body.destination_brand_id,
      consent_id: body.consent_id === 'unknown' ? null : body.consent_id,
      status: 'imported',
      created_at: now(),
    });
  } catch {
    const again = await db(env)
      .select()
      .from(schema.transferImportReceipts)
      .where(
        and(
          eq(schema.transferImportReceipts.operation_id, body.operation_id)
        )
      )
      .get();
    if (again) {
      return { status: 'already_imported', operation_id: again.operation_id };
    }
    throw new ConflictError('Import receipt conflict');
  }

  await db(env).insert(schema.transferPackageEvents).values({
    id: generateId(),
    package_id: body.package_id,
    package_version: body.schema_version,
    user_id: args.userId,
    source_brand_id: body.source_brand_id,
    destination_brand_id: body.destination_brand_id,
    consent_id: body.consent_id === 'unknown' ? null : body.consent_id,
    operation_id: body.operation_id,
    event_type: 'import',
    event_status: 'ok',
    envelope_id_hash: await envelopeIdHash(args.envelope),
    created_at: now(),
  });

  return { status: 'imported', operation_id: body.operation_id };
}
