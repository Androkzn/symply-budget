/**
 * House D1 authority for bridge kill switches (first-primary session when available).
 * KV / FEATURE_DEFAULTS never authorize — only mirror UI chrome.
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

import { isPlatformAuthorityEnabled } from '../config/brand-capabilities';
import * as schema from '../db/schema';
import type { Env } from '../types';
import { ForbiddenError } from '../utils/errors';

import { platformMetric } from './observability/platform-metrics';


export type BridgeControlKey =
  | 'platformRegistrationEnabled'
  | 'softTransferEnabled'
  | 'lifeSnapshotEnabled'
  | 'realtimeVoiceEnabled';

const FALSE_DEFAULTS: Record<BridgeControlKey, boolean> = {
  platformRegistrationEnabled: false,
  softTransferEnabled: false,
  lifeSnapshotEnabled: false,
  realtimeVoiceEnabled: false,
};

function sessionDb(env: Env) {
  const dbBinding = env.DB as D1Database & {
    withSession?: (constraint: string) => D1Database;
  };
  const session =
    typeof dbBinding.withSession === 'function'
      ? dbBinding.withSession('first-primary')
      : dbBinding;
  return drizzle(session as D1Database, { schema });
}

export async function getBridgeControlFlag(
  env: Env,
  key: BridgeControlKey
): Promise<boolean> {
  try {
    const db = sessionDb(env);
    const row = await db
      .select()
      .from(schema.platformBridgeControl)
      .where(eq(schema.platformBridgeControl.key, key))
      .get();
    if (!row) return FALSE_DEFAULTS[key];
    return row.value === 'true' || row.value === '1';
  } catch (error) {
    console.error('[bridge-control] read failed; denying', key, (error as Error).message);
    platformMetric(env, 'platform_bridge_control_denial', 1, {
      key,
      reason: 'read_failed',
    });
    return false;
  }
}

export function assertPlatformRegistrationEnabled(_env: Env): Promise<void> {
  // Public registration is open for all Symply apps — intentionally ungated
  // (product decision 2026-07-16). The platformBridgeControl kill-switch still
  // governs the other bridge gates; registration simply no longer consults it.
  return Promise.resolve();
}

export async function assertSoftTransferEnabled(env: Env): Promise<void> {
  if (!isPlatformAuthorityEnabled(env)) {
    try {
      const house = env.HOUSE_SERVICE as
        | { getBridgeControlFlag?(args: { key: BridgeControlKey }): Promise<boolean> }
        | undefined;
      if (house?.getBridgeControlFlag) {
        const enabled = await house.getBridgeControlFlag({ key: 'softTransferEnabled' });
        if (!enabled) {
          platformMetric(env, 'platform_bridge_control_denial', 1, {
            key: 'softTransferEnabled',
            reason: 'disabled_via_house',
          });
          throw new ForbiddenError('Soft Transfer is disabled');
        }
        return;
      }
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      console.warn('[bridge-control] House softTransfer check failed; denying', (error as Error).message);
      platformMetric(env, 'platform_bridge_control_denial', 1, {
        key: 'softTransferEnabled',
        reason: 'house_check_failed',
      });
      throw new ForbiddenError('Soft Transfer is disabled');
    }
  }
  const enabled = await getBridgeControlFlag(env, 'softTransferEnabled');
  if (!enabled) {
    platformMetric(env, 'platform_bridge_control_denial', 1, {
      key: 'softTransferEnabled',
      reason: 'disabled',
    });
    throw new ForbiddenError('Soft Transfer is disabled');
  }
}

export async function assertRealtimeVoiceEnabled(env: Env): Promise<void> {
  const enabled = await getBridgeControlFlag(env, 'realtimeVoiceEnabled');
  if (!enabled) {
    platformMetric(env, 'platform_bridge_control_denial', 1, {
      key: 'realtimeVoiceEnabled',
      reason: 'disabled',
    });
    throw new ForbiddenError('Realtime voice is disabled');
  }
}
