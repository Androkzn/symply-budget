/**
 * Fail-closed brand resolution + bridge control defaults.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import {
  getAppBrand,
  UnknownAppBrandError,
  isJoinedPlatformBrand,
} from '../../src/config/brand';
import { isHomeApiEnabled } from '../../src/config/brand-capabilities';
import {
  assertPlatformRegistrationEnabled,
  assertSoftTransferEnabled,
  assertRealtimeVoiceEnabled,
  getBridgeControlFlag,
} from '../../src/services/bridge-control';
import type { Env } from '../../src/types';

import { createPlatformMirrorTables } from './helpers';

const testEnv = env as unknown as Env;

describe('getAppBrand fail-closed', () => {
  it('throws 503-shaped error for missing brand', () => {
    try {
      getAppBrand({} as Env);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownAppBrandError);
      expect((e as UnknownAppBrandError).status).toBe(503);
      expect((e as UnknownAppBrandError).code).toBe('misconfigured_app_brand');
    }
  });

  it('throws for unknown brand id', () => {
    expect(() => getAppBrand({ APP_BRAND: 'simple-house' } as Env)).toThrow(
      UnknownAppBrandError
    );
  });

  it('accepts known brands and joins House/Budget/Kaizen/Health', () => {
    expect(getAppBrand({ APP_BRAND: 'symply-house' } as Env)).toBe('symply-house');
    expect(isJoinedPlatformBrand('symply-budget')).toBe(true);
    expect(isJoinedPlatformBrand('symply-health')).toBe(true);
    expect(isHomeApiEnabled({ APP_BRAND: 'symply-house' } as Env)).toBe(true);
    expect(isHomeApiEnabled({ APP_BRAND: 'symply-budget' } as Env)).toBe(false);
  });
});

describe('Symply Health backend gating', () => {
  // Health runs the SAME shared Worker as House: Soft Transfer joined, but never
  // House-domain APIs (tasks, garbage, AI Housekeeper) into its isolated D1.
  it('resolves symply-health as joined without home API', () => {
    expect(getAppBrand({ APP_BRAND: 'symply-health' } as Env)).toBe('symply-health');
    expect(isHomeApiEnabled({ APP_BRAND: 'symply-health' } as Env)).toBe(false);
    expect(isJoinedPlatformBrand('symply-health')).toBe(true);
  });

  it('trims whitespace and still resolves the health brand', () => {
    expect(getAppBrand({ APP_BRAND: ' symply-health ' } as Env)).toBe('symply-health');
  });
});

describe('bridge control defaults (fail closed)', () => {
  it('defaults registration / soft transfer / realtime to false', async () => {
    await createPlatformMirrorTables(testEnv.DB);
    const e = { ...testEnv, APP_BRAND: 'symply-house' } as Env;
    expect(await getBridgeControlFlag(e, 'platformRegistrationEnabled')).toBe(false);
    expect(await getBridgeControlFlag(e, 'softTransferEnabled')).toBe(false);
    expect(await getBridgeControlFlag(e, 'realtimeVoiceEnabled')).toBe(false);

    // Registration is open for all Symply apps now — the gate no longer throws.
    await expect(assertPlatformRegistrationEnabled(e)).resolves.toBeUndefined();
    await expect(assertSoftTransferEnabled(e)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
    await expect(assertRealtimeVoiceEnabled(e)).rejects.toMatchObject({
      name: 'ForbiddenError',
    });
  });
});
