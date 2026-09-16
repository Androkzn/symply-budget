/**
 * Soft Transfer / smart-engine routes — House authority + local export/import.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { getAppBrand } from '../config/brand';
import {
  isPlatformAuthorityEnabled,
  shouldProxyHouseTransferExport,
} from '../config/brand-capabilities';
import { TRANSFER_PACKAGES } from '../config/transfer-package-registry';
import { authMiddleware } from '../middleware/auth';
import { isLocalFirstClient } from '../middleware/budget-local-first-gate';
import { checkRateLimitDO } from '../middleware/rate-limit';
import { assertSoftTransferEnabled } from '../services/bridge-control';
import { getHouseService } from '../services/inter-worker-client';
import {
  grantConsent,
  listConsents,
  prepareTransfer,
  revokeConsent,
} from '../services/soft-transfer/authority';
import { peekTransferEnvelopeDestination } from '../services/soft-transfer/envelope';
import {
  exportFromHouseViaRpc,
  exportTransferPackage,
  importTransferPackage,
  importViaDestinationRpc,
} from '../services/soft-transfer/export-import';
import type { Env } from '../types';
import { ForbiddenError, ValidationError } from '../utils/errors';
import { hasPlatformJwtPrivateKey } from '../utils/platform-jwt';

const smartEngine = new Hono<{ Bindings: Env }>();

smartEngine.use('*', authMiddleware());

smartEngine.use('*', async (c, next) => {
  await assertSoftTransferEnabled(c.env);
  await next();
});

type HouseAuthorityRpc = {
  listTransferConsents?(args: { userId: string }): Promise<unknown>;
  grantTransferConsent?(args: Record<string, unknown>): Promise<unknown>;
  revokeTransferConsent?(args: { userId: string; consentId: string }): Promise<unknown>;
  prepareTransfer?(args: Record<string, unknown>): Promise<unknown>;
};

function houseAuthority(env: Env): HouseAuthorityRpc | null {
  if (isPlatformAuthorityEnabled(env) && hasPlatformJwtPrivateKey(env)) {
    return null; // use local authority
  }
  return (getHouseService(env) as HouseAuthorityRpc | undefined) ?? null;
}

smartEngine.get('/packages', (c) => {
  return c.json({
    data: Object.values(TRANSFER_PACKAGES).map((p) => ({
      package_id: p.packageId,
      version: p.version,
      source_brand_id: p.sourceBrandId,
      destination_brand_id: p.destinationBrandId,
      field_manifest: p.fieldManifest,
      requires_source_household: p.requiresSourceHousehold,
      requires_destination_household: p.requiresDestinationHousehold,
    })),
  });
});

smartEngine.get('/consents', async (c) => {
  const userId = c.get('userId');
  const remote = houseAuthority(c.env);
  if (remote?.listTransferConsents) {
    const data = await remote.listTransferConsents({ userId });
    return c.json({ data });
  }
  const data = await listConsents(c.env, userId);
  return c.json({ data });
});

const grantSchema = z.object({
  package_id: z.string().min(1),
  source_brand_id: z.string().min(1),
  destination_brand_id: z.string().min(1),
  purpose: z.string().max(500).optional(),
  expires_at: z.string().nullable().optional(),
});

smartEngine.post('/consents', async (c) => {
  const userId = c.get('userId');
  const rl = await checkRateLimitDO(c.env, 'transfer:prepare', userId);
  if (!rl.allowed) throw new ForbiddenError('Rate limited');

  const body = grantSchema.parse(await c.req.json());
  const remote = houseAuthority(c.env);
  if (remote?.grantTransferConsent) {
    const data = await remote.grantTransferConsent({
      userId,
      packageId: body.package_id,
      sourceBrandId: body.source_brand_id,
      destinationBrandId: body.destination_brand_id,
      purpose: body.purpose,
      expiresAt: body.expires_at,
    });
    return c.json({ data }, 201);
  }
  const data = await grantConsent(c.env, {
    userId,
    packageId: body.package_id,
    sourceBrandId: body.source_brand_id,
    destinationBrandId: body.destination_brand_id,
    purpose: body.purpose,
    expiresAt: body.expires_at,
  });
  return c.json({ data }, 201);
});

smartEngine.delete('/consents/:consentId', async (c) => {
  const userId = c.get('userId');
  const consentId = c.req.param('consentId');
  const remote = houseAuthority(c.env);
  if (remote?.revokeTransferConsent) {
    const data = await remote.revokeTransferConsent({ userId, consentId });
    return c.json({ data });
  }
  const data = await revokeConsent(c.env, userId, consentId);
  return c.json({ data });
});

const prepareSchema = z.object({
  package_id: z.string().min(1),
  source_brand_id: z.string().min(1),
  destination_brand_id: z.string().min(1),
  consent_id: z.string().min(1),
  source_context_id: z.string().nullable().optional(),
  destination_context_id: z.string().nullable().optional(),
});

smartEngine.post('/prepare', async (c) => {
  const userId = c.get('userId');
  const rl = await checkRateLimitDO(c.env, 'transfer:prepare', userId);
  if (!rl.allowed) throw new ForbiddenError('Rate limited');

  const idempotencyKey =
    c.req.header('Idempotency-Key') || c.req.header('idempotency-key') || '';
  const body = prepareSchema.parse(await c.req.json());
  const args = {
    userId,
    packageId: body.package_id,
    sourceBrandId: body.source_brand_id,
    destinationBrandId: body.destination_brand_id,
    consentId: body.consent_id,
    idempotencyKey,
    sourceContextId: body.source_context_id,
    destinationContextId: body.destination_context_id,
  };

  const remote = houseAuthority(c.env);
  if (remote?.prepareTransfer) {
    const data = await remote.prepareTransfer(args);
    return c.json({ data });
  }
  const data = await prepareTransfer(c.env, args);
  return c.json({ data });
});

const exportSchema = z.object({
  transfer_token: z.string().min(1),
  source_household_id: z.string().nullable().optional(),
  client_payload: z.record(z.unknown()).optional(),
});

smartEngine.post('/export', async (c) => {
  const userId = c.get('userId');
  const rl = await checkRateLimitDO(c.env, 'transfer:prepare', userId);
  if (!rl.allowed) throw new ForbiddenError('Rate limited');

  const body = exportSchema.parse(await c.req.json());
  const brand = getAppBrand(c.env);

  // Peek source brand from JWT payload without full verify (base64 mid segment).
  let sourceBrand = brand;
  try {
    const mid = body.transfer_token.split('.')[1];
    if (mid) {
      const json = JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/')));
      if (typeof json.source_brand_id === 'string') sourceBrand = json.source_brand_id;
    }
  } catch {
    // fall through — export will verify properly
  }

  if (shouldProxyHouseTransferExport(sourceBrand, c.env)) {
    const data = await exportFromHouseViaRpc(c.env, {
      transferToken: body.transfer_token,
      sourceHouseholdId: body.source_household_id,
    });
    return c.json({ data });
  }

  if (sourceBrand !== brand) {
    throw new ValidationError({
      transfer_token: [`Export must run on source Worker (${sourceBrand})`],
    });
  }

  const data = await exportTransferPackage(c.env, {
    transferToken: body.transfer_token,
    sourceHouseholdId: body.source_household_id,
    clientPayload: body.client_payload,
    localFirstClient: isLocalFirstClient(c),
  });
  return c.json({ data });
});

const importSchema = z.object({
  envelope: z.string().min(1),
  destination_household_id: z.string().nullable().optional(),
});

smartEngine.post('/import', async (c) => {
  const userId = c.get('userId');
  const rl = await checkRateLimitDO(c.env, 'transfer:import', userId);
  if (!rl.allowed) throw new ForbiddenError('Rate limited');

  const idempotencyKey =
    c.req.header('Idempotency-Key') || c.req.header('idempotency-key') || '';
  const body = importSchema.parse(await c.req.json());
  const brand = getAppBrand(c.env);
  const destinationBrand =
    peekTransferEnvelopeDestination(body.envelope) ?? brand;

  if (destinationBrand !== brand) {
    const data = await importViaDestinationRpc(c.env, {
      userId,
      envelope: body.envelope,
      idempotencyKey,
      destinationHouseholdId: body.destination_household_id,
      destinationBrandId: destinationBrand,
    });
    return c.json({ data });
  }

  const data = await importTransferPackage(c.env, {
    userId,
    envelope: body.envelope,
    idempotencyKey,
    destinationHouseholdId: body.destination_household_id,
  });
  return c.json({ data });
});

export default smartEngine;
