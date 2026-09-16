/**
 * Soft Transfer authority + envelope unit coverage.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { resolveTransferDirection } from '../../src/config/transfer-package-registry';
import { canonicalize, sha256Hex } from '../../src/services/soft-transfer/canonical-json';
import {
  schemaHashForManifest,
  signTransferEnvelope,
  verifyTransferEnvelope,
} from '../../src/services/soft-transfer/envelope';
import type { Env } from '../../src/types';
import {
  signTransferExportToken,
  verifyTransferExportToken,
} from '../../src/utils/platform-jwt';

import { baseEnv, generatePlatformKeyPair } from './helpers';

describe('Soft Transfer registry directions', () => {
  it('resolves House→Budget property + profile', () => {
    expect(
      resolveTransferDirection('house.property.v1', 'symply-house', 'symply-budget')
    ).toBeTruthy();
    expect(
      resolveTransferDirection('profile.core.v1', 'symply-house', 'symply-budget')
    ).toBeTruthy();
  });

  it('resolves Budget→House profile + summary', () => {
    expect(
      resolveTransferDirection('profile.core.v1', 'symply-budget', 'symply-house')
    ).toBeTruthy();
    expect(
      resolveTransferDirection('budget.summary.v1', 'symply-budget', 'symply-house')
    ).toBeTruthy();
  });

  it('accepts Health and Language package directions', () => {
    expect(
      resolveTransferDirection('profile.core.health.v1', 'symply-house', 'symply-health')
    ).toBeTruthy();
    expect(
      resolveTransferDirection('health.summary.v1', 'symply-health', 'symply-house')
    ).toBeTruthy();
    expect(
      resolveTransferDirection(
        'profile.core.language.v1',
        'symply-house',
        'symply-language'
      )
    ).toBeTruthy();
    expect(
      resolveTransferDirection(
        'language.summary.v1',
        'symply-language',
        'symply-house'
      )
    ).toBeTruthy();
    // Wrong package ID for Health destination still rejected
    expect(
      resolveTransferDirection('profile.core.v1', 'symply-house', 'symply-health')
    ).toBeUndefined();
  });
});

describe('Soft Transfer envelope + transfer JWT', () => {
  let env: Env;

  beforeAll(async () => {
    const keys = await generatePlatformKeyPair();
    env = baseEnv({
      APP_BRAND: 'symply-house',
      PLATFORM_JWT_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
      PLATFORM_JWT_PUBLIC_KEYS: keys.publicKeysJson,
      TRANSFER_ENVELOPE_PRIVATE_JWK: JSON.stringify(keys.privateJwk),
      TRANSFER_ENVELOPE_PUBLIC_KEYS: keys.publicKeysJson,
    });
  });

  it('canonicalizes object key order', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sha256 is stable', async () => {
    expect(await sha256Hex('x')).toBe(await sha256Hex('x'));
  });

  it('signs and verifies envelope', async () => {
    const schemaHash = await schemaHashForManifest('profile.core.v1', 1, [
      'displayName',
      'locale',
      'timezone',
    ]);
    const jws = await signTransferEnvelope(
      {
        package_id: 'profile.core.v1',
        schema_version: 1,
        schema_hash: schemaHash,
        field_manifest: ['displayName', 'locale', 'timezone'],
        purpose: 'test',
        user_id: 'u1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        operation_id: 'op1',
        consent_id: 'c1',
        consent_version: 1,
        context_id: 'none',
        exported_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        payload: { displayName: 'Ada', locale: 'en', timezone: 'UTC' },
      },
      env
    );
    const body = await verifyTransferEnvelope(jws, env);
    expect(body?.payload.displayName).toBe('Ada');
  });

  it('mints transfer+jwt', async () => {
    const token = await signTransferExportToken(
      {
        sub: 'u1',
        operation_id: 'op1',
        package_id: 'profile.core.v1',
        source_brand_id: 'symply-house',
        destination_brand_id: 'symply-budget',
        context_id: 'none',
      },
      env
    );
    const claims = await verifyTransferExportToken(token, env);
    expect(claims?.operation_id).toBe('op1');
  });
});
