/**
 * PlatformBridgeApi — named WorkerEntrypoint for inter-Worker RPC.
 * Service bindings declare entrypoint = "PlatformBridgeApi".
 */
import { WorkerEntrypoint } from 'cloudflare:workers';

import { getAppBrand } from './config/brand';
import {
  isJoinedPlatformBrandId,
  isPlatformAuthorityEnabled,
} from './config/brand-capabilities';
import {
  audienceForBrand,
  type JoinedRuntimeBrandId,
} from './config/platform-brands';
import { assertSoftTransferEnabled, getBridgeControlFlag, type BridgeControlKey } from './services/bridge-control';
import {
  consumeTransferJti,
  grantConsent,
  listConsents,
  prepareTransfer,
  revokeConsent,
} from './services/soft-transfer/authority';
import { verifyTransferEnvelope } from './services/soft-transfer/envelope';
import {
  exportTransferPackage,
  importTransferPackage,
} from './services/soft-transfer/export-import';
import type { Env } from './types';
import {
  hasPlatformJwtPublicKeys,
  verifyProductAccessToken,
} from './utils/platform-jwt';

export class PlatformBridgeApi extends WorkerEntrypoint<Env> {
  async ping(): Promise<{ ok: true; brand: string }> {
    return { ok: true, brand: getAppBrand(this.env) };
  }

  /**
   * House-only: resolve a product access token for a joined child caller.
   * Children must never mint; they may ask House to validate.
   * Audience is the caller's app (`symply-*-app`), not House.
   */
  async resolveSession(args: {
    accessToken: string;
    callerBrand: string;
  }): Promise<{ sub: string; ent_ver: number; sid: string } | null> {
    if (!isPlatformAuthorityEnabled(this.env)) {
      throw new Error('resolveSession is House-only');
    }
    if (!isJoinedPlatformBrandId(args.callerBrand)) {
      return null;
    }
    if (!hasPlatformJwtPublicKeys(this.env)) {
      return null;
    }
    const payload = await verifyProductAccessToken(
      args.accessToken,
      this.env,
      audienceForBrand(args.callerBrand as JoinedRuntimeBrandId)
    );
    if (!payload?.sub || typeof payload.sid !== 'string') return null;
    const entVer =
      typeof payload.ent_ver === 'number' ? payload.ent_ver : Number(payload.ent_ver ?? 0);
    return { sub: payload.sub, ent_ver: entVer, sid: payload.sid };
  }

  async getBridgeControlFlag(args: { key: BridgeControlKey }): Promise<boolean> {
    this.assertHouse();
    return getBridgeControlFlag(this.env, args.key);
  }

  /** House Soft Transfer authority — list consents. */
  async listTransferConsents(args: { userId: string }) {
    this.assertHouse();
    await assertSoftTransferEnabled(this.env);
    return listConsents(this.env, args.userId);
  }

  async grantTransferConsent(args: {
    userId: string;
    packageId: string;
    sourceBrandId: string;
    destinationBrandId: string;
    purpose?: string;
    expiresAt?: string | null;
  }) {
    this.assertHouse();
    return grantConsent(this.env, args);
  }

  async revokeTransferConsent(args: { userId: string; consentId: string }) {
    this.assertHouse();
    return revokeConsent(this.env, args.userId, args.consentId);
  }

  async prepareTransfer(args: {
    userId: string;
    packageId: string;
    sourceBrandId: string;
    destinationBrandId: string;
    consentId: string;
    idempotencyKey: string;
    sourceContextId?: string | null;
    destinationContextId?: string | null;
  }) {
    this.assertHouse();
    return prepareTransfer(this.env, args);
  }

  async consumeTransferJti(args: {
    jti: string;
    operationId: string;
    userId: string;
  }) {
    this.assertHouse();
    return consumeTransferJti(this.env, args);
  }

  /** House-sourced package export (after transfer JWT issued). */
  async exportPackage(args: {
    transferToken: string;
    sourceHouseholdId?: string | null;
  }) {
    this.assertHouse();
    return exportTransferPackage(this.env, args);
  }

  /**
   * Destination-side import — callable on House (summaries) or Budget (House→Budget)
   * via service binding. Does not require platform authority on the callee brand.
   */
  async importPackage(args: {
    userId: string;
    envelope: string;
    idempotencyKey: string;
    destinationHouseholdId?: string | null;
  }) {
    await assertSoftTransferEnabled(this.env);
    return importTransferPackage(this.env, args);
  }

  /**
   * Language Worker import path — verify signed envelope on House (shared crypto).
   * Returns payload body when ok; does not apply destination-side mutations.
   */
  async verifyTransferEnvelope(args: {
    envelope: string;
    userId: string;
    destinationBrandId: string;
  }): Promise<
    | { ok: true; body: Record<string, unknown> }
    | { ok: false; reason: string }
  > {
    this.assertHouse();
    await assertSoftTransferEnabled(this.env);
    const body = await verifyTransferEnvelope(args.envelope, this.env);
    if (!body) return { ok: false, reason: 'invalid_or_expired' };
    if (body.user_id !== args.userId) return { ok: false, reason: 'user_mismatch' };
    if (body.destination_brand_id !== args.destinationBrandId) {
      return { ok: false, reason: 'destination_mismatch' };
    }
    return { ok: true, body: body as unknown as Record<string, unknown> };
  }

  private assertHouse(): void {
    if (!isPlatformAuthorityEnabled(this.env)) {
      throw new Error('Soft Transfer authority is House-only');
    }
  }
}
